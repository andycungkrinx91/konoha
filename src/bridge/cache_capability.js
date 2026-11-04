'use strict';

/**
 * Provider prompt-cache capability detection and cache-hint construction.
 *
 * Custom/self-hosted endpoints frequently ignore or reject cache hints, so
 * capability is resolved from the concrete upstream target rather than assumed.
 * When caching is unavailable we say so, and bill-side telemetry reports
 * cached tokens as unknown instead of inventing a saving.
 */

const Anthropic = Object.freeze({
  MIN_CACHEABLE_TOKENS: 1024,
  MAX_BREAKPOINTS: 4
});

const GOOGLE_HOST_PATTERN = /(^|\.)(googleapis\.com|generativelanguage\.googleapis\.com)$/;
const ANTHROPIC_HOST_PATTERN = /(^|\.)anthropic\.com$/;
const OPENAI_HOST_PATTERN = /(^|\.)(openai\.com|openai\.azure\.com)$/;
const KNOWN_CACHE_HOSTS = [ANTHROPIC_HOST_PATTERN, OPENAI_HOST_PATTERN, GOOGLE_HOST_PATTERN];

function normalizeHost(baseUrl) {
  if (!baseUrl || typeof baseUrl !== 'string') return '';
  try {
    return new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isLoopbackHost(host) {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0';
}

/**
 * Decide whether the given upstream may honour prompt caching.
 * Returns { supported, strategy, reason } and never throws.
 */
function detectCacheCapability({ baseUrl, provider, model, allowCustomCache } = {}) {
  const host = normalizeHost(baseUrl);
  const providerId = String(provider || '').toLowerCase();
  const modelId = String(model || '').toLowerCase();

  const looksAnthropic = providerId === 'anthropic' || ANTHROPIC_HOST_PATTERN.test(host) || modelId.includes('claude');
  const looksOpenAi = providerId === 'openai' || OPENAI_HOST_PATTERN.test(host);
  const looksGoogle = providerId === 'gemini' || providerId === 'google' || GOOGLE_HOST_PATTERN.test(host);

  const isKnownHost = KNOWN_CACHE_HOSTS.some((re) => re.test(host));

  if (!host && !providerId) {
    return { supported: false, strategy: 'none', reason: 'no_upstream_identity' };
  }

  if (isKnownHost) {
    if (looksAnthropic) return { supported: true, strategy: 'anthropic_cache_control', reason: 'known_anthropic_endpoint' };
    if (looksOpenAi) return { supported: true, strategy: 'openai_automatic', reason: 'known_openai_endpoint' };
    if (looksGoogle) return { supported: true, strategy: 'google_context_cache', reason: 'known_google_endpoint' };
  }

  if (isLoopbackHost(host)) {
    return { supported: false, strategy: 'none', reason: 'local_bridge_passthrough' };
  }

  if (allowCustomCache === true) {
    return {
      supported: true,
      strategy: looksAnthropic ? 'anthropic_cache_control' : 'custom_beta_header',
      reason: 'custom_endpoint_opted_in'
    };
  }

  return { supported: false, strategy: 'none', reason: 'unknown_custom_endpoint' };
}

/**
 * Attach an ephemeral cache breakpoint to the last stable system block.
 * Mirrors the messages back untouched when caching is not supported or the
 * prefix is too short to be cacheable, so callers never lose content.
 */
function applyAnthropicCacheHint(system, { estimatedTokens = 0 } = {}) {
  if (!Array.isArray(system) || system.length === 0) return system;
  if (estimatedTokens > 0 && estimatedTokens < Anthropic.MIN_CACHEABLE_TOKENS) return system;

  const lastStableIndex = system.length - 1;
  return system.map((block, index) => {
    if (index !== lastStableIndex || !block || typeof block !== 'object') return block;
    if (block.cache_control) return block;
    return { ...block, cache_control: { type: 'ephemeral' } };
  });
}

/**
 * Declare support for the extended cache TTL beta when a request opts in.
 */
function buildAnthropicBetaHeader({ extendedTtl } = {}) {
  return extendedTtl ? 'prompt-caching-2024-07-31,extended-cache-ttl-2025-04-11' : 'prompt-caching-2024-07-31';
}

/**
 * Extract cached-token usage from a provider response when present.
 * Returns null when the provider reported nothing, so callers can record
 * an explicit unknown rather than a fabricated zero.
 */
function extractCachedTokens(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const candidates = [
    usage.cache_read_input_tokens,
    usage.cached_tokens,
    usage.prompt_tokens_details?.cached_tokens,
    usage.prompt_cache_hit_tokens,
    usage.cachedContentTokenCount
  ];
  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

module.exports = {
  Anthropic,
  detectCacheCapability,
  applyAnthropicCacheHint,
  buildAnthropicBetaHeader,
  extractCachedTokens,
  normalizeHost
};
