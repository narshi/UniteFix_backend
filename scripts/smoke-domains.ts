/**
 * UniteFix on its own domain: pages opened on the onrender.com address move to
 * app.unitefix.com / admin.unitefix.com; the API, payment webhooks and the
 * app's newspaper reader stay where installed apps call them; nothing moves
 * until PUBLIC_APP_URL is set; Android App Links are published.
 *
 *   npm run smoke:domains
 */

import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';
import { canonicalHost, assetLinks, publicAppUrl, adminAppUrl } from '../server/lib/public-url';

const results: Array<{ name: string; pass: boolean }> = [];
const check = (name: string, pass: boolean, detail = '') => { results.push({ name, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail && !pass ? `  — ${detail}` : ''}`); };

function get(port: number, path: string, host: string, method = 'GET') {
    return new Promise<{ status: number; location?: string; body: string }>((resolve, reject) => {
        const r = http.request({ host: '127.0.0.1', port, path, method, headers: { Host: host } }, res => {
            let body = ''; res.on('data', c => (body += c)); res.on('end', () => resolve({ status: res.statusCode ?? 0, location: res.headers.location, body }));
        });
        r.on('error', reject); r.end();
    });
}

async function main() {
    delete process.env.PUBLIC_APP_URL; delete process.env.ADMIN_APP_URL; delete process.env.ANDROID_CERT_SHA256;
    const app = express();
    app.set('trust proxy', 1);
    app.use(canonicalHost());
    app.get('/.well-known/assetlinks.json', assetLinks);
    app.all('*', (_req, res) => res.status(200).send('served here'));
    const server = app.listen(0);
    const port = (server.address() as AddressInfo).port;
    const R = 'unitefix-backend.onrender.com';
    try {
        check('before the domain is set up, nothing moves', (await get(port, '/news/e/abc', R)).status === 200);

        process.env.PUBLIC_APP_URL = 'https://app.unitefix.com/';
        process.env.ADMIN_APP_URL = 'https://admin.unitefix.com';
        const e = await get(port, '/news/e/abc123?x=1', R);
        check('a shared newspaper link opened on the Render address moves to app.unitefix.com', e.status === 301 && e.location === 'https://app.unitefix.com/news/e/abc123?x=1', JSON.stringify(e));
        const pay = await get(port, '/pay/tok', R);
        check('…so does a pay link', pay.location === 'https://app.unitefix.com/pay/tok');
        const root = await get(port, '/', R);
        check('…and the sign-in page (the Partner Hub)', root.location === 'https://app.unitefix.com/');
        const adm = await get(port, '/admin/news', R);
        check('staff pages move to admin.unitefix.com', adm.location === 'https://admin.unitefix.com/admin/news');
        check('the API stays on the Render address (installed apps)', (await get(port, '/api/news/feed', R)).status === 200);
        check('…including payment webhooks', (await get(port, '/api/webhooks/razorpay', R, 'POST')).status === 200);
        check('the app\'s newspaper reader stays (its WebView only trusts its own address)', (await get(port, '/news/read/5?exp=1&sig=x', R)).status === 200);
        check('requests that are not page loads are not redirected', (await get(port, '/news/e/abc', R, 'POST')).status === 200);
        check('on app.unitefix.com itself, pages are served', (await get(port, '/news/e/abc', 'app.unitefix.com')).status === 200);
        check('on admin.unitefix.com, pages are served', (await get(port, '/admin/news', 'admin.unitefix.com')).status === 200);

        check('links are built on the public address, without a trailing slash', publicAppUrl() === 'https://app.unitefix.com' && adminAppUrl() === 'https://admin.unitefix.com');
        delete process.env.ADMIN_APP_URL;
        check('without an admin address, staff links use the public one', adminAppUrl() === 'https://app.unitefix.com');

        check('no App Links file until the fingerprint is set', (await get(port, '/.well-known/assetlinks.json', 'app.unitefix.com')).status === 404);
        process.env.ANDROID_CERT_SHA256 = 'ab:cd:'.repeat(16).slice(0, 95);
        const al = await get(port, '/.well-known/assetlinks.json', 'app.unitefix.com');
        const j = JSON.parse(al.body);
        check('App Links file names the app and its signing certificate', al.status === 200 && j[0]?.target?.package_name === 'com.unitefix.app' && j[0].target.sha256_cert_fingerprints[0] === 'AB:CD:'.repeat(16).slice(0, 95), al.body);
        process.env.ANDROID_CERT_SHA256 = 'not-a-fingerprint';
        check('a malformed fingerprint is not published', (await get(port, '/.well-known/assetlinks.json', 'app.unitefix.com')).status === 404);
    } finally {
        server.close();
    }
    const failed = results.filter(r => !r.pass).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
