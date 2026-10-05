/**
 * Test kit for the Partner Hub smoke suites.
 *
 * Boots the REAL route stack (registerRoutes — every global guard, the
 * capability map, rate limits) on a random local port, so the suites test
 * what production runs rather than handlers in isolation. Talks to the local
 * database from .env. Fixtures are tagged with a run stamp and removed at the
 * end of each suite.
 */

import 'dotenv/config';
import express from 'express';
import type { AddressInfo } from 'net';
import bcrypt from 'bcrypt';
import { db, runStartupMigrations } from '../../server/db';
import { registerRoutes } from '../../server/routes';
import { adminUsers } from '../../shared/schema';

export const results: Array<{ name: string; pass: boolean }> = [];
export function check(name: string, pass: boolean, detail = '') {
    results.push({ name, pass });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}
export function summary(): number {
    const passed = results.filter(r => r.pass).length;
    console.log(`\n${passed}/${results.length} passed`);
    return passed === results.length ? 0 : 1;
}

export async function bootServer() {
    // The local box reaches rate limits fast when a suite logs in many times.
    process.env.RATE_LIMIT_DISABLED = '1';
    // Never upload test files to the real CDN: force the dev (data-URI) path.
    delete process.env.CLOUDINARY_CLOUD_NAME; delete process.env.CLOUDINARY_API_KEY; delete process.env.CLOUDINARY_API_SECRET;
    await runStartupMigrations();
    const app = express();
    app.use(express.json({ limit: '5mb' }));
    app.use(express.urlencoded({ extended: false }));
    const server = await registerRoutes(app);
    app.use((err: any, _req: any, res: any, _next: any) => {
        if (err?.name === 'ZodError') return res.status(400).json({ success: false, message: 'Invalid input', issues: err.issues });
        if (err?.code === '23505') return res.status(409).json({ success: false, message: 'duplicate' });
        res.status(err.status || 500).json({ success: false, message: err.message });
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return { base, close: () => new Promise<void>(r => server.close(() => r())) };
}

export function client(base: string) {
    const call = async (method: string, path: string, opts: { token?: string | null; body?: any; form?: FormData } = {}) => {
        const headers: Record<string, string> = {};
        if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
        let body: any;
        if (opts.form) body = opts.form;
        else if (opts.body !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(opts.body); }
        const res = await fetch(base + path, { method, headers, body });
        const text = await res.text();
        let json: any = null;
        try { json = JSON.parse(text); } catch { json = { raw: text }; }
        return { status: res.status, body: json };
    };
    return {
        get: (p: string, token?: string | null) => call('GET', p, { token }),
        post: (p: string, body?: any, token?: string | null) => call('POST', p, { body, token }),
        put: (p: string, body?: any, token?: string | null) => call('PUT', p, { body, token }),
        patch: (p: string, body?: any, token?: string | null) => call('PATCH', p, { body, token }),
        del: (p: string, token?: string | null) => call('DELETE', p, { token }),
        upload: (p: string, form: FormData, token?: string | null) => call('POST', p, { form, token }),
        async login(username: string, password: string): Promise<string | null> {
            const r = await call('POST', '/api/admin/auth/login', { body: { username, password } });
            return r.body?.token ?? null;
        },
    };
}

/** A throwaway super_admin for staff-side steps. */
export async function makeSuperAdmin(stamp: string) {
    const password = `Sa-${stamp}-pw!`;
    const [row] = await db.insert(adminUsers).values({
        username: `qa_sa_${stamp}`, email: `qa_sa_${stamp}@example.test`, password: await bcrypt.hash(password, 10), role: 'super_admin', isActive: true,
    }).returning();
    return { id: row.id, username: row.username, password };
}

/** Valid GSTIN for a state + PAN-shaped body, with the right check digit. */
export async function gstinFor(stateCode: string, pan: string, entity = '1') {
    const { gstinCheckDigit } = await import('../../shared/hub');
    const first14 = `${stateCode}${pan}${entity}Z`;
    return first14 + gstinCheckDigit(first14);
}

/** A tiny but real PDF, for document uploads. */
export function tinyPdf(label: string) {
    const pdf = `%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%${label}\n%%EOF`;
    return new Blob([pdf], { type: 'application/pdf' });
}

export { db };
