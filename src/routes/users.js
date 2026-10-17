import { Router } from 'express';
import { z } from 'zod';
import { User } from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';

export const userRouter = Router();
userRouter.use(requireAuth);

const profileSchema = z.object({
  displayName: z.string().trim().min(2).max(40),
  bio: z.string().trim().max(160).default(''),
  profilePhoto: z.string().url().nullable().optional(),
  themeColor: z.string().trim().regex(/^#?[0-9a-fA-F]{6}$/).nullable().optional(),
});
const lookupSchema = z.object({ phones: z.array(z.string().trim().min(7).max(18)).min(1).max(100) });

function normalizeThemeColor(value) {
  if (value === undefined || value === null) return value;
  return `#${value.replace('#', '').toLowerCase()}`;
}

function normalizePhone(phone) {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  if (phone.startsWith('+') && digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  return null;
}

const publicFields = 'displayName phone bio profilePhoto themeColor';

userRouter.get('/search', async (request, response, next) => {
  try {
    const phone = normalizePhone(String(request.query.phone || ''));
    if (!phone) return response.status(400).json({ error: 'Enter a valid phone number.' });
    const users = await User.find({ phone, _id: { $ne: request.userId } }).select(publicFields).limit(10);
    return response.json({ users });
  } catch (error) {
    return next(error);
  }
});

userRouter.post('/lookup', async (request, response, next) => {
  try {
    const parsed = lookupSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: 'Provide up to 100 phone numbers.' });
    const phones = parsed.data.phones.map(normalizePhone).filter(Boolean);
    const users = await User.find({ phone: { $in: phones }, _id: { $ne: request.userId } }).select(publicFields).limit(100);
    return response.json({ users });
  } catch (error) {
    return next(error);
  }
});

userRouter.patch('/me', async (request, response, next) => {
  try {
    const parsed = profileSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: 'Check your name, bio, profile photo, and theme color.' });
    const updates = { ...parsed.data };
    if (updates.themeColor !== undefined) updates.themeColor = normalizeThemeColor(updates.themeColor);
    const user = await User.findByIdAndUpdate(request.userId, updates, { new: true, runValidators: true }).select(publicFields);
    if (!user) return response.status(404).json({ error: 'Account not found.' });
    return response.json({ user });
  } catch (error) {
    return next(error);
  }
});

userRouter.post('/:userId/block', async (request, response, next) => {
  try {
    if (!/^[a-f\d]{24}$/i.test(request.params.userId) || request.params.userId === String(request.userId)) {
      return response.status(400).json({ error: 'Invalid contact.' });
    }
    const exists = await User.exists({ _id: request.params.userId });
    if (!exists) return response.status(404).json({ error: 'Contact not found.' });
    await User.updateOne({ _id: request.userId }, { $addToSet: { blockedUsers: request.params.userId } });
    return response.status(204).end();
  } catch (error) {
    return next(error);
  }
});

userRouter.delete('/:userId/block', async (request, response, next) => {
  try {
    if (!/^[a-f\d]{24}$/i.test(request.params.userId)) return response.status(400).json({ error: 'Invalid contact.' });
    await User.updateOne({ _id: request.userId }, { $pull: { blockedUsers: request.params.userId } });
    return response.status(204).end();
  } catch (error) {
    return next(error);
  }
});
