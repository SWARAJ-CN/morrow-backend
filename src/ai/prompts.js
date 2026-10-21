/**
 * Morrow AI task definitions.
 *
 * Every task is a system prompt plus a short, structured user payload. The
 * prompts are written to survive a small model: they state the exact JSON
 * shape required, forbid preamble, and give the model the context it needs so
 * it never has to guess.
 */

export const TONES = [
  { id: 'casual', label: 'Casual', hint: 'Warm and relaxed, like texting a friend.' },
  { id: 'concise', label: 'Concise', hint: 'Short and to the point.' },
  { id: 'professional', label: 'Professional', hint: 'Polished and business-appropriate.' },
  { id: 'empathetic', label: 'Empathetic', hint: 'Caring and supportive.' },
  { id: 'witty', label: 'Witty', hint: 'Light-hearted with a bit of humour.' },
];

export const TONE_IDS = TONES.map((tone) => tone.id);

export function toneLabel(id) {
  return TONES.find((tone) => tone.id === id)?.label || 'Casual';
}

const BASE_RULES = [
  'You are the writing assistant inside Morrow, a private chat app.',
  'Match the language of the conversation. If the conversation is in Hinglish or another Indian language, reply in that same language and script.',
  'Never invent facts that are not in the conversation.',
  'Never include explanations, notes, or commentary — output only what was asked for.',
].join(' ');

// ---------------------------------------------------------------------------
// Context formatting
// ---------------------------------------------------------------------------
/**
 * Turn raw messages into a transcript the model can reason about.
 * @param {Array} messages [{ from: 'me' | 'them', text, displayName }]
 * @param {number} limit how many trailing messages to include
 */
export function formatTranscript(messages = [], limit = 24) {
  return messages
    .filter((message) => message && (message.text || '').trim())
    .slice(-limit)
    .map((message) => {
      const who = message.from === 'me' ? 'Me' : (message.displayName || 'Them');
      return `${who}: ${String(message.text).trim()}`;
    })
    .join('\n');
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------
export function replyTask({ transcript, draft, tone, displayName }) {
  const system = [
    BASE_RULES,
    'You write reply suggestions for a chat app.',
    'Return JSON only, in exactly this shape:',
    '{"suggestions":[{"text":"...","tone":"casual"}]}',
    'Provide exactly 3 suggestions, ordered best-first.',
    'Each suggestion must be a complete, ready-to-send message of at most 160 characters.',
    'The "tone" field must be one of: casual, concise, professional, empathetic, witty.',
    'Vary the three suggestions: they must differ in wording and intent, not just in length.',
    'Never number the suggestions, never wrap them in quotes, never mention that they are suggestions.',
  ].join(' ');

  const user = [
    transcript ? `Conversation so far:\n${transcript}` : 'The conversation is empty — this is the first message.',
    displayName ? `I am ${displayName}.` : '',
    draft ? `I have already typed this draft: "${draft}" — suggestions should be an alternative to it, or a natural continuation.` : '',
    `The suggestions should be ${tone} in tone.`,
  ].filter(Boolean).join('\n\n');

  return { system, user, json: true, maxTokens: 1200, temperature: 0.8 };
}

export function rewriteTask({ text, tone, targetLanguage }) {
  const system = [
    BASE_RULES,
    'You rewrite a single chat message.',
    'Return JSON only, in exactly this shape: {"text":"..."}',
    'Keep the original meaning, the level of detail, and any names, dates, or numbers exactly as they are.',
    'Do not add new information. Do not answer the message — only rewrite it.',
    targetLanguage
      ? `Write the rewrite in ${targetLanguage}.`
      : `Keep the rewrite in the same language as the original, and make it ${tone} in tone.`,
    'The rewritten message must be a single message of at most 400 characters.',
  ].join(' ');

  return { system, user: `Message:\n${text}`, json: true, maxTokens: 1000, temperature: 0.6 };
}

export function translateTask({ text, language }) {
  const system = [
    BASE_RULES,
    'You translate a chat message.',
    'Return JSON only, in exactly this shape: {"text":"..."}',
    `Translate into ${language}. If the message is already in ${language}, return it unchanged.`,
    'Preserve tone, names, emoji, and numbers. Do not add a greeting or a signature.',
    'The translation must be a single message of at most 600 characters.',
  ].join(' ');

  return { system, user: `Message:\n${text}`, json: true, maxTokens: 1000, temperature: 0.2 };
}

export function summarizeTask({ transcript, displayName, peerName }) {
  const system = [
    BASE_RULES,
    'You summarise a chat conversation for someone who was part of it.',
    'Return JSON only, in exactly this shape:',
    '{"headline":"...","points":["..."],"actionItems":["..."],"openQuestions":["..."]}',
    '"headline" is one sentence, at most 120 characters, describing what the conversation is about.',
    '"points" holds 3 to 6 short factual bullets about what was said or agreed.',
    '"actionItems" holds the concrete things someone has to do; use an empty array if there are none.',
    '"openQuestions" holds anything still unanswered; use an empty array if there are none.',
    'Base everything strictly on the transcript. Do not speculate about intent.',
  ].join(' ');

  const user = [
    `Summary for ${displayName || 'me'}${peerName ? `, who was chatting with ${peerName}` : ''}.`,
    `Conversation:\n${transcript}`,
  ].join('\n\n');

  return { system, user, json: true, maxTokens: 1600, temperature: 0.3 };
}

export function assistantTask({ question, transcript, displayName, peerName, history }) {
  const system = [
    BASE_RULES,
    'You are Morrow AI, a helpful assistant built into a private chat app.',
    'You can see the current conversation so you can answer questions about it.',
    'If the user asks what to reply, draft the reply for them and say it is a draft they can edit.',
    'Keep answers short and concrete — this is a phone screen, not a document.',
    'Use a short list only when a list genuinely helps. Never open with a greeting.',
    'If the question is not answerable from the conversation, say what you do not know instead of guessing.',
  ].join(' ');

  const user = [
    question,
    displayName ? `The user is ${displayName}.` : '',
    peerName ? `They are chatting with ${peerName}.` : '',
    transcript ? `Current conversation:\n${transcript}` : 'There is no conversation open right now.',
    history?.length ? `Earlier in this chat with Morrow AI:\n${history.map((item) => `${item.role === 'user' ? 'User' : 'Morrow AI'}: ${item.content}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');

  return { system, user, json: false, maxTokens: 1600, temperature: 0.6 };
}
