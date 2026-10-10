/**
 * Browser check of Newspapers with the real sample edition: the partner sets
 * up the paper and uploads the PDF in the Hub (pdf.js makes the half-page
 * preview in the browser), staff approve it, then the shared link and follow
 * page are opened at phone width (Android and iPhone) and the full reader
 * draws the Kannada pages. Fails on console errors, crashes, blank pages or
 * sideways scroll; saves screenshots; removes everything.
 *
 *   1. npm run build
 *   2. NODE_ENV=production NEWS_STORAGE=local PORT=3056 CLIENT_URL=http://127.0.0.1:3056 CLOUDINARY_CLOUD_NAME= CLOUDINARY_API_KEY= CLOUDINARY_API_SECRET= SMTP_HOST= SMTP_USER= MSG91_API_KEY= TWILIO_SID= RAZORPAY_KEY_ID= RAZORPAY_KEY_SECRET= node dist/index.js
 *   3. UI_BASE=http://127.0.0.1:3056 UI_OUT=../ui-shots/news npx tsx scripts/ui-check-news.ts
 */
import { chromium, type Page } from 'playwright';
import fs from 'fs';
import zlib from 'zlib';
import jwt from 'jsonwebtoken';
import { eq, inArray } from 'drizzle-orm';
import { makeSuperAdmin, gstinFor, cleanupPartners, db } from './lib/hub-test-kit';
import { adminUsers, businessPartners, users, newsPapers, newsEditions } from '../shared/schema';
import { BusinessPartnerService } from '../server/services/business-partner.service';
import { PartnerHubService } from '../server/services/partner-hub.service';

const BASE = process.env.UI_BASE ?? 'http://127.0.0.1:3056';
const OUT = process.env.UI_OUT ?? 'ui-shots/news';
const SAMPLE = 'L:/UF/ತತ್ತ್ವನಿಷ್ಠ 01-09-2026_261010_000215.pdf';
fs.mkdirSync(OUT, { recursive: true });
const stamp = Date.now().toString(36);
const adminIds: number[] = [], bpIds: number[] = [], userIds: number[] = [];
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-A146B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

/** A plain masthead-shaped image: black bar on white. */
function masthead(w = 600, h = 200) {
    const raw = Buffer.alloc((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) {
        raw[y * (w * 3 + 1)] = 0;
        for (let x = 0; x < w; x++) {
            const ink = (y > 60 && y < 140 && x > 40 && x < w - 40) || y > h - 12;
            const o = y * (w * 3 + 1) + 1 + x * 3;
            raw[o] = ink ? (y > h - 12 ? 163 : 22) : 255; raw[o + 1] = ink ? (y > h - 12 ? 39 : 19) : 255; raw[o + 2] = ink ? (y > h - 12 ? 31 : 15) : 255;
        }
    }
    const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
    const crc = (buf: Buffer) => { let c = -1; for (const x of buf) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
    const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

let ipN = 10;
async function login(username: string, password: string): Promise<string | null> {
    const r = await fetch(`${BASE}/api/admin/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.9.7.${ipN++}` }, body: JSON.stringify({ username, password }) });
    return (await r.json().catch(() => null))?.token ?? null;
}
const call = async (method: string, path: string, token: string, body?: unknown) => {
    const r = await fetch(`${BASE}${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => null) };
};

async function main() {
    const errors: string[] = [];
    const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
    const staff = (await login(sa.username, sa.password))!;
    const [sau] = await db.select().from(adminUsers).where(eq(adminUsers.id, sa.id));
    const bp = await BusinessPartnerService.create({ legalName: `Tattvanishtha Publications ${stamp}`, displayName: 'Tattvanishtha', gstin: await gstinFor('29', 'TTVUI1234K'), contactPhone: `7${String(Date.now()).slice(-9)}`, contactEmail: `qa_newsui_${stamp}@example.test`, verticalCodes: ['media'], approvedByAdminId: sa.id, pincode: '581301', district: 'Uttara Kannada', address: 'Karwar' });
    bpIds.push(bp.id);
    await db.update(businessPartners).set({ stateCode: '29', stateName: 'Karnataka' }).where(eq(businessPartners.id, bp.id));
    const l = await PartnerHubService.createOwnerLogin(bp.id, {});
    const [pr] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.email, l.username)); adminIds.push(pr.id);
    const T = (await login(l.username, l.temporaryPassword))!;
    const partnerUser = { id: pr.id, username: l.username, role: 'partner' };
    await call('PUT', '/api/hub/news/paper', T, { name: 'ತತ್ತ್ವನಿಷ್ಠ Tattvanishtha', language: 'kannada', city: 'Karwar', frequency: 'daily', description: "Karwar's Kannada daily — district news, ports, fisheries and local sport." });
    const fd = new FormData(); fd.append('file', new Blob([masthead()], { type: 'image/png' }), 'mast.png');
    await fetch(`${BASE}/api/hub/news/logo`, { method: 'POST', headers: { Authorization: `Bearer ${T}` }, body: fd });

    const browser = await chromium.launch();
    const watch = (page: Page, tag: string) => {
        page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(`${tag}: ${m.text().slice(0, 200)}`); });
        page.on('pageerror', e => errors.push(`${tag}: ${e.message.slice(0, 200)}`));
    };
    const overflow = async (page: Page, tag: string) => { if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) errors.push(`${tag}: horizontal overflow`); };
    const signIn = async (page: Page, token: string, user: object) => {
        await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
        await page.evaluate(([tk, u]) => { localStorage.setItem('adminToken', tk); localStorage.setItem('adminUser', u); }, [token, JSON.stringify(user)]);
    };

    // ── Hub: the paper, then the upload with the real PDF ──
    const hub = await browser.newPage({ viewport: { width: 1360, height: 900 } });
    watch(hub, 'hub');
    await signIn(hub, T, partnerUser);
    await hub.goto(`${BASE}/partner/news`, { waitUntil: 'networkidle' });
    await hub.waitForTimeout(600);
    if (!/Bring your readers across/.test(await hub.locator('body').innerText())) errors.push('hub paper: follow panel missing');
    await hub.screenshot({ path: `${OUT}/hub-paper.png`, fullPage: true });

    await hub.goto(`${BASE}/partner/news/editions`, { waitUntil: 'networkidle' });
    await hub.locator('input[type=file][accept*="pdf"]').setInputFiles(SAMPLE);
    try { await hub.waitForSelector('img[alt="Top half of page one"]', { timeout: 60_000 }); }
    catch { errors.push('hub editions: the preview was not made from the PDF'); }
    const pv = await hub.evaluate(() => { const i = document.querySelector('img[alt="Top half of page one"]') as HTMLImageElement | null; return i ? { w: i.naturalWidth, h: i.naturalHeight } : null; });
    if (!pv || pv.w < 1000 || pv.h < 800) errors.push(`hub editions: preview size ${JSON.stringify(pv)}`);
    if (!/6 pages/.test(await hub.locator('body').innerText())) errors.push('hub editions: page count not read from the PDF');
    await hub.fill('#e-head', 'ಕಾರವಾರ ಬಂದರು ವಿಸ್ತರಣೆಗೆ ಅನುಮೋದನೆ');
    await hub.screenshot({ path: `${OUT}/hub-upload-preview.png`, fullPage: true });
    await hub.getByRole('button', { name: /^Upload$/ }).click();
    try { await hub.waitForSelector('text=Edition uploaded', { timeout: 60_000 }); } catch { errors.push('hub editions: upload did not finish'); }
    await hub.waitForTimeout(800);
    await hub.screenshot({ path: `${OUT}/hub-editions.png`, fullPage: true });

    const [paper] = await db.select().from(newsPapers).where(eq(newsPapers.businessPartnerId, bp.id));
    const [ed] = await db.select().from(newsEditions).where(eq(newsEditions.paperId, paper.id));
    if (!ed || ed.pageCount !== 6 || !ed.previewUrl) errors.push(`upload: ${JSON.stringify({ pages: ed?.pageCount, preview: !!ed?.previewUrl })}`);
    await call('POST', '/api/hub/news/submit', T);

    // ── Staff approve in the browser ──
    const adm = await browser.newPage({ viewport: { width: 1360, height: 900 } });
    watch(adm, 'admin');
    await signIn(adm, staff, { id: sau.id, username: sau.username, role: 'super_admin' });
    await adm.goto(`${BASE}/admin/news`, { waitUntil: 'networkidle' });
    await adm.waitForTimeout(500);
    await adm.screenshot({ path: `${OUT}/admin-queue.png`, fullPage: true });
    await adm.getByRole('button', { name: 'Approve' }).first().click();
    await adm.waitForTimeout(1000);
    await adm.getByRole('button', { name: 'Editions' }).first().click();
    await adm.waitForTimeout(800);
    await adm.screenshot({ path: `${OUT}/admin-live.png`, fullPage: true });
    const [paper2] = await db.select().from(newsPapers).where(eq(newsPapers.id, paper.id));
    if (paper2.status !== 'live') errors.push(`admin: approve did not take (${paper2.status})`);

    await hub.goto(`${BASE}/partner/news/plan`, { waitUntil: 'networkidle' });
    await hub.waitForTimeout(500);
    const planText = await hub.locator('body').innerText();
    if (!/₹129/.test(planText) || !/₹249/.test(planText) || !/₹399/.test(planText)) errors.push('hub plan: prices missing');
    await hub.screenshot({ path: `${OUT}/hub-plan.png`, fullPage: true });
    await hub.setViewportSize({ width: 390, height: 844 });
    for (const p of ['/partner/news', '/partner/news/editions', '/partner/news/plan']) {
        await hub.goto(`${BASE}${p}`, { waitUntil: 'networkidle' }); await hub.waitForTimeout(400);
        await overflow(hub, `hub ${p} @390`);
    }
    await hub.screenshot({ path: `${OUT}/hub-editions-390.png`, fullPage: true });

    // ── The shared link, as WhatsApp and a phone see it ──
    const raw = await (await fetch(`${BASE}/news/e/${ed.publicToken}`)).text();
    if (!/property="og:title" content="ತತ್ತ್ವನಿಷ್ಠ Tattvanishtha — /.test(raw) || !raw.includes(`/api/public/news/e/${ed.publicToken}/preview`)) errors.push('shared link: no title / preview image tags for chat apps');
    const pimg = await fetch(`${BASE}/api/public/news/e/${ed.publicToken}/preview`);
    if (pimg.status !== 200 || !/^image\//.test(pimg.headers.get('content-type') ?? '')) errors.push(`shared link: preview image ${pimg.status}`);
    for (const [ua, tag] of [[ANDROID, 'android'], [IPHONE, 'iphone']] as const) {
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: ua, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
        const page = await ctx.newPage();
        watch(page, `shared ${tag}`);
        await page.goto(`${BASE}/news/e/${ed.publicToken}`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(800);
        const text = await page.locator('body').innerText();
        if (!/Read all 6 pages free on UniteFix/.test(text)) errors.push(`shared ${tag}: install card missing`);
        if (tag === 'android' && !(await page.locator('a[href^="intent://news/e/"]').count())) errors.push('shared android: no open-in-app link');
        if (tag === 'iphone' && !/iPhone app is on its way/.test(text)) errors.push('shared iphone: no iPhone note');
        const ok = await page.evaluate(() => { const i = document.querySelector('main img[alt^="The top half"]') as HTMLImageElement | null; return !!i && i.naturalWidth > 0; });
        if (!ok) errors.push(`shared ${tag}: preview image did not load`);
        await overflow(page, `shared ${tag}`);
        await page.screenshot({ path: `${OUT}/shared-${tag}.png`, fullPage: true });
        await page.goto(`${BASE}/news/p/${bp.partnerCode}`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(600);
        if (!/Follow ತತ್ತ್ವನಿಷ್ಠ Tattvanishtha on UniteFix/.test(await page.locator('body').innerText())) errors.push(`paper ${tag}: follow card missing`);
        await overflow(page, `paper ${tag}`);
        await page.screenshot({ path: `${OUT}/paper-${tag}.png`, fullPage: true });
        await ctx.close();
    }

    // ── The reader, as the app's WebView opens it ──
    const [u] = await db.insert(users).values({ phone: `8${String(Date.now()).slice(-9)}`, username: 'QA Reader', role: 'user', isActive: true } as any).returning();
    userIds.push(u.id);
    const rt = jwt.sign({ userId: u.id, role: 'user' }, process.env.JWT_SECRET as string, { expiresIn: '1h' });
    const op = await call('POST', `/api/news/editions/${ed.id}/open`, rt);
    const rctx = await browser.newContext({ viewport: { width: 390, height: 780 }, userAgent: ANDROID, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const reader = await rctx.newPage();
    watch(reader, 'reader');
    await reader.goto(`${BASE}${op.body?.data?.url}`, { waitUntil: 'networkidle' });
    try {
        await reader.waitForFunction(() => {
            const c = document.querySelector('canvas[aria-label="Page 1"]') as HTMLCanvasElement | null;
            if (!c || !c.width) return false;
            const d = c.getContext('2d')!.getImageData(0, 0, c.width, Math.min(c.height, 600)).data;
            let dark = 0; for (let i = 0; i < d.length; i += 4 * 97) if (d[i] < 120) dark++;
            return dark > 20;
        }, null, { timeout: 60_000 });
    } catch { errors.push('reader: page 1 was not drawn'); }
    await reader.waitForTimeout(800);
    await reader.screenshot({ path: `${OUT}/reader-page1.png` });
    await reader.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.45));
    await reader.waitForTimeout(2500);
    await reader.screenshot({ path: `${OUT}/reader-middle.png` });
    const pages = await reader.locator('canvas[aria-label^="Page "]').count();
    if (pages !== 6) errors.push(`reader: ${pages} pages, expected 6`);
    await reader.getByRole('button', { name: 'Zoom in' }).click();
    await reader.waitForTimeout(1500);
    await reader.screenshot({ path: `${OUT}/reader-zoom.png` });
    const expired = await browser.newPage();
    watch(expired, 'reader-expired');
    await expired.goto(`${BASE}/news/read/${ed.id}?exp=1&sig=x`, { waitUntil: 'networkidle' });
    await expired.waitForTimeout(800);
    if (!/expired/.test(await expired.locator('body').innerText())) errors.push('reader: an expired link is not explained');
    // pdf.js logs the refused fetch itself; that one is expected.
    for (let i = errors.length - 1; i >= 0; i--) if (errors[i].startsWith('reader-expired:') && /403|Unexpected server response/.test(errors[i])) errors.splice(i, 1);

    await browser.close();
    console.log(errors.length ? `FAIL\n${errors.join('\n')}` : 'OK — Hub paper/upload/plan, staff review, shared link (Android, iPhone), follow page, reader (6 pages, zoom), expired link, phone widths');
    process.exitCode = errors.length ? 1 : 0;
}

main().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => {
    try {
        if (bpIds.length) {
            const papers = await db.select({ id: newsPapers.id }).from(newsPapers).where(inArray(newsPapers.businessPartnerId, bpIds));
            if (papers.length) {
                const left = await db.select({ k: newsEditions.fileKey }).from(newsEditions).where(inArray(newsEditions.paperId, papers.map(p => p.id)));
                const { NewsStorage } = await import('../server/lib/news-storage');
                for (const x of left) await NewsStorage.remove(x.k);
            }
        }
    } catch (e) { console.error('file cleanup', e); }
    const uids = userIds.join(',') || '0';
    await cleanupPartners(bpIds, adminIds, [
        `DELETE FROM news_reads WHERE user_id IN (${uids})`,
        `DELETE FROM news_follows WHERE user_id IN (${uids})`,
        `DELETE FROM users WHERE id IN (${uids})`,
    ]);
    process.exit(process.exitCode ?? 0);
});
