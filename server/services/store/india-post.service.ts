/**
 * India Post (Department of Posts, CEPT "beextcustomer" API) for store parcels:
 * pincode check, postage, booking, the address label, bulk tracking and the
 * event webhook.
 *
 * Modes (INDIA_POST_MODE):
 *  - live: real calls. Needs INDIA_POST_USERNAME, INDIA_POST_PASSWORD,
 *    INDIA_POST_CUSTOMER_ID (10-digit bulk customer id) and the contract id
 *    of each product used (INDIA_POST_CONTRACT_SP, _BP). INDIA_POST_BASE_URL
 *    is the test system until India Post issues production access.
 *  - mock: stubbed answers shaped like the real ones, so the whole flow
 *    (book, label, tracking, delivered) can be used before the contract exists.
 *  - off: not offered. The default in production when nothing is set.
 *
 * India Post whitelists the caller's IP for production. Render's outbound IP
 * is not fixed on every plan; INDIA_POST_PROXY_URL routes these calls through
 * a fixed-IP proxy when needed.
 */

import crypto from 'crypto';
import axios, { type AxiosInstance } from 'axios';
import { db } from '../../db';
import { sql, eq } from 'drizzle-orm';
import { indiaPostPincodes } from '@shared/schema';
import { GST_STATES } from '@shared/hub';
import logger from '../../lib/logger';

export type IpMode = 'live' | 'mock' | 'off';
export type IpProduct = 'SP' | 'BP';
export type TrackingStatus = 'booked' | 'pickup_cancelled' | 'handed_over' | 'in_transit' | 'on_hold' | 'out_for_delivery' | 'delivered' | 'returning' | 'returned';

export interface IpParty { name: string; company: string; lines: string[]; city: string; state?: string | null; pincode: string; mobile: string; email?: string | null }
export interface IpParcel { weightGrams: number; lengthCm: number; widthCm: number; heightCm: number }
export interface IpOffice { officeId: string; name: string; type: string; delivers: boolean; city: string | null; state: string | null }
export interface PincodeInfo { pincode: string; deliverable: boolean; stateName: string | null; stateCode: string | null; city: string | null; officeId: string | null; offices: IpOffice[] }
export interface IpTariff { productCode: string; chargeableWeight: number; basePaise: number; taxPaise: number; totalPaise: number; deliveryType: string | null; assuredBy: string | null }
export interface IpEvent { code: string | null; description: string; office: string | null; at: Date; rts: boolean; raw: unknown }

export class IndiaPostError extends Error {
    constructor(message: string, public code = 'INDIA_POST', public status = 502, public details?: string[]) { super(message); }
}

/** Dimension limits from India Post's approach document (cm, grams). */
const LIMITS: Record<string, { w: [number, number]; l: [number, number]; b: [number, number]; h: [number, number] }> = {
    SP_INLAND_DOC: { w: [1, 500], l: [1, 42], b: [1, 29], h: [1, 2] },
    SP_INLAND_PARCEL: { w: [1, 35000], l: [14, 150], b: [9, 150], h: [1, 150] },
    BUSINESS_PARCEL: { w: [1, 35000], l: [14, 150], b: [9, 150], h: [1, 150] },
};

// ── Article numbers (UPU S10) ─────────────────────────────────────────────

const S10_WEIGHTS = [8, 6, 4, 2, 3, 5, 9, 7];

/** The check digit for an 8-digit serial: weighted modulus 11, per India Post's barcode logic. */
export function s10CheckDigit(serial8: string): number {
    if (!/^\d{8}$/.test(serial8)) throw new Error('serial must be 8 digits');
    const sum = serial8.split('').reduce((a, d, i) => a + Number(d) * S10_WEIGHTS[i], 0);
    const c = 11 - (sum % 11);
    return c === 10 ? 0 : c === 11 ? 5 : c;
}

/** EK + 8-digit serial + check digit + IN. */
export function articleNumber(prefix: string, serial: number): string {
    const s = String(serial).padStart(8, '0');
    return `${prefix.toUpperCase()}${s}${s10CheckDigit(s)}IN`;
}

export function isValidArticleNumber(a: string): boolean {
    const m = /^([A-Z]{2})(\d{8})(\d)([A-Z]{2})$/.exec(String(a ?? '').toUpperCase());
    return !!m && s10CheckDigit(m[2]) === Number(m[3]);
}

// ── Event codes → what they mean for an order ─────────────────────────────

const RANK: Record<TrackingStatus, number> = { booked: 0, pickup_cancelled: 0, handed_over: 1, in_transit: 2, on_hold: 3, out_for_delivery: 3, delivered: 5, returning: 6, returned: 7 };

/**
 * One India Post event (webhook code or tracking text) as a status. Returns
 * null for events that do not move anything (unknown wording is recorded only).
 */
export function statusOf(code: string | null | undefined, description: string | null | undefined, rts = false): TrackingStatus | null {
    const c = String(code ?? '').trim().toUpperCase();
    const d = String(description ?? '').trim().toLowerCase();
    if (c === 'ITEM_DELIVERY' || d.startsWith('item delivered')) return d.includes('sender') || rts ? 'returned' : 'delivered';
    if (c === 'ITEM_RETURN' || d.includes('returned to sender')) return 'returning';
    if (c === 'CANCELLED' || d.includes('pickup cancelled')) return 'pickup_cancelled';
    if (c === 'UNASSIGNED' || c === 'ASSIGNED' || d.startsWith('pickup request') || d.startsWith('pickup assigned')) return 'booked';
    if (c === 'PICKEDUP' || c === 'INDUCTED' || c === 'ITEM_BOOK' || d.includes('pickedup') || d.includes('picked up') || d.includes('inducted') || d === 'item booked') return 'handed_over';
    if (c === 'ITEM_INVOICE' || d.includes('out for delivery') || d.includes('invoiced')) return rts ? 'returning' : 'out_for_delivery';
    if (c === 'ITEM_ONHOLD' || d.includes('on hold')) return 'on_hold';
    if (['BAG_DISPATCH', 'BAG_OPEN', 'BAG_CLOSE', 'ITEM_BAG', 'ITEM_REDIRECT'].includes(c) || /bag|dispatch|received|redirect|bagged/.test(d)) return rts ? 'returning' : 'in_transit';
    return null;
}

/**
 * Where a parcel is, from all its events (oldest first). A return is sticky
 * once it starts, delivered is final, and a status never goes backwards
 * because an older event arrived late.
 */
export function foldStatus(current: TrackingStatus | null, events: { status: TrackingStatus | null; at: Date }[]): TrackingStatus | null {
    let s = current;
    for (const e of [...events].sort((a, b) => a.at.getTime() - b.at.getTime())) {
        if (!e.status) continue;
        if (s === 'returned' || (s === 'delivered' && e.status !== 'returned')) continue;
        if ((s === 'returning') && !['returning', 'returned'].includes(e.status)) continue;
        if (s && RANK[e.status] < RANK[s] && s !== 'pickup_cancelled' && s !== 'on_hold') continue;
        s = e.status;
    }
    return s;
}

// ── State names → GST codes ───────────────────────────────────────────────

const norm = (x: string) => x.toLowerCase().replace(/&/g, 'and').replace(/[^a-z]/g, '');
const STATE_BY_NAME = new Map(Object.entries(GST_STATES).map(([code, name]) => [norm(name), code]));
STATE_BY_NAME.set(norm('Orissa'), '21'); STATE_BY_NAME.set(norm('Pondicherry'), '34'); STATE_BY_NAME.set(norm('Jammu & Kashmir'), '01');
STATE_BY_NAME.set(norm('Dadra & Nagar Haveli'), '26'); STATE_BY_NAME.set(norm('Daman & Diu'), '26'); STATE_BY_NAME.set(norm('Andaman & Nicobar'), '35');
STATE_BY_NAME.set(norm('Central Delhi'), '07'); STATE_BY_NAME.set(norm('New Delhi'), '07');
export const stateCodeOf = (name: string | null | undefined) => (name ? STATE_BY_NAME.get(norm(name)) ?? null : null);

// ── Address helpers ───────────────────────────────────────────────────────

/** India Post takes up to 3 lines of 80, 240 in all, each at least 3 characters. */
export function addressLines(parts: (string | null | undefined)[]): string[] {
    const words = parts.filter(Boolean).join(', ').replace(/\s+/g, ' ').trim().slice(0, 240).split(' ');
    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
        if ((cur ? cur.length + 1 : 0) + w.length > 80) { lines.push(cur); cur = w.slice(0, 80); }
        else cur = cur ? `${cur} ${w}` : w;
    }
    if (cur) lines.push(cur);
    return lines.slice(0, 3).map(l => l.length < 3 ? l.padEnd(3, '.') : l);
}

const text80 = (s: string | null | undefined, fallback: string) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 80); return t.length >= 3 ? t : fallback; };
const mobile10 = (s: string | null | undefined) => { const m = String(s ?? '').replace(/\D/g, '').slice(-10); return /^[6-9]\d{9}$/.test(m) ? m : null; };
/** MM/DD/YYYY hh:mm:ss AM/PM, India time. */
export function ipDateTime(d: Date): string {
    const ist = new Date(d.getTime() + 330 * 60_000);
    const p = (n: number) => String(n).padStart(2, '0');
    const h = ist.getUTCHours();
    return `${p(ist.getUTCMonth() + 1)}/${p(ist.getUTCDate())}/${ist.getUTCFullYear()} ${p(h % 12 || 12)}:${p(ist.getUTCMinutes())}:${p(ist.getUTCSeconds())} ${h < 12 ? 'AM' : 'PM'}`;
}

// ── The connector ─────────────────────────────────────────────────────────

export class IndiaPost {
    private static token: { value: string; until: number } | null = null;
    private static loggingIn: Promise<string> | null = null;
    private static http: AxiosInstance | null = null;

    static mode(): IpMode {
        const m = (process.env.INDIA_POST_MODE || '').toLowerCase();
        if (m === 'live') return process.env.INDIA_POST_USERNAME && process.env.INDIA_POST_PASSWORD && process.env.INDIA_POST_CUSTOMER_ID ? 'live' : 'off';
        if (m === 'mock') return 'mock';
        if (m === 'off') return 'off';
        return process.env.NODE_ENV === 'production' ? 'off' : 'mock';
    }

    static status() {
        const mode = this.mode();
        const missing = ['INDIA_POST_USERNAME', 'INDIA_POST_PASSWORD', 'INDIA_POST_CUSTOMER_ID', 'INDIA_POST_CONTRACT_SP'].filter(k => !process.env[k]);
        return {
            mode, base: this.base(), customerId: process.env.INDIA_POST_CUSTOMER_ID ? `…${process.env.INDIA_POST_CUSTOMER_ID.slice(-4)}` : null,
            products: (['SP', 'BP'] as IpProduct[]).filter(p => this.contract(p)), webhookReady: !!process.env.INDIA_POST_WEBHOOK_SECRET,
            missing: (process.env.INDIA_POST_MODE || '').toLowerCase() === 'live' ? missing : [],
        };
    }

    static base() { return (process.env.INDIA_POST_BASE_URL || 'https://test.cept.gov.in/beextcustomer').replace(/\/+$/, ''); }
    static contract(p: IpProduct): string | null { return (p === 'SP' ? process.env.INDIA_POST_CONTRACT_SP : process.env.INDIA_POST_CONTRACT_BP) || (this.mode() === 'mock' ? (p === 'SP' ? '41585456' : '41367422') : null); }
    static customerId(): string { return process.env.INDIA_POST_CUSTOMER_ID || '3000064781'; }

    private static client(): AxiosInstance {
        if (this.http) return this.http;
        const proxy = process.env.INDIA_POST_PROXY_URL ? new URL(process.env.INDIA_POST_PROXY_URL) : null;
        this.http = axios.create({
            baseURL: this.base(), timeout: 25_000,
            proxy: proxy ? { protocol: proxy.protocol.replace(':', ''), host: proxy.hostname, port: Number(proxy.port || (proxy.protocol === 'https:' ? 443 : 80)), auth: proxy.username ? { username: decodeURIComponent(proxy.username), password: decodeURIComponent(proxy.password) } : undefined } : undefined,
        });
        return this.http;
    }

    /** Bearer token: 15 minutes per India Post; renewed a minute early, one login at a time. */
    private static async bearer(): Promise<string> {
        if (this.token && this.token.until > Date.now()) return this.token.value;
        if (this.loggingIn) return this.loggingIn;
        this.loggingIn = (async () => {
            try {
                const r = await this.client().post('/v1/access/login', { username: process.env.INDIA_POST_USERNAME, password: process.env.INDIA_POST_PASSWORD }, { headers: { 'Content-Type': 'application/json' } });
                const t = r.data?.data?.access_token;
                if (!r.data?.success || !t) throw new IndiaPostError(`India Post login failed${r.data?.message ? `: ${r.data.message}` : ''}.`, 'LOGIN');
                const life = Math.max(60, Number(r.data.data.expires_in) || 900);
                this.token = { value: t, until: Date.now() + (life - 60) * 1000 };
                return t;
            } finally { this.loggingIn = null; }
        })();
        return this.loggingIn;
    }

    /** One authenticated call; a 401 logs in again once. */
    private static async call<T = any>(method: 'get' | 'post', path: string, opts: { params?: Record<string, unknown>; data?: unknown; responseType?: 'json' | 'arraybuffer'; headers?: Record<string, string> } = {}): Promise<T> {
        for (let attempt = 0; attempt < 2; attempt++) {
            const token = await this.bearer();
            try {
                const r = await this.client().request({ method, url: path, params: opts.params, data: opts.data, responseType: opts.responseType ?? 'json', headers: { Authorization: `Bearer ${token}`, ...(opts.headers ?? {}) } });
                return r.data as T;
            } catch (e: any) {
                if (e?.response?.status === 401 && attempt === 0) { this.token = null; continue; }
                const body = e?.response?.data;
                const msg = body && typeof body === 'object' && !(body instanceof ArrayBuffer) ? (body.message || (Array.isArray(body.errors) ? body.errors.map((x: any) => x.msg ?? x).join('; ') : '')) : '';
                logger.warn(`[INDIA-POST] ${method.toUpperCase()} ${path} failed: ${e?.response?.status ?? ''} ${msg || e?.message}`);
                throw new IndiaPostError(`India Post did not answer${msg ? `: ${String(msg).slice(0, 200)}` : ' (try again shortly)'}.`, 'UNAVAILABLE', 502);
            }
        }
        throw new IndiaPostError('India Post login keeps failing.', 'LOGIN');
    }

    // ── Pincodes ──

    /** Offices, state and whether India Post delivers there. Cached for 30 days. */
    static async pincode(pin: string, opts: { fresh?: boolean } = {}): Promise<PincodeInfo | null> {
        if (!/^[1-9]\d{5}$/.test(pin)) return null;
        if (this.mode() === 'off') return null;
        if (!opts.fresh) {
            const [c] = await db.select().from(indiaPostPincodes).where(eq(indiaPostPincodes.pincode, pin)).limit(1);
            if (c && c.fetchedAt && Date.now() - c.fetchedAt.getTime() < 30 * 86_400_000) {
                return { pincode: pin, deliverable: c.deliverable, stateName: c.stateName, stateCode: stateCodeOf(c.stateName), city: c.city, officeId: c.officeId, offices: (c.offices as IpOffice[]) ?? [] };
            }
        }
        let rows: any[];
        if (this.mode() === 'mock') rows = mockOffices(pin);
        else {
            const r = await this.call<any>('get', '/v1/pincode-search', { params: { pincode: pin, 'office-type': 'post' } });
            rows = Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : [];
        }
        const offices: IpOffice[] = rows.map(o => ({ officeId: String(o.office_id), name: String(o.office_name ?? ''), type: String(o.office_type_code ?? ''), delivers: o.delivery_office_flag === true || o.delivery_office_flag === 'true', city: o.city_name ?? null, state: o.state_name ?? null }));
        // The booking office: a delivery office that is not a branch office (India Post's rule).
        const office = offices.find(o => o.delivers && o.type !== 'BPO') ?? null;
        const stateName = offices.find(o => o.state)?.state ?? null;
        const city = office?.city ?? offices.find(o => o.city)?.city ?? null;
        const info: PincodeInfo = { pincode: pin, deliverable: offices.length > 0 && rows.some(o => o.is_rolled_out !== false), stateName, stateCode: stateCodeOf(stateName), city, officeId: office?.officeId ?? null, offices };
        await db.insert(indiaPostPincodes).values({ pincode: pin, stateName, city, deliverable: info.deliverable, officeId: info.officeId, offices: offices as any, fetchedAt: new Date() })
            .onConflictDoUpdate({ target: indiaPostPincodes.pincode, set: { stateName, city, deliverable: info.deliverable, officeId: info.officeId, offices: offices as any, fetchedAt: new Date() } });
        return info;
    }

    // ── Postage ──

    /** SP: a document under 500 g that fits an envelope; else a parcel. */
    static articleType(p: IpProduct, parcel: IpParcel): string {
        if (p === 'BP') return 'BUSINESS_PARCEL';
        const d = LIMITS.SP_INLAND_DOC;
        const fitsDoc = parcel.weightGrams <= d.w[1] && parcel.lengthCm <= d.l[1] && parcel.widthCm <= d.b[1] && parcel.heightCm <= d.h[1];
        return fitsDoc ? 'SP_INLAND_DOC' : 'SP_INLAND_PARCEL';
    }

    /** India Post's limits for the parcel, in words, or null when it is fine. */
    static parcelProblem(p: IpProduct, parcel: IpParcel): string | null {
        if (!Number.isInteger(parcel.weightGrams)) return 'India Post takes the weight in whole grams.';
        const type = this.articleType(p, parcel);
        const L = LIMITS[type];
        const out = (v: number, [a, b]: [number, number]) => !(v >= a && v <= b);
        if (out(parcel.weightGrams, L.w)) return `${type === 'SP_INLAND_DOC' ? 'A Speed Post document' : 'A parcel'} weighs ${L.w[0]} g to ${L.w[1] / 1000} kg.`;
        if (out(parcel.lengthCm, L.l) || out(parcel.widthCm, L.b) || out(parcel.heightCm, L.h)) return `For a ${type === 'SP_INLAND_DOC' ? 'document' : 'parcel'}, length is ${L.l[0]}–${L.l[1]} cm, width ${L.b[0]}–${L.b[1]} cm and height ${L.h[0]}–${L.h[1]} cm.`;
        return null;
    }

    static async tariff(p: IpProduct, from: string, to: string, parcel: IpParcel, insurePaise = 0): Promise<IpTariff> {
        const problem = this.parcelProblem(p, parcel);
        if (problem) throw new IndiaPostError(problem, 'BAD_PARCEL', 400);
        if (this.mode() === 'off') throw new IndiaPostError('India Post is not set up yet.', 'OFF', 409);
        const ins = insurePaise > 0 ? Math.ceil(insurePaise / 100) : undefined;
        let r: any;
        if (this.mode() === 'mock') r = mockTariff(p, from, to, parcel);
        else if (p === 'SP') r = await this.call('get', '/v1/speed-post/tariffs', { params: { 'product-code': 'SP', weight: parcel.weightGrams, 'source-pincode': from, 'destination-pincode': to, length: parcel.lengthCm, width: parcel.widthCm, height: parcel.heightCm, ...(ins ? { INS: ins } : {}), POD: 'NO' } });
        else r = await this.call('get', '/v1/business-parcel-tariff/calculate', { params: { 'product-code': 'BP', weight: parcel.weightGrams, 'source-pincode': from, 'destination-pincode': to, length: parcel.lengthCm, width: parcel.widthCm, height: parcel.heightCm, ...(ins ? { ins } : {}) } });
        if (!r?.success) throw new IndiaPostError(`India Post could not price this parcel${r?.message ? `: ${r.message}` : ''}.`, 'NO_TARIFF');
        const vas = typeof r.vas_charges === 'number' ? r.vas_charges : Object.values(r.vas_charges ?? {}).reduce((a: number, v: any) => a + Number(v || 0), 0);
        const taxPaise = Math.round(Number(r.total_tax ?? (Number(r.cgst || 0) + Number(r.sgst || 0) + Number(r.igst || 0))) * 100);
        const totalPaise = Math.round(Number(r.final_amount) * 100);
        return { productCode: String(r.product_code ?? ''), chargeableWeight: Number(r.chargeable_weight ?? parcel.weightGrams), basePaise: Math.max(0, totalPaise - taxPaise) || Math.round((Number(r.base_tariff || 0) + Number(vas || 0)) * 100), taxPaise, totalPaise, deliveryType: r.delivery_type ?? null, assuredBy: r.assured_delivery_day ?? null };
    }

    // ── Booking ──

    /**
     * Book one article. India Post books it for real when the parcel reaches
     * the post office (drop-off) or the postman collects it (pickup); until
     * then it is a booking request with our article number.
     */
    static async book(a: {
        product: IpProduct; articleNumber: string; parcel: IpParcel; sender: IpParty; receiver: IpParty;
        handover: { kind: 'dropoff'; officeId: string } | { kind: 'pickup'; officeId: string; date: Date; slot: '10:00-13:00' | '13:00-16:00' };
        reference: string; insurePaise?: number;
    }): Promise<{ batchId: string; tariffPaise: number | null }> {
        if (this.mode() === 'off') throw new IndiaPostError('India Post is not set up yet.', 'OFF', 409);
        const contract = this.contract(a.product);
        if (!contract) throw new IndiaPostError(`No India Post contract is set for ${a.product === 'SP' ? 'Speed Post' : 'Business Parcel'}.`, 'NO_CONTRACT', 409);
        const problem = this.parcelProblem(a.product, a.parcel);
        if (problem) throw new IndiaPostError(problem, 'BAD_PARCEL', 400);
        const sm = mobile10(a.sender.mobile), rm = mobile10(a.receiver.mobile);
        if (!sm) throw new IndiaPostError('The sender needs a 10-digit mobile number starting 6–9.', 'BAD_PARTY', 400);
        if (!rm) throw new IndiaPostError('The customer\'s mobile number is not a valid 10-digit number.', 'BAD_PARTY', 400);
        const type = this.articleType(a.product, a.parcel);
        const isPickup = a.handover.kind === 'pickup';
        const sl = a.sender.lines, rl = a.receiver.lines;
        const article: Record<string, unknown> = {
            bulk_customer_id: this.customerId(), contract_id: contract, barcode_no: a.articleNumber,
            pickup_or_dropoff: isPickup ? 'PICKUP' : 'DROPOFF', pickup_dropoff_office_id: Number(a.handover.officeId),
            article_type: type, physical_weight: a.parcel.weightGrams, shape_of_article: type === 'SP_INLAND_DOC' ? 'DOC' : 'NROL',
            length: a.parcel.lengthCm, breadth_diameter: a.parcel.widthCm, height: a.parcel.heightCm,
            priority_flag: 'FALSE', delivery_instruction: '', delivery_slot: '', instruction_rts: 'RTS',
            sender_name: text80(a.sender.name, 'Sender'), sender_company: text80(a.sender.company, text80(a.sender.name, 'Sender')),
            sender_add_line_1: sl[0] ?? '', sender_add_line_2: sl[1] ?? '', sender_add_line_3: sl[2] ?? '',
            sender_city: text80(a.sender.city, 'NA '), sender_state: a.sender.state ? text80(a.sender.state, '') : '', sender_pincode: a.sender.pincode,
            sender_emailid: a.sender.email ?? '', sender_alt_contact: '', sender_kyc: '', sender_tax_reference: '',
            receiver_name: text80(a.receiver.name, 'Customer'), receiver_company: text80(a.receiver.company, text80(a.receiver.name, 'Customer')),
            receiver_add_line_1: rl[0] ?? '', receiver_add_line_2: rl[1] ?? '', receiver_add_line_3: rl[2] ?? '',
            receiver_city: text80(a.receiver.city, 'NA '), receiver_state: a.receiver.state ? text80(a.receiver.state, '') : '', receiver_pincode: a.receiver.pincode,
            receiver_emailid: '', receiver_alt_contact: '', receiver_kyc: '', receiver_tax_reference: '',
            alt_address_flag: 'FALSE', pickup_address_flag: isPickup ? 'TRUE' : 'FALSE', drop_off_pincode: isPickup ? '' : a.sender.pincode,
            sender_mobile_no: sm, receiver_mobile_no: rm,
            prepayment_code: '', value_of_prepayment: 0, codr_cod: '', value_for_codr_cod: '',
            insurance_type: a.insurePaise ? 'DOP' : '', value_of_insurance: a.insurePaise ? Math.ceil(a.insurePaise / 100) : 0,
            ack: 'FALSE', reg: 'FALSE', otp: 'FALSE', bulk_reference: a.reference.slice(0, 50),
            pickup_address_id: '', pickup_addressee_name: '', pickup_company_name: '', pickup_address_line1: '', pickup_address_line2: '', pickup_address_line3: '',
            pickup_city: '', pickup_state: '', pickup_pincode: '', pickup_email_id: '', pickup_alt_contact_no: '0', pickup_mobile_no: '0', pickup_schedule_slot: '', pickup_schedule_date: '',
            alt_addressee_name: '', alt_company_name: '', alt_address_line1: '', alt_address_line2: '', alt_address_line3: '', alt_city: '', alt_state: '', alt_pincode: '', alt_email_id: '', alt_contact_no: '0', alt_alternate_mobile_no: '',
        };
        if (a.handover.kind === 'pickup') Object.assign(article, {
            pickup_addressee_name: article.sender_name, pickup_company_name: article.sender_company,
            pickup_address_line1: sl[0] ?? '', pickup_address_line2: sl[1] ?? '', pickup_address_line3: sl[2] ?? '',
            pickup_city: article.sender_city, pickup_state: article.sender_state, pickup_pincode: a.sender.pincode, pickup_mobile_no: sm,
            pickup_schedule_slot: a.handover.slot, pickup_schedule_date: ipDateTime(a.handover.date),
        });
        const r: any = this.mode() === 'mock' ? mockBook(article) : await this.call('post', `/process-articles/${this.customerId()}`, { data: { articles: [article] }, headers: { 'Content-Type': 'application/json' } });
        const ok = (r?.valid_articles ?? []).find((v: any) => v.barcode_no === a.articleNumber);
        if (!r?.success || !ok) {
            const errs: string[] = (r?.error_articles ?? []).flatMap((x: any) => x.errors ?? []).map(String);
            throw new IndiaPostError(`India Post did not accept the booking${errs.length ? `: ${errs.slice(0, 3).join('; ')}` : r?.message ? `: ${r.message}` : ''}.`, 'REJECTED', 422, errs);
        }
        return { batchId: String(r.batch_id ?? r.correlation_id ?? ''), tariffPaise: ok.calculated_tariff != null ? Math.round(Number(ok.calculated_tariff) * 100) : null };
    }

    // ── Label ──

    /** India Post's own A6 label (PDF). Null in mock mode: the caller prints UniteFix's label. */
    static async label(x: { articleNumber: string; product: IpProduct; parcel: IpParcel; sender: IpParty; receiver: IpParty; bookingOffice: { name: string; pincode: string }; deliveryOffice?: string | null; totalPaise?: number; reference?: string }): Promise<Buffer | null> {
        if (this.mode() !== 'live') return null;
        const body = [{
            customer_id: Number(this.customerId()), delivery_office_name: x.deliveryOffice ?? '', destination_pin: x.receiver.pincode,
            channel_type: 'E', user_type: 'R', barcode_no: x.articleNumber, service_type: x.product, booking_type: 'COMMERCIAL',
            article_length: String(x.parcel.lengthCm), article_breadth: String(x.parcel.widthCm), article_height: String(x.parcel.heightCm),
            charged_weight: x.parcel.weightGrams, physical_weight: x.parcel.weightGrams,
            volumetric_weight: Math.round(x.parcel.lengthCm * x.parcel.widthCm * x.parcel.heightCm / 5),
            insurance_flag: false, insurance_value: 0,
            recipient_name: x.receiver.name, recipient_mobile: mobile10(x.receiver.mobile) ?? '', recipient_addressl1: x.receiver.lines[0] ?? '', recipient_addressl2: x.receiver.lines[1] ?? '', recipient_addressl3: x.receiver.lines[2] ?? '',
            recipient_city: x.receiver.city, recipient_pin: x.receiver.pincode, recipient_state: x.receiver.state ?? '',
            sender_name: x.sender.name, sender_mobile: mobile10(x.sender.mobile) ?? '', sender_addressl1: x.sender.lines[0] ?? '', sender_addressl2: x.sender.lines[1] ?? '', sender_addressl3: x.sender.lines[2] ?? '',
            sender_city: x.sender.city, sender_pin: x.sender.pincode, sender_state: x.sender.state ?? '',
            transmission_mode: 'S', payment_mode: 'CO', booking_office_name: x.bookingOffice.name, booking_office_pin: x.bookingOffice.pincode,
            size: 'A6', total_amount: x.totalPaise ? x.totalPaise / 100 : 0, payment_status: 'PC', identifier: 'Domestic', bkg_ref_id: x.reference ?? '', priority: false, registered_flag: false,
        }];
        const data = await this.call<ArrayBuffer>('post', '/v1/label/create/domestic', { data: body, responseType: 'arraybuffer', headers: { 'Content-Type': 'application/json' } });
        const buf = Buffer.from(data);
        if (buf.subarray(0, 4).toString() !== '%PDF') throw new IndiaPostError('India Post did not return a label.', 'NO_LABEL');
        return buf;
    }

    // ── Tracking ──

    /** Events for up to 500 articles booked under our customer id. */
    static async track(articles: string[]): Promise<Map<string, IpEvent[]>> {
        const out = new Map<string, IpEvent[]>();
        if (!articles.length || this.mode() === 'off') return out;
        if (articles.length > 500) throw new Error('at most 500 articles per tracking call');
        const r: any = this.mode() === 'mock' ? mockTrack(articles) : await this.call('post', '/v1/tracking/bulk', { data: { bulk: articles }, headers: { 'Content-Type': 'application/json' } });
        for (const item of r?.data ?? []) {
            const no = String(item?.booking_details?.article_number ?? '').toUpperCase();
            if (!no) continue;
            out.set(no, (item.tracking_details ?? []).map((t: any) => ({
                code: null, description: String(t.event ?? '').trim(), office: t.office ?? null,
                at: parseIpDate(t.date, t.time), rts: t.rts === true, raw: t,
            })).filter((e: IpEvent) => e.description && !Number.isNaN(e.at.getTime())));
        }
        return out;
    }

    /** A webhook body as events, keyed by article. Accepts one event or a list. */
    static webhookEvents(body: unknown): { article: string; event: IpEvent }[] {
        const list = Array.isArray(body) ? body : Array.isArray((body as any)?.events) ? (body as any).events : [body];
        return list.filter((e: any) => e && typeof e === 'object' && e.article_number).map((e: any) => ({
            article: String(e.article_number).toUpperCase().trim(),
            event: { code: e.event_code ? String(e.event_code) : null, description: String(e.event_description ?? e.event_code ?? '').trim(), office: e.event_office_name ?? null, at: parseIpDate(e.event_date, e.event_time), rts: false, raw: e },
        })).filter((x: { event: IpEvent }) => x.event.description && !Number.isNaN(x.event.at.getTime()));
    }

    /** Constant-time check of the webhook's shared secret (header or ?token=). */
    static webhookAuthorised(secretGiven: string | null | undefined): boolean {
        const want = process.env.INDIA_POST_WEBHOOK_SECRET;
        if (!want) return this.mode() === 'mock';
        const a = Buffer.from(String(secretGiven ?? '')), b = Buffer.from(want);
        return a.length === b.length && crypto.timingSafeEqual(a, b);
    }

    /** For tests. */
    static resetForTests() { this.token = null; this.loggingIn = null; this.http = null; }
}

/** India Post dates: ISO with zone, or a date plus a time in India time. */
export function parseIpDate(date: unknown, time?: unknown): Date {
    const d = String(date ?? '').trim();
    if (/T\d{2}:\d{2}/.test(d)) return new Date(d);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return new Date(`${d}T${/^\d{2}:\d{2}(:\d{2})?$/.test(String(time ?? '')) ? String(time) : '00:00:00'}+05:30`);
    return new Date(NaN);
}

// ── Stubbed answers (mock mode), shaped like India Post's ────────────────

/** Mock pincodes: 999xxx does not exist; 1xxxxx Delhi, 4xxxxx Maharashtra, 5[6-9]xxxx Karnataka, 6xxxxx Tamil Nadu, else Karnataka. */
function mockOffices(pin: string) {
    if (pin.startsWith('999')) return [];
    const state = pin.startsWith('1') ? 'Delhi' : pin.startsWith('4') ? 'Maharashtra' : pin.startsWith('6') ? 'Tamil Nadu' : 'Karnataka';
    const base = 20000000 + Number(pin.slice(1)) * 10;
    return [
        { pincode: Number(pin), office_name: `Test ${pin} S.O`, office_id: String(base + 1), office_type_code: 'SPO', state_name: state, delivery_office_flag: false, city_name: `Test City ${pin.slice(0, 3)}`, is_rolled_out: true },
        { pincode: Number(pin), office_name: `Test ${pin} H.O`, office_id: String(base + 3), office_type_code: 'HPO', state_name: state, delivery_office_flag: true, city_name: `Test City ${pin.slice(0, 3)}`, is_rolled_out: true },
    ];
}

function mockTariff(p: IpProduct, from: string, to: string, parcel: IpParcel) {
    const vol = Math.round(parcel.lengthCm * parcel.widthCm * parcel.heightCm / 5);
    const w = Math.max(parcel.weightGrams, IndiaPost.articleType(p, parcel) === 'SP_INLAND_DOC' ? 0 : vol);
    const local = from.slice(0, 3) === to.slice(0, 3);
    const base = (p === 'SP' ? 41 : 35) + Math.ceil(w / 500) * (local ? 12 : 30);
    const tax = Math.round(base * 0.18);
    return { success: true, product_code: IndiaPost.articleType(p, parcel), chargeable_weight: w, base_tariff: base, vas_charges: 0, cgst: tax / 2, sgst: tax / 2, total_tax: tax, final_amount: base + tax, delivery_type: local ? 'Local' : 'Inter-city' };
}

function mockBook(a: Record<string, unknown>) {
    const errors: string[] = [];
    if (!/^\d{6}$/.test(String(a.sender_pincode))) errors.push('Sender pincode must be exactly 6 digits');
    if (!/^\d{6}$/.test(String(a.receiver_pincode))) errors.push('Receiver pincode must be exactly 6 digits');
    if (!/^\d{8}$/.test(String(a.pickup_dropoff_office_id))) errors.push(`${a.pickup_or_dropoff === 'PICKUP' ? 'Pickup' : 'Dropoff'} Officeid must be exactly 8 digits`);
    if (String(a.receiver_pincode).startsWith('999')) errors.push('Receiver pincode is not serviceable');
    const now = new Date().toISOString();
    return errors.length
        ? { success: true, batch_id: `batch_mock_${Date.now()}`, total: 1, processed: 1, valid_articles: [], error_articles: [{ barcode_no: a.barcode_no, index: 0, errors }] }
        : { success: true, batch_id: `batch_mock_${Date.now()}`, total: 1, processed: 1, valid_articles: [{ barcode_no: a.barcode_no, index: 0, timestamp: now, calculated_tariff: null }], error_articles: [] };
}

/**
 * Mock tracking moves a parcel along with time since booking (minutes),
 * so a test can push it forward with MOCK_INDIA_POST_STAGE=<article>:<stage>.
 */
const MOCK_FLOW = ['Item Booked', 'Item bagged', 'Item Dispatched', 'Item received at Destination', 'Taken out for delivery', 'Item Delivered(Addressee)'];
const MOCK_RTS = ['Item Booked', 'Item Dispatched', 'Item received at Destination', 'Item Returned to Sender', 'Item Dispatched', 'Item Delivered(Sender)'];
export const mockStages = new Map<string, { stage: number; rts?: boolean; from: Date }>();
function mockTrack(articles: string[]) {
    return {
        success: true, data: articles.filter(a => mockStages.has(a)).map(a => {
            const m = mockStages.get(a)!;
            const flow = m.rts ? MOCK_RTS : MOCK_FLOW;
            const ev = flow.slice(0, m.stage + 1).map((e, i) => ({ date: new Date(m.from.getTime() + i * 3_600_000).toISOString(), office: i < 2 ? 'Test Booking H.O' : 'Test Delivery H.O', event: e, remarks: '', rts: !!m.rts && i >= 3 })).reverse();
            return { booking_details: { article_number: a }, tracking_details: ev, del_status: { del_status: m.stage >= flow.length - 1 ? 'delivered' : 'not delivered' } };
        }),
    };
}
