import { Router } from 'express';
import { z } from 'zod';
import { User } from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';
import { Conversation } from '../models/Conversation.js';
import { sendPushNotification } from '../push.js';

export const notificationRouter = Router();
notificationRouter.use(requireAuth);

const tokenSchema = z.object({ token: z.string().regex(/^ExponentPushToken\[.+\]$/) });

notificationRouter.post('/token', async (request, response, next) => {
  try {
    const parsed = tokenSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: 'Invalid Expo push token.' });
    await User.updateOne({ _id: request.userId }, { $addToSet: { pushTokens: parsed.data.token } });
    return response.status(204).end();
  } catch (error) {
    return next(error);
  }
});

notificationRouter.post('/video-invite', async (request, response, next) => {
  try {
    const parsed = z.object({ conversationId: z.string().regex(/^[a-f\d]{24}$/i), roomUrl: z.string().url() }).safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: 'Invalid video call invite.' });
    const conversation = await Conversation.findOne({ _id: parsed.data.conversationId, members: request.userId });
    if (!conversation) return response.status(404).json({ error: 'Conversation not found.' });
    const recipientIds = conversation.members.filter((id) => String(id) !== String(request.userId));
    const [sender, recipients] = await Promise.all([
      User.findById(request.userId).select('displayName'),
      User.find({ _id: { $in: recipientIds } }).select('pushTokens'),
    ]);
    await sendPushNotification(recipients.flatMap((recipient) => recipient.pushTokens), `${sender?.displayName || 'Your contact'} is starting a video call`, 'Tap to join the call.', { url: parsed.data.roomUrl, conversationId: conversation.id });
    return response.status(204).end();
  } catch (error) {
    return next(error);
  }
});
