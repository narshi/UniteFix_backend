/**
 * Upload Routes
 * 
 * Provides authenticated image upload endpoints:
 *   POST /api/upload/image         — Upload a single image (profile pics, etc.)
 *   POST /api/upload/images        — Upload multiple images (service request photos, max 5)
 * 
 * All uploads go to Cloudinary and return CDN URLs.
 * Uses multer for multipart/form-data parsing with memory storage.
 */

import type { Express, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { authenticateToken } from '../middleware/auth.middleware';
import { uploadImageBuffer } from '../services/cloudinary.service';
import logger from '../lib/logger';

// Multer config: store in memory, max 5MB per file, images only
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 5,
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (JPEG, PNG, WebP) are allowed'));
    }
  },
});

interface AuthenticatedRequest extends Request {
  user?: { userId: number; role: string };
}

export function registerUploadRoutes(app: Express) {

  /**
   * POST /api/upload/image
   * Upload a single image. Returns the CDN URL.
   * 
   * Body: multipart/form-data with field name "image"
   * Query: ?folder=profile_pictures (optional, defaults to "general")
   * 
   * Response: { success: true, data: { url, publicId } }
   */
  app.post(
    '/api/upload/image',
    authenticateToken,
    upload.single('image'),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        if (!req.file) {
          return res.status(400).json({ success: false, message: 'No image file provided' });
        }

        const folder = (req.query.folder as string) || 'general';
        const allowedFolders = ['profile_pictures', 'service_photos', 'general'];
        const safeFolder = allowedFolders.includes(folder) ? folder : 'general';

        const result = await uploadImageBuffer(req.file.buffer, safeFolder, {
          maxWidth: safeFolder === 'profile_pictures' ? 500 : 1200,
          maxHeight: safeFolder === 'profile_pictures' ? 500 : 1200,
        });

        logger.info('[UPLOAD] Single image uploaded', {
          userId: req.user?.userId,
          folder: safeFolder,
          size: req.file.size,
        });

        res.json({
          success: true,
          data: {
            url: result.url,
            publicId: result.publicId,
          },
        });
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * POST /api/upload/images
   * Upload multiple images (max 5). Returns array of CDN URLs.
   * 
   * Body: multipart/form-data with field name "images"
   * Query: ?folder=service_photos (optional, defaults to "general")
   * 
   * Response: { success: true, data: { urls: string[], publicIds: string[] } }
   */
  app.post(
    '/api/upload/images',
    authenticateToken,
    upload.array('images', 5),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const files = req.files as Express.Multer.File[];
        if (!files || files.length === 0) {
          return res.status(400).json({ success: false, message: 'No image files provided' });
        }

        const folder = (req.query.folder as string) || 'general';
        const allowedFolders = ['profile_pictures', 'service_photos', 'general'];
        const safeFolder = allowedFolders.includes(folder) ? folder : 'general';

        const results = await Promise.all(
          files.map((file) =>
            uploadImageBuffer(file.buffer, safeFolder, {
              maxWidth: 1200,
              maxHeight: 1200,
            }),
          ),
        );

        logger.info('[UPLOAD] Multiple images uploaded', {
          userId: req.user?.userId,
          folder: safeFolder,
          count: files.length,
          totalSize: files.reduce((sum, f) => sum + f.size, 0),
        });

        res.json({
          success: true,
          data: {
            urls: results.map((r) => r.url),
            publicIds: results.map((r) => r.publicId),
          },
        });
      } catch (error) {
        next(error);
      }
    },
  );
}
