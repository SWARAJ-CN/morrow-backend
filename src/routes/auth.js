import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { User } from '../models/User.js';
import { createToken, requireAuth } from '../middleware/auth.js';

export const authRouter = Router();

const registerSchema = z.object({
  displayName: z.string().trim().min(2).max(40),
  phone: z.string().regex(/^\+91[6-9]\d{9}$/, 'Use a valid +91 mobile number.'),
  password: z.string().min(8).max(72),
});

const loginSchema = z.object({
  phone: z.string().regex(/^\+91[6-9]\d{9}$/),
  password: z.string().min(1).max(72),
});

function publicUser(user) {
  return { id: user.id, displayName: user.displayName, phone: user.phone, bio: user.bio, profilePhoto: user.profilePhoto, themeColor: user.themeColor || null };
}

authRouter.post('/register', async (request, response, next) => {
  try {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: 'Enter your name, valid +91 mobile number, and password of at least 8 characters.' });

    const { displayName, phone, password } = parsed.data;
    if (await User.exists({ phone })) return response.status(409).json({ error: 'An account with this phone number already exists.' });

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ displayName, phone, passwordHash });
    return response.status(201).json({ token: createToken(user.id), user: publicUser(user) });
  } catch (error) {
    if (error.code === 11000) return response.status(409).json({ error: 'An account with this phone number already exists.' });
    return next(error);
  }
});

authRouter.post('/login', async (request, response, next) => {
  try {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: 'Enter a valid +91 mobile number and password.' });

    const user = await User.findOne({ phone: parsed.data.phone }).select('+passwordHash');
    if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
      return response.status(401).json({ error: 'Phone number or password is incorrect.' });
    }

    return response.json({ token: createToken(user.id), user: publicUser(user) });
  } catch (error) {
    return next(error);
  }
});

authRouter.get('/me', requireAuth, async (request, response, next) => {
  try {
    const user = await User.findById(request.userId);
    if (!user) return response.status(401).json({ error: 'Account no longer exists.' });
    return response.json({ user: publicUser(user) });
  } catch (error) {
    return next(error);
  }
});