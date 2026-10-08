/**
 * Cloudinary Service
 * 
 * Handles image uploads to Cloudinary CDN.
 * Falls back to storing raw base64 data-URIs in dev mode if credentials are missing.
 * 
 * ENV VARS REQUIRED (production):
 *   CLOUDINARY_CLOUD_NAME
 *   CLOUDINARY_API_KEY
 *   CLOUDINARY_API_SECRET
 */

import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary';
import logger from '../lib/logger';

let initialized = false;

function ensureInitialized(): boolean {
  if (initialized) return !!process.env.CLOUDINARY_CLOUD_NAME;

  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;

  if (CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET) {
    cloudinary.config({
      cloud_name: CLOUDINARY_CLOUD_NAME,
      api_key: CLOUDINARY_API_KEY,
      api_secret: CLOUDINARY_API_SECRET,
      secure: true,
    });
    initialized = true;
    logger.info('[CLOUDINARY] Configured successfully', { cloudName: CLOUDINARY_CLOUD_NAME });
    return true;
  }

  initialized = true;
  logger.warn('[CLOUDINARY] Missing credentials — uploads will be stored as raw URLs/base64 (dev mode)');
  return false;
}

export interface UploadResult {
  url: string;          // HTTPS CDN URL
  publicId: string;     // Cloudinary public ID (for deletion)
  width?: number;
  height?: number;
}

/**
 * Upload a single image buffer to Cloudinary.
 * 
 * @param buffer  - The raw file buffer (from multer)
 * @param folder  - Cloudinary folder path (e.g. "profile_pictures", "service_photos")
 * @param options - Extra options (e.g. max dimensions)
 */
export async function uploadImageBuffer(
  buffer: Buffer,
  folder: string,
  options: { maxWidth?: number; maxHeight?: number } = {},
): Promise<UploadResult> {
  const isConfigured = ensureInitialized();

  if (!isConfigured) {
    // Dev fallback: convert buffer to base64 data URI
    const base64 = buffer.toString('base64');
    const dataUri = `data:image/jpeg;base64,${base64}`;
    logger.info('[CLOUDINARY] Dev mode — returning base64 data URI');
    return { url: dataUri, publicId: `dev_${Date.now()}` };
  }

  return new Promise<UploadResult>((resolve, reject) => {
    const transformation: Record<string, any>[] = [
      { quality: 'auto', fetch_format: 'auto' },
    ];

    if (options.maxWidth || options.maxHeight) {
      transformation.push({
        width: options.maxWidth || 1200,
        height: options.maxHeight || 1200,
        crop: 'limit', // Downscale only, never upscale
      });
    }

    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: `unitefix/${folder}`,
        resource_type: 'image',
        transformation,
      },
      (error, result: UploadApiResponse | undefined) => {
        if (error) {
          logger.error('[CLOUDINARY] Upload failed', { error: error.message, folder });
          return reject(new Error(`Image upload failed: ${error.message}`));
        }
        if (!result) {
          return reject(new Error('Image upload returned no result'));
        }

        logger.info('[CLOUDINARY] Upload successful', {
          publicId: result.public_id,
          bytes: result.bytes,
          format: result.format,
        });

        resolve({
          url: result.secure_url,
          publicId: result.public_id,
          width: result.width,
          height: result.height,
        });
      },
    );

    uploadStream.end(buffer);
  });
}

/**
 * Delete an image from Cloudinary by its public ID.
 */
export async function deleteImage(publicId: string): Promise<void> {
  const isConfigured = ensureInitialized();
  if (!isConfigured) {
    logger.info('[CLOUDINARY] Dev mode — skipping delete');
    return;
  }

  try {
    await cloudinary.uploader.destroy(publicId);
    logger.info('[CLOUDINARY] Deleted image', { publicId });
  } catch (error: any) {
    logger.error('[CLOUDINARY] Delete failed', { publicId, error: error.message });
  }
}

/**
 * Upload a document — a PDF or an image — such as a GST certificate or a
 * cancelled cheque. `resource_type: 'auto'` keeps PDFs as PDFs; the image
 * helper above would try to transcode them.
 */
export async function uploadDocumentBuffer(
  buffer: Buffer,
  folder: string,
  mimeType: string,
): Promise<UploadResult> {
  const isConfigured = ensureInitialized();
  if (!isConfigured) {
    logger.info('[CLOUDINARY] Dev mode — returning document as data URI');
    return { url: `data:${mimeType || 'application/octet-stream'};base64,${buffer.toString('base64')}`, publicId: `dev_${Date.now()}` };
  }
  return new Promise<UploadResult>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      // PDFs as 'raw': Cloudinary blocks delivery of image-type PDFs by default,
      // which would leave an uploaded certificate unviewable by the reviewer.
      { folder: `unitefix/${folder}`, resource_type: mimeType === 'application/pdf' ? 'raw' : 'image' },
      (error, result: UploadApiResponse | undefined) => {
        if (error) {
          logger.error('[CLOUDINARY] Document upload failed', { error: error.message, folder });
          return reject(new Error(`Document upload failed: ${error.message}`));
        }
        if (!result) return reject(new Error('Document upload returned no result'));
        resolve({ url: result.secure_url, publicId: result.public_id });
      },
    );
    stream.end(buffer);
  });
}

export class VideoStorageUnavailable extends Error {}

/**
 * Upload a short video clip (a photographer's reel). Cloudinary transcodes it
 * to a web-friendly MP4 no wider than 1280 px; the poster frame is the same
 * URL as a .jpg. Without Cloudinary there is nowhere sensible to keep video
 * (a data URI of a clip is megabytes in a database row), so this refuses.
 */
export async function uploadVideoBuffer(buffer: Buffer, folder: string): Promise<UploadResult & { durationSec: number | null; posterUrl: string }> {
  if (!ensureInitialized()) throw new VideoStorageUnavailable('Video uploads need cloud storage, which is not set up.');
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: `unitefix/${folder}`, resource_type: 'video', transformation: [{ width: 1280, crop: 'limit', quality: 'auto', fetch_format: 'mp4' }] },
      (error, result: UploadApiResponse | undefined) => {
        if (error) { logger.error('[CLOUDINARY] Video upload failed', { error: error.message, folder }); return reject(new Error(`Video upload failed: ${error.message}`)); }
        if (!result) return reject(new Error('Video upload returned no result'));
        const url = result.secure_url;
        resolve({ url, publicId: result.public_id, width: result.width, height: result.height, durationSec: result.duration != null ? Math.round(Number(result.duration)) : null, posterUrl: url.replace(/\.[a-z0-9]+$/i, '.jpg') });
      },
    );
    stream.end(buffer);
  });
}

export async function deleteVideo(publicId: string): Promise<void> {
  if (!ensureInitialized()) return;
  try { await cloudinary.uploader.destroy(publicId, { resource_type: 'video' }); } catch (e: any) { logger.error('[CLOUDINARY] Video delete failed', { publicId, error: e?.message }); }
}
