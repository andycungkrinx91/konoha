'use strict';

/**
 * src/canonical_skills.js
 * 
 * Authoritative single source of truth for:
 * 1. The 16 canonical top-level skills in Konoha.
 * 2. Embedded reference skills (skills consolidated into references/*.md inside ninja skills).
 * 3. Pruning and protection invariants across all coding clients and database migrations.
 */

const fs = require('fs');
const path = require('path');

const CANONICAL_SKILL_NAMES = new Set([
  'anbu-skill',
  'antislop',
  'antislop-code',
  'antislop-copywriting',
  'antislop-human',
  'antislop-layoutmobile',
  'antislop-ui',
  'chunin-skill',
  'genin-skill',
  'helm-chart-scaffolding',
  'i-have-adhd',
  'jonin-skill',
  'kage-skill',
  'konoha',
  'sannin-skill',
  'tokubetsu-jonin-skill'
]);

// Explicit registry of skills that were consolidated into references inside ninja skills.
// These must NEVER appear as standalone top-level skill folders in .agents/skills or any client.
const KNOWN_EMBEDDED_REFERENCE_SKILLS = new Set([
  'accessibility-testing-expert',
  'adaptive-model-cascade',
  'affective-computing-emotion-ai',
  'agentic-coding-workflow-expert',
  'agentic-memory-architect',
  'agentic-micro-economy-architect',
  'ai-code-review-autonomous',
  'ai-llm-integration-expert',
  'ai-media-generation-expert',
  'ai-prompt-engineering-expert',
  'ai-safety-governance-expert',
  'angular-code-expert',
  'angular-developer',
  'angular-expert',
  'angular-ui-expert',
  'anthropic-cybersecurity-skills',
  'api-design-expert',
  'api-gateway-proxy-expert',
  'app-analyzer-optimizer',
  'app-promo-media-expert',
  'apple-ecosystem-expert',
  'architecture-analysis',
  'astro-framework-expert',
  'async-queue-temporal-expert',
  'authentication-identity-expert',
  'autonomous-api-drift-healer',
  'autonomous-red-teamer',
  'autonomous-tdd-debugger',
  'backend-review',
  'bigquery-data-transfer-service',
  'bigquery-sql',
  'biome-linter-formatter-expert',
  'blockchain-web3-expert',
  'brainstorming',
  'browser-automation-expert',
  'building-data-apps',
  'bun-runtime-expert',
  'character-hygiene',
  'chart-structure',
  'chatbot-messaging-expert',
  'ci-cd-devops-architect',
  'cloud-hosting-expert',
  'code-exploration',
  'code-review',
  'coderabbit',
  'command-safety',
  'compliance-gdpr-privacy-expert',
  'composable-mach-architect',
  'context-optimization',
  'context-window-engineer',
  'cron-scheduler-expert',
  'data-autocleaning',
  'data-pipeline-etl-expert',
  'data-telemetry-expert',
  'data-visualization-expert',
  'database-orm-expert',
  'dataform-bigquery',
  'dbt-bigquery',
  'deep-research-analyst',
  'dependency-upgrade-migrator',
  'design-system-architect',
  'design-token-manifest',
  'desktop-electron-expert',
  'details',
  'devops-engineer',
  'discovering-gcp-data-assets',
  'distributed-systems',
  'documentation-site-expert',
  'documentation-writer',
  'docx',
  'doku-mcp-server',
  'doku-payment-gateway',
  'domain-driven-design-expert',
  'drawio-skill',
  'draw-io-diagram-generator',
  'e2e-testing-expert',
  'ecommerce-expert',
  'elite-powerpoint-designer',
  'email-notification-expert',
  'enforcing-resource-attribution',
  'ephemeral-generative-ui-architect',
  'ephemeral-wasm-sandbox-executor',
  'error-resilience-expert',
  'event-driven-architect',
  'feature-flag-analytics-expert',
  'file-upload-media-expert',
  'firebase-security-expert',
  'form-validation-expert',
  'formal-spec-z3-verifier',
  'framer-motion-animator',
  'frontend-review',
  'frontier-ai-models-expert',
  'fullstack-expert',
  'gcp-data-pipelines',
  'gcp-dataflow',
  'gcp-pipeline-orchestration',
  'gcp-pipeline-resource-provisioning',
  'gcp-spark',
  'gcp-spark-troubleshooting',
  'gemini-agent-booster',
  'geospatial-maps-expert',
  'global-a11y-i18n-expert',
  'glsl-shader-expert',
  'go-programming-expert',
  'google-cloud-auth-verification',
  'graph-rag-knowledge-expert',
  'graphql-apollo-expert',
  'guardrails',
  'headless-cms-expert',
  'hig',
  'improve-codebase-architecture',
  'js-backend-expert',
  'kv-cache-prefix-optimizer',
  'laravel-specialist',
  'legacy-code-translator',
  'living-codebase-ast-graph',
  'llm-finops-router',
  'llm-observability-expert',
  'local-slm-edge-ai-expert',
  'logging-error-tracking-expert',
  'magento-module-developer',
  'managing-python-dependencies',
  'mcp-server-architect',
  'mcp-tools-block',
  'micro-frontend-architect',
  'ml-best-practices',
  'mobile-expo-expert',
  'modern-css-native-expert',
  'monorepo-architect',
  'mpa-orchestrator',
  'multi-agent-orchestration',
  'multi-stage-dockerfile',
  'multimodal-spatial-video-cloner',
  'mvc-expert',
  'n8n-automation-expert',
  'nextjs-app-router-expert',
  'nextjs-code-expert',
  'nextjs-ui-expert',
  'notebook-guidance',
  'nuxt',
  'nuxt-code-expert',
  'nuxt-ui-expert',
  'openapi-swagger-codegen-expert',
  'owasp-security',
  'payment-gateway-expert',
  'pdf',
  'pdf-document-generation-expert',
  'performance-web-vitals',
  'post-quantum-crypto-migrator',
  'postmortem-writer',
  'pptx',
  'prd-architect',
  'proactive-background-watcher',
  'production-ready-hardener',
  'prometheus-grafana',
  'prompt-engineer',
  'prompt-injection-firewall',
  'property-mutation-testing-expert',
  'pwa-offline-first-expert',
  'pydantic-ai-expert',
  'python-programming-expert',
  'qa-automation',
  'rate-limit-abuse-prevention',
  'react-nextjs-patterns',
  'react-patterns',
  'react-performance',
  'react-testing',
  'realtime-collaboration-expert',
  'report-quality',
  'research-methodology',
  'rich-text-editor-expert',
  'risk-assessment',
  'router',
  'rust-programming-expert',
  'saas-architect',
  'saas-billing',
  'saas-multi-tenant',
  'scalability-clean-code',
  'schema-mapping',
  'screenshot-to-code-expert',
  'search-engine-expert',
  'secret-safety',
  'self-healing-cloud-orchestrator',
  'senior-frontend',
  'seo',
  'session-memory-manager',
  'skill-repair',
  'solidjs-expert',
  'source-evaluation',
  'source-fidelity-directives',
  'spa-orchestrator',
  'speculative-multi-draft-synthesizer',
  'spline-interactive',
  'sse-websocket-streaming-expert',
  'state-management-expert',
  'supabase-security-expert',
  'svelte-code-expert',
  'svelte-sveltekit-expert',
  'svelte-ui-expert',
  'svelte5-best-practices',
  'svg-animation-motion-expert',
  'synthetic-data-finetuning-expert',
  'tailwind-design-system',
  'tailwind-expert',
  'tailwind-v4-shadcn',
  'tanstack-query-expert',
  'taste-skill-frontend-expert',
  'tauri-expert',
  'technical-article-writer',
  'test-e2e-skill',
  'test-time-compute-optimizer',
  'token-safety',
  'typescript-expert',
  'ui-ux-pro-max',
  'vector-db-rag-expert',
  'vercel-ai-sdk-expert',
  'vite',
  'voice-ai-realtime-agent',
  'vue-frontend-expert',
  'wasm-edge-computing-expert',
  'web-3d-graphics-expert',
  'web-game-engine-expert',
  'web-scraper',
  'website-design-cloner',
  'webxr-ar-vr-expert',
  'wordpress-headless-expert',
  'wordpress-pro',
  'zero-ai-human-writing',
  'zero-tech-debt-auditor',
  'zero-to-prod-orchestrator',
  'zero-trust-secret-vault'
]);

let _dynamicEmbeddedRefsCache = null;

/**
 * Returns the set of all embedded reference names.
 * Dynamically scans known canonical directories and combines with the explicit registry.
 */
function getEmbeddedReferenceSkills(searchRoots = []) {
  if (_dynamicEmbeddedRefsCache && (!searchRoots || searchRoots.length === 0)) {
    return _dynamicEmbeddedRefsCache;
  }

  const set = new Set(KNOWN_EMBEDDED_REFERENCE_SKILLS);
  const roots = [
    path.resolve(__dirname, '..', '.agents', 'skills'),
    path.resolve(__dirname, '..', 'src', 'templates', 'skills'),
    ...(Array.isArray(searchRoots) ? searchRoots : [searchRoots])
  ].filter(Boolean);

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    try {
      const entries = fs.readdirSync(root, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory() || !CANONICAL_SKILL_NAMES.has(e.name)) continue;
        const refDir = path.join(root, e.name, 'references');
        if (!fs.existsSync(refDir)) continue;

        const scanRefs = (dir) => {
          try {
            const sub = fs.readdirSync(dir, { withFileTypes: true });
            for (const item of sub) {
              if (item.isDirectory()) {
                scanRefs(path.join(dir, item.name));
              } else if (item.isFile() && item.name.endsWith('.md')) {
                const base = item.name.slice(0, -3);
                set.add(base);
              }
            }
          } catch (_) { /* best-effort */ }
        };
        scanRefs(refDir);
      }
    } catch (_) { /* best-effort */ }
  }

  if (!searchRoots || searchRoots.length === 0) {
    _dynamicEmbeddedRefsCache = set;
  }
  return set;
}

/**
 * Check if a skill name is an embedded reference in any ninja skill.
 */
function isEmbeddedReference(skillName) {
  if (!skillName || typeof skillName !== 'string') return false;
  const clean = skillName.trim().replace(/\/SKILL\.md$/, '').replace(/\.md$/, '');
  const base = path.basename(clean);
  const embeddedSet = getEmbeddedReferenceSkills();
  return embeddedSet.has(base) || embeddedSet.has(clean);
}

/**
 * Check if a skill name is one of the 16 canonical skills.
 */
function isCanonicalSkill(skillName) {
  if (!skillName || typeof skillName !== 'string') return false;
  const clean = path.basename(skillName.trim().replace(/\/SKILL\.md$/, '').replace(/\.md$/, ''));
  return CANONICAL_SKILL_NAMES.has(clean);
}

/**
 * Prune any directory from targetDir that is an embedded reference
 * (or stale non-canonical skill that has been consolidated into ninja references).
 * Strictly preserves canonical skills and genuine user-created custom skills.
 */
function pruneObsoleteStandaloneSkills(targetDir, _options = {}) {
  if (!fs.existsSync(targetDir)) return { pruned: 0, removed: [] };

  const embeddedSet = getEmbeddedReferenceSkills();
  const removed = [];

  try {
    const entries = fs.readdirSync(targetDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name.endsWith('.fingerprint')) continue;
      if (CANONICAL_SKILL_NAMES.has(e.name)) continue;

      const fullPath = path.join(targetDir, e.name);

      // If this directory/file name is in the embedded reference set, it was consolidated
      // into a ninja skill and MUST NOT exist as a standalone top-level folder.
      if (embeddedSet.has(e.name)) {
        try {
          fs.rmSync(fullPath, { recursive: true, force: true });
          removed.push(e.name);
        } catch (_) { /* best-effort */ }
      }
    }
  } catch (_) { /* best-effort */ }

  return { pruned: removed.length, removed };
}

module.exports = {
  CANONICAL_SKILL_NAMES,
  KNOWN_EMBEDDED_REFERENCE_SKILLS,
  getEmbeddedReferenceSkills,
  isEmbeddedReference,
  isCanonicalSkill,
  pruneObsoleteStandaloneSkills
};
