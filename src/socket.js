import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from './config.js';
import { Conversation } from './models/Conversation.js';
import { Message } from './models/Message.js';

const sendSchema = z.object({
  conversationId: z.string().regex(/^[a-f\d]{24}$/i),
  text: z.string().trim().min(1).max(2000),
});

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

  io.on('connection', (socket) => {
    socket.on('conversation:join', async (conversationId, acknowledge = () => {}) => {
      try {
        if (!/^[a-f\d]{24}$/i.test(String(conversationId))) return acknowledge({ error: 'Invalid conversation.' });
        const isMember = await Conversation.exists({ _id: conversationId, members: socket.data.userId });
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
        const conversation = await Conversation.findOne({ _id: conversationId, members: socket.data.userId });
        if (!conversation) return acknowledge({ error: 'Conversation not found.' });

        const message = await Message.create({ conversation: conversation.id, sender: socket.data.userId, text });
        conversation.lastMessage = message.id;
        await conversation.save();
        const populatedMessage = await message.populate('sender', 'displayName phone profilePhoto');
        io.to(`conversation:${conversation.id}`).emit('message:new', populatedMessage);
        return acknowledge({ ok: true, message: populatedMessage });
      } catch {
        return acknowledge({ error: 'Message could not be sent.' });
      }
    });
  });
}