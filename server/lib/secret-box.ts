/**
 * Encrypts small secrets (an integration's access token) for storage in the
 * database: AES-256-GCM, key derived from INTEGRATIONS_SECRET (or JWT_SECRET,
 * which every deployment has). Changing that secret makes stored values
 * unreadable — staff re-enter them; nothing else breaks.
 */

import crypto from 'crypto';

const key = () => crypto.createHash('sha256').update(`integrations:${process.env.INTEGRATIONS_SECRET || process.env.JWT_SECRET || ''}`).digest();

export function seal(plain: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), body.toString('base64')].join(':');
}

/** The plain text, or null when it cannot be opened (the secret changed, or it was tampered with). */
export function open(sealed: string | null | undefined): string | null {
    if (!sealed) return null;
    try {
        const [v, iv, tag, body] = sealed.split(':');
        if (v !== 'v1') return null;
        const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
        decipher.setAuthTag(Buffer.from(tag, 'base64'));
        return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString('utf8');
    } catch {
        return null;
    }
}
