'use strict';

/**
 * Refine-intent DSL for forking an existing asset.
 *
 * A refine prompt is parsed into an intent (`{ kind, tokens, scaleFactor, targets }`) whose
 * targets are verbatim node names of the parent spec. The intent is then applied by CLONING
 * the parent spec and patching ONLY the targeted node objects in place: every other field,
 * node and light of the parent survives byte-for-byte, because nothing is re-expressed.
 *
 * `compileRefineIntentToDsl` renders the applied spec into a Konoha DSL v1 script. That text
 * is PERSISTED PROVENANCE (human-readable record of the geometry input for a fork) and is
 * never parsed back to build the spec. e.g.
 *   "make the hull plate gold"  ->  `box 1.6 0.9 1.1 at 0 0.45 0 as hull_plate color #d4af37 metal 0.95 rough 0.22`
 *
 * Token values are chosen to survive `applyGenerationProfile` clamping for production_pbr
 * (metalness [0.5, 1.0], roughness [0.2, 0.9]).
 */

const INTRINSIC_TOKENS = Object.freeze({
  gold: { metalness: 0.95, roughness: 0.22, color: '#d4af37' },
  silver: { metalness: 0.95, roughness: 0.25, color: '#c0c0c0' },
  chrome: { metalness: 1, roughness: 0.2, color: '#e2e8f0' },
  copper: { metalness: 0.92, roughness: 0.35, color: '#b87333' },
  bronze: { metalness: 0.9, roughness: 0.4, color: '#a97142' },
  metallic: { metalness: 0.85, roughness: 0.3 },
  glossy: { metalness: 0.6, roughness: 0.2 },
  matte: { metalness: 0.55, roughness: 0.88 },
  shiny: { metalness: 0.6, roughness: 0.2 },
  emissive: { emissiveIntensity: 1.6 },
  glowing: { emissiveIntensity: 1.6 },
  translucent: { transmission: 0.6, roughness: 0.2 },
  transparent: { transmission: 0.6, roughness: 0.2 },
  red: { color: '#dc2626' },
  blue: { color: '#2563eb' },
  green: { color: '#16a34a' },
  yellow: { color: '#eab308' },
  purple: { color: '#7c3aed' },
  white: { color: '#f8fafc' },
  black: { color: '#0f172a' }
});

const TOKEN_ALIASES = Object.freeze({
  golden: 'gold',
  glowing: 'emissive',
  transparent: 'translucent',
  shiny: 'glossy',
  larger: 'bigger',
  huge: 'bigger',
  largerScale: 'bigger'
});

/** Scale factor tokens: every numeric part size on the targeted node is multiplied by the factor. */
const SCALE_TOKENS = Object.freeze({
  bigger: 1.25,
  huge: 1.6,
  smaller: 0.75,
  thinner: 0.7,
  wider: 1.2,
  taller: 1.25,
  shorter: 0.8
});

const ALL_TOKENS = [...new Set([...Object.keys(INTRINSIC_TOKENS), ...Object.keys(SCALE_TOKENS), ...Object.keys(TOKEN_ALIASES)])];
const SORTED_TOKENS = ALL_TOKENS.slice().sort((a, b) => b.length - a.length);
/**
 * Verbs/adjectives/qualifiers that are styling vocabulary, never part names. Without them
 * "recolor the lid" would strip "recolor" as an action but leave no expressible property, and
 * "make the lid gold" would try to match a part literally named "gold".
 */
const STYLE_WORDS = new Set([
  'make', 'turn', 'give', 'set', 'paint', 'style', 'color', 'colour', 'recolor', 'recolour', 'resize',
  'scale', 'apply', 'use', 'look', 'looking', 'like', 'want', 'should', 'would', 'just', 'some', 'please',
  'finish', 'surface', 'material', 'made', 'need', 'needs', 'needed', 'bit', 'much', 'very', 'more',
  'slightly', 'existing', 'all', 'every', 'whole', 'entire', 'it', 'its', 'this', 'that',
  ...ALL_TOKENS
]);
const STOPWORD_REGEX = new RegExp(`\\b(${[...STYLE_WORDS].join('|')})\\b`, 'gi');

const TARGET_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'with', 'for', 'on', 'in', 'into', 'from', 'as',
  'part', 'parts', 'piece', 'asset', 'model', 'out'
]);

const ADDITIVE_NODE_REGEX = /\b(add|create|attach|append|include|insert)\b/i;
const REMOVAL_NODE_REGEX = /\b(remove|delete|drop|erase)\b/i;
const HEX_REGEX = /#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/;

/** Properties a fork can actually express; quoted verbatim in every rejection message. */
const EXPRESSIBLE_PROPERTIES = 'color (a colour word or #hex), metalness/finish (metallic, chrome, gold, matte, glossy), '
  + 'roughness, or size (bigger, smaller, wider, taller, thinner, shorter, huge)';

function normalizeNodeName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function _round(value) {
  return Math.round(Number(value) * 10000) / 10000;
}

function _nodeSize(node) {
  const partSize = node && node.part && Array.isArray(node.part.size) ? node.part.size : null;
  if (partSize && partSize.length === 3 && partSize.every((v) => Number.isFinite(Number(v)) && Number(v) > 0)) {
    return partSize.map((v) => Math.min(2.8, Math.max(0.02, Number(v))));
  }
  return null;
}

function _primitiveForNode(node) {
  const raw = String((node && ((node.part && node.part.primitive) || (node.geometry && node.geometry.type))) || 'box');
  const normalized = raw === 'rounded_box' || raw === 'roundedbox' ? 'roundedBox' : raw;
  const allowed = new Set(['box', 'roundedBox', 'sphere', 'cylinder', 'cone', 'torus', 'capsule']);
  return allowed.has(normalized) ? normalized : 'box';
}

/** Geometry parameters per DSL primitive; `size` is [width, height, depth]. */
function _geometryTokens(primitive, size) {
  const [w, h, d] = size || [0.6, 0.6, 0.6];
  switch (primitive) {
    case 'sphere': return [String(_round(Math.max(w, h, d) / 2))];
    case 'cylinder': return [String(_round(w / 2)), String(_round(d / 2)), String(_round(h))];
    case 'cone': return [String(_round(w / 2)), String(_round(h))];
    case 'torus': return [String(_round(Math.max(w, d) / 2)), String(_round(Math.max(0.02, h / 4)))];
    case 'capsule': return [String(_round(Math.max(w, d) / 2)), String(_round(Math.max(0.02, h)))];
    default: return [String(_round(w)), String(_round(h)), String(_round(d))];
  }
}

/** Canonical DSL provenance tokens for a whole material. */
function _tokensFromMaterial(mat = {}) {
  const tokens = [
    'color', String(mat.color || '#6366f1'),
    'metal', String(_round(Number.isFinite(Number(mat.metalness)) ? mat.metalness : 0.5)),
    'rough', String(_round(Number.isFinite(Number(mat.roughness)) ? mat.roughness : 0.4))
  ];
  if (Number(mat.transmission) > 0) tokens.push('glass', '0.85');
  if (Number(mat.emissiveIntensity) > 0) {
    tokens.push('emissive', String(mat.emissive || mat.color || '#6366f1'), String(_round(mat.emissiveIntensity)));
  }
  return tokens;
}

/**
 * Applies the intent's tokens to a COPY of the node's material. Absent optional fields stay
 * absent so an unrelated part is never given a `transmission: 0` the parent did not have.
 */
function _materialForIntent(node, intent, forcedColor) {
  const material = (node && node.material && typeof node.material === 'object') ? node.material : {};
  const merged = { ...material };
  if (merged.color === undefined) merged.color = '#6366f1';
  if (!Number.isFinite(Number(merged.metalness))) merged.metalness = 0.5;
  if (!Number.isFinite(Number(merged.roughness))) merged.roughness = 0.4;
  for (const token of intent.tokens || []) {
    if (INTRINSIC_TOKENS[token]) Object.assign(merged, INTRINSIC_TOKENS[token]);
  }
  // An explicit #hex is the user's literal request and wins over incidental style tokens.
  if (intent.hexColor) merged.color = intent.hexColor;
  if (forcedColor) merged.color = forcedColor;
  return merged;
}

/** Resolves which parent node names the instruction names. */
function _resolveTargets(nodes, targetWords, rawText) {
  const available = nodes.map((n) => String(n.name));
  if (targetWords.length === 0) {
    if (nodes.length === 1) return { targets: available };
    return {
      error_code: 'REFINE_TARGET_AMBIGUOUS',
      error: `the instruction names no part; name the part to edit (available: ${available.slice(0, 24).join(', ')})`
    };
  }
  const normalizedWords = targetWords.map(normalizeNodeName).filter((w) => w.length > 0);
  const joined = normalizedWords.join('');
  const exact = available.filter((name) => {
    const norm = normalizeNodeName(name);
    return normalizedWords.includes(norm) || (joined.length > 2 && norm === joined);
  });
  const matched = exact.length > 0
    ? exact
    : available.filter((name) => {
      const norm = normalizeNodeName(name);
      return Boolean(norm) && normalizedWords.some((word) => norm.includes(word) || word.includes(norm));
    });
  if (matched.length === 0) {
    return {
      error_code: 'REFINE_TARGET_NOT_FOUND',
      error: `no part named "${targetWords.join(' ')}" exists on the parent asset (available: ${available.slice(0, 24).join(', ')})`
    };
  }
  const unique = [...new Set(matched)];
  if (unique.length > 1) {
    return {
      error_code: 'REFINE_TARGET_AMBIGUOUS',
      error: `"${rawText}" matches ${unique.length} parts (${unique.join(', ')}); name exactly one part to edit`
    };
  }
  return { targets: unique };
}

/**
 * Parses a user edit instruction into an intent: `{ kind, tokens, scaleFactor, targets }`
 * where targets are parent node names. Every failure is explicit and fail-closed:
 * no default token, no implicit all-node target, no multi-node guess.
 */
function parseRefineIntent(instruction, spec) {
  const text = String(instruction || '').trim();
  if (!text) return { error_code: 'REFINE_INSTRUCTION_REQUIRED', error: 'instruction is required' };
  const nodes = Array.isArray(spec && spec.nodes) ? spec.nodes.filter((n) => n && n.name) : [];
  if (nodes.length === 0) {
    return { error_code: 'PARENT_SPEC_MISSING', error: 'parent spec has no nodes to refine' };
  }

  const lower = text.toLowerCase();
  if (ADDITIVE_NODE_REGEX.test(lower)) {
    return {
      error_code: 'REFINE_INSTRUCTION_UNSUPPORTED',
      error: `additive part creation is not expressible when forking an existing asset; restyle or resize an existing part instead (${EXPRESSIBLE_PROPERTIES})`
    };
  }
  if (REMOVAL_NODE_REGEX.test(lower) && !/\bcolor\b/.test(lower)) {
    return {
      error_code: 'REFINE_INSTRUCTION_UNSUPPORTED',
      error: `part removal is not expressible when forking an existing asset; restyle or resize an existing part instead (${EXPRESSIBLE_PROPERTIES})`
    };
  }

  const tokens = [];
  for (const token of SORTED_TOKENS) {
    if (!new RegExp(`\\b${token}\\b`, 'i').test(lower)) continue;
    const canonical = TOKEN_ALIASES[token] || token;
    if (SCALE_TOKENS[token] !== undefined && !tokens.includes(token)) tokens.push(token);
    else if (INTRINSIC_TOKENS[canonical] && !tokens.includes(canonical)) tokens.push(canonical);
  }

  const hexMatch = text.match(HEX_REGEX);
  const hexColor = hexMatch ? `#${hexMatch[1].toLowerCase()}` : null;
  if (tokens.length === 0 && !hexColor) {
    return {
      error_code: 'REFINE_INSTRUCTION_UNSUPPORTED',
      error: `"${text.slice(0, 120)}" asks for no expressible property; a refine can change ${EXPRESSIBLE_PROPERTIES}`
    };
  }

  let scaleFactor = null;
  let scaleToken = null;
  for (const key of tokens) {
    if (SCALE_TOKENS[key] !== undefined) {
      scaleFactor = SCALE_TOKENS[key];
      scaleToken = key;
      break;
    }
  }

  // Strip the expressible vocabulary, then the finite style words: whatever survives is the
  // part name the user pointed at. An unknown adjective ("premium") survives and fails closed
  // only when it matches no node, so object prompts like "industrial coolant reactor" stay valid.
  const phrase = lower
    .replace(new RegExp(`\\b(${SORTED_TOKENS.join('|')})\\b`, 'gi'), ' ')
    .replace(new RegExp(HEX_REGEX.source, 'gi'), ' ')
    .replace(STOPWORD_REGEX, ' ')
    .replace(/\b\d+(\.\d+)?\b/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const targetWords = phrase.split(' ')
    .filter((w) => w.length > 2 && !TARGET_STOPWORDS.has(w) && !STYLE_WORDS.has(w));

  const resolved = _resolveTargets(nodes, targetWords, text);
  if (resolved.error_code) return resolved;

  return {
    kind: scaleFactor !== null ? 'resize' : 'restyle',
    tokens,
    scaleFactor,
    scaleToken,
    hexColor,
    targets: resolved.targets,
    instruction: text
  };
}

/**
 * Applies an intent to a CLONE of the parent spec. Only the resolved node objects are patched;
 * every other node, light and top-level field is carried over untouched. Throws when an intent
 * names an unresolvable target so a bad path can never degrade into a silent whole-spec rewrite.
 */
function applyIntentToSpec(intent, parentSpec) {
  const spec = structuredClone(parentSpec);
  const targetSet = new Set(intent.targets || []);
  const colorTokens = (intent.tokens || []).filter((t) => INTRINSIC_TOKENS[t] && INTRINSIC_TOKENS[t].color);
  const lastColorToken = colorTokens.length ? INTRINSIC_TOKENS[colorTokens[colorTokens.length - 1]].color : null;
  const scale = intent.kind === 'resize' && Number(intent.scaleFactor) > 0 ? Number(intent.scaleFactor) : null;
  let patched = 0;
  for (const node of spec.nodes || []) {
    if (!node || !targetSet.has(node.name)) continue;
    node.material = _materialForIntent(node, intent, null);
    if (lastColorToken && !intent.hexColor) node.material.color = lastColorToken;
    const size = scale ? _nodeSize(node) : null;
    if (size) node.part = { ...node.part, size: size.map((v) => _round(v * scale)) };
    patched += 1;
  }
  if (patched === 0) {
    throw new Error(`refine intent targets none of the spec nodes (${(intent.targets || []).join(', ')})`);
  }
  return spec;
}

/**
 * Renders a spec into a DSL v1 script for persistence. Provenance only: the returned text is
 * recorded on the job, never parsed back into the geometry input.
 */
function compileRefineIntentToDsl(intent, spec) {
  const lines = [
    `archetype ${String((spec && spec.archetype) || 'game-prop')}`,
    `polycount ${Number((spec && spec.target_polycount) || 50000)}`
  ];
  for (const node of (spec && spec.nodes) || []) {
    const primitive = _primitiveForNode(node);
    const size = _nodeSize(node) || [0.6, 0.6, 0.6];
    const pos = (node && node.transform && Array.isArray(node.transform.position)) ? node.transform.position : [0, 0, 0];
    const posStr = pos.slice(0, 3).map((v) => _round(Number(v) || 0)).join(' ');
    const material = _tokensFromMaterial(node && node.material);
    lines.push(`${primitive} ${_geometryTokens(primitive, size).join(' ')} at ${posStr} as ${node.name} ${material.join(' ')}`);
  }
  return lines.join('\n');
}

module.exports = {
  INTRINSIC_TOKENS,
  SCALE_TOKENS,
  EXPRESSIBLE_PROPERTIES,
  normalizeNodeName,
  parseRefineIntent,
  applyIntentToSpec,
  compileRefineIntentToDsl
};
