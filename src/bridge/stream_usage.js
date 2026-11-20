'use strict';

/**
 * src/bridge/stream_usage.js — who may be sent `stream_options.include_usage`.
 *
 * `stream_options` belongs to the [OI] Chat Completions contract. A provider
 * that does not implement that contract may reject the unknown parameter and
 * fail the whole request, so support is never inferred from "it looks like an
 * LLM endpoint": only a provider on the explicit allowlist is asked, and
 * anything else is denied. The allowlist is config-driven
 * (`bridge_stream_usage_providers`, default `openai`) so a verified provider can
 * be added without a code change, and a single bridge can override the decision
 * in either direction with `supportsStreamUsage`.
 *
 * Denying the field is not an error: the stream proceeds and the caller sees
 * whatever usage the upstream volunteers. When it volunteers none, the
 * Anthropic translation fails loudly rather than inventing counts.
 */

const { getConfigValue } = require('../config_access');

/**
 * Providers whose declared contract is the [OI] Chat Completions API, which is
 * where `stream_options.include_usage` is defined. `openai-compatible` is the
 * label this repository's `konoha bridge create` writes for "speaks that API"
 * (OpenAI, Groq, vLLM, Ollama, LM Studio, llama.cpp), so it qualifies; an
 * `antigravity-extension` or unrecognised provider does not.
 *
 * A server that validates unknown parameters rejects the whole request, so this
 * list is the allowlist, not a guess: unknown providers are denied by default
 * and a strict server is excluded with `bridge_stream_usage_providers` or a
 * per-bridge `supportsStreamUsage: false`.
 */
const DEFAULT_STREAM_USAGE_PROVIDERS = ['openai', 'openai-compatible', '9router'];

function parseAllowlist(raw) {
  const source = Array.isArray(raw) ? raw : String(raw === undefined || raw === null ? '' : raw).split(',');
  return new Set(
    source
      .map((value) => String(value).trim().toLowerCase())
      .filter(Boolean)
  );
}

function providerAllowlist(rawConfig) {
  const configured = rawConfig === undefined ? getConfigValue('bridge_stream_usage_providers') : rawConfig;
  const parsed = parseAllowlist(configured);
  return parsed.size > 0 ? parsed : parseAllowlist(DEFAULT_STREAM_USAGE_PROVIDERS);
}

/**
 * Decide whether this bridge may receive `stream_options.include_usage`.
 *
 * @param {object|null} bridgeConfig  bridge row (`provider`, `supportsStreamUsage`)
 * @param {string|string[]} [rawConfig] override for `bridge_stream_usage_providers`
 * @returns {boolean}
 */
function supportsStreamUsage(bridgeConfig, rawConfig) {
  if (!bridgeConfig) return false;
  if (typeof bridgeConfig.supportsStreamUsage === 'boolean') return bridgeConfig.supportsStreamUsage;
  const provider = typeof bridgeConfig.provider === 'string' ? bridgeConfig.provider.trim().toLowerCase() : '';
  if (!provider) return false;
  return providerAllowlist(rawConfig).has(provider);
}

module.exports = { supportsStreamUsage, providerAllowlist, DEFAULT_STREAM_USAGE_PROVIDERS };
