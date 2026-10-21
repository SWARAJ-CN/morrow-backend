import { Router } from 'express';
import { z } from 'zod';
import { User } from '../models/User.js';
import { Story } from '../models/Story.js';
import { getAppSettings, updateAppSettings } from '../models/Settings.js';
import { config } from '../config.js';
import { isOnline, getLastSeen, liveCount } from '../presence.js';

/**
 * Admin API.
 *
 * Backed by a bearer token (`ADMIN_TOKEN`). When no token is configured one
 * is generated at boot and printed to the server log, so the panel is never
 * left wide open.
 */
export const adminRouter = Router();

const inviteUrlSchema = z.object({
  inviteUrl: z.string().trim().max(500).default(''),
});

function requireAdmin(request, response, next) {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, '') || request.query.token;
  if (!config.adminToken) {
    return response.status(503).json({ error: 'The admin panel is not configured on this server.' });
  }
  if (token !== config.adminToken) {
    return response.status(401).json({ error: 'Invalid admin token.' });
  }
  return next();
}

adminRouter.use(requireAdmin);

// ---------------------------------------------------------------------------
// Live users
// ---------------------------------------------------------------------------
adminRouter.get('/live-users', async (request, response, next) => {
  try {
    const users = await User.find({})
      .select('displayName phone profilePhoto lastSeen createdAt')
      .sort({ lastSeen: -1 })
      .limit(500);

    const live = users
      .map((user) => ({
        id: user.id,
        displayName: user.displayName,
        phone: user.phone,
        profilePhoto: user.profilePhoto,
        lastSeen: isOnline(user.id) ? null : (user.lastSeen || getLastSeen(user.id) || null),
        online: isOnline(user.id),
        joinedAt: user.createdAt,
      }))
      .filter((user) => user.online)
      .sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));

    const all = users.map((user) => ({
      id: user.id,
      displayName: user.displayName,
      phone: user.phone,
      profilePhoto: user.profilePhoto,
      lastSeen: isOnline(user.id) ? null : (user.lastSeen || getLastSeen(user.id) || null),
      online: isOnline(user.id),
      joinedAt: user.createdAt,
    }));

    return response.json({ live, all, liveCount: live.length, totalCount: all.length });
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
adminRouter.get('/settings', async (request, response, next) => {
  try {
    const settings = await getAppSettings();
    return response.json({ inviteUrl: settings.inviteUrl || '', updatedAt: settings.updatedAt });
  } catch (error) {
    return next(error);
  }
});

adminRouter.put('/settings/invite-url', async (request, response, next) => {
  try {
    const parsed = inviteUrlSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: 'That invite link is not valid.' });

    const value = parsed.data.inviteUrl.trim();
    if (value) {
      try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('protocol');
      } catch {
        return response.status(400).json({ error: 'Use a full http:// or https:// link.' });
      }
    }

    const settings = await updateAppSettings({ inviteUrl: value });
    return response.json({ inviteUrl: settings.inviteUrl || '', updatedAt: settings.updatedAt });
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// A light health summary for the panel header
// ---------------------------------------------------------------------------
adminRouter.get('/summary', async (request, response, next) => {
  try {
    const [users, stories, messages] = await Promise.all([
      User.countDocuments(),
      Story.countDocuments({ expiresAt: { $gt: new Date() } }),
      import('../models/Message.js').then((module) => module.Message.countDocuments()),
    ]);
    return response.json({ users, stories, messages, live: liveCount() });
  } catch (error) {
    return next(error);
  }
});
