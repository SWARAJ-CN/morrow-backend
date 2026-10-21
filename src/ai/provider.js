/**
 * Provider-agnostic LLM client for the Morrow assistant.
 *
 * The API key never leaves the server: the Expo app talks to `/api/ai/*` and
 * this module forwards the request to whichever provider is configured.
 *
 *   AI_PROVIDER   openai (default) | anthropic | gemini
 *   AI_API_KEY    the provider's secret
 *   AI_BASE_URL   override the provider endpoint (self-hosted, Groq,
 *                 OpenRouter, Together, DeepSeek, Ollama, LM Studio, …)
 *   AI_MODEL      model id; each provider has a sensible default
 *
 * Every provider is reached over plain `fetch`, so no extra SDK is needed and
 * the backend stays dependency-light.
 */

import { config } from '../config.js';

const DEFAULTS = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  // Groq speaks the OpenAI chat-completions API, so it reuses that code path.
  groq: { baseUrl: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b' },
  anthropic: { baseUrl: 'https://api.anthropic.com/v1', model: 'claude-3-5-haiku-latest' },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.0-flash' },
};

export class AiError extends Error {
  constructor(message, { status = 502, code = 'ai_request_failed' } = {}) {
    super(message);
    this.name = 'AiError';
    this.status = status;
    this.code = code;
  }
}

export function aiConfigured() {
  return Boolean(config.assistant.apiKey);
}

function settings() {
  const provider = (config.assistant.provider || 'groq').toLowerCase();
  const defaults = DEFAULTS[provider] || DEFAULTS.groq;
  return {
    provider,
    apiKey: config.assistant.apiKey,
    baseUrl: (config.assistant.baseUrl || defaults.baseUrl).replace(/\/+$/, ''),
    model: config.assistant.model || defaults.model,
    fastModel: config.assistant.fastModel || '',
  };
}

/**
 * Complete a prompt.
 *
 * @param {object} options
 * @param {string} options.system     system instruction
 * @param {Array}  options.messages    [{ role: 'user' | 'assistant', content: string }]
 * @param {number} options.maxTokens
 * @param {number} options.temperature
 * @param {boolean} options.json       ask for a JSON object response
 * @returns {Promise<{ text: string, raw: any }>}
 */
export async function complete({
  system,
  messages = [],
  user,
  maxTokens = 600,
  temperature = 0.7,
  json = false,
  model: modelOverride,
  fast = false,
}) {
  const { provider, apiKey, baseUrl, model, fastModel } = settings();

  // Tasks describe themselves with a single `user` payload; a chat-style
  // `messages` array can be supplied instead.
  const conversation = messages.length ? messages : (user ? [{ role: 'user', content: user }] : []);
  const target = modelOverride || (fast && fastModel ? fastModel : model);

  if (!apiKey) {
    throw new AiError('AI is not configured on this server.', { status: 501, code: 'ai_not_configured' });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  const signal = controller.signal;

  try {
    if (provider === 'anthropic') return await callAnthropic({ system, conversation, maxTokens, temperature, json, apiKey, baseUrl, model: target, signal });
    if (provider === 'gemini') return await callGemini({ system, conversation, maxTokens, temperature, json, apiKey, baseUrl, model: target, signal });
    return await callOpenAi({ system, conversation, maxTokens, temperature, json, apiKey, baseUrl, model: target, signal });
  } catch (error) {
    if (error instanceof AiError) throw error;
    if (error?.name === 'AbortError') {
      throw new AiError('The AI took too long to respond. Please try again.', { status: 504, code: 'assistant_timeout' });
    }
    throw new AiError(error?.message || 'The AI provider could not be reached.');
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------
async function callOpenAi({ system, conversation, maxTokens, temperature, json, apiKey, baseUrl, model, signal }) {
  const body = {
    model,
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      ...conversation.map((message) => ({ role: message.role, content: message.content })),
    ],
    temperature,
    max_tokens: maxTokens,
  };
  const post = async (payload) => {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload),
      signal,
    });
    return { response, data: await readJson(response) };
  };

  if (json) {
    const first = await post({ ...body, response_format: { type: 'json_object' } });
    if (first.response.ok) {
      const text = first.data?.choices?.[0]?.message?.content;
      if (typeof text === 'string' && text.trim()) return { text, raw: first.data };
    }
    // Some providers (Groq's gpt-oss models among them) reject JSON mode
    // outright. The prompt still asks for JSON and `parseJson` is tolerant,
    // so fall back to a plain completion instead of failing the request.
    if (!jsonModeUnsupported(first.response.status, first.data)) {
      throw new AiError(providerMessage(first.data) || 'The AI provider rejected the request.', { status: 502 });
    }
  }

  const { response, data } = await post(body);
  if (!response.ok) {
    throw new AiError(providerMessage(data) || 'The AI provider rejected the request.', { status: 502 });
  }

  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) {
    throw new AiError('The AI provider returned an empty response.', { status: 502, code: 'assistant_empty_response' });
  }
  return { text, raw: data };
}

/** True when the failure looks like "this provider has no JSON mode". */
function jsonModeUnsupported(status, data) {
  if (status !== 400) return false;
  const message = String(providerMessage(data) || '').toLowerCase();
  return /json|response_format|failed_generation/.test(message);
}

async function callAnthropic({ system, conversation, maxTokens, temperature, json, apiKey, baseUrl, model, signal }) {
  const body = {
    model,
    max_tokens: maxTokens,
    temperature,
    messages: conversation.map((message) => ({ role: message.role, content: message.content })),
  };
  if (system) body.system = json ? `${system}\n\nRespond with a single JSON object and nothing else.` : system;

  const response = await fetch(`${baseUrl}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    signal,
  });

  const data = await readJson(response);
  if (!response.ok) {
    throw new AiError(providerMessage(data) || 'The AI provider rejected the request.', { status: 502 });
  }

  const text = (data?.content || []).map((part) => part?.text || '').join('').trim();
  if (!text) throw new AiError('The AI provider returned an empty response.', { status: 502, code: 'assistant_empty_response' });
  return { text, raw: data };
}

async function callGemini({ system, conversation, maxTokens, temperature, json, apiKey, baseUrl, model, signal }) {
  const body = {
    contents: conversation.map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    })),
    generationConfig: { maxOutputTokens: maxTokens, temperature },
  };
  if (system) body.systemInstruction = { parts: [{ text: json ? `${system}\n\nRespond with a single JSON object and nothing else.` : system }] };

  const response = await fetch(`${baseUrl}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  const data = await readJson(response);
  if (!response.ok) {
    throw new AiError(providerMessage(data) || 'The AI provider rejected the request.', { status: 502 });
  }

  const text = (data?.candidates?.[0]?.content?.parts || []).map((part) => part?.text || '').join('').trim();
  if (!text) throw new AiError('The AI provider returned an empty response.', { status: 502, code: 'assistant_empty_response' });
  return { text, raw: data };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: { message: text.slice(0, 400) } };
  }
}

function providerMessage(data) {
  const message = data?.error?.message || data?.message;
  return typeof message === 'string' ? message : null;
}

/**
 * Pull a JSON object out of a model response. Models like to wrap JSON in
 * ```json fences or add a sentence of commentary, so this is deliberately
 * forgiving before it gives up.
 */
export function parseJson(text) {
  const candidates = [];

  const fenced = String(text || '').match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1]);

  const braced = String(text || '').match(/\{[\s\S]*\}/);
  if (braced) candidates.push(braced[0]);

  candidates.push(String(text || ''));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate.trim());
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}
