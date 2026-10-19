import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from './config.js';
import { Conversation } from './models/Conversation.js';
import { Message } from './models/Message.js';
import { User } from './models/User.js';
import { addConnection, presenceSnapshot, removeConnection } from './presence.js';
import { notifyConversation } from './push.js';

const sendSchema = z.object({
  conversationId: z.string().regex(/^[a-f\d]{24}$/i),
  text: z.string().trim().min(1).max(2000),
});

const querySchema = z.object({ userIds: z.array(z.string()).max(200) });

export function configureSocket(io) {
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Authentication required.'));
      const claims = jwt.verify(token, config.jwtSecret);
      socket.data.userId = claims.sub;
      return next();
    } catch {
      return next(new Error('Invalid or expired session.'));
    }
  });

  io.on('connection', async (socket) => {
    const userId = String(socket.data.userId);
    socket.join(`user:${userId}`);

    // Presence — announce the user the first time they connect.
    if (addConnection(userId)) {
      await User.updateOne({ _id: userId }, { $set: { lastSeen: null } }).catch(() => {});
      io.emit('presence:update', { userId, online: true, lastSeen: null });
    }

    socket.on('presence:query', async (payload, acknowledge = () => {}) => {
      try {
        const parsed = querySchema.safeParse(payload);
        if (!parsed.success) return acknowledge({ error: 'Invalid presence query.' });
        const users = await User.find({ _id: { $in: parsed.data.userIds } }).select('lastSeen');
        const persisted = new Map(users.map((user) => [String(user._id), user.lastSeen]));
        return acknowledge({ presence: presenceSnapshot(parsed.data.userIds, persisted) });
      } catch {
        return acknowledge({ error: 'Could not load presence.' });
      }
    });

    socket.on('conversation:join', async (conversationId, acknowledge = () => {}) => {
      try {
        if (!/^[a-f\d]{24}$/i.test(String(conversationId))) return acknowledge({ error: 'Invalid conversation.' });
        const isMember = await Conversation.exists({ _id: conversationId, members: userId });
        if (!isMember) return acknowledge({ error: 'Conversation not found.' });
        await socket.join(`conversation:${conversationId}`);
        return acknowledge({ ok: true });
      } catch {
        return acknowledge({ error: 'Could not join conversation.' });
      }
    });

    socket.on('message:send', async (payload, acknowledge = () => {}) => {
      try {
        const parsed = sendSchema.safeParse(payload);
        if (!parsed.success) return acknowledge({ error: 'Invalid message.' });
        const { conversationId, text } = parsed.data;
        const conversation = await Conversation.findOne({ _id: conversationId, members: userId });
        if (!conversation) return acknowledge({ error: 'Conversation not found.' });

        const message = await Message.create({ conversation: conversation.id, sender: userId, text });
        conversation.lastMessage = message.id;
        await conversation.save();
        const populatedMessage = await message.populate('sender', 'displayName phone profilePhoto');

        // Deliver to every member's personal room so their chat list updates
        // even when they are not viewing this conversation.
        conversation.members.forEach((member) => io.to(`user:${member}`).emit('message:new', populatedMessage));
        notifyConversation(conversation, userId, populatedMessage.sender?.displayName, text);

        return acknowledge({ ok: true, message: populatedMessage });
      } catch {
        return acknowledge({ error: 'Message could not be sent.' });
      }
    });

    socket.on('disconnect', async () => {
      const wentOfflineAt = removeConnection(userId);
      if (wentOfflineAt) {
        await User.updateOne({ _id: userId }, { $set: { lastSeen: wentOfflineAt } }).catch(() => {});
        io.emit('presence:update', { userId, online: false, lastSeen: wentOfflineAt });
      }
    });
  });
}
