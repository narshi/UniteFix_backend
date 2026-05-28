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
