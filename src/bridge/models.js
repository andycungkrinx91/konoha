'use strict';

// ─────────────────────────────────────────────
// Model Definitions for OpenAI Bridge
// ─────────────────────────────────────────────

const MODEL_MAP = {
  'gemini-3.7-flash-medium': {
    value: 1049,
    name: 'Gemini 3.7 Flash Medium (Antigravity)',
    owned_by: 'google',
    modalities: { input: ['text', 'image'], output: ['text'] },
    limit: { context: 1048576, output: 65536 },
  },
  'gemini-3.7-flash-high': {
    value: 1050,
    name: 'Gemini 3.7 Flash High (Antigravity)',
    owned_by: 'google',
    modalities: { input: ['text', 'image'], output: ['text', 'image'] },
    limit: { context: 1048576, output: 65536 },
  },
  'gemini-3.7-flash-low': {
    value: 1051,
    name: 'Gemini 3.7 Flash Low (Antigravity)',
    owned_by: 'google',
    modalities: { input: ['text', 'image'], output: ['text'] },
    limit: { context: 1048576, output: 65536 },
  },
  'gemini-3.6-flash-medium': {
    value: 1046,
    name: 'Gemini 3.6 Flash Medium (Antigravity)',
    owned_by: 'google',
    modalities: { input: ['text', 'image'], output: ['text'] },
    limit: { context: 1048576, output: 65536 },
  },
  'gemini-3.6-flash-high': {
    value: 1047,
    name: 'Gemini 3.6 Flash High (Antigravity)',
    owned_by: 'google',
    modalities: { input: ['text', 'image'], output: ['text', 'image'] },
    limit: { context: 1048576, output: 65536 },
  },
  'gemini-3.6-flash-low': {
    value: 1048,
    name: 'Gemini 3.6 Flash Low (Antigravity)',
    owned_by: 'google',
    modalities: { input: ['text', 'image'], output: ['text'] },
    limit: { context: 1048576, output: 65536 },
  },
  'gemini-3.1-pro-high': {
    value: 1037,
    name: 'Gemini 3.1 Pro High (Antigravity)',
    owned_by: 'google',
    modalities: { input: ['text', 'image'], output: ['text'] },
    limit: { context: 1048576, output: 65535 },
  },
  'gemini-3.1-pro-low': {
    value: 1036,
    name: 'Gemini 3.1 Pro Low (Antigravity)',
    owned_by: 'google',
    modalities: { input: ['text', 'image'], output: ['text'] },
    limit: { context: 1048576, output: 65535 },
  },
  'claude-sonnet-4-6': {
    value: 1035,
    name: 'Claude Sonnet 4.6 (Antigravity)',
    owned_by: 'anthropic',
    modalities: { input: ['text', 'image'], output: ['text', 'image'] },
    limit: { context: 200000, output: 64000 },
  },
  'claude-opus-4-6-thinking': {
    value: 1026,
    name: 'Claude Opus 4.6 Thinking (Antigravity)',
    owned_by: 'anthropic',
    modalities: { input: ['text', 'image'], output: ['text'] },
    limit: { context: 200000, output: 64000 },
  },
  'gpt-oss-120b': {
    value: 342,
    name: 'GPT-OSS 120B Medium (Antigravity)',
    owned_by: 'openai',
    modalities: { input: ['text', 'image'], output: ['text'] },
    limit: { context: 128000, output: 16384 },
  },
  // Aliases for convenience
  antigravity: {
    value: 1046,
    name: 'Gemini 3.6 Flash Medium (Antigravity)',
    owned_by: 'google',
    modalities: { input: ['text', 'image'], output: ['text'] },
    limit: { context: 1048576, output: 65536 },
    hidden: true,
  },
  'gpt-oss-120b-medium': {
    value: 342,
    name: 'GPT-OSS 120B Medium (Antigravity)',
    owned_by: 'openai',
    modalities: { input: ['text', 'image'], output: ['text'] },
    limit: { context: 128000, output: 16384 },
    hidden: true,
  },
  'antigravity-claude-sonnet-4-6': {
    value: 1035,
    name: 'Claude Sonnet 4.6 (Antigravity)',
    owned_by: 'anthropic',
    modalities: { input: ['text', 'image'], output: ['text', 'image'] },
    limit: { context: 200000, output: 64000 },
    hidden: true,
  },
  'antigravity-claude-opus-4-6-thinking': {
    value: 1026,
    name: 'Claude Opus 4.6 Thinking (Antigravity)',
    owned_by: 'anthropic',
    modalities: { input: ['text', 'image'], output: ['text'] },
    limit: { context: 200000, output: 64000 },
    hidden: true,
  },
  'antigravity-gpt-oss-120b': {
    value: 342,
    name: 'GPT-OSS 120B Medium (Antigravity)',
    owned_by: 'openai',
    modalities: { input: ['text', 'image'], output: ['text'] },
    limit: { context: 128000, output: 16384 },
    hidden: true,
  },
  'antigravity-gemini-3.7-flash-medium': {
    value: 1049,
    name: 'Gemini 3.7 Flash Medium (Antigravity)',
    owned_by: 'google',
    modalities: { input: ['text', 'image'], output: ['text'] },
    limit: { context: 1048576, output: 65536 },
    hidden: true,
  },
  'antigravity-gemini-3.7-flash-high': {
    value: 1050,
    name: 'Gemini 3.7 Flash High (Antigravity)',
    owned_by: 'google',
    modalities: { input: ['text', 'image'], output: ['text', 'image'] },
    limit: { context: 1048576, output: 65536 },
    hidden: true,
  },
  'antigravity-gemini-3.7-flash-low': {
    value: 1051,
    name: 'Gemini 3.7 Flash Low (Antigravity)',
    owned_by: 'google',
    modalities: { input: ['text', 'image'], output: ['text'] },
    limit: { context: 1048576, output: 65536 },
    hidden: true,
  },
  'antigravity-gemini-3.6-flash-medium': {
    value: 1046,
    name: 'Gemini 3.6 Flash Medium (Antigravity)',
    owned_by: 'google',
    modalities: { input: ['text', 'image'], output: ['text'] },
    limit: { context: 1048576, output: 65536 },
    hidden: true,
  },
  'antigravity-gemini-3.6-flash-high': {
    value: 1047,
    name: 'Gemini 3.6 Flash High (Antigravity)',
    owned_by: 'google',
    modalities: { input: ['text', 'image'], output: ['text', 'image'] },
    limit: { context: 1048576, output: 65536 },
    hidden: true,
  },
  'antigravity-gemini-3.6-flash-low': {
    value: 1048,
    name: 'Gemini 3.6 Flash Low (Antigravity)',
    owned_by: 'google',
    modalities: { input: ['text', 'image'], output: ['text'] },
    limit: { context: 1048576, output: 65536 },
    hidden: true,
  },
  'antigravity-gemini-3.1-pro-high': {
    value: 1037,
    name: 'Gemini 3.1 Pro High (Antigravity)',
    owned_by: 'google',
    modalities: { input: ['text', 'image'], output: ['text'] },
    limit: { context: 1048576, output: 65535 },
    hidden: true,
  },
  'antigravity-gemini-3.1-pro-low': {
    value: 1036,
    name: 'Gemini 3.1 Pro Low (Antigravity)',
    owned_by: 'google',
    modalities: { input: ['text', 'image'], output: ['text'] },
    limit: { context: 1048576, output: 65535 },
    hidden: true,
  },
};

const DEFAULT_MODEL_KEY = 'gemini-3.6-flash-medium';

function resolveModel(requestedModel) {
  if (!requestedModel) {
    return { key: DEFAULT_MODEL_KEY, ...MODEL_MAP[DEFAULT_MODEL_KEY] };
  }
  if (MODEL_MAP[requestedModel]) return { key: requestedModel, ...MODEL_MAP[requestedModel] };
  const lower = requestedModel.toLowerCase();
  for (const [k, v] of Object.entries(MODEL_MAP)) {
    if (k.includes(lower) || lower.includes(k)) return { key: k, ...v };
  }
  return { key: requestedModel, name: requestedModel, owned_by: 'openai', context: 128000, output: 16384 };
}

module.exports = { MODEL_MAP, DEFAULT_MODEL_KEY, resolveModel };
