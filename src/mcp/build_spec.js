/**
 * src/mcp/build_spec.js — Website & UI build specification generator.
 * 
 * CRITICAL INVARIANT (PLAN_REFACTOR.md §2):
 * Reads runtime state via getWorkspaceRoot().
 * Never exports or imports mutable state by value.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const db = require("../db");
const { getDb } = db;
const {
  getWorkspaceRoot,
  KONOHA_DIR
} = require("./runtime_state");
const {
  fuzzyResolveSkill,
  getAgentSkills,
  logToolCall
} = require("./skills");

const BUILD_FRAMEWORKS = {
  next: {
    canonical: 'nextjs',
    display: 'Next.js 16.3',
    aliases: new Set(['next', 'nextjs', 'react']),
    scaffold_command: 'pnpm create next-app@latest',
    routing: 'Use Next.js 16 App Router under app/ (strictly Next.js 16.3+, React 19, Tailwind v4 — NEVER Next.js 15, 14, or hash-based SPA routing).',
    validation: ['pnpm run lint', 'pnpm run build'],
    required_scripts: ['pnpm lint', 'pnpm build', 'pnpm start', 'pnpm dev'],
    source_extensions: new Set(['.html', '.css', '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx']),
    skill_prefix: 'nextjs'
  },
  svelte: {
    canonical: 'sveltekit',
    display: 'SvelteKit',
    aliases: new Set(['svelte', 'sveltekit']),
    scaffold_command: 'pnpm dlx sv create <project-name>',
    routing: 'Use SvelteKit file-based routing under src/routes/ — NEVER hash-based SPA routing.',
    validation: ['pnpm run check', 'pnpm run lint', 'pnpm run build'],
    required_scripts: ['pnpm check', 'pnpm lint', 'pnpm build', 'pnpm start', 'pnpm dev'],
    source_extensions: new Set(['.html', '.css', '.js', '.mjs', '.ts', '.svelte']),
    skill_prefix: 'svelte'
  },
  nuxt: {
    canonical: 'nuxt',
    display: 'Nuxt 4.3',
    aliases: new Set(['nuxt', 'nuxt3', 'vue']),
    scaffold_command: 'pnpm dlx nuxi@latest init <project-name>',
    routing: 'Use Nuxt 4 file-based routing under app/pages/ and app/layouts/ — NEVER hash-based SPA routing.',
    validation: ['pnpm run lint', 'pnpm run build'],
    required_scripts: ['pnpm lint', 'pnpm build', 'pnpm start', 'pnpm dev'],
    source_extensions: new Set(['.html', '.css', '.js', '.mjs', '.ts', '.vue']),
    skill_prefix: 'nuxt'
  },
  angular: {
    canonical: 'angular',
    display: 'Angular 20+ Signals',
    aliases: new Set(['angular', 'ng']),
    scaffold_command: 'pnpm dlx @angular/cli@latest new <project-name> --package-manager=pnpm',
    routing: 'Use standalone Angular Router with app.routes.ts — NEVER hash-based SPA routing.',
    validation: ['pnpm run lint', 'pnpm run build'],
    required_scripts: ['pnpm lint', 'pnpm build', 'pnpm start', 'pnpm dev'],
    source_extensions: new Set(['.html', '.css', '.scss', '.js', '.mjs', '.ts']),
    skill_prefix: 'angular'
  }
};

function validateBuildInput(name, description = null, framework = null, tasteDials = null) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(name.trim())) {
    throw new Error('name must contain 1-100 letters, numbers, dots, underscores, or hyphens');
  }
  if (description !== null && (typeof description !== 'string' || !description.trim())) {
    throw new Error('description is required');
  }
  const fwClean = String(framework || '').toLowerCase().replace(/[.\s-]/g, '');
  let spec = null;
  for (const value of Object.values(BUILD_FRAMEWORKS)) {
    for (const alias of value.aliases) {
      if (fwClean === alias.replace(/[.\s-]/g, '')) {
        spec = value;
        break;
      }
    }
    if (spec) break;
  }
  if (!spec) {
    throw new Error('framework must be one of: nextjs, nuxt, sveltekit, angular');
  }

  const dials = { design_variance: 8, motion_intensity: 7, visual_density: 6 };
  if (tasteDials !== null && tasteDials !== undefined) {
    if (typeof tasteDials !== 'object' || Array.isArray(tasteDials)) {
      throw new Error('taste_dials must be an object');
    }
    for (const key of Object.keys(dials)) {
      if (key in tasteDials) {
        const val = tasteDials[key];
        if (typeof val !== 'number' || isNaN(val) || val < 1 || val > 10) {
          throw new Error(`${key} must be a number from 1 to 10`);
        }
        dials[key] = val;
      }
    }
  }
  return { frameworkSpec: spec, tasteDials: dials };
}

function resolveBuildSourceDir(sourceDir) {
  if (!sourceDir || typeof sourceDir !== 'string' || !sourceDir.trim()) {
    throw new Error('source_dir is required');
  }
  let raw = sourceDir.trim();
  if (raw.startsWith('~/') || raw === '~') {
    raw = path.join(os.homedir(), raw.substring(1));
  }
  const workspace = path.resolve(getWorkspaceRoot() || process.cwd());
  const resolved = path.resolve(path.isAbsolute(raw) ? raw : path.join(workspace, raw));
  // Resolve symlinks so workspaces mounted through links are not falsely rejected
  let realResolved = resolved;
  let realWorkspace = workspace;
  try { realResolved = fs.realpathSync(resolved); } catch (_) {}
  try { realWorkspace = fs.realpathSync(workspace); } catch (_) {}
  const isWinPlatform = process.platform === 'win32';
  const norm = (p) => isWinPlatform ? p.toLowerCase() : p;
  const allowedRoots = [norm(realWorkspace), norm(path.resolve(KONOHA_DIR))];

  const isAllowed = allowedRoots.some(root => {
    const r = norm(realResolved);
    return r === root || r.startsWith(root + path.sep);
  });
  if (!isAllowed) {
    throw new Error(`Source directory outside workspace: ${sourceDir}`);
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`Source directory not found: ${sourceDir}`);
  }
  return resolved;
}

function normalizeFrameworkName(framework) {
  const { frameworkSpec } = validateBuildInput('build', null, framework);
  return frameworkSpec.display;
}


function loadSkillContentForBuild(skillNames, conn) {
  const blocks = [];
  for (const name of skillNames) {
    const resolved = fuzzyResolveSkill(name, conn) || name;
    try {
      const row = conn.prepare('SELECT content FROM skills WHERE name = ?').get(resolved);
      if (row && row.content) {
        const raw = row.content.trim();
        let preview = raw.substring(0, 400).trim();
        if (raw.length > 400) {
          preview += `\n...(Call konoha.get_skill('${resolved}') for full reference manual)`;
        }
        blocks.push({
          skill_name: resolved,
          content: preview,
          byte_size: Buffer.byteLength(raw, 'utf8'),
          token_efficient: true
        });
      }
    } catch (e) {
      process.stderr.write(`[mcp konoha] Error loading skill ${resolved}: ${e.message}\n`);
    }
  }
  return blocks;
}

function inferBuildArchetype(description) {
  const text = (description || '').toLowerCase();
  if (['e-commerce', 'ecommerce', 'online store', 'shop', 'catalog', 'product detail', 'checkout', 'storefront', 'marketplace'].some(t => text.includes(t))) {
    return 'commerce';
  }
  if (['dashboard', 'admin', 'analytics', 'back office', 'internal tool', 'infra', 'infrastructure', 'metric', 'monitoring', 'server', 'cluster', 'k8s', 'control panel', 'crm', 'telemetry'].some(t => text.includes(t))) {
    return 'dashboard';
  }
  if (['portfolio', 'personal site', 'case studies', 'resume', 'curriculum vitae', 'developer site', 'designer site'].some(t => text.includes(t))) {
    return 'portfolio';
  }
  if (['landing page', 'one-page', 'one page', 'marketing page', 'saas', 'waitlist', 'product launch'].some(t => text.includes(t))) {
    return 'landing';
  }
  if (['company', 'corporate', 'agency', 'consultancy', 'firm', 'enterprise', 'organization', 'business profile'].some(t => text.includes(t))) {
    return 'company';
  }
  if (['documentation', 'docs site', 'knowledge base', 'developer portal', 'api reference', 'handbook'].some(t => text.includes(t))) {
    return 'documentation';
  }
  return 'application';
}

function frameworkSourceSignals(filename, content) {
  const lowerName = filename.toLowerCase();
  const lowerContent = content.toLowerCase();
  const signals = new Set();
  if (lowerName.endsWith('.tsx') || lowerName.endsWith('.jsx') || lowerContent.includes('next/') || lowerContent.includes('next.js')) {
    signals.add('nextjs');
  }
  if (lowerName.endsWith('.svelte') || lowerContent.includes('svelte') || lowerContent.includes("from '$app/")) {
    signals.add('sveltekit');
  }
  if (lowerName.endsWith('.vue') || lowerContent.includes('definepagemeta') || lowerContent.includes('<script setup')) {
    signals.add('nuxt');
  }
  if (lowerName.endsWith('.component.ts') || lowerContent.includes('@component') || lowerContent.includes('standalone: true') || lowerContent.includes('signal(')) {
    signals.add('angular');
  }
  return Array.from(signals).sort();
}

function analyzeImageMetadata(filePath) {
  const meta = {};
  try {
    const stat = fs.statSync(filePath);
    meta.size_bytes = stat.size;
  } catch (_) {
    meta.size_bytes = 0;
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
    if (bytesRead > 24 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      // PNG
      const w = buf.readUInt32BE(16);
      const h = buf.readUInt32BE(20);
      meta.width = w;
      meta.height = h;
      meta.aspect_ratio = h > 0 ? Math.round((w / h) * 100) / 100 : 0;
      meta.orientation = w > h ? 'landscape' : (h > w ? 'portrait' : 'square');
      meta.format = 'PNG';
    } else if (bytesRead > 10 && (buf.subarray(0, 6).toString('ascii') === 'GIF87a' || buf.subarray(0, 6).toString('ascii') === 'GIF89a')) {
      // GIF
      const w = buf.readUInt16LE(6);
      const h = buf.readUInt16LE(8);
      meta.width = w;
      meta.height = h;
      meta.aspect_ratio = h > 0 ? Math.round((w / h) * 100) / 100 : 0;
      meta.orientation = w > h ? 'landscape' : (h > w ? 'portrait' : 'square');
      meta.format = 'GIF';
    } else if (bytesRead > 4 && buf[0] === 0xFF && buf[1] === 0xD8) {
      // JPEG
      let offset = 2;
      while (offset < bytesRead - 8) {
        if (buf[offset] !== 0xFF) break;
        const marker = buf[offset + 1];
        if ([0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF].includes(marker)) {
          const h = buf.readUInt16BE(offset + 5);
          const w = buf.readUInt16BE(offset + 7);
          meta.width = w;
          meta.height = h;
          meta.aspect_ratio = h > 0 ? Math.round((w / h) * 100) / 100 : 0;
          meta.orientation = w > h ? 'landscape' : (h > w ? 'portrait' : 'square');
          meta.format = 'JPEG';
          break;
        }
        const len = buf.readUInt16BE(offset + 2);
        offset += 2 + len;
      }
    }
  } catch (_) { /* ignore */ }
  return meta;
}

function buildFromSource(name, sourceDir, framework, agentName = null, tasteDials = null) {
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
  try {
    // Dependency/build output dirs would crowd out actual design assets
    const SKIP_DIRS = new Set([
      'node_modules', '.git', 'dist', 'build', 'out', 'coverage',
      '.next', '.nuxt', '.svelte-kit', '.angular', '__pycache__', '.venv'
    ]);
    function walkDir(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (allFiles.length >= 100) break;
        if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        let st;
        try {
          st = fs.statSync(full);
        } catch (_) { continue; }
        if (st.isDirectory()) {
          walkDir(full);
        } else if (st.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          const validExts = new Set([
            '.png', '.jpg', '.jpeg', '.webp', '.svg', '.html', '.xml',
            '.tsx', '.jsx', '.ts', '.js', '.css', '.scss', '.svelte',
            '.vue', '.mjs', '.cjs'
          ]);
          if (validExts.has(ext)) {
            allFiles.push(path.relative(resolvedSourceDir, full).replace(/\\/g, '/'));
          }
        }
      }
    }
    walkDir(resolvedSourceDir);
  } catch (e) {
    const res = JSON.stringify({ error: `Failed to list source directory: ${e.message}` });
    logToolCall('build_from_source', `name=${name}, source_dir=${sourceDir}`, res, agentName);
    return res;
  }

  if (allFiles.length === 0) {
    const res = JSON.stringify({ error: `No supported design images or source files found in ${sourceDir}.` });
    logToolCall('build_from_source', `name=${name}, source_dir=${sourceDir}`, res, agentName);
    return res;
  }

  const imageExts = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg']);
  const codeExts = new Set(['.html', '.css', '.scss', '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.svelte', '.vue', '.xml']);

  const imagesRaw = allFiles.filter(f => imageExts.has(path.extname(f).toLowerCase()));
  const sourcesRaw = allFiles.filter(f => codeExts.has(path.extname(f).toLowerCase()));

  const detectedImages = [];
  for (const m of imagesRaw) {
    const fpath = path.join(resolvedSourceDir, m);
    const meta = analyzeImageMetadata(fpath);
    if (!meta.size_bytes || meta.size_bytes === 0) continue;
    meta.filename = m;
    detectedImages.push(meta);
  }

  const detectedSources = [];
  for (const s of sourcesRaw.slice(0, 30)) {
    const fpath = path.join(resolvedSourceDir, s);
    const meta = { filename: s };
    try {
      const st = fs.statSync(fpath);
      meta.size_bytes = st.size;
      const rawContent = fs.readFileSync(fpath);
      meta.sha256 = crypto.createHash('sha256').update(rawContent).digest('hex');
      if (st.size <= 50000) {
        const content = rawContent.toString('utf8');
        meta.content_excerpt = content.substring(0, 4000);
        meta.framework_hints = frameworkSourceSignals(s, content);
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
    detectedSources.push(meta);
  }

  const layoutHints = [];
  for (const m of detectedImages) {
    if (m.width && m.height) {
      layoutHints.push(`${m.filename} (${m.width}x${m.height}, ${m.orientation || 'unknown'})`);
    }
  }

  const displayFramework = frameworkSpec.display;
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

  let agentSkills = null;
  if (agentName) agentSkills = getAgentSkills(agentName);
  if (!agentSkills) agentSkills = getAgentSkills('jonin');
  if (!agentSkills) {
    agentSkills = ['jonin-skill'];
  }

  const fwLowerSrc = displayFramework.toLowerCase();
  let frameworkSkillsSrc = [];
  if (fwLowerSrc.includes('next') || fwLowerSrc.includes('react')) {
    frameworkSkillsSrc = [
      'jonin-skill/design-token-manifest',
      'jonin-skill/tailwind-design-system',
      'jonin-skill/build-directives-manifest',
      'jonin-skill/source-fidelity-directives',
      'jonin-skill/nextjs-ui-expert',
      'jonin-skill/nextjs-code-expert',
      'jonin-skill/taste-skill-frontend-expert'
    ];
  } else if (fwLowerSrc.includes('svelte')) {
    frameworkSkillsSrc = [
      'jonin-skill/design-token-manifest',
      'jonin-skill/tailwind-design-system',
      'jonin-skill/build-directives-manifest',
      'jonin-skill/source-fidelity-directives',
      'jonin-skill/svelte-ui-expert',
      'jonin-skill/svelte-code-expert',
      'jonin-skill/taste-skill-frontend-expert'
    ];
  } else if (fwLowerSrc.includes('nuxt')) {
    frameworkSkillsSrc = [
      'jonin-skill/design-token-manifest',
      'jonin-skill/tailwind-design-system',
      'jonin-skill/build-directives-manifest',
      'jonin-skill/source-fidelity-directives',
      'jonin-skill/nuxt-ui-expert',
      'jonin-skill/nuxt-code-expert',
      'jonin-skill/taste-skill-frontend-expert'
    ];
  } else if (fwLowerSrc.includes('angular')) {
    frameworkSkillsSrc = [
      'jonin-skill/design-token-manifest',
      'jonin-skill/tailwind-design-system',
      'jonin-skill/build-directives-manifest',
      'jonin-skill/source-fidelity-directives',
      'jonin-skill/angular-ui-expert',
      'jonin-skill/angular-code-expert',
      'jonin-skill/taste-skill-frontend-expert'
    ];
  } else {
    frameworkSkillsSrc = [
      'jonin-skill/design-token-manifest',
      'jonin-skill/tailwind-design-system',
      'jonin-skill/build-directives-manifest',
      'jonin-skill/source-fidelity-directives'
    ];
  }

  for (const fsItem of frameworkSkillsSrc) {
    if (!agentSkills.includes(fsItem)) agentSkills.push(fsItem);
  }
  if (!agentSkills.includes('jonin-skill/taste-skill-frontend-expert')) {
    agentSkills.push('jonin-skill/taste-skill-frontend-expert');
  }

  const absoluteImagePaths = detectedImages.map(m => path.resolve(path.join(resolvedSourceDir, m.filename)));

  directives.push('You MUST follow the package.json template, CSS variables, design-token manifest, and routing rules from the embedded skill content below.');
  if (fwLowerSrc.includes('next') || fwLowerSrc.includes('react')) {
    directives.push('Next.js Version Mandate: MUST strictly use Next.js 16+ (next: ^16.3.3, react: ^19.0.0, react-dom: ^19.0.0, Tailwind CSS v4). Under NO circumstances should Next.js 15 or 14 be used for fresh builds.');
    directives.push('Use Next.js 16 App Router under app/ — NEVER hash-based SPA routing.');
    directives.push("Install the template dependencies including Tailwind CSS v4, ESLint, and the framework's production build tools.");
  } else if (fwLowerSrc.includes('svelte')) {
    directives.push('Use SvelteKit file-based routing under src/routes/ — NEVER hash-based SPA routing.');
    directives.push('Install the template dependencies including Tailwind CSS, ESLint, Prettier, and svelte-check.');
  } else if (fwLowerSrc.includes('nuxt')) {
    directives.push('Use Nuxt 4 file-based routing under app/pages/ and app/layouts/ — NEVER hash-based SPA routing.');
    directives.push('Install the template dependencies including Tailwind CSS, ESLint, and Nuxt build tools.');
  } else if (fwLowerSrc.includes('angular')) {
    directives.push('Use standalone Angular Router with app.routes.ts — NEVER hash-based SPA routing.');
    directives.push('Install the template dependencies including Tailwind CSS, ESLint, and Angular build tools.');
  } else {
    directives.push('Use framework-native routing — NEVER hash-based SPA routing.');
  }
  directives.push(`Provide the framework validation scripts: ${frameworkSpec.validation.join(', ')}. All validation must finish with zero errors and zero warnings.`);
  directives.push("Mandatory package.json Scripts Invariant: EVERY build across all frameworks (Next.js, SvelteKit, Nuxt, Angular) MUST strictly provide working package.json scripts for 'pnpm lint', 'pnpm build', and 'pnpm start' (plus 'pnpm check' for SvelteKit).");
  directives.push(`Apply Taste-Skill dials: DESIGN_VARIANCE=${validatedDials.design_variance}/10, MOTION_INTENSITY=${validatedDials.motion_intensity}/10, VISUAL_DENSITY=${validatedDials.visual_density}/10.`);

  let skillBlocks = [];
  let specConn = null;
  try {
    specConn = getDb();
    const fwBase = fwLowerSrc.includes('svelte') ? 'svelte' : (fwLowerSrc.includes('next') || fwLowerSrc.includes('react') ? 'nextjs' : (fwLowerSrc.includes('nuxt') ? 'nuxt' : (fwLowerSrc.includes('angular') ? 'angular' : null)));
    const criticalSkills = [
      fwBase ? `jonin-skill/${fwBase}-ui-expert` : null,
      fwBase ? `jonin-skill/${fwBase}-code-expert` : null,
      'jonin-skill/build-directives-manifest',
      'jonin-skill/design-token-manifest',
      'jonin-skill/source-fidelity-directives',
      'jonin-skill/taste-skill-frontend-expert'
    ].filter(Boolean);
    skillBlocks = loadSkillContentForBuild(criticalSkills, specConn);
  } catch (e) {
    process.stderr.write(`[mcp konoha] Error loading skill content for build_from_source: ${e.message}\n`);
  } finally {
    if (specConn) {
      try { specConn.close(); } catch (_) {}
    }
  }

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
    taste_skill_source: 'https://www.tasteskill.dev/guide',
    taste_skill_audits: ['em_dash', 'pre_flight', 'section_layout_repetition', 'hero_discipline', 'preservation', 'brand_fidelity'],
    detected_images: detectedImages,
    detected_sources: detectedSources,
    directives,
    image_to_code_required: detectedImages.length > 0,
    required_skills: agentSkills,
    skill_load_sequence: agentSkills,
    delegate_constraints: directives,
    absolute_image_paths: absoluteImagePaths,
    forbid_build_from_text: detectedImages.length > 0,
    taste_dials: validatedDials,
    scaffold_command: frameworkSpec.scaffold_command || '',
    validation_commands: frameworkSpec.validation,
    embedded_skill_content: skillBlocks
  };

  const res = JSON.stringify(spec);
  logToolCall('build_from_source', `name=${name}, source_dir=${sourceDir}, framework=${framework}`, res, agentName);
  return res;
}

function buildFromText(name, description, framework, agentName = null, tasteDials = null) {
  let frameworkSpec, validatedDials;
  try {
    const validated = validateBuildInput(name, description, framework, tasteDials);
    frameworkSpec = validated.frameworkSpec;
    validatedDials = validated.tasteDials;
  } catch (exc) {
    const res = JSON.stringify({ error: exc.message });
    logToolCall('build_from_text', `name=${name}, framework=${framework}`, res, agentName);
    return res;
  }
  // Infer after validation: description is guaranteed to be a non-empty string here
  const archetype = inferBuildArchetype(description);

  const displayFramework = frameworkSpec.display;
  let agentSkills = null;
  if (agentName) agentSkills = getAgentSkills(agentName);
  if (!agentSkills) agentSkills = getAgentSkills('jonin');
  if (!agentSkills) agentSkills = ['jonin-skill'];

  const fwLower = displayFramework.toLowerCase();
  let frameworkSkills = [];
  if (fwLower.includes('next') || fwLower.includes('react')) {
    frameworkSkills = [
      'jonin-skill/design-token-manifest',
      'jonin-skill/tailwind-design-system',
      'jonin-skill/build-directives-manifest',
      'jonin-skill/source-fidelity-directives',
      'jonin-skill/nextjs-ui-expert',
      'jonin-skill/nextjs-code-expert',
      'jonin-skill/taste-skill-frontend-expert'
    ];
  } else if (fwLower.includes('svelte')) {
    frameworkSkills = [
      'jonin-skill/design-token-manifest',
      'jonin-skill/tailwind-design-system',
      'jonin-skill/build-directives-manifest',
      'jonin-skill/source-fidelity-directives',
      'jonin-skill/svelte-ui-expert',
      'jonin-skill/svelte-code-expert',
      'jonin-skill/taste-skill-frontend-expert'
    ];
  } else if (fwLower.includes('nuxt')) {
    frameworkSkills = [
      'jonin-skill/design-token-manifest',
      'jonin-skill/tailwind-design-system',
      'jonin-skill/build-directives-manifest',
      'jonin-skill/source-fidelity-directives',
      'jonin-skill/nuxt-ui-expert',
      'jonin-skill/nuxt-code-expert',
      'jonin-skill/taste-skill-frontend-expert'
    ];
  } else if (fwLower.includes('angular')) {
    frameworkSkills = [
      'jonin-skill/design-token-manifest',
      'jonin-skill/tailwind-design-system',
      'jonin-skill/build-directives-manifest',
      'jonin-skill/source-fidelity-directives',
      'jonin-skill/angular-ui-expert',
      'jonin-skill/angular-code-expert',
      'jonin-skill/taste-skill-frontend-expert'
    ];
  } else {
    frameworkSkills = [
      'jonin-skill/design-token-manifest',
      'jonin-skill/tailwind-design-system',
      'jonin-skill/build-directives-manifest',
      'jonin-skill/source-fidelity-directives'
    ];
  }

  for (const fsItem of frameworkSkills) {
    if (!agentSkills.includes(fsItem)) agentSkills.push(fsItem);
  }
  if (!agentSkills.includes('jonin-skill/taste-skill-frontend-expert')) {
    agentSkills.push('jonin-skill/taste-skill-frontend-expert');
  }

  const routingDirective = frameworkSpec.routing;
  const scaffoldCommand = frameworkSpec.scaffold_command || '';
  const installDirective = 'Install and validate dependencies with pnpm, then run every command returned in validation_commands.';

  const buildDirectives = [
    `Build a premium, intentional ${displayFramework} website named '${name}' from this description: '${description}'.`,
    `Standard Project Scaffolding Command: When scaffolding a fresh project, use the official framework CLI command: '${scaffoldCommand}'.`,
    'Load Taste-Skill v2 once as the design source, declare the design read and explain each dial before implementation.',
    `Use framework-native routing: ${routingDirective}`,
    installDirective,
    'Framework Version Mandates: Next.js builds MUST strictly use Next.js with React 19 and Tailwind CSS (pnpm create next-app@latest). Svelte builds use SvelteKit 2 + Svelte 5 (pnpm dlx sv create <project-name>). Nuxt builds use Nuxt (pnpm dlx nuxi@latest init <project-name>). Angular builds use Angular 19+ (pnpm dlx @angular/cli@latest new <project-name> --package-manager=pnpm).',
    `Apply Taste-Skill dials: DESIGN_VARIANCE=${validatedDials.design_variance}/10, MOTION_INTENSITY=${validatedDials.motion_intensity}/10, VISUAL_DENSITY=${validatedDials.visual_density}/10, with one-line rationale for each.`,
    'Apply semantic design tokens, accessible keyboard and focus states, reduced-motion fallbacks, transform/opacity-only motion, and teardown for timers, observers, listeners, and animation frames.',
    'Run Taste-Skill audits before completion: zero em-dash or en-dash characters, Pre-Flight Check, section-layout repetition, hero discipline when a hero exists, and preservation/brand fidelity when an existing brand exists.',
    'Use distinctive editorial typography, cinematic section spacing, intentional CSS Grid or bento composition, mobile-safe min-h-[100dvh], and vector icons with no emojis in UI controls.',
    'Header Architecture Mandate: The brand logo MUST always be placed on the far LEFT of the navigation header with navigation links adjacent/centered and action buttons on the right. Never position the logo on the right or center.',
    'Mobile View Invariant (NO Top Menu Toggle in Header): In mobile view (lg:hidden), NEVER show a top menu toggle or hamburger button in the header. Mobile navigation is powered exclusively by the fixed bottom MobileDock.',
    'Floating Bottom-Left Theme Switcher Popup: Every text-based website build MUST include an interactive 10-Theme Light-Mode Switcher floating button in the bottom-left corner (fixed bottom-6 left-6 z-50, like a customer chat widget) in both desktop and mobile viewports that opens the 10-theme selection popup modal with dynamic CSS variables and localStorage persistence. Pure Light Mode is first-class (zero dark mode enforcement).',
    'Archetype-Adaptive Mobile Dock: Every text-based website build MUST include a fixed bottom mobile navigation dock (MobileDock) on mobile viewports (lg:hidden) with quick one-tap links dynamically adapted to the website archetype (e.g. E-commerce: Home, Shop, Themes, Wishlist, Cart; Portfolio: Home, Projects, Case Studies, About, Contact; Dashboard: Overview, Analytics, Users, Settings; SaaS: Home, Features, Pricing, Contact).',
    'Hero Banner Carousel Mandate: The homepage hero section MUST implement an interactive hero banner carousel with a minimum of 4 high-definition slides, autoplay (5000ms) with hover pause, previous/next chevron buttons, indicator thumbnails/dots, slide badges, and call-to-action buttons.',
    'Taste-Skill Prettification: Combine Taste-Skill principles (editorial typography, negative space, subtle 3D hover tilt, glassmorphic depth, smooth GPU transitions, zero emoji policy in UI controls) to enrich the visual polish without altering the default Konoha design.',
    "SSR & Hydration Safety Mandate: All interactive client components accessing localStorage, window, or document (ThemeSwitcher, HeroCarousel, MobileDock) MUST use 'use client' and an explicit useMounted() state guard before rendering localStorage-dependent DOM elements to guarantee 0 hydration mismatch errors.",
    'Essential Dependency Packages: Ensure required icon and utility packages (lucide-react / lucide-svelte / lucide-vue-next / lucide-angular, clsx, tailwind-merge) are installed during scaffolding to eliminate missing module errors.',
    'Zero Errors & Zero Warnings Mandate: Do not claim completion until every configured framework validation command (pnpm run build, pnpm run lint, pnpm run check for SvelteKit) passes cleanly with 0 errors and 0 warnings.'
  ];

  if (archetype === 'commerce') {
    buildDirectives.push(
      'Commerce features: implement a 50-item production catalog with reactive search, category filters, price range, sorting, pagination, product detail, cart, and checkout routes.',
      'Commerce hero: add the full-width interactive 4-slide 3D carousel with 1200px perspective, max 12deg tilt, 5000ms autoplay, split-drapes transition, thumbnails, and keyboard controls.',
      'Commerce shell: add the ten-theme light-mode switcher popup, sticky header search, mobile dock, lazy images, security headers, custom error pages, and Build by Konoha footer watermark.'
    );
  } else if (['dashboard', 'admin', 'infra'].includes(archetype)) {
    buildDirectives.push(
      'Dashboard Shell Architecture: implement a fixed Left Sidebar (hidden lg:flex w-64 flex-col border-r border-[var(--theme-border)] bg-white/95 min-h-screen sticky top-0) with brand logo at top-left, navigation links with badges, and user profile badge.',
      'Dashboard Top Header: sticky top bar (h-16 border-b border-[var(--theme-border)] bg-white/80 backdrop-blur-md px-6 flex items-center justify-between) with breadcrumb, global search bar, live status pill, and notification trigger.',
      'Dashboard KPI & Analytics Widgets: implement 4+ Metric KPI stat cards with trend percentage badges (+12.5%), SSR-safe interactive SVG Area/Line charts with time-range filters (24h, 7d, 30d), and filterable data tables with status pills (Healthy, Warning, Critical).',
      'Dashboard Mobile View: fixed bottom mobile dock (MobileDock) with quick one-tap links (Overview, Analytics, Servers/Users, Settings, Themes) and NO top hamburger menu toggle.'
    );
  } else if (archetype === 'portfolio') {
    buildDirectives.push(
      'Portfolio Hero Section: developer/designer introduction with editorial typography, interactive status badge, tech stack pills, resume download CTA, and social links.',
      'Projects Bento Grid: showcase 6+ rich projects with category filter tabs (All, Fullstack, AI, Mobile), tags, interactive modal preview dialogs, and live demo / GitHub links.',
      'Interactive Skills & Experience: category-filtered skills matrix (Frontend, Backend, DevOps, AI) with proficiency meters, and interactive career timeline.',
      'Contact & Inquiries: interactive contact form with client-side validation, instant feedback toast, and direct email/calendar booking triggers.',
      'Portfolio Mobile View: fixed bottom mobile dock (Home, Projects, Experience, Skills, Contact, Themes) with zero mobile header menu toggle.'
    );
  } else if (['landing', 'saas'].includes(archetype)) {
    buildDirectives.push(
      'SaaS/Landing Hero: high-impact value proposition hero with interactive product preview mockup or 4-slide hero banner carousel with 5000ms autoplay.',
      'Feature Bento Grid: interactive feature showcase with glassmorphism cards, hover tilt effects, and clear benefit descriptions.',
      'Interactive Pricing Tier Switcher: Monthly vs Annual billing toggle with 20% discount badge, feature comparison checklist, and highlighted Recommended tier.',
      'Social Proof & FAQ: client testimonials carousel, trusted company logos, and interactive FAQ accordion with smooth spring expansion.',
      'SaaS Mobile View: fixed bottom mobile dock (Home, Features, Pricing, Testimonials, Themes) with zero mobile header menu toggle.'
    );
  } else if (['company', 'corporate'].includes(archetype)) {
    buildDirectives.push(
      'Company Profile Hero: 4-slide mission and achievements banner carousel with high-definition slides and CTA buttons.',
      'Corporate Showcase: About Us narrative, leadership team grid, services/solutions interactive tab switcher, and client case studies.',
      'Contact & Locations: interactive inquiry form, office location cards, and company credentials.',
      'Corporate Mobile View: fixed bottom mobile dock (Home, About, Services, Case Studies, Contact, Themes) with zero mobile header menu toggle.'
    );
  } else if (archetype === 'documentation') {
    buildDirectives.push(
      'Documentation Layout: two-column or three-column documentation layout with sticky left sidebar navigation, central markdown/content reader, and right-hand On This Page table of contents.',
      'Doc Features: fast search modal (Cmd+K), interactive code blocks with copy-to-clipboard buttons, syntax highlighting, and callout alert boxes.',
      'Docs Mobile View: fixed bottom mobile dock (Docs, Guides, API, Search, Themes).'
    );
  } else {
    buildDirectives.push('Application features: infer only the routes and interactions required by the description, adhering strictly to the 4 layout invariants, 10 light-mode themes, and zero errors contract.');
  }
  buildDirectives.push("Mandatory package.json Scripts Invariant: EVERY build across all frameworks (Next.js, SvelteKit, Nuxt, Angular) MUST strictly provide working package.json scripts for 'pnpm lint', 'pnpm build', and 'pnpm start' (plus 'pnpm check' for SvelteKit).");

  let skillBlocks = [];
  let textConn = null;
  try {
    textConn = getDb();
    const fwBase = fwLower.includes('svelte') ? 'svelte' : (fwLower.includes('next') || fwLower.includes('react') ? 'nextjs' : (fwLower.includes('nuxt') ? 'nuxt' : (fwLower.includes('angular') ? 'angular' : null)));
    const criticalSkills = [
      fwBase ? `jonin-skill/${fwBase}-ui-expert` : null,
      fwBase ? `jonin-skill/${fwBase}-code-expert` : null,
      'jonin-skill/build-directives-manifest',
      'jonin-skill/design-token-manifest',
      'jonin-skill/taste-skill-frontend-expert'
    ].filter(Boolean);
    skillBlocks = loadSkillContentForBuild(criticalSkills, textConn);
  } catch (e) {
    process.stderr.write(`[mcp konoha] Error loading skill content for build_from_text: ${e.message}\n`);
  } finally {
    if (textConn) {
      try { textConn.close(); } catch (_) {}
    }
  }

  const spec = {
    status: 'success',
    project_name: name,
    framework: frameworkSpec.canonical,
    framework_display: displayFramework,
    mode: 'build_from_text',
    description,
    archetype,
    taste_skill_source: 'https://www.tasteskill.dev/guide',
    taste_skill_read: 'Load Taste-Skill v2 once, declare the design read, and explain each dial before implementation.',
    taste_skill_audits: ['em_dash', 'pre_flight', 'section_layout_repetition', 'hero_discipline', 'preservation', 'brand_fidelity'],
    design_tokens: { perspective: '1200px', tilt_max: '12deg', transition: '300ms', entrance: '500ms', hero_content_entrance: '600ms', hero_autoplay: '6000ms', theme_storage_key: 'konoha-theme' },
    directives: buildDirectives,
    required_skills: agentSkills,
    skill_load_sequence: agentSkills,
    delegate_constraints: buildDirectives,
    taste_dials: validatedDials,
    scaffold_command: frameworkSpec.scaffold_command || '',
    validation_commands: frameworkSpec.validation,
    embedded_skill_content: skillBlocks
  };

  const res = JSON.stringify(spec);
  logToolCall('build_from_text', `name=${name}, description=${description}, framework=${framework}`, res, agentName);
  return res;
}


module.exports = {
  BUILD_FRAMEWORKS,
  validateBuildInput,
  resolveBuildSourceDir,
  normalizeFrameworkName,
  loadSkillContentForBuild,
  inferBuildArchetype,
  frameworkSourceSignals,
  analyzeImageMetadata,
  buildFromSource,
  buildFromText
};
