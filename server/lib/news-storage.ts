/**
 * Where newspaper PDFs live. They are private: readers get them only through
 * UniteFix (a signed, short-lived reader link), never from a public URL —
 * otherwise "install the app to read the rest" means nothing.
 *
 *   Cloudinary (production)  raw files of type "authenticated": no public URL
 *                            exists; the server fetches with a signed URL and
 *                            streams to the reader.
 *   Local disk (development) under .data/news — Render's disk is wiped on every
 *                            deploy, so production refuses to use it — unless
 *                            NEWS_STORAGE=local, for a production build run on
 *                            this machine (the browser checks). Never set on Render.
 */

import fs from 'fs';
import path from 'path';
import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'stream';

const LOCAL_DIR = path.resolve(process.cwd(), '.data', 'news');
const localAllowed = () => process.env.NODE_ENV !== 'production' || process.env.NEWS_STORAGE === 'local';

function cloudReady() {
    const { CLOUDINARY_CLOUD_NAME: n, CLOUDINARY_API_KEY: k, CLOUDINARY_API_SECRET: s } = process.env;
    if (!n || !k || !s) return false;
    cloudinary.config({ cloud_name: n, api_key: k, api_secret: s, secure: true });
    return true;
}

export class NewsStorageUnavailable extends Error {}

export const NewsStorage = {
    /** Can editions be stored here at all? */
    ready() { return cloudReady() || localAllowed(); },
    mode(): 'cloudinary' | 'local' | 'none' { return cloudReady() ? 'cloudinary' : localAllowed() ? 'local' : 'none'; },

    async put(buffer: Buffer, key: string): Promise<string> {
        if (cloudReady()) {
            return new Promise((resolve, reject) => {
                const up = cloudinary.uploader.upload_stream(
                    { resource_type: 'raw', type: 'authenticated', public_id: `unitefix/news/${key}.pdf`, overwrite: true },
                    (err, res) => (err || !res ? reject(new Error(`Storage upload failed: ${err?.message ?? 'no result'}`)) : resolve(`cld:${res.public_id}`)),
                );
                up.end(buffer);
            });
        }
        if (!localAllowed()) throw new NewsStorageUnavailable('Newspaper storage is not set up (Cloudinary keys are missing).');
        fs.mkdirSync(LOCAL_DIR, { recursive: true });
        const file = path.join(LOCAL_DIR, `${key.replace(/[^\w.-]/g, '_')}.pdf`);
        await fs.promises.writeFile(file, buffer);
        return `local:${path.basename(file)}`;
    },

    /** The PDF as a stream, and its size when known. */
    async open(storedKey: string): Promise<{ stream: Readable; size: number | null }> {
        if (storedKey.startsWith('cld:')) {
            if (!cloudReady()) throw new NewsStorageUnavailable('Storage is not configured.');
            const publicId = storedKey.slice(4);
            const url = cloudinary.url(publicId, { resource_type: 'raw', type: 'authenticated', sign_url: true, secure: true });
            const res = await fetch(url);
            if (!res.ok || !res.body) throw new Error(`Storage fetch failed (${res.status})`);
            const size = Number(res.headers.get('content-length')) || null;
            return { stream: Readable.fromWeb(res.body as any), size };
        }
        if (storedKey.startsWith('local:')) {
            const file = path.join(LOCAL_DIR, path.basename(storedKey.slice(6)));
            const st = await fs.promises.stat(file);
            return { stream: fs.createReadStream(file), size: st.size };
        }
        throw new Error('Unknown storage key');
    },

    async remove(storedKey: string | null | undefined) {
        if (!storedKey) return;
        try {
            if (storedKey.startsWith('cld:') && cloudReady()) await cloudinary.uploader.destroy(storedKey.slice(4), { resource_type: 'raw', type: 'authenticated' });
            else if (storedKey.startsWith('local:')) await fs.promises.unlink(path.join(LOCAL_DIR, path.basename(storedKey.slice(6)))).catch(() => undefined);
        } catch { /* a leftover file is better than a failed clean-up job */ }
    },
};
