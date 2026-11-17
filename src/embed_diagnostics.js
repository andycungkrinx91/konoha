'use strict';

/**
 * src/embed_diagnostics.js — turns an embedding failure into a problem statement
 * plus actionable remedies.
 *
 * Kept pure and free of CLI imports so `konoha init`, `konoha migrate` and
 * `konoha doctor` all print the same diagnosis for the same error. Progress
 * rendering stays in the CLI; this module only classifies.
 */

const { SEMANTIC_SEARCH_ENV } = require('./hf_cache_resolver');

/**
 * Ordered rules: the first `match` that hits wins. Every entry must explain the
 * cause and name a command the user can actually run.
 */
const RULES = [
  {
    id: 'semantic_disabled',
    match: (err) => /semantic embedding requested while .* disabled/i.test(err.message || ''),
    summary: 'Semantic embedding is switched off in this environment.',
    causes: [`${SEMANTIC_SEARCH_ENV} is set to a falsey value (0/false/off/no).`],
    fixes: [
      `unset ${SEMANTIC_SEARCH_ENV} (or set it to 1) and re-run`,
      'konoha doctor --fix',
    ],
  },
  {
    id: 'model_download',
    match: (err) => /failed to load .*model/i.test(err.message || ''),
    summary: 'The Granite embedding model could not be loaded.',
    causes: [
      'The ONNX weights are not in the local HuggingFace cache yet and the download failed.',
      'A proxy, firewall or offline mode blocked huggingface.co.',
      'The cache directory is not writable.',
    ],
    fixes: [
      'check network access to huggingface.co, then re-run konoha init',
      'if you use a proxy, set HTTPS_PROXY before re-running',
      'if the cache is on a read-only volume, point HF_HOME at a writable directory',
      'konoha doctor --fix',
    ],
  },
  {
    id: 'dimension_mismatch',
    match: (err) => /embedding dimension mismatch/i.test(err.message || ''),
    summary: 'Stored vectors do not match the current model width (384).',
    causes: ['The database was built by a different embedding model or an older schema.'],
    fixes: [
      'konoha migrate --rebuild-embeddings',
      'konoha doctor --fix',
    ],
  },
  {
    id: 'onnx_output',
    match: (err) => /unexpected .*tensor|unexpected pooled tensor/i.test(err.message || ''),
    summary: 'The ONNX runtime returned a tensor shape the embedder does not understand.',
    causes: ['A corrupted or partially downloaded model file.', 'An incompatible onnxruntime binary for this platform.'],
    fixes: [
      'delete the cached model directory and re-run konoha init to re-download it',
      'konoha doctor --fix',
    ],
  },
  {
    id: 'runtime_missing',
    match: (err) => /onnxruntime|cannot find module|module not found/i.test(err.message || ''),
    summary: 'The ONNX runtime is not installed or cannot be loaded.',
    causes: ['npm optional dependencies were skipped during install.', 'A platform-specific binary is missing.'],
    fixes: [
      'reinstall konoha so onnxruntime-node is fetched for this platform',
      'konoha doctor --fix',
    ],
  },
];

const FALLBACK = {
  id: 'unknown',
  summary: 'Embedding failed for an unclassified reason.',
  causes: ['The failure did not match any known embedding error, so the cause is not yet identifiable.'],
  fixes: ['re-run with KONOHA_DEBUG=1 for a full stack trace', 'konoha doctor --fix'],
};

/**
 * Classifies an embedding failure.
 * @param {Error|{message?: string}} err
 * @returns {{id: string, summary: string, causes: string[], fixes: string[], message: string}}
 */
function classifyEmbedFailure(err) {
  const message = (err && err.message) || String(err || 'unknown error');
  const rule = RULES.find((r) => r.match({ message })) || FALLBACK;
  return { ...rule, message };
}

/**
 * Renders a classification as printable lines. No colors: the caller owns them.
 * @param {ReturnType<typeof classifyEmbedFailure>} failure
 * @returns {string[]}
 */
function formatEmbedFailure(failure) {
  const lines = [`Reason: ${failure.message}`];
  if (failure.causes.length > 0) {
    lines.push('Likely cause:');
    for (const c of failure.causes) lines.push(`  - ${c}`);
  }
  lines.push('How to resolve:');
  for (const f of failure.fixes) lines.push(`  - ${f}`);
  return lines;
}

module.exports = { classifyEmbedFailure, formatEmbedFailure, RULES };
