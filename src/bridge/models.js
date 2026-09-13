'use strict';

// Model Definitions for OpenAI Bridge (table-driven: id, value, name, owner,
// input modalities, output modalities, context limit, output limit, hidden)

const MODEL_SPECS = [
  ['gemini-3.7-flash-medium', 1049, 'Gemini 3.7 Flash Medium (Antigravity)', 'google', ['text', 'image'], ['text'], 1048576, 65536],
  ['gemini-3.7-flash-high', 1050, 'Gemini 3.7 Flash High (Antigravity)', 'google', ['text', 'image'], ['text', 'image'], 1048576, 65536],
  ['gemini-3.7-flash-low', 1051, 'Gemini 3.7 Flash Low (Antigravity)', 'google', ['text', 'image'], ['text'], 1048576, 65536],
  ['gemini-3.6-flash-medium', 1046, 'Gemini 3.6 Flash Medium (Antigravity)', 'google', ['text', 'image'], ['text'], 1048576, 65536],
  ['gemini-3.6-flash-high', 1047, 'Gemini 3.6 Flash High (Antigravity)', 'google', ['text', 'image'], ['text', 'image'], 1048576, 65536],
  ['gemini-3.6-flash-low', 1048, 'Gemini 3.6 Flash Low (Antigravity)', 'google', ['text', 'image'], ['text'], 1048576, 65536],
  ['gemini-3.1-pro-high', 1037, 'Gemini 3.1 Pro High (Antigravity)', 'google', ['text', 'image'], ['text'], 1048576, 65535],
  ['gemini-3.1-pro-low', 1036, 'Gemini 3.1 Pro Low (Antigravity)', 'google', ['text', 'image'], ['text'], 1048576, 65535],
  ['claude-sonnet-4-6', 1035, 'Claude Sonnet 4.6 (Antigravity)', 'anthropic', ['text', 'image'], ['text', 'image'], 200000, 64000],
  ['claude-opus-4-6-thinking', 1026, 'Claude Opus 4.6 Thinking (Antigravity)', 'anthropic', ['text', 'image'], ['text'], 200000, 64000],
  ['gpt-oss-120b', 342, 'GPT-OSS 120B Medium (Antigravity)', 'openai', ['text', 'image'], ['text'], 128000, 16384],
  ['antigravity', 1046, 'Gemini 3.6 Flash Medium (Antigravity)', 'google', ['text', 'image'], ['text'], 1048576, 65536, true],
  ['gpt-oss-120b-medium', 342, 'GPT-OSS 120B Medium (Antigravity)', 'openai', ['text', 'image'], ['text'], 128000, 16384, true],
  ['antigravity-claude-sonnet-4-6', 1035, 'Claude Sonnet 4.6 (Antigravity)', 'anthropic', ['text', 'image'], ['text', 'image'], 200000, 64000, true],
  // aislop-ignore-next-line code-quality/duplicate-block (structurally similar boilerplate with contextual differences)
  ['antigravity-claude-opus-4-6-thinking', 1026, 'Claude Opus 4.6 Thinking (Antigravity)', 'anthropic', ['text', 'image'], ['text'], 200000, 64000, true],
  ['antigravity-gpt-oss-120b', 342, 'GPT-OSS 120B Medium (Antigravity)', 'openai', ['text', 'image'], ['text'], 128000, 16384, true],
  ['antigravity-gemini-3.7-flash-medium', 1049, 'Gemini 3.7 Flash Medium (Antigravity)', 'google', ['text', 'image'], ['text'], 1048576, 65536, true],
  ['antigravity-gemini-3.7-flash-high', 1050, 'Gemini 3.7 Flash High (Antigravity)', 'google', ['text', 'image'], ['text', 'image'], 1048576, 65536, true],
  ['antigravity-gemini-3.7-flash-low', 1051, 'Gemini 3.7 Flash Low (Antigravity)', 'google', ['text', 'image'], ['text'], 1048576, 65536, true],
  ['antigravity-gemini-3.6-flash-medium', 1046, 'Gemini 3.6 Flash Medium (Antigravity)', 'google', ['text', 'image'], ['text'], 1048576, 65536, true],
  ['antigravity-gemini-3.6-flash-high', 1047, 'Gemini 3.6 Flash High (Antigravity)', 'google', ['text', 'image'], ['text', 'image'], 1048576, 65536, true],
  ['antigravity-gemini-3.6-flash-low', 1048, 'Gemini 3.6 Flash Low (Antigravity)', 'google', ['text', 'image'], ['text'], 1048576, 65536, true],
  ['antigravity-gemini-3.1-pro-high', 1037, 'Gemini 3.1 Pro High (Antigravity)', 'google', ['text', 'image'], ['text'], 1048576, 65535, true],
  ['antigravity-gemini-3.1-pro-low', 1036, 'Gemini 3.1 Pro Low (Antigravity)', 'google', ['text', 'image'], ['text'], 1048576, 65535, true],
];

// aislop-ignore-next-line code-quality/duplicate-block (structurally similar boilerplate with contextual differences)
const MODEL_MAP = Object.fromEntries(
  MODEL_SPECS.map(([id, value, name, owned_by, input, output, context, outputLimit, hidden]) => [
    id,
    {
      value,
      name,
      owned_by,
      modalities: { input, output },
      limit: { context, output: outputLimit },
      ...(hidden ? { hidden: true } : {}),
    },
  ])
);

// aislop-ignore-next-line code-quality/duplicate-block (structurally similar boilerplate with contextual differences)
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
// aislop-ignore-next-line code-quality/duplicate-block (structurally similar boilerplate with contextual differences)
