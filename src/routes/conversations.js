import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Conversation } from '../models/Conversation.js';
import { Message } from '../models/Message.js';
import { User } from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';

export const conversationRouter = Router();
conversationRouter.use(requireAuth);

const createSchema = z.object({ phone: z.string().trim().min(7).max(18) });
const messageSchema = z.object({
  kind: z.enum(['text', 'image', 'video', 'audio', 'file', 'gif', 'sticker']).default('text'),
  text: z.string().trim().max(4000).default(''),
  mediaUrl: z.string().url().nullable().optional(),
  mediaName: z.string().trim().max(180).default(''),
  mediaType: z.string().trim().max(100).default(''),
  durationSeconds: z.number().min(0).nullable().optional(),
}).refine((message) => message.text.length > 0 || Boolean(message.mediaUrl), 'Message content is required.');
const preferencesSchema = z.object({ wallpaperUrl: z.string().url().nullable(), wallpaperBrightness: z.number().min(0.25).max(1) });

function directKey(firstId, secondId) {
  return [String(firstId), String(secondId)].sort().join(':');
}

function validId(value) {
  return mongoose.isValidObjectId(value);
}

conversationRouter.get('/', async (request, response, next) => {
  try {
    const [conversations, me] = await Promise.all([
      Conversation.find({ members: request.userId })
        .populate('members', 'displayName phone bio profilePhoto')
        .populate({ path: 'lastMessage', select: 'kind text mediaUrl mediaName mediaType durationSeconds sender createdAt' })
        .sort({ updatedAt: -1 }),
      User.findById(request.userId).select('blockedUsers'),
    ]);

    const blockedIds = new Set((me?.blockedUsers || []).map(String));
    const payload = conversations.map((conversation) => {
      const plain = conversation.toJSON();
      const peer = (plain.members || []).find((member) => String(member._id) !== String(request.userId));
      plain.isBlocked = Boolean(peer && blockedIds.has(String(peer._id)));
      return plain;
    });

    return response.json({ conversations: payload });
  } catch (error) {
    return next(error);
  }
});

conversationRouter.post('/', async (request, response, next) => {
  try {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: 'Enter a valid phone number.' });

    const digits = parsed.data.phone.replace(/\D/g, '');
    const phone = digits.length === 10 ? `+91${digits}` : digits.startsWith('91') ? `+${digits}` : parsed.data.phone;
    const peer = await User.findOne({ phone }).select('displayName phone bio profilePhoto');
    if (!peer) return response.status(404).json({ error: 'No account was found for that phone number.' });
    if (peer.id === String(request.userId)) return response.status(400).json({ error: 'Choose another account to start a chat.' });

    const key = directKey(request.userId, peer.id);
    const conversation = await Conversation.findOneAndUpdate(
      { directKey: key },
      { $setOnInsert: { directKey: key, members: [request.userId, peer.id] } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).populate('members', 'displayName phone bio profilePhoto');

    return response.status(200).json({ conversation });
  } catch (error) {
    return next(error);
  }
});

conversationRouter.get('/:conversationId/messages', async (request, response, next) => {
  try {
    if (!validId(request.params.conversationId)) return response.status(400).json({ error: 'Invalid conversation.' });
    const conversation = await Conversation.findOne({ _id: request.params.conversationId, members: request.userId });
    if (!conversation) return response.status(404).json({ error: 'Conversation not found.' });

    const messages = await Message.find({ conversation: conversation.id })
      .populate('sender', 'displayName phone profilePhoto')
      .sort({ createdAt: -1 })
      .limit(50);
    return response.json({ messages: messages.reverse() });
  } catch (error) {
    return next(error);
  }
});

conversationRouter.delete('/:conversationId/messages', async (request, response, next) => {
  try {
    if (!validId(request.params.conversationId)) return response.status(400).json({ error: 'Invalid conversation.' });
    const conversation = await Conversation.findOne({ _id: request.params.conversationId, members: request.userId });
    if (!conversation) return response.status(404).json({ error: 'Conversation not found.' });
    await Message.deleteMany({ conversation: conversation.id });
    conversation.lastMessage = null;
    await conversation.save();
    return response.status(204).end();
  } catch (error) {
    return next(error);
  }
});

conversationRouter.delete('/:conversationId', async (request, response, next) => {
  try {
    if (!validId(request.params.conversationId)) return response.status(400).json({ error: 'Invalid conversation.' });
    const conversation = await Conversation.findOneAndDelete({ _id: request.params.conversationId, members: request.userId });
    if (!conversation) return response.status(404).json({ error: 'Conversation not found.' });
    await Message.deleteMany({ conversation: conversation.id });
    return response.status(204).end();
  } catch (error) {
    return next(error);
  }
});

conversationRouter.patch('/:conversationId/preferences', async (request, response, next) => {
  try {
    if (!validId(request.params.conversationId)) return response.status(400).json({ error: 'Invalid conversation.' });
    const parsed = preferencesSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: 'Invalid wallpaper settings.' });
    const conversation = await Conversation.findOneAndUpdate(
      { _id: request.params.conversationId, members: request.userId },
      { $set: parsed.data },
      { new: true },
    );
    if (!conversation) return response.status(404).json({ error: 'Conversation not found.' });
    return response.json({ conversation });
  } catch (error) {
    return next(error);
  }
});

conversationRouter.post('/:conversationId/messages', async (request, response, next) => {
  try {
    if (!validId(request.params.conversationId)) return response.status(400).json({ error: 'Invalid conversation.' });
    const parsed = messageSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: 'Message content is required.' });

    const conversation = await Conversation.findOne({ _id: request.params.conversationId, members: request.userId });
    if (!conversation) return response.status(404).json({ error: 'Conversation not found.' });
    const peerId = conversation.members.find((member) => String(member) !== String(request.userId));
    const sender = await User.findById(request.userId).select('blockedUsers displayName');
    const peer = await User.findById(peerId).select('blockedUsers');
    if (sender.blockedUsers.some((id) => String(id) === String(peerId)) || peer?.blockedUsers.some((id) => String(id) === String(request.userId))) {
      return response.status(403).json({ error: 'Messaging is unavailable for this contact.' });
    }
    const message = await Message.create({ conversation: conversation.id, sender: request.userId, ...parsed.data });
    conversation.lastMessage = message.id;
    await conversation.save();
    const populatedMessage = await message.populate('sender', 'displayName phone profilePhoto');

    request.app.get('io').to(`conversation:${conversation.id}`).emit('message:new', populatedMessage);
    const recipients = await User.find({ _id: { $in: conversation.members.filter((member) => String(member) !== String(request.userId)) } }).select('pushTokens');
    const body = parsed.data.kind === 'text' ? parsed.data.text : `Sent a ${parsed.data.kind}.`;
    const { sendPushNotification } = await import('../push.js');
    sendPushNotification(recipients.flatMap((recipient) => recipient.pushTokens), sender?.displayName || 'New message', body, { conversationId: conversation.id }).catch((error) => console.warn('Push delivery failed:', error.message));
    return response.status(201).json({ message: populatedMessage });
  } catch (error) {
    return next(error);
  }
});