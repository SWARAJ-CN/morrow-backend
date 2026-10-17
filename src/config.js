import 'dotenv/config';

const jwtSecret = process.env.JWT_SECRET;

if (!jwtSecret || jwtSecret.startsWith('replace-this')) {
  throw new Error('Set JWT_SECRET in backend/.env before starting the server.');
}

if (jwtSecret.length < 32) {
  console.warn('JWT_SECRET is shorter than 32 characters; use a stronger key in production.');
}

export const config = {
  port: Number(process.env.PORT) || 4000,
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chat_app',
  jwtSecret,
  clientOrigin: process.env.CLIENT_ORIGIN || '*',
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
    folder: process.env.CLOUDINARY_FOLDER || 'morrow',
  },
};