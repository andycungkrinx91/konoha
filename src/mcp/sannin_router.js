'use strict';

const { getSoul } = require('../persona_memory_soul');

/** Skills a delegated subagent receives; the rest stay discoverable on demand. */
const MAX_ENVELOPE_SKILLS = 4;
/** Soul behaviour kept verbatim in the envelope. */
const SOUL_SNIPPET_BYTES = 700;
/** Project-memory recalls attached to a delegated turn. */
const MAX_RECALL_ITEMS = 3;
const RECALL_SNIPPET_CHARS = 160;

const ROUTE_PREFIXES = [
  { token: 'direct:', mode: 'direct' },
  { token: '[direct]', mode: 'direct' },
  { token: 'delegate:', mode: 'delegate' },
  { token: '[delegate]', mode: 'delegate' },
  { token: 'pipeline:', mode: 'pipeline' },
  { token: '[pipeline]', mode: 'pipeline' }
];

const MUTATING_VERBS = [
  'add', 'apply', 'build', 'bump', 'change', 'connect', 'convert', 'create',
  'delete', 'deploy', 'drop', 'edit', 'enable', 'extend', 'fix', 'implement',
  'insert', 'install', 'migrate', 'move', 'patch', 'refactor', 'remove',
  'rename', 'replace', 'restore', 'rewrite', 'ship', 'split', 'update', 'wire'
];

/**
 * Work that needs an archetype even when the prompt is short: building,
 * migrating or restructuring something is not an inline edit.
 */
const HEAVY_VERBS = [
  'build', 'convert', 'create', 'deploy', 'extend', 'implement', 'install',
  'migrate', 'refactor', 'rewrite', 'ship', 'split', 'wire'
];

const READONLY_VERBS = [
  'check', 'describe', 'diagnose', 'explain', 'find', 'grep', 'inspect',
  'list', 'look', 'lookup', 'read', 'review', 'search', 'show', 'status',
  'summarize', 'trace', 'what', 'where', 'which', 'why'
];

const AMBIGUITY_TERMS = [
  'somehow', 'something', 'maybe', 'perhaps', 'etc', 'stuff', 'things',
  'whatever', 'somewhere', 'figure out', 'not sure'
];

const FILE_EXTENSIONS = 'js|jsx|ts|tsx|svelte|py|go|rs|java|rb|php|sql|md|json|ya?ml|css|html';
const FILE_PATTERN = new RegExp(`[\\w./-]+\\.(?:${FILE_EXTENSIONS})\\b`, 'gi');
const SLASH_PATH_PATTERN = /(?:^|\s)(?:\.{0,2}\/|(?:[\w.-]+\/){2,})[\w.-]*/g;

function buildWordPattern(words) {
  const escaped = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`\\b(?:${escaped.join('|')})\\b`, 'g');
}

const MUTATION_PATTERN = buildWordPattern(MUTATING_VERBS);
const HEAVY_PATTERN = buildWordPattern(HEAVY_VERBS);
const READONLY_PATTERN = buildWordPattern(READONLY_VERBS);
const AMBIGUITY_PATTERN = buildWordPattern(AMBIGUITY_TERMS);

function countMatches(lowerText, pattern) {
  pattern.lastIndex = 0;
  const hits = lowerText.match(pattern);
  pattern.lastIndex = 0;
  return hits ? hits.length : 0;
}

function detectExplicitRoute(prompt) {
  const head = prompt.toLowerCase();
  return ROUTE_PREFIXES.find((entry) => head.startsWith(entry.token)) || null;
}

/**
 * Turn a prompt into numbers the router can defend. Nothing here consults the
 * database, so the decision is reproducible and cheap on every turn.
 */
function scoreRouteSignals(prompt = '') {
  const text = typeof prompt === 'string' ? prompt.trim() : '';
  const lower = text.toLowerCase();
  const explicit = detectExplicitRoute(text);
  const fileHits = text.match(FILE_PATTERN) || [];
  const slashHits = text.match(SLASH_PATH_PATTERN) || [];
  const scopeHits = (lower.match(/\b(?:and|plus|also|then|both|across|every|all)\b/g) || []).length;
  const questionMarks = (text.match(/\?/g) || []).length;
  return {
    words: lower.split(/\s+/).filter(Boolean).length,
    chars: text.length,
    filePaths: fileHits.length,
    slashPaths: slashHits.length,
    mutationVerbs: countMatches(lower, MUTATION_PATTERN),
    heavyVerbs: countMatches(lower, HEAVY_PATTERN),
    readonlyVerbs: countMatches(lower, READONLY_PATTERN),
    scopeHits,
    ambiguity: countMatches(lower, AMBIGUITY_PATTERN),
    questionMarks,
    explicit: explicit ? explicit.mode : null
  };
}

function result(mode, confidence, reasons, signals) {
  return { mode, confidence: Math.round(confidence * 100) / 100, reasons, signals };
}

/**
 * Choose between answering with bounded MCP tools, handing the turn to one
 * subagent, or running the gated pipeline.
 */
function decideRoute({ prompt = '', executionTrack = 'fast_track', workstreams = [] } = {}) {
  const signals = scoreRouteSignals(prompt);
  if (signals.explicit) {
    return result(signals.explicit, 0.99, [`explicit ${signals.explicit} prefix`], signals);
  }

  const reasons = [];
  const spread = Math.max(signals.filePaths, signals.slashPaths);
  if (signals.ambiguity > 0) reasons.push(`${signals.ambiguity} ambiguity marker(s)`);
  if (spread > 0) reasons.push(`${spread} file path reference(s)`);
  if (signals.mutationVerbs > 0) reasons.push(`${signals.mutationVerbs} mutating verb(s)`);
  if (signals.readonlyVerbs > 0) reasons.push(`${signals.readonlyVerbs} read-only verb(s)`);
  if (signals.scopeHits > 0) reasons.push(`${signals.scopeHits} scope conjunction(s)`);
  if (signals.questionMarks > 0) reasons.push(`${signals.questionMarks} explicit question(s)`);

  const isReadOnlyTurn = signals.readonlyVerbs > 0
    && signals.mutationVerbs === 0
    && signals.ambiguity === 0
    && spread <= 3;
  if (isReadOnlyTurn) {
    return result('direct', 0.78, ['lookup turn, no mutation asked', ...reasons], signals);
  }

  const isSingleBoundedEdit = signals.mutationVerbs > 0
    && signals.heavyVerbs === 0
    && signals.mutationVerbs <= 2
    && spread <= 2
    && signals.words <= 24
    && signals.ambiguity === 0
    && signals.scopeHits <= 1;
  if (isSingleBoundedEdit) {
    return result('direct', 0.72, ['single bounded edit, small blast radius', ...reasons], signals);
  }

  const multiWorkstream = Array.isArray(workstreams) && workstreams.length > 1;
  const wideBlastRadius = signals.mutationVerbs >= 3 || spread >= 3;
  const gatedTrack = executionTrack === 'full_sdlc';
  if (gatedTrack && (multiWorkstream || wideBlastRadius)) {
    return result('pipeline', 0.84, ['multi-surface change needs gated plan', ...reasons], signals);
  }

  const isNarrowDelegate = signals.mutationVerbs > 0 && spread <= 2 && signals.ambiguity === 0;
  if (isNarrowDelegate) {
    return result('delegate', 0.7, ['focused change for one archetype', ...reasons], signals);
  }

  if (signals.words <= 8 && signals.mutationVerbs === 0) {
    return result('direct', 0.62, ['short turn, nothing to mutate', ...reasons], signals);
  }
  return result('delegate', 0.6, ['needs archetype judgement', ...reasons], signals);
}

function formatRouteLine(route) {
  if (!route) return '';
  const why = route.reasons && route.reasons.length > 0 ? ` — ${route.reasons.join('; ')}` : '';
  return `**Route Decision**: \`${route.mode}\` (confidence ${route.confidence})${why}\n`;
}

function coverBytes(text, maxBytes) {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  let out = text;
  while (Buffer.byteLength(out, 'utf8') > maxBytes) {
    out = out.substring(0, Math.max(0, out.length - 24));
  }
  return `${out.trimEnd()} …`;
}

/**
 * The soul is already loaded into the subagent prompt; the envelope only needs
 * the behaviour directive plus the archetype so the operator can see which
 * voice was bound. A missing soul is reported as missing, never faked.
 */
function buildSoulSnippet(agentName, projectPath) {
  try {
    const soul = getSoul({ agentName, projectPath });
    if (!soul) return '';
    const parts = [];
    if (typeof soul.behavior_directive === 'string' && soul.behavior_directive.trim()) {
      parts.push(soul.behavior_directive.trim());
    } else if (typeof soul.will_of_fire === 'string' && soul.will_of_fire.trim()) {
      parts.push(soul.will_of_fire.trim());
    }
    if (Array.isArray(soul.tenets) && soul.tenets.length > 0) {
      parts.push(soul.tenets.slice(0, 2).join(' · '));
    }
    if (parts.length === 0) return '';
    return coverBytes(parts.join(' — '), SOUL_SNIPPET_BYTES);
  } catch (_) {
    return '';
  }
}

function buildRecallSnippet(agentName, projectPath, query) {
  try {
    const { queryProjectMemory } = require('./memory_project_context');
    const raw = queryProjectMemory(query, projectPath, agentName, null, MAX_RECALL_ITEMS);
    const parsed = JSON.parse(raw);
    const memories = Array.isArray(parsed.memories) ? parsed.memories.slice(0, MAX_RECALL_ITEMS) : [];
    return memories.map((m) => {
      const snippet = (m.content || '').replace(/\s+/g, ' ').trim().substring(0, RECALL_SNIPPET_CHARS);
      return `- [${m.memory_type || 'memory'}] ${m.title || 'untitled'}: ${snippet}`;
    });
  } catch (_) {
    return [];
  }
}

/**
 * Everything a delegated subagent needs to start without a discovery turn:
 * bounded skills, its own soul, and project recall.
 */
function buildDelegationEnvelope({ agentName, projectPath, prompt = '', routedSkills = [] } = {}) {
  const skills = Array.isArray(routedSkills) ? routedSkills.slice(0, MAX_ENVELOPE_SKILLS) : [];
  const droppedSkills = Array.isArray(routedSkills)
    ? routedSkills.filter((s) => !skills.includes(s))
    : [];
  const soul = buildSoulSnippet(agentName, projectPath);
  const recall = buildRecallSnippet(agentName, projectPath, prompt);
  const lines = [];
  lines.push(`### Delegation Envelope for \`${agentName}\``);
  lines.push(`- Bound skills (${skills.length}/${MAX_ENVELOPE_SKILLS}): ${skills.length > 0 ? skills.map((s) => `\`${s}\``).join(', ') : 'soul-bound defaults only'}`);
  if (droppedSkills.length > 0) {
    lines.push(`- On-demand skills (load with \`konoha.use_skills\` only if needed): ${droppedSkills.map((s) => `\`${s}\``).join(', ')}`);
  }
  lines.push(`- Soul excerpt: ${soul ? soul.replace(/\n+/g, ' | ') : 'unavailable — follow the inlined discipline contract'}`);
  if (recall.length > 0) {
    lines.push(`- Project recall (${recall.length} item(s)):`);
    lines.push(recall.join('\n'));
  } else {
    lines.push('- Project recall: none recorded for this project yet');
  }
  return {
    agent: agentName,
    skills,
    dropped_skills: droppedSkills,
    soul: soul || null,
    recall,
    text: lines.join('\n')
  };
}

function buildDirectGuidance({ skills = [], projectPath = null } = {}) {
  const bounded = Array.isArray(skills) ? skills.slice(0, MAX_ENVELOPE_SKILLS) : [];
  return (
    '\n\n### ⚡ Direct Execution (no subagent spawn)\n' +
    '- This turn is small enough to finish inline. Do NOT spawn a subagent for it.\n' +
    '- Read with `konoha.read_file_range` / `konoha.token_efficient_grep` / `konoha.get_file_structure` instead of whole-file reads.\n' +
    '- Locate files with `konoha.find_files_clean`; never run a recursive shell grep over the repository.\n' +
    (bounded.length > 0 ? `- Load only the skills this turn needs: ${bounded.map((s) => `\`${s}\``).join(', ')}.\n` : '') +
    `- Project: \`${projectPath || process.cwd()}\`. Report the result with command evidence, not a summary of intent.\n` +
    '- If the work turns out to touch more than two files, stop and re-route through `sannin` with `pipeline:` so the gates apply.'
  );
}

module.exports = {
  MAX_ENVELOPE_SKILLS,
  MAX_RECALL_ITEMS,
  SOUL_SNIPPET_BYTES,
  RECALL_SNIPPET_CHARS,
  ROUTE_PREFIXES,
  scoreRouteSignals,
  decideRoute,
  formatRouteLine,
  buildDelegationEnvelope,
  buildDirectGuidance
};
