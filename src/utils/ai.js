const axios = require('axios');
const { logger } = require('./logger');

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const GEMINI_API_BASE   = 'https://generativelanguage.googleapis.com/v1beta/models';
const ANTHROPIC_MODEL   = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
const GEMINI_MODEL      = process.env.GEMINI_MODEL    || 'gemini-2.0-flash';

// ── Anthropic ──────────────────────────────────────────────────────────────────

async function callAnthropic({ systemPrompt, userMessage, maxTokens }) {
  const resp = await axios.post(
    ANTHROPIC_API_URL,
    {
      model: ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    },
    {
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      timeout: 45000,
    }
  );
  const text = resp.data.content[0].text;
  return parseAgentOutput(text);
}

// ── Gemini ─────────────────────────────────────────────────────────────────────

async function callGemini({ systemPrompt, userMessage, maxTokens }) {
  const url = `${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  console.log('[GEMINI] Calling with model:', GEMINI_MODEL);
  try {
    const resp = await axios.post(
      url,
      {
        contents: [
          {
            role: 'user',
            parts: [{ text: `${systemPrompt}\n\n${userMessage}` }],
          },
        ],
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature: 0.7,
        },
      },
      { timeout: 45000 }
    );
    console.log('[GEMINI] Success, status:', resp.status);
    return parseAgentOutput(resp.data.candidates[0].content.parts[0].text);
  } catch (err) {
    console.error('[GEMINI] Error status:', err.response?.status);
    console.error('[GEMINI] Error body raw:', JSON.stringify(err.response?.data || 'no response data'));
    console.error('[GEMINI] Error message:', err.message);
    console.error('[GEMINI] Full error keys:', Object.keys(err).join(', '));
    throw new Error('AI inference failed (Gemini): ' + (err.response?.data?.error?.message || err.response?.data?.message || err.message || 'unknown error'));
  }
}

// ── Cascade ────────────────────────────────────────────────────────────────────

/**
 * Core inference call. All agents use this.
 * Returns the full structured agent output object.
 * Provider order: Anthropic → Gemini → error
 */
async function callAI({ systemPrompt, userMessage, maxTokens = 2048 }) {
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return await callAnthropic({ systemPrompt, userMessage, maxTokens });
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message;
      if (!process.env.GEMINI_API_KEY) {
        logger.error('Anthropic API error:', msg);
        throw new Error(`AI inference failed: ${msg}`);
      }
      logger.warn(`Anthropic failed, falling back to Gemini: ${msg}`);
    }
  }

  if (process.env.GEMINI_API_KEY) {
    try {
      return await callGemini({ systemPrompt, userMessage, maxTokens });
    } catch (err) {
      const msg = err.message;
      logger.error('Gemini API error:', msg);
      throw new Error(msg);
    }
  }

  throw new Error(
    'No AI provider configured. Set ANTHROPIC_API_KEY or ' +
    'GEMINI_API_KEY in your .env file. ' +
    'Get a free Gemini key at aistudio.google.com'
  );
}

// ── Output parser (shared by both providers) ───────────────────────────────────

/**
 * Parse the structured JSON output that all agents must return.
 * Agents are instructed to respond with a JSON block wrapped in ```json ... ```
 */
function parseAgentOutput(text) {
  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
  const jsonStr = jsonMatch ? jsonMatch[1] : text;

  try {
    const parsed = JSON.parse(jsonStr);
    if (!parsed.summary) parsed.summary = 'Done.';
    if (typeof parsed.confidence !== 'number') parsed.confidence = 0.8;
    if (!Array.isArray(parsed.proposed_actions)) parsed.proposed_actions = [];
    if (!Array.isArray(parsed.memory_updates)) parsed.memory_updates = [];
    return parsed;
  } catch (e) {
    logger.warn('Could not parse structured agent output, wrapping raw text.');
    return {
      summary: text,
      recommendation: '',
      confidence: 0.5,
      proposed_actions: [],
      memory_updates: [],
    };
  }
}

// ── Embeddings ─────────────────────────────────────────────────────────────────

/**
 * Generate an embedding vector.
 * Uses OpenAI text-embedding-3-small if OPENAI_API_KEY is set.
 * Falls back to Gemini embedding-001 (768-dim) if GEMINI_API_KEY is set.
 */
async function createEmbedding(text) {
  if (process.env.OPENAI_API_KEY) {
    const resp = await axios.post(
      'https://api.openai.com/v1/embeddings',
      {
        model: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
        input: text.slice(0, 8000),
        dimensions: parseInt(process.env.EMBEDDING_DIMENSIONS || '1536'),
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 20000,
      }
    );
    return resp.data.data[0].embedding;
  }

  if (process.env.GEMINI_API_KEY) {
    logger.warn('Using Gemini embeddings (768-dim). Semantic search may be less accurate than OpenAI 1536-dim.');
    const url = `${GEMINI_API_BASE}/embedding-001:embedContent?key=${process.env.GEMINI_API_KEY}`;
    const resp = await axios.post(
      url,
      { content: { parts: [{ text: text.slice(0, 8000) }] } },
      { timeout: 20000 }
    );
    return resp.data.embedding.values;
  }

  throw new Error('No embedding provider configured. Set OPENAI_API_KEY or GEMINI_API_KEY.');
}

// ── Audio transcription ────────────────────────────────────────────────────────

/**
 * Transcribe a voice message using OpenAI Whisper.
 * Returns null with a warning if OPENAI_API_KEY is not set.
 */
async function transcribeAudio(audioBuffer, filename = 'voice.ogg') {
  if (!process.env.OPENAI_API_KEY) {
    logger.warn('transcribeAudio: OPENAI_API_KEY not set. Voice transcription skipped.');
    return null;
  }

  const FormData = require('form-data');
  const form = new FormData();
  form.append('file', audioBuffer, { filename, contentType: 'audio/ogg' });
  form.append('model', 'whisper-1');
  form.append('language', 'en');

  const resp = await axios.post(
    'https://api.openai.com/v1/audio/transcriptions',
    form,
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        ...form.getHeaders(),
      },
      timeout: 60000,
    }
  );
  return resp.data.text;
}

module.exports = { callAI, createEmbedding, transcribeAudio };
