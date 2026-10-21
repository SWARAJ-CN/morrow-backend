import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Conversation } from '../models/Conversation.js';
import { Message } from '../models/Message.js';
import { User } from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';
import { isOnline } from '../presence.js';
import { notifyConversation } from '../push.js';

export const conversationRouter = Router();
conversationRouter.use(requireAuth);

const createSchema = z.object({ phone: z.string().trim().min(7).max(18) });
const messageSchema = z.object({
  kind: z.enum(['text', 'image', 'video', 'audio', 'file', 'gif', 'sticker']).default('text'),
  text: z.string().trim().max(4000).default(''),
  mediaUrl: z.string().url().nullable().optional(),
  mediaName: z.string().trim().max(180).default(''),
  mediaType: z.string().trim().max(100).default(''),
  thumbnailUrl: z.string().url().nullable().optional(),
  replyTo: z.string().trim().max(40).nullable().optional(),
  durationSeconds: z.number().min(0).nullable().optional(),
  reactions: z.array(z.object({
    emoji: z.string().trim().min(1).max(8),
    users: z.array(z.string().trim().max(40)).max(100).default([]),
  })).max(20).optional(),
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
        .populate('members', 'displayName phone bio profilePhoto lastSeen')
        .populate({ path: 'lastMessage', select: 'kind text mediaUrl mediaName mediaType durationSeconds sender createdAt' })
        .sort({ updatedAt: -1 }),
      User.findById(request.userId).select('blockedUsers'),
    ]);

    const blockedIds = new Set((me?.blockedUsers || []).map(String));
    const payload = conversations.map((conversation) => {
      const plain = conversation.toJSON();
      const peer = (plain.members || []).find((member) => String(member._id) !== String(request.userId));
      plain.isBlocked = Boolean(peer && blockedIds.has(String(peer._id)));
      // Presence is in-memory; the persisted `lastSeen` covers offline users.
      plain.peerOnline = Boolean(peer && isOnline(peer._id));
      plain.peerLastSeen = plain.peerOnline ? null : (peer?.lastSeen || null);
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
      .populate({ path: 'replyTo', select: 'text kind sender createdAt', populate: { path: 'sender', select: 'displayName' } })
      .sort({ createdAt: -1 })
      .limit(50);
    return response.json({ messages: messages.reverse() });
  } catch (error) {
    return next(error);
  }
});

// Add or remove a reaction on a message.
conversationRouter.post('/:conversationId/messages/:messageId/react', async (request, response, next) => {
  try {
    if (!validId(request.params.conversationId) || !validId(request.params.messageId)) {
      return response.status(400).json({ error: 'Invalid message.' });
    }
    const parsed = z.object({ emoji: z.string().trim().min(1).max(8) }).safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: 'Pick a reaction.' });

    const conversation = await Conversation.findOne({ _id: request.params.conversationId, members: request.userId });
    if (!conversation) return response.status(404).json({ error: 'Conversation not found.' });

    const message = await Message.findOne({ _id: request.params.messageId, conversation: conversation.id });
    if (!message) return response.status(404).json({ error: 'Message not found.' });

    const emoji = parsed.data.emoji;
    const existing = (message.reactions || []).find((reaction) => reaction.emoji === emoji);
    const already = existing?.user?.some?.((id) => String(id) === String(request.userId));

    if (already) {
      // Reacting again removes the reaction.
      message.reactions = message.reactions
        .map((reaction) => (reaction.emoji === emoji
          ? { ...reaction, user: reaction.user.filter((id) => String(id) !== String(request.userId)) }
          : reaction))
        .filter((reaction) => reaction.user.length > 0);
    } else if (existing) {
      existing.user = [...(existing.user || []), request.userId];
    } else {
      message.reactions = [...(message.reactions || []), { emoji, user: [request.userId] }];
    }
    message.markModified('reactions');
    await message.save();

    await message.populate('sender', 'displayName phone profilePhoto');
    request.app.get('io').to(`conversation:${conversation.id}`).emit('message:updated', message);
    conversation.members.forEach((member) => request.app.get('io').to(`user:${member}`).emit('message:updated', message));

    return response.json({ message });
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
    conversation.members.forEach((member) => request.app.get('io').to(`user:${member}`).emit('message:new', populatedMessage));
    const body = parsed.data.kind === 'text' ? parsed.data.text : `Sent a ${parsed.data.kind}.`;
    notifyConversation(conversation, request.userId, sender?.displayName, body);
    return response.status(201).json({ message: populatedMessage });
  } catch (error) {
    return next(error);
  }
});