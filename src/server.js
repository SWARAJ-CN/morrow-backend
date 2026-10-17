import express from 'express';
import { createServer } from 'node:http';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { Server } from 'socket.io';
import { config } from './config.js';
import { connectDatabase } from './db.js';
import { authRouter } from './routes/auth.js';
import { conversationRouter } from './routes/conversations.js';
import { notificationRouter } from './routes/notifications.js';
import { storyRouter } from './routes/stories.js';
import { uploadRouter } from './routes/uploads.js';
import { userRouter } from './routes/users.js';
import { User } from './models/User.js';
import { configureSocket } from './socket.js';

const app = express();
const server = createServer(app);
const allowedOrigins = config.clientOrigin.split(',').map((origin) => origin.trim());
const originCheck = (origin, callback) => {
  if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return callback(null, true);
  return callback(new Error('Origin not allowed by CORS.'));
};

const io = new Server(server, { cors: { origin: originCheck } });
app.set('io', io);
app.use(helmet());
app.use(cors({ origin: originCheck }));
app.use(express.json({ limit: '10kb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 200, standardHeaders: 'draft-8', legacyHeaders: false }));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false }));

app.get('/health', (_request, response) => response.json({ status: 'ok' }));
app.use('/uploads', express.static('uploads', { dotfiles: 'deny', index: false, maxAge: '1d' }));
app.use('/api/auth', authRouter);
app.use('/api/conversations', conversationRouter);
app.use('/api/notifications', notificationRouter);
app.use('/api/stories', storyRouter);
app.use('/api/uploads', uploadRouter);
app.use('/api/users', userRouter);
app.use((error, _request, response, _next) => {
  console.error(error);
  if (error.code === 'LIMIT_FILE_SIZE') return response.status(413).json({ error: 'Files must be 50 MB or smaller.' });
  if (error.name === 'MulterError' || error.message === 'This file type is not supported.') return response.status(400).json({ error: error.message });
  if (/cloudinary/i.test(error.message || '')) return response.status(502).json({ error: 'Upload failed. Please try again.' });
  return response.status(500).json({ error: 'An unexpected server error occurred.' });
});

configureSocket(io);

connectDatabase()
  .then(async () => {
    // Reconcile indexes so every user is not forced to share a single `null`
    // email (the schema declares email as sparse + unique).
    await User.syncIndexes().catch((error) => console.warn('Index sync skipped:', error.message));
    server.listen(config.port, '0.0.0.0', () => console.log(`Chat API listening on port ${config.port}`));
  })
  .catch((error) => {
    console.error('Could not connect to MongoDB:', error.message);
    process.exit(1);
  });