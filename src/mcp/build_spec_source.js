'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getDb } = require('../db');
const { getAgentSkills, logToolCall } = require('./skills');
const {
  humanBuiltFingerprintDirectives,
  validateBuildInput,
  resolveBuildSourceDir,
  loadSkillContentForBuild,
  frameworkSourceSignals
} = require('./build_spec_common');

function readPngDimensions(buf) {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), format: 'PNG' };
}

function readGifDimensions(buf) {
  return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8), format: 'GIF' };
}

function readJpegDimensions(buf, bytesRead) {
  let offset = 2;
  const markers = new Set([0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF]);
  while (offset < bytesRead - 8) {
    if (buf[offset] !== 0xFF) break;
    const marker = buf[offset + 1];
    if (markers.has(marker)) {
      return { w: buf.readUInt16BE(offset + 7), h: buf.readUInt16BE(offset + 5), format: 'JPEG' };
    }
    offset += 2 + buf.readUInt16BE(offset + 2);
  }
  return null;
}

function analyzeImageMetadata(filePath) {
  const meta = { size_bytes: 0 };
  try {
    meta.size_bytes = fs.statSync(filePath).size;
  } catch (_) {
    return meta;
  }
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.svg') || lower.endsWith('.html') || lower.endsWith('.htm')) {
    return meta;
  }
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(2048);
    const bytesRead = fs.readSync(fd, buf, 0, 2048, 0);
    fs.closeSync(fd);
    let parsed = null;
    if (bytesRead > 24 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      parsed = readPngDimensions(buf);
    } else if (bytesRead > 10 && (buf.subarray(0, 6).toString('ascii') === 'GIF87a' || buf.subarray(0, 6).toString('ascii') === 'GIF89a')) {
      parsed = readGifDimensions(buf);
    } else if (bytesRead > 4 && buf[0] === 0xFF && buf[1] === 0xD8) {
      parsed = readJpegDimensions(buf, bytesRead);
    }
    if (parsed) {
      const { w, h, format } = parsed;
      meta.width = w;
      meta.height = h;
      meta.aspect_ratio = h > 0 ? Math.round((w / h) * 100) / 100 : 0;
      meta.orientation = w > h ? 'landscape' : (h > w ? 'portrait' : 'square');
      meta.format = format;
    }
  } catch (_) { /* ignore */ }
  return meta;
}

const SKIP_SOURCE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage',
  '.next', '.nuxt', '.svelte-kit', '.angular', '__pycache__', '.venv'
]);

const VALID_SOURCE_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.svg', '.html', '.xml',
  '.tsx', '.jsx', '.ts', '.js', '.css', '.scss', '.svelte',
  '.vue', '.mjs', '.cjs'
]);

function processSourceEntry(entry, dir, resolvedRoot, allFiles) {
  if (entry.name.startsWith('.') || SKIP_SOURCE_DIRS.has(entry.name)) return;
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) {
    walkSourceDir(full, resolvedRoot, allFiles);
    return;
  }
  if (!entry.isFile()) return;
  const ext = path.extname(entry.name).toLowerCase();
  if (VALID_SOURCE_EXTS.has(ext)) {
    allFiles.push(path.relative(resolvedRoot, full).replace(/\\/g, '/'));
  }
}

function walkSourceDir(dir, resolvedRoot, allFiles) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return;
  }
  for (const entry of entries) {
    if (allFiles.length >= 100) break;
    processSourceEntry(entry, dir, resolvedRoot, allFiles);
  }
}

function inspectSourceContent(fpath, filename, size) {
  const meta = { filename, size_bytes: size };
  try {
    const rawContent = fs.readFileSync(fpath);
    meta.sha256 = crypto.createHash('sha256').update(rawContent).digest('hex');
    if (size <= 50000) {
      const content = rawContent.toString('utf8');
      meta.content_excerpt = content.substring(0, 300);
      meta.framework_hints = frameworkSourceSignals(filename, content);
      meta.has_exports_or_imports = /\b(import|export)\b/.test(content);
      meta.signals = {
        routes: /(app\/|src\/routes\/|pages\/|app\.routes|definePageMeta|@angular\/router)/i.test(content),
        design_tokens: /(--[a-z0-9-]+|@theme|tailwindcss)/i.test(content),
        accessibility: /(aria-|role=|tabindex|sr-only)/i.test(content),
        reduced_motion: /(prefers-reduced-motion|reduced.?motion)/i.test(content),
        animation_frame: content.includes('requestAnimationFrame'),
        hero_carousel: /(carousel|swiper|splide|slide)/i.test(content)
      };
    }
  } catch (_) { /* ignore */ }
  return meta;
}

function resolveSourceSkills(displayFramework, agentName) {
  let skills = agentName ? getAgentSkills(agentName) : null;
  if (!skills) skills = getAgentSkills('jonin') || ['jonin-skill'];

  const fwLower = displayFramework.toLowerCase();
  const basePrefix = fwLower.includes('svelte') ? 'svelte' : (fwLower.includes('next') || fwLower.includes('react') ? 'nextjs' : (fwLower.includes('nuxt') ? 'nuxt' : (fwLower.includes('angular') ? 'angular' : null)));

  const frameworkSkills = [
    'jonin-skill/design-token-manifest',
    'jonin-skill/tailwind-design-system',
    'jonin-skill/build-directives-manifest',
    'jonin-skill/source-fidelity-directives'
  ];
  if (basePrefix) {
    frameworkSkills.push(`jonin-skill/${basePrefix}-ui-expert`, `jonin-skill/${basePrefix}-code-expert`);
  }
  frameworkSkills.push('jonin-skill/taste-skill-frontend-expert');

  for (const s of frameworkSkills) {
    if (!skills.includes(s)) skills.push(s);
  }
  return skills;
}

function assembleSourceDirectives(context) {
  const { displayFramework, name, sourceDir, detectedImages, layoutHints, detectedSources, frameworkSpec, validatedDials } = context;
  const directives = [
    `Build a clean ${displayFramework} website named '${name}' based on the source design directory '${sourceDir}'.`
  ];
  if (detectedImages.length > 0) {
    directives.push(`Detected design mockups: ${detectedImages.map(m => m.filename).join(', ')}. Translate these layouts directly into component structure with high visual fidelity.`);
  }
  if (layoutHints.length > 0) {
    directives.push(`Image layout analysis: ${layoutHints.join('; ')}. Use these dimensions to guide responsive breakpoints and aspect ratios.`);
  }
  if (detectedSources.length > 0) {
    directives.push(`Detected source code reference files: ${detectedSources.map(s => s.filename).join(', ')}. Reconstruct or migrate component structure and logic from these files.`);
  }

  directives.push('You MUST follow the package.json template, CSS variables, design-token manifest, and routing rules from the embedded skill content below.');
  directives.push(`Use framework-native routing: ${frameworkSpec.routing}`);
  directives.push(`Provide the framework validation scripts: ${frameworkSpec.validation.join(', ')}. All validation must finish with zero errors and zero warnings.`);
  directives.push("Mandatory package.json Scripts Invariant: EVERY build across all frameworks (Next.js, SvelteKit, Nuxt, Angular) MUST strictly provide working package.json scripts for 'pnpm lint', 'pnpm build', and 'pnpm start' (plus 'pnpm check' for SvelteKit).");
  directives.push(`Apply Taste-Skill dials: DESIGN_VARIANCE=${validatedDials.design_variance}/10, MOTION_INTENSITY=${validatedDials.motion_intensity}/10, VISUAL_DENSITY=${validatedDials.visual_density}/10.`);
  directives.push("SDLC & Anti-Slop Delivery Gate: Verify Definition-of-Readiness compliance and run 'rtk aislop scan --changes' to ensure ai_slop_findings: 0 and ai_slop_clean: true before delivery.");
  directives.push("Token-Safe Dependencies: Install packages with 'rtk pnpm add <packages> --silent' to suppress verbose terminal output and protect token budget.");
  directives.push(...humanBuiltFingerprintDirectives('build_from_source'));
  return Array.from(new Set(directives));
}

function getCriticalSkills(fwBase) {
  return [
    fwBase ? `jonin-skill/${fwBase}-ui-expert` : null,
    fwBase ? `jonin-skill/${fwBase}-code-expert` : null,
    'jonin-skill/build-directives-manifest',
    'jonin-skill/design-token-manifest',
    'jonin-skill/source-fidelity-directives',
    'jonin-skill/taste-skill-frontend-expert'
  ].filter(Boolean);
}

function safeCloseDb(conn) {
  if (!conn) return;
  try { conn.close(); } catch (_) { /* intentional fallback */ }
}

function loadEmbeddedSourceSkills(displayFramework) {
  let skillBlocks = [];
  const fwLower = displayFramework.toLowerCase();
  const fwBase = fwLower.includes('svelte') ? 'svelte' : (fwLower.includes('next') || fwLower.includes('react') ? 'nextjs' : (fwLower.includes('nuxt') ? 'nuxt' : (fwLower.includes('angular') ? 'angular' : null)));
  const criticalSkills = getCriticalSkills(fwBase);
  let specConn = null;
  try {
    specConn = getDb();
    skillBlocks = loadSkillContentForBuild(criticalSkills, specConn);
  } catch (e) {
    process.stderr.write(`[mcp konoha] Error loading skill content for build_from_source: ${e.message}\n`);
  } finally {
    safeCloseDb(specConn);
  }
  return skillBlocks;
}

function readSourceFileMeta(resolvedSourceDir, s) {
  const fpath = path.join(resolvedSourceDir, s);
  try {
    const st = fs.statSync(fpath);
    return inspectSourceContent(fpath, s, st.size);
  } catch (_) {
    return null;
  }
}

function collectDetectedImages(allFiles, resolvedSourceDir) {
  const imageExts = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg']);
  const detected = [];
  for (const m of allFiles) {
    const ext = path.extname(m).toLowerCase();
    if (!imageExts.has(ext)) continue;
    const meta = analyzeImageMetadata(path.join(resolvedSourceDir, m));
    if (meta.size_bytes > 0) {
      meta.filename = m;
      detected.push(meta);
    }
  }
  return detected;
}

function collectDetectedSources(allFiles, resolvedSourceDir) {
  const codeExts = new Set(['.html', '.css', '.scss', '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.svelte', '.vue', '.xml']);
  const detected = [];
  for (const s of allFiles) {
    if (detected.length >= 15) break;
    const ext = path.extname(s).toLowerCase();
    if (!codeExts.has(ext)) continue;
    const meta = readSourceFileMeta(resolvedSourceDir, s);
    if (meta) detected.push(meta);
  }
  return detected;
}

function collectLayoutHints(detectedImages) {
  const hints = [];
  for (const m of detectedImages) {
    if (m.width && m.height) {
      hints.push(`${m.filename} (${m.width}x${m.height}, ${m.orientation || 'unknown'})`);
    }
  }
  return hints;
}

function buildFromSource(name, sourceDir, framework, options = {}) {
  const agentName = (options && typeof options === 'object') ? options.agentName : (typeof options === 'string' ? options : null);
  const tasteDials = (options && typeof options === 'object' && !Array.isArray(options) && options.tasteDials !== undefined)
    ? options.tasteDials
    : arguments[4];

  let frameworkSpec, validatedDials, resolvedSourceDir;
  try {
    const validated = validateBuildInput(name, null, framework, tasteDials);
    frameworkSpec = validated.frameworkSpec;
    validatedDials = validated.tasteDials;
    resolvedSourceDir = resolveBuildSourceDir(sourceDir);
  } catch (exc) {
    const res = JSON.stringify({ error: exc.message });
    logToolCall('build_from_source', `name=${name}, source_dir=${sourceDir}`, res, agentName);
    return res;
  }

  const allFiles = [];
  walkSourceDir(resolvedSourceDir, resolvedSourceDir, allFiles);
  if (allFiles.length === 0) {
    const res = JSON.stringify({ error: `No supported design images or source files found in ${sourceDir}.` });
    logToolCall('build_from_source', `name=${name}, source_dir=${sourceDir}`, res, agentName);
    return res;
  }

  const detectedImages = collectDetectedImages(allFiles, resolvedSourceDir);
  const detectedSources = collectDetectedSources(allFiles, resolvedSourceDir);
  const layoutHints = collectLayoutHints(detectedImages);
  const displayFramework = frameworkSpec.display;
  const agentSkills = resolveSourceSkills(displayFramework, agentName);
  const directives = assembleSourceDirectives({
    displayFramework, name, sourceDir, detectedImages, layoutHints, detectedSources, frameworkSpec, validatedDials
  });

  const spec = {
    status: 'success',
    project_name: name,
    framework: frameworkSpec.canonical,
    framework_display: displayFramework,
    mode: 'build_from_source',
    source_directory: resolvedSourceDir,
    source_fidelity: true,
    premium_effects_policy: 'Only preserve or enhance effects explicitly present in source; do not inject generic themes, catalogs, carousels, dialogs, or sections.',
    design_tokens: { perspective: '1200px', tilt_max: '12deg', transition: '300ms', entrance: '500ms', hero_content_entrance: '600ms', hero_autoplay: '6000ms', theme_storage_key: 'konoha-theme' },
    taste_skill_source: process.env.KONOHA_TASTE_SKILL_DOCS || 'https://www.tasteskill.dev/guide',
    taste_skill_audits: ['em_dash', 'pre_flight', 'section_layout_repetition', 'hero_discipline', 'preservation', 'brand_fidelity', 'zero_ai_slop', 'sdlc_readiness'],
    detected_images: detectedImages,
    detected_sources: detectedSources,
    directives,
    image_to_code_required: detectedImages.length > 0,
    required_skills: agentSkills,
    skill_load_sequence: agentSkills,
    delegate_constraints: directives,
    absolute_image_paths: detectedImages.map(m => path.resolve(path.join(resolvedSourceDir, m.filename))),
    forbid_build_from_text: detectedImages.length > 0,
    taste_dials: validatedDials,
    scaffold_command: frameworkSpec.scaffold_command || '',
    validation_commands: frameworkSpec.validation,
    embedded_skill_content: loadEmbeddedSourceSkills(displayFramework)
  };

  const res = JSON.stringify(spec);
  logToolCall('build_from_source', `name=${name}, source_dir=${sourceDir}, framework=${framework}`, res, agentName);
  return res;
}

module.exports = {
  analyzeImageMetadata,
  buildFromSource
};
