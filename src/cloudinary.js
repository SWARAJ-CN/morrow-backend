// Cloudinary uploads over the REST API — no SDK dependency required.
// Configure CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET
// in backend/.env. When they are missing, callers fall back to local disk storage.
import { createHash, randomUUID } from 'node:crypto';
import { config } from './config.js';

const { cloudName, apiKey, apiSecret, folder } = config.cloudinary;

export const cloudinaryEnabled = Boolean(cloudName && apiKey && apiSecret);

// Cloudinary resource type depends on the file, but the `auto` endpoint picks
// the right one (image / video / raw) for us.
export async function uploadToCloudinary(buffer, { filename, mimeType } = {}) {
  if (!cloudinaryEnabled) throw new Error('Cloudinary is not configured.');

  const timestamp = Math.floor(Date.now() / 1000);
  // Sign every parameter except file/api_key/resource_type, sorted by name.
  const signedParams = { folder, timestamp };
  const toSign = Object.keys(signedParams)
    .sort()
    .map((key) => `${key}=${signedParams[key]}`)
    .join('&');
  const signature = createHash('sha1').update(`${toSign}${apiSecret}`).digest('hex');

  const safeName = String(filename || randomUUID()).replace(/[^\w.\-]+/g, '_').slice(-120) || randomUUID();

  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType || 'application/octet-stream' }), safeName);
  form.append('api_key', apiKey);
  form.append('timestamp', String(timestamp));
  form.append('folder', folder);
  form.append('signature', signature);

  const endpoint = `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`;
  const response = await fetch(endpoint, { method: 'POST', body: form });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail = data?.error?.message || `responded with ${response.status}`;
    throw new Error(`Cloudinary upload failed: ${detail}`);
  }

  const url = data.secure_url || data.url;

  return {
    url,
    // A poster frame for videos, so the app can show a preview without
    // decoding the video itself.
    thumbnailUrl: data.resource_type === 'video' ? videoThumbnail(url, data.public_id) : null,
    publicId: data.public_id,
    resourceType: data.resource_type,
    format: data.format,
    bytes: data.bytes,
  };
}

/**
 * Build a poster-frame URL for an uploaded video.
 *
 * Cloudinary can deliver any frame of a video as an image, so the same
 * public id with `so_0` (the first second) and a `.jpg` extension gives a
 * thumbnail.
 */
export function videoThumbnail(url, publicId) {
  if (!publicId) return null;
  const base = String(url || '');
  const folder = base.includes('/upload/') ? base.slice(0, base.indexOf('/upload/')) : '';
  const id = String(publicId).replace(/\//g, '/');
  return `${folder}/upload/so_0/${id}.jpg`;
}
