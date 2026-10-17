import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export function createToken(userId) {
  return jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: '7d' });
}

export function requireAuth(request, response, next) {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');

  if (!token) {
    return response.status(401).json({ error: 'Authentication required.' });
  }

  try {
    request.userId = jwt.verify(token, config.jwtSecret).sub;
    return next();
  } catch {
    return response.status(401).json({ error: 'Invalid or expired session.' });
  }
}