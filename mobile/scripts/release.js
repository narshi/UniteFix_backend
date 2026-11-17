#!/usr/bin/env node
/**
 * UniteFix Play Store Release Script
 * ===================================
 * One command to: bump version → build AAB → upload to Play Store → done.
 *
 * Usage:
 *   node scripts/release.js                      # patch bump, upload to INTERNAL testing (default)
 *   node scripts/release.js --bump minor         # minor bump (1.0.32 → 1.1.0)
 *   node scripts/release.js --bump major         # major bump (1.0.32 → 2.0.0)
 *   node scripts/release.js --skip-build         # skip build, upload existing AAB
 *   node scripts/release.js --skip-upload        # build only, don't upload
 *   node scripts/release.js --track production --rollout 0.1   # production, 10% staged
 *   node scripts/release.js --track production   # production, 100% (asks you to type "yes")
 *   node scripts/release.js --dry-run            # show what would happen
 *   --yes                                        # skip the typed confirmation (only in a terminal you trust)
 *
 * The script never commits or tags. Commit the version bump yourself after it succeeds.
 *
 * Prerequisites:
 *   1. Android SDK + JDK 17 installed (you have this ✅)
 *   2. upload-key.keystore in android/app/ (you have this ✅)
 *   3. keystore.properties in android/ (you have this ✅)
 *   4. Google Play service account JSON (see RELEASE_SETUP.md)
 *   5. npm install googleapis (run once)
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

// ─── Paths ───────────────────────────────────────────────────────────────────
const MOBILE_ROOT = path.resolve(__dirname, '..');
const ANDROID_ROOT = path.join(MOBILE_ROOT, 'android');
const APP_JSON = path.join(MOBILE_ROOT, 'app.json');
const BUILD_GRADLE = path.join(ANDROID_ROOT, 'app', 'build.gradle');
const AAB_PATH = path.join(ANDROID_ROOT, 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab');

// Service account JSON path — set via env or default location
const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT
  || path.join(MOBILE_ROOT, 'play-service-account.json');

const PACKAGE_NAME = 'com.unitefix.app';

// ─── Parse CLI Args ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return args[idx + 1];
}
const hasFlag = (name) => args.includes(`--${name}`);

const BUMP = getArg('bump') || 'patch'; // patch | minor | major
// Internal testing is the default: a plain run never reaches users. Production must be asked for.
const TRACK = getArg('track') || 'internal';
const ROLLOUT = getArg('rollout') ? parseFloat(getArg('rollout')) : 1.0;
if (!['internal', 'alpha', 'beta', 'production'].includes(TRACK)) { console.error(`Unknown track "${TRACK}".`); process.exit(1); }
if (!(ROLLOUT > 0 && ROLLOUT <= 1)) { console.error(`--rollout must be more than 0 and at most 1 (got ${ROLLOUT}).`); process.exit(1); }
const YES = hasFlag('yes');
const SKIP_BUILD = hasFlag('skip-build');
const SKIP_UPLOAD = hasFlag('skip-upload');
const DRY_RUN = hasFlag('dry-run');

// ─── Utilities ───────────────────────────────────────────────────────────────
const log = (emoji, msg) => console.log(`\n${emoji}  ${msg}`);
const dim = (msg) => console.log(`   ${msg}`);
const die = (msg) => { console.error(`\n❌  ${msg}`); process.exit(1); };

/** Publishing reaches users, so a person must type "yes" (or pass --yes). */
function confirm(question) {
  if (YES) return Promise.resolve(true);
  if (!process.stdin.isTTY) die('Refusing to publish without confirmation. Run it in a terminal, or pass --yes.');
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer.trim() === 'yes'); }));
}

function execInDir(cmd, cwd, label) {
  log('⚙️', label || cmd);
  try {
    execSync(cmd, {
      cwd,
      stdio: 'inherit',
      env: { ...process.env, JAVA_HOME: process.env.JAVA_HOME || 'C:\\Program Files\\Eclipse Adoptium\\jdk-17.0.19.10-hotspot' }
    });
  } catch (e) {
    die(`Command failed: ${cmd}`);
  }
}

// ─── Step 1: Version Bump ────────────────────────────────────────────────────
function bumpVersion() {
  log('📦', `Bumping version (${BUMP})...`);

  // Read current version from app.json
  const appJson = JSON.parse(fs.readFileSync(APP_JSON, 'utf-8'));
  const currentVersion = appJson.expo.version;
  const currentVersionCode = appJson.expo.android.versionCode;

  // Compute new version
  const parts = currentVersion.split('.').map(Number);
  if (BUMP === 'major') { parts[0]++; parts[1] = 0; parts[2] = 0; }
  else if (BUMP === 'minor') { parts[0] = parts[0]; parts[1]++; parts[2] = 0; }
  else { parts[2]++; } // patch

  const newVersion = parts.join('.');
  const newVersionCode = currentVersionCode + 1;

  dim(`Version: ${currentVersion} → ${newVersion}`);
  dim(`VersionCode: ${currentVersionCode} → ${newVersionCode}`);

  if (DRY_RUN) return { newVersion, newVersionCode };

  // Update app.json
  appJson.expo.version = newVersion;
  appJson.expo.android.versionCode = newVersionCode;
  fs.writeFileSync(APP_JSON, JSON.stringify(appJson, null, 2) + '\n');

  // Update build.gradle (versionCode and versionName)
  let gradle = fs.readFileSync(BUILD_GRADLE, 'utf-8');
  gradle = gradle.replace(
    /versionCode\s+\d+/,
    `versionCode ${newVersionCode}`
  );
  gradle = gradle.replace(
    /versionName\s+"[^"]+"/,
    `versionName "${newVersion}"`
  );
  fs.writeFileSync(BUILD_GRADLE, gradle);

  log('✅', `Version bumped to ${newVersion} (${newVersionCode})`);
  return { newVersion, newVersionCode };
}

// ─── Step 2: Build AAB ──────────────────────────────────────────────────────
function buildAAB() {
  if (SKIP_BUILD) {
    log('⏭️', 'Skipping build (--skip-build)');
    if (!fs.existsSync(AAB_PATH)) {
      die(`No AAB found at ${AAB_PATH}. Remove --skip-build to build first.`);
    }
    return;
  }

  log('🔨', 'Building release AAB...');
  dim(`Working directory: ${ANDROID_ROOT}`);

  if (DRY_RUN) {
    dim('[DRY RUN] Would run: gradlew.bat bundleRelease');
    return;
  }

  // Clean previous build
  execInDir('gradlew.bat clean', ANDROID_ROOT, 'Cleaning previous build...');

  // Build the release AAB
  execInDir('gradlew.bat bundleRelease', ANDROID_ROOT, 'Building release bundle...');

  if (!fs.existsSync(AAB_PATH)) {
    die(`Build succeeded but AAB not found at expected path:\n   ${AAB_PATH}`);
  }

  const size = (fs.statSync(AAB_PATH).size / (1024 * 1024)).toFixed(1);
  log('✅', `AAB built successfully (${size} MB)`);
  dim(AAB_PATH);
}

// ─── Step 3: Upload to Play Store ────────────────────────────────────────────
async function uploadToPlayStore(newVersion) {
  if (SKIP_UPLOAD) {
    log('⏭️', 'Skipping upload (--skip-upload)');
    dim(`AAB is at: ${AAB_PATH}`);
    return;
  }

  log('🚀', `Uploading to Play Store (${TRACK} track)...`);

  if (DRY_RUN) {
    dim(`[DRY RUN] Would upload ${AAB_PATH}`);
    dim(`[DRY RUN] Track: ${TRACK}, Rollout: ${ROLLOUT * 100}%`);
    dim(`[DRY RUN] Service account: ${fs.existsSync(SERVICE_ACCOUNT_PATH) ? '✅ Found' : '❌ Not found (setup needed)'}`);
    return;
  }

  // Check service account exists
  if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    die(
      `Google Play service account JSON not found!\n` +
      `   Expected at: ${SERVICE_ACCOUNT_PATH}\n` +
      `   Or set env: GOOGLE_PLAY_SERVICE_ACCOUNT=/path/to/key.json\n\n` +
      `   See PlayStore_Release_Automation.md for setup instructions.`
    );
  }

  // Dynamic import googleapis
  let google;
  try {
    const { google: g } = require('googleapis');
    google = g;
  } catch (e) {
    die(
      `'googleapis' package not installed.\n` +
      `   Run: cd mobile && npm install --save-dev googleapis\n` +
      `   Then re-run this script.`
    );
  }

  const ok = await confirm(`\nPublish version ${newVersion} to the ${TRACK} track at ${ROLLOUT * 100}%? Type "yes" to continue: `);
  if (!ok) die('Not published. Nothing was sent to Google Play. (The version number in app.json and build.gradle was already bumped; revert it if you do not want it.)');

  // Authenticate with service account
  const auth = new google.auth.GoogleAuth({
    keyFile: SERVICE_ACCOUNT_PATH,
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });

  const publisher = google.androidpublisher({ version: 'v3', auth });

  try {
    // 1. Create an edit
    dim('Creating edit...');
    const { data: edit } = await publisher.edits.insert({
      packageName: PACKAGE_NAME,
    });
    const editId = edit.id;
    dim(`Edit ID: ${editId}`);

    // 2. Upload AAB
    dim('Uploading AAB (this may take a minute)...');
    const { data: bundle } = await publisher.edits.bundles.upload({
      packageName: PACKAGE_NAME,
      editId,
      media: {
        mimeType: 'application/octet-stream',
        body: fs.createReadStream(AAB_PATH),
      },
    });
    dim(`Uploaded versionCode: ${bundle.versionCode}`);

    // 3. Assign to track
    dim(`Assigning to ${TRACK} track (${ROLLOUT * 100}% rollout)...`);
    await publisher.edits.tracks.update({
      packageName: PACKAGE_NAME,
      editId,
      track: TRACK,
      requestBody: {
        track: TRACK,
        releases: [
          {
            versionCodes: [String(bundle.versionCode)],
            status: ROLLOUT < 1.0 ? 'inProgress' : 'completed',
            userFraction: ROLLOUT < 1.0 ? ROLLOUT : undefined,
            releaseNotes: [
              {
                language: 'en-IN',
                text: `UniteFix v${newVersion}\n• Bug fixes and performance improvements`,
              },
            ],
          },
        ],
      },
    });

    // 4. Commit the edit
    dim('Committing edit...');
    await publisher.edits.commit({
      packageName: PACKAGE_NAME,
      editId,
    });

    log('🎉', `Successfully published to ${TRACK} track!`);
    dim(`Version: ${newVersion}, Rollout: ${ROLLOUT * 100}%`);
    dim(`View at: https://play.google.com/console`);

  } catch (err) {
    const msg = err?.response?.data?.error?.message || err.message;
    die(`Play Store upload failed: ${msg}`);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║   UniteFix Play Store Release Pipeline     ║');
  console.log('╚════════════════════════════════════════════╝');

  if (DRY_RUN) log('🏜️', 'DRY RUN — no changes will be made\n');

  const { newVersion, newVersionCode } = bumpVersion();
  buildAAB();
  await uploadToPlayStore(newVersion);
  if (!DRY_RUN) dim('Next: commit app.json and build.gradle with the version bump, then push.');

  console.log('\n╔════════════════════════════════════════════╗');
  console.log(DRY_RUN ? '║   Dry run finished. Nothing was changed.   ║' : '║   ✅  Release Pipeline Complete!            ║');
  console.log('╚════════════════════════════════════════════╝\n');
}

main().catch((err) => {
  console.error('\n❌ Release failed:', err.message);
  process.exit(1);
});
