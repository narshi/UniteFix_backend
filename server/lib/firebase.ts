/**
 * Firebase Admin — single shared app for the whole server.
 *
 * Two features depend on this app:
 *   1. Truecaller / phone auth → `admin.auth().verifyIdToken()`
 *   2. Push notifications      → `admin.messaging().sendEachForMulticast()`
 *
 * Both need the SAME app instance. Calling `initializeApp()` a second time
 * throws `app/duplicate-app`, so this module is the only place that may
 * initialize it — everything else imports `admin` (and `isMessagingReady`)
 * from here.
 *
 * Credentials are resolved in this order:
 *   1. FCM_SERVICE_ACCOUNT_JSON  — the service-account JSON inline (hosting-friendly)
 *   2. GOOGLE_APPLICATION_CREDENTIALS — path to the service-account key file
 *   3. Application Default Credentials (GCP metadata server)
 *
 * Verifying ID tokens works with just a projectId, but MESSAGING DOES NOT —
 * FCM needs a real credential to mint an access token. Without one, push
 * silently degrades to log-only.
 */

import admin from 'firebase-admin';
import logger from './logger';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'unitefix-e7ae3';

/** True only when the app was initialized with a real service-account credential. */
let messagingReady = false;

function resolveCredential(): admin.credential.Credential | null {
  if (process.env.FCM_SERVICE_ACCOUNT_JSON) {
    try {
      const serviceAccount = JSON.parse(process.env.FCM_SERVICE_ACCOUNT_JSON);
      logger.info('[FIREBASE_ADMIN] Using credential from FCM_SERVICE_ACCOUNT_JSON');
      return admin.credential.cert(serviceAccount);
    } catch (error: any) {
      logger.error('[FIREBASE_ADMIN] FCM_SERVICE_ACCOUNT_JSON is not valid JSON', {
        error: error.message,
      });
      return null;
    }
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    try {
      logger.info('[FIREBASE_ADMIN] Using credential from GOOGLE_APPLICATION_CREDENTIALS', {
        path: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      });
      return admin.credential.applicationDefault();
    } catch (error: any) {
      logger.error('[FIREBASE_ADMIN] Could not load GOOGLE_APPLICATION_CREDENTIALS', {
        error: error.message,
      });
      return null;
    }
  }

  // On GCP/Cloud Run the metadata server supplies ADC with no env var set.
  try {
    return admin.credential.applicationDefault();
  } catch {
    return null;
  }
}

try {
  if (!admin.apps.length) {
    const credential = resolveCredential();

    if (credential) {
      admin.initializeApp({ credential, projectId: PROJECT_ID });
      messagingReady = true;
      logger.info('[FIREBASE_ADMIN] Initialized with credentials — push notifications enabled');
    } else {
      // Degraded mode: ID-token verification still works, messaging does not.
      admin.initializeApp({ projectId: PROJECT_ID });
      messagingReady = false;
      logger.warn(
        '[FIREBASE_ADMIN] Initialized WITHOUT credentials. Auth token verification will work, ' +
        'but PUSH NOTIFICATIONS ARE DISABLED. Set FCM_SERVICE_ACCOUNT_JSON or ' +
        'GOOGLE_APPLICATION_CREDENTIALS to enable them.'
      );
    }
  } else {
    // Already initialized elsewhere (tests, hot reload) — trust it.
    messagingReady = true;
  }
} catch (error: any) {
  logger.error('[FIREBASE_ADMIN] Initialization error', { error: error.message });
  messagingReady = false;
}

/**
 * Whether `admin.messaging()` can actually deliver. Callers should check this
 * before attempting a send so a misconfigured environment produces one clear
 * warning instead of an exception per notification.
 */
export function isMessagingReady(): boolean {
  return messagingReady;
}

export { admin };
