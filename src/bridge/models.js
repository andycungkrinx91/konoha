'use strict';

// ─────────────────────────────────────────────
// Model Definitions for OpenAI Bridge
// ─────────────────────────────────────────────

const MODEL_MAP = {
  'gpt-4o': {
    name: 'GPT-4o',
    owned_by: 'openai',
    context: 128000,
    output: 16384,
  },
  'gpt-4o-mini': {
    name: 'GPT-4o Mini',
    owned_by: 'openai',
    context: 128000,
    output: 16384,
  },
  'o1': {
    name: 'o1',
    owned_by: 'openai',
    context: 200000,
    output: 100000,
  },
  'o3-mini': {
    name: 'o3-mini',
    owned_by: 'openai',
    context: 200000,
    output: 100000,
  },
  'gpt-4-turbo': {
    name: 'GPT-4 Turbo',
    owned_by: 'openai',
    context: 128000,
    output: 4096,
  },
  'gpt-4': {
    name: 'GPT-4',
    owned_by: 'openai',
    context: 8192,
    output: 4096,
  },
  'gpt-3.5-turbo': {
    name: 'GPT-3.5 Turbo',
    owned_by: 'openai',
    context: 16385,
    output: 4096,
  },
};

const DEFAULT_MODEL_KEY = 'gpt-4o';

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
