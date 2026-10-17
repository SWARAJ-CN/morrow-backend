import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { mediaKindForMimeType, upload, uploadDirectory } from '../middleware/upload.js';
import { cloudinaryEnabled, uploadToCloudinary } from '../cloudinary.js';

export const uploadRouter = Router();
uploadRouter.use(requireAuth);

uploadRouter.post('/', upload.single('file'), async (request, response, next) => {
  if (!request.file) return response.status(400).json({ error: 'Choose a file to upload.' });

  const { buffer, originalname, mimetype, size } = request.file;
  const mediaType = mediaKindForMimeType(mimetype);

  try {
    // Preferred path: store the file on Cloudinary so media survives restarts
    // and is served from a CDN.
    if (cloudinaryEnabled) {
      const uploaded = await uploadToCloudinary(buffer, { filename: originalname, mimeType: mimetype });
      return response.status(201).json({
        asset: {
          url: uploaded.url,
          publicId: uploaded.publicId,
          provider: 'cloudinary',
          mediaType,
          name: originalname,
          mimeType: mimetype,
          size,
        },
      });
    }

    // Fallback: keep the file on local disk and serve it from /uploads.
    const extension = path.extname(originalname).slice(0, 12).toLowerCase();
    const filename = `${randomUUID()}${extension}`;
    await writeFile(path.join(uploadDirectory, filename), buffer);

    return response.status(201).json({
      asset: {
        url: `${request.protocol}://${request.get('host')}/uploads/${filename}`,
        provider: 'local',
        mediaType,
        name: originalname,
        mimeType: mimetype,
        size,
      },
    });
  } catch (error) {
    return next(error);
  }
});
