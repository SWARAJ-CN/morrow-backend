import path from 'node:path';
import { mkdirSync } from 'node:fs';
import multer from 'multer';

// Files are buffered in memory so the upload route can stream them to
// Cloudinary, or write them to disk when Cloudinary is not configured.
export const uploadDirectory = path.resolve('uploads');
mkdirSync(uploadDirectory, { recursive: true });

// The types people actually share. Document formats are matched on their
// vendor prefix (`vnd.`), on the `x-` convention, or on a small explicit
// list, so a .docx or .pages file is not rejected as "unsupported".
export const allowedMimeType = new RegExp(
  '^(image\\/(jpeg|jpg|png|webp|gif|svg\\+xml|heic|heif|bmp|tiff?)'
  + '|video\\/(mp4|quicktime|webm|mov|x-m4v|3gpp|3gpp2|mpeg)'
  + '|audio\\/(mpeg|mp3|mp4|aac|wav|webm|x-m4a|ogg|amr|3gpp)'
  + '|application\\/(pdf|zip|octet-stream|json|x-zip-compressed|msword|mspowerpoint|msaccess|ms-excel|rtf|vnd\\.[\\w.+-]+|epub\\+zip|x-tar|gzip|x-gzip|x-rar-compressed|x-7z-compressed|x-bzip|x-bzip2|x-tgz|javascript|x-javascript|sql)'
  + '|text\\/(plain|csv|markdown|html|rtf|calendar|vcard|typescript))$',
  'i',
);

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
