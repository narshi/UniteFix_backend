import admin from 'firebase-admin';
import logger from './logger';

// Initialize Firebase Admin SDK
// Using only the project ID is sufficient for verifying ID tokens,
// but requires GOOGLE_APPLICATION_CREDENTIALS locally.
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && process.env.NODE_ENV !== 'production') {
  logger.warn('[FIREBASE_ADMIN] GOOGLE_APPLICATION_CREDENTIALS not set. Firebase token verification will fail in local development unless you provide a service account key.');
}

try {
  if (!admin.apps.length) {
    admin.initializeApp({
      projectId: 'unitefix-e7ae3',
    });
    logger.info('[FIREBASE_ADMIN] Initialized successfully');
  }
} catch (error) {
  logger.error('[FIREBASE_ADMIN] Initialization error', { error });
}

export { admin };
