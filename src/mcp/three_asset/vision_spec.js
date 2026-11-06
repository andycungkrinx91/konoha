'use strict';

/**
 * Inherited-Model Vision-to-DSL Synthesizer for Konoha 3D Pipeline.
 * Enterprise Realistic PBR contracts guarded by Circuit Breaker.
 */

const fs = require('fs');
const path = require('path');
const { resolveChatTargets, sendChatMessage } = require('./model_router');
const {
  createDefaultSceneSpec,
  resolveEffectiveArchetype,
  customizeSpecFromPrompt,
  parseTurnaroundIntent,
  extractLabelText,
  stripLabelText
} = require('./spec_schema');
const { synthesizeSceneFromPrompt } = require('./prompt_synthesizer');
const { parseTailCount } = require('./creature_synthesizer');
const { detailParts } = require('./part_library');
const {
  PROMPT_CACHE_KEY,
  generateObjectBrief,
  buildObjectBriefFromAnalysis,
  critiqueRender,
  normalizeObjectBrief,
  alignSpecToBriefRatio
} = require('./spec_brief');
const { parseKonohaDSL, specToDSL } = require('./dsl_parser');
const { globalCircuitRegistry } = require('../../circuit_breaker');
const { countTiktoken } = require('../../token_sampler');

function sanitizeError(msg) {
  return String(msg || '')
    .replace(/sk-[a-zA-Z0-9_-]{8,}/g, '[REDACTED]')
    .replace(/\$\$[A-Z0-9_]+:[A-Z0-9_]+\$\$/g, '[REDACTED]')
    .replace(/(?:key|token|auth|bearer|credential)[:\s=]+[^\s,;"']+/gi, '$1: [REDACTED]');
}

let cachedDslSkillPrompt = null;
function getDslSkillPrompt() {
  if (cachedDslSkillPrompt) return cachedDslSkillPrompt;
  const skillPath = path.join(__dirname, '..', '..', 'templates', 'skills', 'yamanaka-skill', 'references', 'konoha-3d-dsl.md');
  let skillText = '';
  try {
    if (fs.existsSync(skillPath)) {
      skillText = fs.readFileSync(skillPath, 'utf8');
      skillText = skillText.replace(/^---[\s\S]*?---\n*/, '').trim();
    }
  } catch { /* intentional best-effort fallback: spec generation degrades to the deterministic path */ }

  cachedDslSkillPrompt = `You are Yamanaka, the Konoha elite 3D architectural sculptor and generative shinobi.
You construct complete, production-grade 3D assets strictly adhering to the Konoha 3D mini-DSL skill specification.

=== AUTHORITATIVE KONOHA 3D DSL SKILL SPECIFICATION ===
${skillText}
=== END SKILL SPECIFICATION ===

=== ENTERPRISE & PHOTOREALISTIC 3D STUDIO SPECIFICATION CONTRACT ===
1. OUTPUT: Output ONLY the raw Konoha 3D DSL script or clean JSON scene spec. Never include markdown conversational filler.
2. GEOMETRY & CURVATURE:
   - Use high-segment curved and chamfered geometries (capsule, lathe, cylinder with radialSegments >= 32, sphere 48x32, torus, roundedBox).
   - Construct cohesive, multi-part assemblies with realistic anatomical proportions and functional engineering components.
3. PHYSICAL MATERIALS (MeshPhysicalMaterial):
   - Full metallic range [0.0, 1.0]: polished chrome, titanium, aluminum, satin gold.
   - Micro-roughness [0.01, 0.98]: smooth optical glass, brushed metals, matte polymer.
   - Clearcoat up to 1.0 for car paint, lacquered carbon fiber, and glazed ceramics.
   - Transmission up to 1.0 with realistic IOR (1.45 to 1.58) for glass and crystals.
   - Emissive glow [0.0, 8.0] for optical sensors, HUD indicators, and laser lines.
4. GROUNDING & SCALE:
   - Lowest part MUST touch ground at y=0 (min_y = 0).
   - Aggregate dimensions must fit inside a 3.0 x 3.0 x 3.0 bounding extent.
   - Symmetrically balanced or dynamically centered around x=0.
5. COMPONENT HIERARCHY:
   - Include 14 to 32 detailed, layered subcomponents (primary hull/body, secondary structural tiers, bevel trims, inset panels/windows, vents, surface hardware, emissive accents, grounded base at y=0). Keep output concise with zero comments.
6. ORGANIC & CREATURE ANATOMY:
   - For creatures/quadrupeds build full anatomy: ribcage, spine, pelvis, neck, skull, muzzle, jaw, eyes (with pupil), ears, and 4 articulated limbs whose paws touch y=0.
   - Every separate tail plume must be its own named node (tail_1 ... tail_N) radially fanned so they never overlap in any orthographic view.
7. MATERIAL EXTENSION: physical materials also accept sheen [0..1], sheenRoughness [0..1], sheenColor hex, and subsurface [0..1] for fur, velvet and skin.
8. If the prompt asks for turnaround / orthographic reference views, include: "turnaround": { "enabled": true, "views": ["front","side","back","top"], "aspectRatio": "16:9", "background": "#d4d4d8", "flatStudioLighting": true, "noShadows": true }.`;

  return cachedDslSkillPrompt;
}

const DSL_SYSTEM_PROMPT = getDslSkillPrompt();

function detectMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.webp') return 'image/webp';
  return 'application/octet-stream';
}

function degToRad(value) {
  return typeof value === 'number' ? (value * Math.PI) / 180 : 0;
}

function normalizeRotation(rotation) {
  if (!Array.isArray(rotation)) return [0, 0, 0];
  return rotation.map((v) => (Math.abs(v) > Math.PI * 2 + 0.001 ? degToRad(v) : Number(v) || 0));
}

function inferMaterialFromName(name) {
  const lower = String(name || '').toLowerCase();
  const isMetal = /metal|steel|chrome|titanium|iron|aluminum|gold|brass|copper/.test(lower);
  const isGlow = /glow|neon|hologram|laser|emissive|plasma|led|cyan/.test(lower);
  let color = '#94a3b8';
  if (/^#[0-9a-f]{3,8}$/i.test(lower)) color = lower;
  else if (/black|obsidian|dark|carbon/.test(lower)) color = '#1e293b';
  else if (/white|pearl|ceramic/.test(lower)) color = '#f8fafc';
  else if (/cyan|hologram|holo|blue/.test(lower)) color = '#38bdf8';
  else if (/gold|brass|amber/.test(lower)) color = '#f59e0b';
  else if (/red|crimson|ruby/.test(lower)) color = '#ef4444';
  const mat = {
    type: 'physical',
    color,
    roughness: isMetal ? 0.25 : 0.45,
    metalness: isMetal ? 0.85 : 0.2
  };
  if (isGlow) {
    mat.emissive = color;
    mat.emissiveIntensity = 2.0;
  }
  return mat;
}

function resolveNodeMaterial(node, materialTable) {
  const ref = node && node.material;
  if (ref && typeof ref === 'object') return ref;
  if (typeof ref === 'string') {
    if (materialTable && materialTable[ref] && typeof materialTable[ref] === 'object') {
      const entry = { ...materialTable[ref] };
      if (!entry.type) entry.type = 'physical';
      return entry;
    }
    return inferMaterialFromName(ref);
  }
  return { type: 'physical', color: '#94a3b8', roughness: 0.5, metalness: 0.2 };
}

function extractNodeGeometry(raw) {
  if (raw.geometry && typeof raw.geometry === 'object' && raw.geometry.type) {
    const params = { ...raw.geometry.params };
    for (const [k, v] of Object.entries(raw.geometry)) {
      if (k !== 'type' && k !== 'params') params[k] = v;
    }
    return { type: raw.geometry.type, params };
  }
  const fallbackType = raw.type || raw.primitive;
  if (typeof fallbackType === 'string') {
    const params = { ...raw.params };
    if (Array.isArray(raw.size)) params.size = raw.size;
    if (typeof raw.radius === 'number') params.radius = raw.radius;
    if (typeof raw.height === 'number') params.height = raw.height;
    return { type: fallbackType, params };
  }
  return null;
}

function flattenNodeTree(rawNodes, materialTable, out = [], inherited = [0, 0, 0]) {
  for (const raw of Array.isArray(rawNodes) ? rawNodes : []) {
    if (!raw || typeof raw !== 'object') continue;
    const rawPos = raw.position || raw.transform?.position;
    const localPos = Array.isArray(rawPos) ? rawPos.map(Number) : [0, 0, 0];
    const worldPos = [
      inherited[0] + (localPos[0] || 0),
      inherited[1] + (localPos[1] || 0),
      inherited[2] + (localPos[2] || 0)
    ];
    const geom = extractNodeGeometry(raw);
    const nodeName = String(raw.id || raw.name || `node_${out.length}`).replace(/[^a-zA-Z0-9_-]/g, '_');
    if (geom) {
      const rawRot = raw.rotation || raw.transform?.rotation;
      const rawScale = raw.scale || raw.transform?.scale;
      out.push({
        name: nodeName,
        geometry: geom,
        material: resolveNodeMaterial(raw, materialTable),
        transform: {
          position: worldPos,
          rotation: normalizeRotation(rawRot),
          scale: Array.isArray(rawScale) ? rawScale.map(Number) : [1, 1, 1]
        }
      });
    }
    if (Array.isArray(raw.children)) flattenNodeTree(raw.children, materialTable, out, worldPos);
  }
  return out;
}

function structuralJsonToSpec(parsedJson) {
  const asset = parsedJson.asset && typeof parsedJson.asset === 'object' ? parsedJson.asset : {};
  const nodes = flattenNodeTree(parsedJson.nodes, parsedJson.materials || {});
  if (nodes.length === 0) return null;
  const spec = {
    name: asset.name || parsedJson.name || 'SynthesizedAsset',
    archetype: String(asset.archetype || parsedJson.archetype || asset.class || 'application').toLowerCase(),
    target_polycount: parsedJson.target_polycount || 50000,
    camera: parsedJson.camera,
    lights: parsedJson.lights,
    style: parsedJson.style,
    turnaround: parsedJson.turnaround,
    nodes
  };
  if (/quadruped|creature/i.test(String(asset.class || ''))) spec.archetype = 'game-creature';
  return spec;
}

function normalizeSpecNodeMaterials(spec, materialTable = {}) {
  if (!spec || !Array.isArray(spec.nodes)) return spec;
  for (const node of spec.nodes) {
    if (node && typeof node === 'object') {
      node.material = resolveNodeMaterial(node, materialTable);
    }
  }
  return spec;
}

function parseDslOrJson(text) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();

  try {
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsedJson = JSON.parse(jsonMatch[0]);
      if (parsedJson && Array.isArray(parsedJson.nodes) && parsedJson.nodes.length > 0) {
        const structural = structuralJsonToSpec(parsedJson);
        if (structural) return { spec: structural, dsl: null };
      }
      if (parsedJson && parsedJson.nodes) {
        const rawSpec = parsedJson.spec || parsedJson;
        return { spec: normalizeSpecNodeMaterials(rawSpec, parsedJson.materials || {}), dsl: null };
      }
    }
  } catch { /* intentional best-effort fallback: spec generation degrades to the deterministic path */ }

  try {
    const cleanDsl = trimmed.replace(/^```[a-zA-Z0-9_-]*\n?/m, '').replace(/\n?```$/m, '').trim();
    const dslResult = parseKonohaDSL(cleanDsl);
    const spec = dslResult && (dslResult.spec || dslResult);
    if (spec && Array.isArray(spec.nodes) && spec.nodes.length > 0) {
      return { spec: normalizeSpecNodeMaterials(spec), dsl: cleanDsl };
    }
  } catch { /* intentional best-effort fallback: spec generation degrades to the deterministic path */ }

  return null;
}

function computeTokenTelemetry(inputText, outputText, usage = null) {
  if (usage && usage.prompt_tokens !== undefined) {
    const input_tokens = usage.prompt_tokens || 0;
    const output_tokens = usage.completion_tokens || 0;
    const total_tokens = usage.total_tokens || (input_tokens + output_tokens);
    const est_cost_usd = usage.cost || (input_tokens * 0.000003 + output_tokens * 0.000015);
    return { input_tokens, output_tokens, total_tokens, est_cost_usd, token_source: 'provider_usage' };
  }

  const input_tokens = countTiktoken(inputText || '');
  const output_tokens = countTiktoken(outputText || '');
  const total_tokens = input_tokens + output_tokens;
  const est_cost_usd = Number((input_tokens * 0.000003 + output_tokens * 0.000015).toFixed(6));
  return { input_tokens, output_tokens, total_tokens, est_cost_usd, token_source: 'tokenizer_estimate' };
}

function makeFallbackImageResult(archetype, name, modelUsed, reason) {
  return {
    spec: createDefaultSceneSpec(archetype, name),
    source: reason === 'No image provided' ? 'procedural_default' : 'procedural_fallback',
    model_used: modelUsed,
    fallback_reason: reason,
    tokens: { input_tokens: 0, output_tokens: 0, total_tokens: 0, est_cost_usd: 0.0 }
  };
}

async function tryImageVisionTarget(target, ctx) {
  try {
    const response = await sendChatMessage(target, {
      system: DSL_SYSTEM_PROMPT,
      userText: ctx.userText,
      imageBuffer: ctx.imageBuffer,
      mimeType: ctx.mimeType,
      model: target.model || ctx.requestedModel,
      max_tokens: 12288,
      timeoutMs: 90000,
      cacheKey: PROMPT_CACHE_KEY
    });
    const parsed = parseDslOrJson(response.text);
    if (parsed) {
      ctx.circuit.recordSuccess();
      const enriched = alignSpecToBriefRatio(await enrichSynthesizedSpec(ctx.prompt || ctx.name, parsed.spec, ctx.name, ctx.targetPolycount, ctx.effectiveArch), ctx.brief);
      return { spec: enriched, dsl: parsed.dsl, source: 'vision', model_used: response.model_used, tokens: computeTokenTelemetry(ctx.userText, response.text, response.usage) };
    }
  } catch (err) {
    ctx.circuit.recordFailure();
    process.stderr.write(`[vision_spec] Vision target attempt failed: ${sanitizeError(err.message)}\n`);
  }
  return null;
}

async function generateSceneSpecFromImage(options = {}) {
  const { image_path: imagePath, prompt = '', name = 'HeroModel', archetype = 'application', model: requestedModel = null, target_polycount = 50000, object_brief: brief = null } = options;
  if (!imagePath || !fs.existsSync(imagePath)) return makeFallbackImageResult(archetype, name, 'default', 'No image provided');
  const circuit = globalCircuitRegistry.getOrCreate('yamanaka-llm-synthesis', 3, 60);
  if (!circuit.allowRequest()) return makeFallbackImageResult(archetype, name, 'circuit-breaker-open', 'LLM synthesis circuit breaker is OPEN');
  const targets = resolveChatTargets(options);
  if (targets.length === 0) return makeFallbackImageResult(archetype, name, 'threejs-procedural-engine', 'No vision targets available');

  const effectiveArch = resolveEffectiveArchetype(prompt || name, archetype);
  const refAnalysis = options.reference_analysis && !options.reference_analysis.error ? options.reference_analysis : null;
  const analysisHint = refAnalysis ? ` Reference metrics: height/width ratio ${refAnalysis.height_to_width_ratio}, symmetry ${refAnalysis.symmetry_x_score}, palette ${(refAnalysis.dominant_colors || []).join(' ')}.` : '';
  const promptHint = prompt ? ` User Prompt: "${prompt}".` : '';
  const userText = `Examine this reference image.${promptHint} Deconstruct its 3D form, layered subcomponents, PBR materials, and silhouette into a production-grade Konoha 3D DSL script (16-32 nodes). Name: ${name}, Archetype: ${effectiveArch}, Polycount: ${target_polycount}.${analysisHint} Output raw DSL only.`;
  const ctx = { prompt, name, targetPolycount: target_polycount, effectiveArch, brief, userText, imageBuffer: fs.readFileSync(imagePath), mimeType: detectMimeType(imagePath), requestedModel, circuit };
  for (const target of targets.slice(0, 2)) {
    const res = await tryImageVisionTarget(target, ctx);
    if (res) return res;
  }
  return makeFallbackImageResult(effectiveArch, name, 'default', 'All vision targets failed or returned invalid DSL');
}

function countTailNodes(spec) {
  if (!spec || !Array.isArray(spec.nodes)) return 0;
  const ids = new Set();
  for (const n of spec.nodes) {
    const m = String(n.name || '').match(/tail[_-]?(\d+)/i);
    if (m) ids.add(m[1]);
  }
  return ids.size;
}

async function enrichSynthesizedSpec(prompt, spec, name, targetPolycount, requestedArchetype) {
  const tailCount = parseTailCount(prompt);
  const nodeCount = spec && Array.isArray(spec.nodes) ? spec.nodes.length : 0;
  const needsCreature = spec && spec.archetype === 'game-creature';
  const sparse = nodeCount < 18 || (tailCount > 1 && countTailNodes(spec) < tailCount);
  if (needsCreature && sparse) {
    const richer = synthesizeSceneFromPrompt(prompt, name, targetPolycount, requestedArchetype);
    if (richer && richer.archetype === 'game-creature' && richer.nodes.length > nodeCount) {
      return richer;
    }
  }
  if (needsCreature || !spec) return spec;

  const targetArch = String(requestedArchetype || spec.archetype || 'application').toLowerCase();
  if ((!spec.archetype || spec.archetype === 'application') && targetArch !== 'application') {
    spec.archetype = targetArch;
  }
  let baseline = null;
  try {
    baseline = createDefaultSceneSpec(targetArch, name, targetPolycount);
  } catch { /* intentional best-effort fallback: an unknown archetype simply skips the floor */ }
  const floor = baseline && Array.isArray(baseline.nodes) ? baseline.nodes.length : 0;
  if (floor > spec.nodes.length) {
    const needed = floor - spec.nodes.length;
    spec.nodes.push(...detailParts(spec.nodes.length + needed, spec.nodes));
  }
  return spec;
}

function resolveComponentPrimitive(desc, w, h, d) {
  if (/\b(lid|dome|cap|sphere|bulb|orb)\b/.test(desc)) {
    return {
      primitive: 'sphere',
      params: { radius: Math.max(w, d) * 0.5, widthSegments: 32, heightSegments: 24, size: [w, h, d] }
    };
  }
  if (/\b(ring|handle|torus|rim|halo)\b/.test(desc)) {
    return {
      primitive: 'torus',
      params: { radius: Math.max(w, d) * 0.45, tube: Math.max(0.025, h * 0.35), radialSegments: 16, tubularSegments: 32, size: [w, h, d] }
    };
  }
  if (/\b(body|pot|cylinder|housing|base|vent|hinge|barrel|column|pillar)\b/.test(desc)) {
    return {
      primitive: 'cylinder',
      params: { radiusTop: w * 0.5, radiusBottom: d * 0.48, height: h, radialSegments: 32, size: [w, h, d] }
    };
  }
  return {
    primitive: 'roundedBox',
    params: { width: w, height: h, depth: d, size: [w, h, d] }
  };
}

function resolveBriefPlacement({ index: i, description: desc, height: h, depth: d, cursorY, mainDims }) {
  if (i === 0) return { pos: [0, Number((h * 0.5).toFixed(4)), 0], nextY: h };
  if (/\b(window|facade|glazing|screen|display|panel|grille)\b/.test(desc)) {
    return { pos: [0, Number((mainDims[1] * 0.58).toFixed(4)), Number((mainDims[2] * 0.5 + d * 0.25).toFixed(4))], nextY: cursorY };
  }
  if (/\b(canopy|entrance|door|porch|awning)\b/.test(desc)) {
    return { pos: [0, Number((Math.min(mainDims[1] * 0.28, h * 0.6)).toFixed(4)), Number((mainDims[2] * 0.5 + d * 0.45).toFixed(4))], nextY: cursorY };
  }
  if (/\b(sign|signage|cross|emblem|logo|badge)\b/.test(desc)) {
    return { pos: [0, Number((mainDims[1] * 0.86).toFixed(4)), Number((mainDims[2] * 0.5 + d * 0.35).toFixed(4))], nextY: cursorY };
  }
  const yCenter = Number((cursorY + h * 0.5).toFixed(4));
  return { pos: [0, yCenter, 0], nextY: cursorY + h * 0.88 };
}

function specFromBriefComponents(brief, name, effectiveArch, targetPolycount) {
  if (!brief || !Array.isArray(brief.components) || brief.components.length === 0) return null;
  const nodes = [];
  let cursorY = 0;
  let mainDims = [1.0, 1.0, 1.0];
  for (let i = 0; i < brief.components.length; i++) {
    const comp = brief.components[i] || {};
    const bbox = comp.relative_bbox || {};
    const w = Math.max(0.08, Math.min(2.4, Number(bbox.w) || 0.6));
    const h = Math.max(0.06, Math.min(2.4, Number(bbox.h) || 0.35));
    const d = Math.max(0.08, Math.min(2.4, Number(bbox.d) || w));
    if (i === 0) mainDims = [w, h, d];
    const desc = `${comp.name || ''} ${comp.description || ''}`.toLowerCase();
    const { primitive, params } = resolveComponentPrimitive(desc, w, h, d);
    const { pos, nextY } = resolveBriefPlacement({ index: i, description: desc, height: h, depth: d, cursorY, mainDims });
    cursorY = nextY;
    const matText = String(comp.material || '').toLowerCase();
    const isMetal = /metal|steel|chrome|aluminum|iron|brass/.test(matText);
    const nodeName = String(comp.name || `part_${i + 1}`).replace(/[^a-zA-Z0-9_-]/g, '_');
    nodes.push({
      name: nodeName,
      part: {
        primitive,
        size: [w, h, d],
        position: pos,
        parent: i > 0 ? nodes[0].name : null,
        modifiers: { bevel: 0.02 }
      },
      geometry: { type: primitive, params },
      material: {
        type: 'physical',
        color: typeof comp.color === 'string' && comp.color.startsWith('#')
          ? comp.color
          : (i % 2 === 0 ? '#cbd5e1' : '#334155'),
        roughness: isMetal ? 0.22 : 0.38,
        metalness: isMetal ? 0.82 : 0.18,
        clearcoat: 0.35,
        ...(/\b(illuminat|neon|glow|beacon|led|light)\b/.test(desc) ? { emissive: comp.color || '#38bdf8', emissiveIntensity: 2.2 } : {})
      },
      transform: { position: pos, rotation: [0, 0, 0], scale: [1, 1, 1] }
    });
  }
  if (nodes.length < 8) {
    nodes.push(...detailParts(8, nodes));
  }
  const distinct = new Set(nodes.map((n) => String(n.material?.color || '').toLowerCase()).filter(Boolean));
  if (distinct.size < 2 && nodes.length >= 2) {
    nodes[nodes.length - 1].material.color = distinct.has('#38bdf8') ? '#f59e0b' : '#38bdf8';
  }
  return {
    name: name || 'BriefSynthesizedAsset',
    archetype: effectiveArch || 'game-prop',
    target_polycount: targetPolycount || 12000,
    camera: { position: [0, Math.max(1.2, cursorY * 0.8), 2.8], fov: 40, target: [0, cursorY * 0.45, 0] },
    lights: [
      { type: 'ambient', color: '#ffffff', intensity: 0.85 },
      { type: 'directional', color: '#fef08a', intensity: 2.2, position: [3, 5, 4] },
      { type: 'point', color: '#38bdf8', intensity: 1.4, position: [-2, 2, 2] }
    ],
    nodes
  };
}

function assembleSpec(prompt, name, targetPolycount, ...archArgs) {
  const [effectiveArch, requestedArchetype, brief = null] = archArgs;
  const semanticSpec = synthesizeSceneFromPrompt(prompt, name, targetPolycount, requestedArchetype);
  const briefSpec = !semanticSpec ? specFromBriefComponents(brief, name, effectiveArch, targetPolycount) : null;
  const fallbackSpec = semanticSpec || briefSpec || createDefaultSceneSpec(effectiveArch, name);
  if (fallbackSpec && fallbackSpec.nodes && (semanticSpec || briefSpec)) {
    fallbackSpec.archetype = (semanticSpec || briefSpec).archetype || effectiveArch;
  }
  customizeSpecFromPrompt(fallbackSpec, prompt, targetPolycount);
  if (fallbackSpec) {
    fallbackSpec.__prompt = prompt;
    fallbackSpec.turnaround = parseTurnaroundIntent(prompt, fallbackSpec.turnaround);
    alignSpecToBriefRatio(fallbackSpec, brief);
  }
  return fallbackSpec;
}

function makeScaffoldedResult(fallbackSpec, fallbackReason) {
  return {
    spec: fallbackSpec,
    source: 'scaffolded_dsl',
    dsl: specToDSL(fallbackSpec),
    model_used: 'scaffolded-dsl-engine',
    fallback_reason: fallbackReason,
    tokens: { input_tokens: 0, output_tokens: 0, total_tokens: 0, est_cost_usd: 0.0 }
  };
}

function buildPromptSynthesisUserText(prompt, name, effectiveArch, targetPolycount, brief) {
  const turnaroundIntent = parseTurnaroundIntent(prompt, null);
  const labelText = extractLabelText(prompt);
  const shapePrompt = stripLabelText(prompt);
  const briefBlock = brief
    ? `\nObject Brief (authoritative proportions): ${JSON.stringify({ components: brief.components, real_world_dimensions_m: brief.real_world_dimensions_m, proportions: brief.proportions, materials: brief.materials })}`
    : '';
  const labelBlock = labelText.length
    ? `\nBrand/label text (surface texture text only, never geometry): ${labelText.join(', ')}`
    : '';
  return `Prompt Concept: "${shapePrompt}".${briefBlock}${labelBlock}
Resolved Archetype: ${effectiveArch}
Target Polycount: ${target_polycount_val(targetPolycount)}
Asset Name: ${name}
Turnaround Reference Requested: ${turnaroundIntent.enabled ? `yes, views ${turnaroundIntent.views.join(', ')} at ${turnaroundIntent.aspectRatio}` : 'no'}

Task: Refine this concept into a complete, high-fidelity Konoha 3D DSL script (or raw JSON scene spec).
Use realistic curved/chamfered primitives, MeshPhysicalMaterial PBR finishes, and ground min_y = 0.
Output strictly raw Konoha 3D DSL script only.`;
}

function target_polycount_val(v) {
  return v || 50000;
}

async function tryPromptSynthesisTarget(target, targetIndex, totalTargets, ctx) {
  ctx.emit('llm_synthesis_attempt', {
    model: target.model,
    attempt: targetIndex + 1,
    total_targets: totalTargets,
    provider: target.kind
  });
  try {
    const response = await sendChatMessage(target, {
      system: DSL_SYSTEM_PROMPT,
      userText: ctx.userText,
      model: target.model || ctx.requestedModel,
      max_tokens: 12288,
      timeoutMs: 90000,
      cacheKey: PROMPT_CACHE_KEY,
      onProgress: (progress) => ctx.emit('llm_synthesis_progress', {
        model: progress.model,
        contentLength: progress.contentLength,
        reasoningLength: progress.reasoningLength,
        usage: progress.usage
      })
    });

    const parsed = parseDslOrJson(response.text);
    if (parsed) {
      ctx.circuit.recordSuccess();
      const enriched = alignSpecToBriefRatio(await enrichSynthesizedSpec(ctx.prompt, parsed.spec, ctx.name, ctx.targetPolycount, ctx.effectiveArch), ctx.brief);
      const telem = computeTokenTelemetry(ctx.userText, response.text, response.usage);
      ctx.emit('llm_synthesis_complete', { model: response.model_used, tokens: telem, nodes: enriched.nodes.length });
      return {
        spec: enriched,
        dsl: parsed.dsl,
        source: 'prompt_synthesis',
        model_used: response.model_used,
        tokens: telem
      };
    }
    ctx.emit('llm_synthesis_invalid', { model: target.model, reason: 'unparseable output' });
  } catch (err) {
    ctx.circuit.recordFailure();
    ctx.emit('llm_synthesis_error', { model: target.model, reason: sanitizeError(err.message) });
    process.stderr.write(`[vision_spec] Prompt target attempt failed: ${sanitizeError(err.message)}\n`);
  }
  return null;
}

function createActionEmitter(onAction) {
  return (event, payload) => {
    if (typeof onAction !== 'function') return;
    try { onAction(event, payload); } catch { /* intentional best-effort fallback */ }
  };
}

async function generateSceneSpecFromPrompt(prompt, options = {}) {
  const {
    name = 'HeroModel',
    archetype = 'auto',
    model: requestedModel = null,
    target_polycount = 50000,
    onAction = null
  } = options;

  const effectiveArch = resolveEffectiveArchetype(prompt, archetype);
  const brief = options.object_brief || null;

  if (options.offline === true || options.use_llm === false || process.env.NODE_ENV === 'test') {
    const fallbackSpec = assembleSpec(prompt, name, target_polycount, effectiveArch, archetype, brief);
    return {
      spec: fallbackSpec,
      source: 'offline_procedural',
      dsl: specToDSL(fallbackSpec),
      model_used: 'offline-procedural-synthesizer',
      tokens: { input_tokens: 0, output_tokens: 0, total_tokens: 0, est_cost_usd: 0.0 }
    };
  }
  const emit = createActionEmitter(onAction);

  const circuit = globalCircuitRegistry.getOrCreate('yamanaka-llm-synthesis', 3, 60);
  if (!circuit.allowRequest()) {
    const fallbackSpec = assembleSpec(prompt, name, target_polycount, effectiveArch, archetype, brief);
    return {
      spec: fallbackSpec,
      source: 'circuit_breaker_fallback',
      dsl: specToDSL(fallbackSpec),
      model_used: 'circuit-breaker-open',
      tokens: { input_tokens: 0, output_tokens: 0, total_tokens: 0, est_cost_usd: 0.0 }
    };
  }

  const targets = resolveChatTargets(options);
  if (targets.length === 0) {
    return makeScaffoldedResult(assembleSpec(prompt, name, target_polycount, effectiveArch, archetype, brief), 'No chat targets available');
  }

  const userText = buildPromptSynthesisUserText(prompt, name, effectiveArch, target_polycount, brief);
  const cappedTargets = targets.slice(0, 2);
  const ctx = { prompt, name, targetPolycount: target_polycount, effectiveArch, requestedModel, userText, circuit, emit, brief };

  for (const [targetIndex, target] of cappedTargets.entries()) {
    const res = await tryPromptSynthesisTarget(target, targetIndex, cappedTargets.length, ctx);
    if (res) return res;
  }

  return makeScaffoldedResult(assembleSpec(prompt, name, target_polycount, effectiveArch, archetype, brief), 'All targets failed or returned invalid DSL');
}

async function tryCritiqueRepairTarget(target, critiquePrompt, prevImage, requestedModel, circuit) {
  try {
    const response = await sendChatMessage(target, {
      system: DSL_SYSTEM_PROMPT,
      userText: critiquePrompt,
      imageBuffer: prevImage,
      mimeType: 'image/png',
      model: requestedModel,
      timeoutMs: 25000
    });
    const parsed = parseDslOrJson(response.text);
    if (parsed) {
      circuit.recordSuccess();
      return { applied: true, spec: parsed.spec, dsl: parsed.dsl, model_used: response.model_used, tokens: computeTokenTelemetry(critiquePrompt, response.text, response.usage) };
    }
  } catch (err) {
    circuit.recordFailure();
    process.stderr.write(`[vision_spec] Critique pass failed: ${err.message}\n`);
  }
  return null;
}

async function critiqueAndRepairSpec(options = {}) {
  const { dslScript = '', image_path: imagePath = null, preview_png_path: previewPngPath = null, model: requestedModel = null } = options;
  if (!dslScript || !imagePath || !previewPngPath) return { applied: false, reason: 'Missing inputs for critique' };
  const circuit = globalCircuitRegistry.getOrCreate('yamanaka-llm-synthesis', 3, 60);
  if (!circuit.allowRequest()) return { applied: false, reason: 'Circuit breaker is OPEN' };
  const targets = resolveChatTargets(options);
  if (targets.length === 0) return { applied: false, reason: 'No LLM target for critique' };
  const prevImage = fs.existsSync(previewPngPath) ? fs.readFileSync(previewPngPath) : null;
  if (!prevImage) return { applied: false, reason: 'Preview image unreadable' };
  const critiquePrompt = `Compare this 3D preview render against reference requirements. Output the complete revised Konoha 3D DSL script only.\nCurrent DSL:\n${critiquePromptInput(dslScript)}`;
  for (const target of targets.slice(0, 2)) {
    const res = await tryCritiqueRepairTarget(target, critiquePrompt, prevImage, requestedModel, circuit);
    if (res) return res;
  }
  return { applied: false, reason: 'Critique synthesis failed' };
}

function critiquePromptInput(dslScript) {
  return String(dslScript || '');
}

module.exports = {
  generateObjectBrief,
  buildObjectBriefFromAnalysis,
  critiqueRender,
  normalizeObjectBrief,
  specFromBriefComponents,
  PROMPT_CACHE_KEY,
  DSL_SYSTEM_PROMPT,
  detectMimeType,
  parseDslOrJson,
  structuralJsonToSpec,
  computeTokenTelemetry,
  generateSceneSpecFromImage,
  generateSceneSpecFromPrompt,
  enrichSynthesizedSpec,
  critiqueAndRepairSpec
};
