/**
 * Forced app update: staff set a minimum version code; builds below it are
 * refused (426 UPDATE_REQUIRED), optionally also builds too old to say their
 * version. Browsers and the version check itself are never refused.
 *
 *   npm run smoke:app-version
 */

import { bootServer, client, check, summary, makeSuperAdmin, cleanupPartners } from './lib/hub-test-kit';

const stamp = Date.now().toString(36);
const adminIds: number[] = [];
const OKHTTP = 'okhttp/4.9.2';
const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36';

async function main() {
    const { base, close } = await bootServer();
    const api = client(base);
    const hit = async (path: string, headers: Record<string, string>) => {
        const r = await fetch(`${base}${path}`, { headers });
        return { status: r.status, body: await r.json().catch(() => ({})) as any };
    };
    const { appVersionPolicy, saveAppVersionPolicy } = await import('../server/lib/app-version');
    const original = await appVersionPolicy();
    try {
        const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
        const S = (await api.login(sa.username, sa.password))!;
        await saveAppVersionPolicy({ minVersionCode: 0, latestVersionCode: 0, blockLegacy: false }, null);

        const v0 = await hit('/api/client/app-version?platform=android', { 'User-Agent': OKHTTP });
        check('the version check answers, with no minimum by default', v0.status === 200 && v0.body?.data?.minVersionCode === 0 && /^market:\/\//.test(v0.body.data.updateUrl));
        check('with no minimum, an app build is not refused', (await hit('/api/services/categories', { 'User-Agent': OKHTTP, 'X-App-Version-Code': '31' })).status !== 426);

        const bad = await api.put('/api/admin/app-version', { minVersionCode: 40, latestVersionCode: 35 }, S);
        check('a minimum above the latest build is refused (nobody could update past it)', bad.status === 400 && /above the latest/.test(bad.body?.error ?? ''));
        check('a version code that is not a whole number is refused', (await api.put('/api/admin/app-version', { minVersionCode: 'abc' }, S)).status === 400);
        check('a store link that is not market:// or https:// is refused', (await api.put('/api/admin/app-version', { androidUrl: 'javascript:alert(1)' }, S)).status === 400);

        const set = await api.put('/api/admin/app-version', { minVersionCode: 32, latestVersionCode: 32, message: 'Please update UniteFix: this version is no longer supported.' }, S);
        check('staff set minimum 32', set.status === 200 && set.body?.data?.minVersionCode === 32 && /below 32/.test(set.body?.message ?? ''), JSON.stringify(set.body).slice(0, 200));
        const got = await api.get('/api/admin/app-version', S);
        check('…and read it back', got.body?.data?.minVersionCode === 32 && got.body.data.latestVersionCode === 32);

        const old = await hit('/api/services/categories', { 'User-Agent': OKHTTP, 'X-App-Version-Code': '31', 'X-App-Platform': 'android' });
        check('a build below the minimum is refused with 426 and the message', old.status === 426 && old.body?.code === 'UPDATE_REQUIRED' && /no longer supported/.test(old.body.message) && old.body.minVersionCode === 32, JSON.stringify(old.body));
        check('…on any API call, signed in or not', (await hit('/api/auth/me', { 'User-Agent': OKHTTP, 'X-App-Version-Code': '20' })).status === 426);
        check('a build at the minimum works', (await hit('/api/services/categories', { 'User-Agent': OKHTTP, 'X-App-Version-Code': '32' })).status !== 426);
        check('the version check itself is never refused', (await hit('/api/client/app-version', { 'User-Agent': OKHTTP, 'X-App-Version-Code': '20' })).status === 200);
        const v1 = await hit('/api/client/app-version?platform=android', {});
        check('…and tells the app the minimum and the message', v1.body?.data?.minVersionCode === 32 && /no longer supported/.test(v1.body.data.message));
        check('an old build with no version header is not refused while "block older builds" is off', (await hit('/api/services/categories', { 'User-Agent': OKHTTP })).status !== 426);

        await api.put('/api/admin/app-version', { blockLegacy: true }, S);
        check('"block older builds" on: an app build that sends no version is refused', (await hit('/api/services/categories', { 'User-Agent': OKHTTP })).status === 426);
        check('…but a browser (admin, Partner Hub, website) never is', (await hit('/api/services/categories', { 'User-Agent': BROWSER })).status !== 426);
        check('…nor staff pages', (await hit('/api/admin/app-version', { 'User-Agent': OKHTTP })).status !== 426);

        await api.put('/api/admin/app-version', { minVersionCode: 0, blockLegacy: false }, S);
        check('setting the minimum back to 0 lets every build in again', (await hit('/api/services/categories', { 'User-Agent': OKHTTP, 'X-App-Version-Code': '20' })).status !== 426);
    } finally {
        await saveAppVersionPolicy(original, null);
        await close();
    }
}

main().catch(e => { console.error(e); check('no crash', false, e?.message); }).finally(async () => {
    await cleanupPartners([], adminIds, [`DELETE FROM audit_logs WHERE action = 'app_version_policy_changed' AND changed_by IN (${adminIds.join(',') || '0'})`]);
    process.exit(summary());
});
