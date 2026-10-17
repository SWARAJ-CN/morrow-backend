import path from 'node:path';
import { mkdirSync } from 'node:fs';
import multer from 'multer';

// Files are buffered in memory so the upload route can stream them to
// Cloudinary, or write them to disk when Cloudinary is not configured.
export const uploadDirectory = path.resolve('uploads');
mkdirSync(uploadDirectory, { recursive: true });

export const allowedMimeType = /^(image\/(jpeg|png|webp|gif|svg\+xml)|video\/(mp4|quicktime|webm)|audio\/(mpeg|mp4|aac|wav|webm|x-m4a|ogg)|application\/(pdf|zip|vnd\.|octet-stream|json|x-zip-compressed|msword)|text\/(plain|csv))/i;

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (!allowedMimeType.test(file.mimetype)) return callback(new Error('This file type is not supported.'));
    return callback(null, true);
  },
});

export function mediaKindForMimeType(mimeType = '') {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'file';
}
