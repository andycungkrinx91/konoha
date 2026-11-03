'use strict';

/**
 * Inherited-Model Vision-to-DSL Synthesizer for Konoha 3D Pipeline.
 * Enterprise Realistic PBR contracts guarded by Circuit Breaker.
 */

const fs = require('fs');
const path = require('path');
const { resolveChatTargets, sendChatMessage } = require('./model_router');
const { createDefaultSceneSpec, resolveEffectiveArchetype, customizeSpecFromPrompt, parseTurnaroundIntent } = require('./spec_schema');
const { synthesizeSceneFromPrompt } = require('./prompt_synthesizer');
const { parseTailCount } = require('./creature_synthesizer');
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
  } catch (_) {}

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
   - Include 6 to 36 meaningful, articulate subcomponents.
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

function resolveNodeMaterial(node, materialTable) {
  const ref = node.material;
  if (ref && typeof ref === 'object') return ref;
  if (typeof ref === 'string' && materialTable[ref]) {
    const entry = Object.assign({}, materialTable[ref]);
    if (!entry.type) entry.type = 'physical';
    return entry;
  }
  return { type: 'physical', color: '#94a3b8', roughness: 0.5, metalness: 0.2 };
}

function flattenNodeTree(rawNodes, materialTable, out = [], inherited = [0, 0, 0]) {
  for (const raw of Array.isArray(rawNodes) ? rawNodes : []) {
    if (!raw || typeof raw !== 'object') continue;
    const localPos = Array.isArray(raw.position) ? raw.position.map(Number) : [0, 0, 0];
    const worldPos = [inherited[0] + (localPos[0] || 0), inherited[1] + (localPos[1] || 0), inherited[2] + (localPos[2] || 0)];
    const geom = raw.geometry && typeof raw.geometry === 'object' ? raw.geometry : null;
    const nodeName = String(raw.id || raw.name || `node_${out.length}`).replace(/[^a-zA-Z0-9_-]/g, '_');
    if (geom && geom.type) {
      const params = Object.assign({}, geom.params || {});
      for (const [k, v] of Object.entries(geom)) {
        if (k !== 'type' && k !== 'params') params[k] = v;
      }
      out.push({
        name: nodeName,
        geometry: { type: geom.type, params },
        material: resolveNodeMaterial(raw, materialTable),
        transform: {
          position: worldPos,
          rotation: normalizeRotation(raw.rotation),
          scale: Array.isArray(raw.scale) ? raw.scale.map(Number) : [1, 1, 1]
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
        return { spec: parsedJson.spec || parsedJson, dsl: null };
      }
    }
  } catch (_) {}

  try {
    const cleanDsl = trimmed.replace(/^```[a-zA-Z0-9_-]*\n?/m, '').replace(/\n?```$/m, '').trim();
    const dslResult = parseKonohaDSL(cleanDsl);
    const spec = dslResult && (dslResult.spec || dslResult);
    if (spec && Array.isArray(spec.nodes) && spec.nodes.length > 0) {
      return { spec, dsl: cleanDsl };
    }
  } catch (_) {}

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

async function generateSceneSpecFromImage(options = {}) {
  const {
    image_path: imagePath,
    name = 'HeroModel',
    archetype = 'application',
    model: requestedModel = null,
    target_polycount = 50000
  } = options;

  if (!imagePath || !fs.existsSync(imagePath)) {
    return {
      spec: createDefaultSceneSpec(archetype, name),
      source: 'procedural_default',
      model_used: 'default',
      fallback_reason: 'No image provided',
      tokens: { input_tokens: 0, output_tokens: 0, total_tokens: 0, est_cost_usd: 0.0 }
    };
  }

  const circuit = globalCircuitRegistry.getOrCreate('yamanaka-llm-synthesis', 3, 60);
  if (!circuit.allowRequest()) {
    return {
      spec: createDefaultSceneSpec(archetype, name),
      source: 'procedural_fallback',
      model_used: 'circuit-breaker-open',
      fallback_reason: 'LLM synthesis circuit breaker is OPEN',
      tokens: { input_tokens: 0, output_tokens: 0, total_tokens: 0, est_cost_usd: 0.0 }
    };
  }

  const targets = resolveChatTargets(options);
  if (targets.length === 0) {
    return {
      spec: createDefaultSceneSpec(archetype, name),
      source: 'procedural_fallback',
      model_used: 'threejs-procedural-engine',
      fallback_reason: 'No vision targets available',
      tokens: { input_tokens: 0, output_tokens: 0, total_tokens: 0, est_cost_usd: 0.0 }
    };
  }

  const imageBuffer = fs.readFileSync(imagePath);
  const mimeType = detectMimeType(imagePath);
  const userText = `Examine this reference image. Deconstruct its 3D form, materials, and silhouette into a production-grade Konoha 3D DSL script. Name: ${name}, Archetype: ${archetype}, Polycount: ${target_polycount}. Output raw DSL only.`;

  for (const target of targets) {
    try {
      const response = await sendChatMessage(target, {
        system: DSL_SYSTEM_PROMPT,
        userText,
        imageBuffer,
        mimeType,
        model: requestedModel,
        timeoutMs: 120000
      });

      const parsed = parseDslOrJson(response.text);
      if (parsed) {
        circuit.recordSuccess();
        const telem = computeTokenTelemetry(userText, response.text, response.usage);
        return {
          spec: parsed.spec,
          dsl: parsed.dsl,
          source: 'vision',
          model_used: response.model_used,
          tokens: telem
        };
      }
    } catch (err) {
      circuit.recordFailure();
      process.stderr.write(`[vision_spec] Vision target attempt failed: ${sanitizeError(err.message)}\n`);
    }
  }

  return {
    spec: createDefaultSceneSpec(archetype, name),
    source: 'procedural_fallback',
    model_used: 'default',
    fallback_reason: 'All vision targets failed or returned invalid DSL',
    tokens: { input_tokens: 0, output_tokens: 0, total_tokens: 0, est_cost_usd: 0.0 }
  };
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
  if (!needsCreature || !sparse) return spec;
  const richer = synthesizeSceneFromPrompt(prompt, name, targetPolycount, requestedArchetype);
  if (richer && richer.archetype === 'game-creature' && richer.nodes.length > nodeCount) {
    return richer;
  }
  return spec;
}

function assembleSpec(prompt, name, targetPolycount, effectiveArch, requestedArchetype) {
  const semanticSpec = synthesizeSceneFromPrompt(prompt, name, targetPolycount, requestedArchetype);
  const fallbackSpec = semanticSpec || createDefaultSceneSpec(effectiveArch, name);
  if (fallbackSpec && fallbackSpec.nodes && semanticSpec) {
    fallbackSpec.archetype = semanticSpec.archetype || effectiveArch;
  }
  customizeSpecFromPrompt(fallbackSpec, prompt, targetPolycount);
  if (fallbackSpec) {
    fallbackSpec.__prompt = prompt;
    fallbackSpec.turnaround = parseTurnaroundIntent(prompt, fallbackSpec.turnaround);
  }
  return fallbackSpec;
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
  const emit = (event, payload) => {
    if (typeof onAction === 'function') {
      try { onAction(event, payload); } catch (_) {}
    }
  };

  const circuit = globalCircuitRegistry.getOrCreate('yamanaka-llm-synthesis', 3, 60);
  if (!circuit.allowRequest()) {
    const fallbackSpec = assembleSpec(prompt, name, target_polycount, effectiveArch, archetype);
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
    const fallbackSpec = assembleSpec(prompt, name, target_polycount, effectiveArch, archetype);
    return {
      spec: fallbackSpec,
      source: 'scaffolded_dsl',
      dsl: specToDSL(fallbackSpec),
      model_used: 'scaffolded-dsl-engine',
      fallback_reason: 'No chat targets available',
      tokens: { input_tokens: 0, output_tokens: 0, total_tokens: 0, est_cost_usd: 0.0 }
    };
  }

  const turnaroundIntent = parseTurnaroundIntent(prompt, null);
  const userText = `Prompt Concept: "${prompt}".
Resolved Archetype: ${effectiveArch}
Target Polycount: ${target_polycount}
Asset Name: ${name}
Turnaround Reference Requested: ${turnaroundIntent.enabled ? `yes, views ${turnaroundIntent.views.join(', ')} at ${turnaroundIntent.aspectRatio}` : 'no'}

Task: Refine this concept into a complete, high-fidelity Konoha 3D DSL script (or raw JSON scene spec).
Use realistic curved/chamfered primitives, MeshPhysicalMaterial PBR finishes, and ground min_y = 0.
Output strictly raw Konoha 3D DSL script only.`;

  for (const [targetIndex, target] of targets.entries()) {
    emit('llm_synthesis_attempt', {
      model: target.model,
      attempt: targetIndex + 1,
      total_targets: targets.length,
      provider: target.kind
    });
    try {
      const response = await sendChatMessage(target, {
        system: DSL_SYSTEM_PROMPT,
        userText,
        model: target.model || requestedModel,
        max_tokens: 8192,
        timeoutMs: 120000,
        onProgress: (progress) => emit('llm_synthesis_progress', {
          model: progress.model,
          contentLength: progress.contentLength,
          reasoningLength: progress.reasoningLength,
          usage: progress.usage
        })
      });

      const parsed = parseDslOrJson(response.text);
      if (parsed) {
        circuit.recordSuccess();
        const enriched = await enrichSynthesizedSpec(prompt, parsed.spec, name, target_polycount, effectiveArch);
        const telem = computeTokenTelemetry(userText, response.text, response.usage);
        emit('llm_synthesis_complete', { model: response.model_used, tokens: telem, nodes: enriched.nodes.length });
        return {
          spec: enriched,
          dsl: parsed.dsl,
          source: 'prompt_synthesis',
          model_used: response.model_used,
          tokens: telem
        };
      }
      emit('llm_synthesis_invalid', { model: target.model, reason: 'unparseable output' });
    } catch (err) {
      circuit.recordFailure();
      emit('llm_synthesis_error', { model: target.model, reason: sanitizeError(err.message) });
      process.stderr.write(`[vision_spec] Prompt target attempt failed: ${sanitizeError(err.message)}\n`);
    }
  }

  const fallbackSpec = assembleSpec(prompt, name, target_polycount, effectiveArch, archetype);
  return {
    spec: fallbackSpec,
    source: 'scaffolded_dsl',
    dsl: specToDSL(fallbackSpec),
    model_used: 'scaffolded-dsl-engine',
    fallback_reason: 'All targets failed or returned invalid DSL',
    tokens: { input_tokens: 0, output_tokens: 0, total_tokens: 0, est_cost_usd: 0.0 }
  };
}

async function critiqueAndRepairSpec(options = {}) {
  const {
    dslScript = '',
    image_path: imagePath = null,
    preview_png_path: previewPngPath = null,
    model: requestedModel = null
  } = options;

  if (!dslScript || !imagePath || !previewPngPath) {
    return { applied: false, reason: 'Missing inputs for critique' };
  }

  const circuit = globalCircuitRegistry.getOrCreate('yamanaka-llm-synthesis', 3, 60);
  if (!circuit.allowRequest()) {
    return { applied: false, reason: 'Circuit breaker is OPEN' };
  }

  const targets = resolveChatTargets(options);
  if (targets.length === 0) {
    return { applied: false, reason: 'No LLM target for critique' };
  }

  const prevImage = fs.existsSync(previewPngPath) ? fs.readFileSync(previewPngPath) : null;
  if (!prevImage) {
    return { applied: false, reason: 'Preview image unreadable' };
  }

  const critiquePrompt = `Compare this 3D preview render against reference requirements. Output the complete revised Konoha 3D DSL script only.\nCurrent DSL:\n${dslScript}`;

  for (const target of targets) {
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
        const telem = computeTokenTelemetry(critiquePrompt, response.text, response.usage);
        return {
          applied: true,
          spec: parsed.spec,
          dsl: parsed.dsl,
          model_used: response.model_used,
          tokens: telem
        };
      }
    } catch (err) {
      circuit.recordFailure();
      process.stderr.write(`[vision_spec] Critique pass failed: ${err.message}\n`);
    }
  }

  return { applied: false, reason: 'Critique synthesis failed' };
}

module.exports = {
  DSL_SYSTEM_PROMPT,
  detectMimeType,
  parseDslOrJson,
  structuralJsonToSpec,
  computeTokenTelemetry,
  generateSceneSpecFromImage,
  generateSceneSpecFromPrompt,
  critiqueAndRepairSpec
};
