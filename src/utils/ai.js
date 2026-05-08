const axios = require('axios');
const { logger } = require('./logger');

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_MODEL    = process.env.GEMINI_MODEL || 'gemini-1.5-flash-latest';

// ── Gemini (primary provider) ──────────────────────────────────────────────────

async function callGemini({ systemPrompt, userMessage, maxTokens }) {
  const url = `${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`;
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
    return parseAgentOutput(resp.data.candidates[0].content.parts[0].text);
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.response?.data?.message || err.message || 'unknown error';
    logger.error('Gemini API error:', msg, '| status:', err.response?.status);
    throw new Error(`AI inference failed (Gemini): ${msg}`);
  }
}

// ── Core inference ─────────────────────────────────────────────────────────────

/**
 * Core inference call. All agents use this.
 * Returns the full structured agent output object.
 * Primary provider: Gemini
 */
async function callAI({ systemPrompt, userMessage, maxTokens = 2048 }) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error(
      'GEMINI_API_KEY is not set. Get a free key at aistudio.google.com and add it to your .env file.'
    );
  }
  return callGemini({ systemPrompt, userMessage, maxTokens });
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
 * Uses Gemini embedding-001 (primary). Falls back to OpenAI if OPENAI_API_KEY is set.
 */
async function createEmbedding(text) {
  if (process.env.GEMINI_API_KEY) {
    const url = `${GEMINI_API_BASE}/embedding-001:embedContent?key=${process.env.GEMINI_API_KEY}`;
    const resp = await axios.post(
      url,
      { content: { parts: [{ text: text.slice(0, 8000) }] } },
      { timeout: 20000 }
    );
    return resp.data.embedding.values;
  }

  throw new Error('GEMINI_API_KEY is not set. Embeddings require a Gemini API key.');
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
