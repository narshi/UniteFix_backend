/**
 * Fails if any t('...') key used in the app is missing from the locale files.
 *
 * i18next renders a missing key as the key itself, so the bug ships silently
 * and users see "profile.name" sitting where a label should be. Nothing in
 * tsc or the bundler catches it — this does.
 *
 *   npm run check:i18n
 *
 * A key is only reported as BROKEN when it is missing AND the call passes no
 * inline default, since t('a.b', 'Fallback') renders the fallback. Missing
 * Kannada entries are reported separately: those fall back to English, which is
 * degraded but not broken.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const LOCALES = {
    en: path.join(SRC, 'i18n', 'locales', 'en.json'),
    kn: path.join(SRC, 'i18n', 'locales', 'kn.json'),
};

function walk(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
    }
    return out;
}

function flatten(obj, prefix = '', out = {}) {
    for (const [k, v] of Object.entries(obj)) {
        const key = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
        else out[key] = v;
    }
    return out;
}

const tables = {};
for (const [lang, file] of Object.entries(LOCALES)) {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    tables[lang] = flatten(raw.translation ?? raw);
}

// t('key'), t("key"), t(`key`) — with an optional string second argument.
const CALL = /\bt\(\s*(?:'([^']+)'|"([^"]+)"|`([^`]+)`)\s*(,\s*(?:'([^']*)'|"([^"]*)"))?/g;

const used = new Map();
for (const file of walk(SRC)) {
    const src = fs.readFileSync(file, 'utf8');
    let m;
    while ((m = CALL.exec(src))) {
        const key = m[1] || m[2] || m[3];
        // Dotted keys only — bare t('x') is almost always something else.
        if (!key || !key.includes('.')) continue;
        const entry = used.get(key) || { files: new Set(), hasDefault: false };
        entry.files.add(path.relative(SRC, file).replace(/\\/g, '/'));
        if (m[5] !== undefined || m[6] !== undefined) entry.hasDefault = true;
        used.set(key, entry);
    }
}

const rows = [...used.entries()].sort(([a], [b]) => a.localeCompare(b));
const broken = rows.filter(([k, v]) => tables.en[k] === undefined && !v.hasDefault);
const softMissing = rows.filter(([k, v]) => tables.en[k] === undefined && v.hasDefault);
const missingKn = rows.filter(([k]) => tables.en[k] !== undefined && tables.kn[k] === undefined);

console.log(`i18n: ${rows.length} keys used | en ${Object.keys(tables.en).length} | kn ${Object.keys(tables.kn).length}`);

if (softMissing.length) {
    console.log(`\nNOTE — missing from en.json but the call supplies a default (${softMissing.length}):`);
    for (const [k, v] of softMissing) console.log(`  ${k}  (${[...v.files].join(', ')})`);
}

if (missingKn.length) {
    console.log(`\nWARN — missing from kn.json, will show English (${missingKn.length}):`);
    for (const [k] of missingKn) console.log(`  ${k}`);
}

if (broken.length) {
    console.error(`\nFAIL — these render as the raw key on screen (${broken.length}):`);
    for (const [k, v] of broken) console.error(`  ${k}  (${[...v.files].join(', ')})`);
    process.exit(1);
}

console.log('\nOK — every key resolves to a string.');
