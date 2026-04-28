const axios = require('axios');
const { logger } = require('./logger');

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';

/**
 * Core inference call. All agents use this.
 * Returns the full structured agent output object.
 */
async function callAI({ systemPrompt, userMessage, maxTokens = 2048 }) {
  const headers = {
    'x-api-key': process.env.ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  };

  const body = {
    model: MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  };

  try {
    const resp = await axios.post(ANTHROPIC_API_URL, body, { headers, timeout: 45000 });
    const text = resp.data.content[0].text;
    return parseAgentOutput(text);
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    logger.error('Anthropic API error:', msg);
    throw new Error(`AI inference failed: ${msg}`);
  }
}

/**
 * Parse the structured JSON output that all agents must return.
 * Agents are instructed to respond with a JSON block wrapped in ```json ... ```
 */
function parseAgentOutput(text) {
  // Extract JSON from markdown code block if present
  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
  const jsonStr = jsonMatch ? jsonMatch[1] : text;

  try {
    const parsed = JSON.parse(jsonStr);
    // Validate required fields
    if (!parsed.summary) parsed.summary = 'Done.';
    if (typeof parsed.confidence !== 'number') parsed.confidence = 0.8;
    if (!Array.isArray(parsed.proposed_actions)) parsed.proposed_actions = [];
    if (!Array.isArray(parsed.memory_updates)) parsed.memory_updates = [];
    return parsed;
  } catch (e) {
    // If parsing fails, return a safe wrapper around the raw text
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

/**
 * Generate an embedding vector for the given text.
 * Uses OpenAI text-embedding-3-small.
 */
async function createEmbedding(text) {
  const resp = await axios.post(
    'https://api.openai.com/v1/embeddings',
    {
      model: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
      input: text.slice(0, 8000), // max input length guard
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

/**
 * Transcribe a voice message using OpenAI Whisper.
 * audioBuffer: Buffer of the audio file
 * filename: e.g. 'voice.ogg'
 */
async function transcribeAudio(audioBuffer, filename = 'voice.ogg') {
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
