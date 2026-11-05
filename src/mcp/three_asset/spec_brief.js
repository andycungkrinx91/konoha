'use strict';

/**
 * Yamanaka 3D brief + critique stages: text-to-3D object briefs, image-derived
 * briefs, and vision critique of a multi-view render grid. Uses the shared
 * model router so routing/brief work stays cheap and critique can use a stronger
 * model with a byte-stable prompt cache key.
 */

const fs = require('fs');
const { resolveChatTargets, sendChatMessage } = require('./model_router');
const { extractLabelText, stripLabelText } = require('./spec_schema');
const { globalCircuitRegistry } = require('../../circuit_breaker');
const { countTiktoken } = require('../../token_sampler');

function sanitizeError(msg) {
  return String(msg || '').replace(/\s+/g, ' ').slice(0, 240);
}

function detectMimeType(filePath) {
  const lower = String(filePath || '').toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/png';
}

function computeTokenTelemetry(inputText, outputText, usage = null) {
  const providerInput = Number(usage && (usage.prompt_tokens ?? usage.input_tokens));
  const providerOutput = Number(usage && (usage.completion_tokens ?? usage.output_tokens));
  const input_tokens = Number.isFinite(providerInput) && providerInput > 0 ? providerInput : countTiktoken(inputText || '');
  const output_tokens = Number.isFinite(providerOutput) && providerOutput > 0 ? providerOutput : countTiktoken(outputText || '');
  const total_tokens = input_tokens + output_tokens;
  const est_cost_usd = Number((input_tokens * 0.000003 + output_tokens * 0.000015).toFixed(6));
  return { input_tokens, output_tokens, total_tokens, est_cost_usd, token_source: 'tokenizer_estimate' };
}

const PROMPT_CACHE_KEY = 'konoha-3d-system-v1';

const OBJECT_BRIEF_SYSTEM_PROMPT = `You are Yamanaka, the Konoha 3D prop analyst.
Return ONLY a raw JSON object (no markdown fence, no prose) with this exact schema:
{
  "components": [{ "name": string, "description": string,
                   "relative_bbox": { "w": number, "h": number, "d": number },
                   "material": string, "color": "#rrggbb" }],
  "real_world_dimensions_m": { "width_m": number, "height_m": number, "depth_m": number },
  "proportions": { "height_to_width_ratio": number, "notes": string },
  "materials": [string],
  "label_text": [string]
}
relative_bbox values are unitless fractions of the object's largest dimension.
label_text is ONLY surface branding/lettering and never describes geometry.`;

const CRITIQUE_SYSTEM_PROMPT = `You are Yamanaka QA, reviewing a multi-view render grid against a reference image.
Return ONLY raw JSON: { "score": 0-100, "issues": [{ "part": string, "problem": string,
"fix": { "axis": "size"|"position"|"material", "index": 0|1|2, "direction": "increase"|"decrease"|"move_positive"|"move_negative", "amount": number } }],
"summary": string }. Never invent parts that are not in the render.`;

function parseJsonLoose(text) {
  if (!text) return null;
  const trimmed = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { return null; }
    }
    return null;
  }
}

function normalizeBriefComponent(c) {
  return {
    name: String(c.name || 'component').slice(0, 64),
    description: String(c.description || '').slice(0, 240),
    relative_bbox: {
      w: Math.max(0.001, Number(c.relative_bbox?.w) || 0.2),
      h: Math.max(0.001, Number(c.relative_bbox?.h) || 0.2),
      d: Math.max(0.001, Number(c.relative_bbox?.d) || 0.2)
    },
    material: String(c.material || 'default').slice(0, 64),
    color: String(c.color || '#cbd5e1').slice(0, 9)
  };
}

function resolveHeightToWidthRatio(raw, dims) {
  if (Number(raw.proportions?.height_to_width_ratio) > 0) {
    return Number(raw.proportions.height_to_width_ratio);
  }
  if (Number(dims.height_m) > 0 && Number(dims.width_m) > 0) {
    return Number(dims.height_m) / Number(dims.width_m);
  }
  return 1;
}

function normalizeObjectBrief(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const components = Array.isArray(raw.components)
    ? raw.components.slice(0, 24).map(normalizeBriefComponent)
    : [];
  const dims = raw.real_world_dimensions_m || {};
  return {
    components,
    real_world_dimensions_m: {
      width_m: Math.max(0.001, Number(dims.width_m) || 1),
      height_m: Math.max(0.001, Number(dims.height_m) || 1),
      depth_m: Math.max(0.001, Number(dims.depth_m) || 1)
    },
    proportions: {
      height_to_width_ratio: resolveHeightToWidthRatio(raw, dims),
      notes: String(raw.proportions?.notes || '').slice(0, 240)
    },
    materials: Array.isArray(raw.materials) ? raw.materials.map((m) => String(m).slice(0, 64)).slice(0, 12) : [],
    label_text: Array.isArray(raw.label_text) ? raw.label_text.map((m) => String(m).slice(0, 64)).slice(0, 8) : []
  };
}

const ZERO_TOKENS = Object.freeze({ input_tokens: 0, output_tokens: 0, total_tokens: 0, est_cost_usd: 0.0 });

/**
 * Text-to-3D object brief: components, real-world dimensions, proportions and
 * materials authored before the scene spec. Failure returns null (pipeline then
 * behaves exactly as before).
 */
async function tryBriefTarget(target, userText, model, circuit) {
  try {
    const response = await sendChatMessage(target, {
      system: OBJECT_BRIEF_SYSTEM_PROMPT,
      userText,
      model: target.model || model,
      max_tokens: 1024,
      timeoutMs: 25000,
      cacheKey: PROMPT_CACHE_KEY
    });
    const brief = normalizeObjectBrief(parseJsonLoose(response.text));
    if (brief && brief.components.length > 0) {
      circuit.recordSuccess();
      return {
        brief,
        model_used: response.model_used,
        tokens: computeTokenTelemetry(userText, response.text, response.usage)
      };
    }
  } catch (err) {
    circuit.recordFailure();
    process.stderr.write(`[vision_spec] Object brief attempt failed: ${sanitizeError(err.message)}\n`);
  }
  return null;
}

async function generateObjectBrief(prompt, options = {}) {
  const archetype = options.archetype || 'auto';
  const model = options.model || null;
  const labels = extractLabelText(prompt);
  const shapePrompt = stripLabelText(prompt);
  const targets = resolveChatTargets({ ...options, model });
  if (targets.length === 0) {
    return { brief: null, model_used: null, tokens: { ...ZERO_TOKENS }, fallback_reason: 'No chat targets available' };
  }
  const circuit = globalCircuitRegistry.getOrCreate('yamanaka-3d-brief', 3, 60);
  if (!circuit.allowRequest()) {
    return { brief: null, model_used: null, tokens: { ...ZERO_TOKENS }, fallback_reason: 'Brief circuit breaker is OPEN' };
  }
  const userText = `Subject: "${shapePrompt}"
Resolved archetype: ${archetype}
${labels.length ? `Surface label text (texture only, never geometry): ${labels.join(', ')}` : ''}
Decompose the subject into its physical parts with relative proportions.`;
  for (const target of targets.slice(0, 2)) {
    const res = await tryBriefTarget(target, userText, model, circuit);
    if (res) return res;
  }
  return { brief: null, model_used: null, tokens: { ...ZERO_TOKENS }, fallback_reason: 'All brief targets failed' };
}

function buildObjectBriefFromAnalysis(analysis, _archetype) {
  if (!analysis || analysis.error) return null;
  const ratio = Number(analysis.aspect_ratio) > 0 ? Number(analysis.aspect_ratio) : 1;
  const colors = Array.isArray(analysis.dominant_colors) ? analysis.dominant_colors : [];
  return normalizeObjectBrief({
    components: [],
    real_world_dimensions_m: { width_m: 1, height_m: Number((1 / ratio).toFixed(3)) || 1, depth_m: 1 },
    proportions: {
      height_to_width_ratio: Number(analysis.height_to_width_ratio) > 0 ? analysis.height_to_width_ratio : Number((1 / ratio).toFixed(4)),
      notes: 'Derived from reference image silhouette bounding box.'
    },
    materials: colors.slice(0, 5),
    label_text: []
  });
}

async function tryCritiqueTarget(target, ctx) {
  try {
    const response = await sendChatMessage(target, {
      system: CRITIQUE_SYSTEM_PROMPT,
      userText: ctx.userText,
      imageBuffer: ctx.gridBuffer,
      mimeType: detectMimeType(ctx.gridPath),
      extraImages: ctx.referenceBuffer ? [{ buffer: ctx.referenceBuffer, mimeType: detectMimeType(ctx.referencePath) }] : [],
      model: target.model || ctx.model,
      max_tokens: 1024,
      timeoutMs: 30000,
      cacheKey: PROMPT_CACHE_KEY
    });
    const parsed = parseJsonLoose(response.text);
    if (parsed && Number.isFinite(Number(parsed.score))) {
      ctx.circuit.recordSuccess();
      return {
        critique: {
          score: Math.max(0, Math.min(100, Number(parsed.score))),
          issues: Array.isArray(parsed.issues) ? parsed.issues.slice(0, 12) : [],
          summary: String(parsed.summary || '').slice(0, 400)
        },
        model_used: response.model_used,
        tokens: computeTokenTelemetry(ctx.userText, response.text, response.usage)
      };
    }
  } catch (err) {
    ctx.circuit.recordFailure();
    process.stderr.write(`[vision_spec] Critique attempt failed: ${sanitizeError(err.message)}\n`);
  }
  return null;
}

async function critiqueRender(options = {}) {
  const { gridPath, referencePath, prompt = '', model = null, targets: presetTargets } = options;
  if (!gridPath || !fs.existsSync(gridPath)) {
    return { critique: null, model_used: null, tokens: { ...ZERO_TOKENS }, fallback_reason: 'No render grid' };
  }
  const targets = presetTargets || resolveChatTargets({ ...options, model });
  if (targets.length === 0) {
    return { critique: null, model_used: null, tokens: { ...ZERO_TOKENS }, fallback_reason: 'No vision targets available' };
  }
  const circuit = globalCircuitRegistry.getOrCreate('yamanaka-3d-critique', 3, 60);
  if (!circuit.allowRequest()) {
    return { critique: null, model_used: null, tokens: { ...ZERO_TOKENS }, fallback_reason: 'Critique circuit breaker is OPEN' };
  }
  const userText = `Subject: "${stripLabelText(prompt)}"
Compare the multi-view render grid (image 1) against the reference (image 2). Report proportions, symmetry and part placement defects.`;
  const ctx = {
    userText,
    gridPath,
    referencePath,
    gridBuffer: fs.readFileSync(gridPath),
    referenceBuffer: referencePath && fs.existsSync(referencePath) ? fs.readFileSync(referencePath) : null,
    model,
    circuit
  };
  for (const target of targets.slice(0, 2)) {
    const res = await tryCritiqueTarget(target, ctx);
    if (res) return res;
  }
  return { critique: null, model_used: null, tokens: { ...ZERO_TOKENS }, fallback_reason: 'All critique targets failed' };
}

module.exports = {
  PROMPT_CACHE_KEY,
  OBJECT_BRIEF_SYSTEM_PROMPT,
  CRITIQUE_SYSTEM_PROMPT,
  parseJsonLoose,
  normalizeObjectBrief,
  generateObjectBrief,
  buildObjectBriefFromAnalysis,
  critiqueRender
};
