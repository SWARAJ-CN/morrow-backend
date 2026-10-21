/**
 * Assistant routes.
 *
 * Every route is authenticated, rate limited, and validated. Conversations are
 * always read from MongoDB on the server — the client cannot ask for a chat it
 * is not a member of.
 */

import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Conversation } from '../models/Conversation.js';
import { Message } from '../models/Message.js';
import { User } from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';
import { aiConfigured, complete, parseJson, AiError } from '../ai/provider.js';
import {
  assistantTask, formatTranscript, replyTask, rewriteTask, summarizeTask, TONE_IDS, translateTask,
} from '../ai/prompts.js';

export const assistantRouter = Router();
assistantRouter.use(requireAuth);

const messageSchema = z.object({
  from: z.enum(['me', 'them']).default('them'),
  text: z.string().trim().max(4000).default(''),
  displayName: z.string().trim().max(80).optional(),
  kind: z.string().trim().max(20).optional(),
});

const contextSchema = z.object({
  conversationId: z.string().trim().max(40).optional(),
  messages: z.array(messageSchema).max(60).optional(),
  draft: z.string().trim().max(4000).optional(),
  tone: z.enum(TONE_IDS).default('casual'),
  displayName: z.string().trim().max(80).optional(),
  peerName: z.string().trim().max(80).optional(),
});

const rewriteSchema = z.object({
  text: z.string().trim().min(1).max(4000),
  tone: z.enum(TONE_IDS).default('casual'),
  targetLanguage: z.string().trim().max(60).optional(),
});

const translateSchema = z.object({
  text: z.string().trim().min(1).max(4000),
  language: z.string().trim().min(1).max(60),
});

const assistantSchema = z.object({
  question: z.string().trim().min(1).max(4000),
  conversationId: z.string().trim().max(40).optional(),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().trim().max(4000),
  })).max(20).default([]),
});

/** Load a conversation the caller is a member of, with its messages. */
async function loadConversation(conversationId, userId) {
  if (!mongoose.isValidObjectId(conversationId)) return null;
  const conversation = await Conversation.findOne({ _id: conversationId, members: userId });
  if (!conversation) return null;
  const messages = await Message.find({ conversation: conversation._id })
    .sort({ createdAt: 1 })
    .limit(300)
    .populate('sender', 'displayName');
  return { conversation, messages };
}

/** Turn stored messages into the shape the prompts expect. */
function toPromptMessages(messages, userId) {
  return messages
    .filter((message) => message.kind === 'text' && String(message.text || '').trim())
    .map((message) => ({
      from: String(message.sender?._id || message.sender) === String(userId) ? 'me' : 'them',
      text: message.text,
      displayName: message.sender?.displayName || '',
    }));
}

function peerNameFor(conversation, userId, members) {
  const peer = (members || conversation?.members || []).find(
    (member) => String(member?._id || member) !== String(userId),
  );
  return peer?.displayName || '';
}

function notConfigured(response) {
  return response.status(501).json({
    error: 'The assistant is not configured on this server yet.',
    code: 'assistant_not_configured',
  });
}

/**
 * Whether the AI layer is usable. The app calls this to decide between the
 * hosted assistant and the on-device fallback, without paying for a request.
 */
assistantRouter.get('/status', (request, response) => {
  response.json({ configured: aiConfigured() });
});

// ---------------------------------------------------------------------------
// Reply suggestions
// ---------------------------------------------------------------------------
assistantRouter.post('/reply', async (request, response, next) => {
  try {
    const parsed = contextSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: 'That request could not be understood.' });
    if (!aiConfigured()) return notConfigured(response);
    const input = parsed.data;

    let messages = input.messages || [];
    let displayName = input.displayName;
    let peerName = input.peerName;

    if (input.conversationId) {
      const loaded = await loadConversation(input.conversationId, request.userId);
      if (loaded) {
        messages = toPromptMessages(loaded.messages, request.userId);
        peerName = peerName || peerNameFor(loaded.conversation, request.userId, loaded.messages);
      }
    }

    if (!displayName) {
      const me = await User.findById(request.userId).select('displayName');
      displayName = me?.displayName || '';
    }

    const transcript = formatTranscript(messages);
    const task = replyTask({ transcript, draft: input.draft, tone: input.tone, displayName });

    const { text } = await complete({ ...task, fast: true });
    const parsedJson = parseJson(text);
    const raw = Array.isArray(parsedJson?.suggestions) ? parsedJson.suggestions : [];

    const suggestions = raw
      .map((item) => ({
        text: String(item?.text || '').trim().slice(0, 400),
        tone: TONE_IDS.includes(item?.tone) ? item.tone : input.tone,
      }))
      .filter((item) => item.text.length > 0)
      .slice(0, 3);

    if (!suggestions.length) {
      return response.status(502).json({ error: 'The AI could not produce any suggestions.', code: 'assistant_empty_response' });
    }

    return response.json({ suggestions });
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// Rewrite
// ---------------------------------------------------------------------------
assistantRouter.post('/rewrite', async (request, response, next) => {
  try {
    const parsed = rewriteSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: 'Nothing to rewrite.' });
    if (!aiConfigured()) return notConfigured(response);
    const { text, tone, targetLanguage } = parsed.data;

    const result = await complete(rewriteTask({ text, tone, targetLanguage }));
    const json = parseJson(result.text);
    const rewritten = String(json?.text || result.text || '').trim().slice(0, 2000);

    if (!rewritten) {
      return response.status(502).json({ error: 'The AI could not rewrite that message.', code: 'assistant_empty_response' });
    }

    return response.json({ text: rewritten, tone });
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// Translate
// ---------------------------------------------------------------------------
assistantRouter.post('/translate', async (request, response, next) => {
  try {
    const parsed = translateSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: 'Nothing to translate.' });
    if (!aiConfigured()) return notConfigured(response);
    const { text, language } = parsed.data;

    const result = await complete(translateTask({ text, language }));
    const json = parseJson(result.text);
    const translated = String(json?.text || result.text || '').trim().slice(0, 2000);

    if (!translated) {
      return response.status(502).json({ error: 'The AI could not translate that message.', code: 'assistant_empty_response' });
    }

    return response.json({ text: translated, language });
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// Conversation summary
// ---------------------------------------------------------------------------
assistantRouter.post('/summarize', async (request, response, next) => {
  try {
    const parsed = contextSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: 'That request could not be understood.' });
    if (!aiConfigured()) return notConfigured(response);
    const input = parsed.data;

    let messages = input.messages || [];
    let displayName = input.displayName;
    let peerName = input.peerName;

    if (input.conversationId) {
      const loaded = await loadConversation(input.conversationId, request.userId);
      if (!loaded) return response.status(404).json({ error: 'Conversation not found.' });
      messages = toPromptMessages(loaded.messages, request.userId);
      peerName = peerName || peerNameFor(loaded.conversation, request.userId, loaded.messages);
    }

    if (!messages.length) {
      return response.status(400).json({ error: 'There is nothing to summarise yet.' });
    }

    if (!displayName) {
      const me = await User.findById(request.userId).select('displayName');
      displayName = me?.displayName || '';
    }

    const transcript = formatTranscript(messages, 60);
    const result = await complete(summarizeTask({ transcript, displayName, peerName }));
    const json = parseJson(result.text) || {};

    const asList = (value) => (Array.isArray(value) ? value : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .slice(0, 8);

    return response.json({
      summary: {
        headline: String(json.headline || 'Conversation summary').trim().slice(0, 300),
        points: asList(json.points),
        actionItems: asList(json.actionItems),
        openQuestions: asList(json.openQuestions),
      },
    });
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// Assistant
// ---------------------------------------------------------------------------
assistantRouter.post('/assistant', async (request, response, next) => {
  try {
    const parsed = assistantSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: 'Ask a question to continue.' });
    if (!aiConfigured()) return notConfigured(response);
    const { question, conversationId, history } = parsed.data;

    let transcript = '';
    let peerName = '';

    if (conversationId) {
      const loaded = await loadConversation(conversationId, request.userId);
      if (loaded) {
        transcript = formatTranscript(toPromptMessages(loaded.messages, request.userId));
        peerName = peerNameFor(loaded.conversation, request.userId, loaded.messages);
      }
    }

    const me = await User.findById(request.userId).select('displayName');
    const result = await complete(assistantTask({
      question,
      transcript,
      displayName: me?.displayName || '',
      peerName,
      history,
    }));

    const reply = String(result.text || '').trim().slice(0, 4000);
    if (!reply) {
      return response.status(502).json({ error: 'The AI could not answer that.', code: 'assistant_empty_response' });
    }

    return response.json({ reply });
  } catch (error) {
    return next(error);
  }
});

// AI failures are expected (rate limits, provider outages, a missing key), so
// they answer with a readable message instead of a generic 500.
assistantRouter.use((error, _request, response, _next) => {
  if (error instanceof AiError) {
    return response.status(error.status).json({ error: error.message, code: error.code });
  }
  return response.status(500).json({ error: 'The assistant is temporarily unavailable.' });
});
