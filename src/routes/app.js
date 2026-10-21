import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getAppSettings } from '../models/Settings.js';

/**
 * Runtime app configuration the client can change from the admin panel.
 * Keeping it in one place means the app never hardcodes a link.
 */
export const appRouter = Router();
appRouter.use(requireAuth);

appRouter.get('/config', async (request, response, next) => {
  try {
    const settings = await getAppSettings();
    return response.json({ inviteUrl: settings.inviteUrl || '' });
  } catch (error) {
    return next(error);
  }
});
