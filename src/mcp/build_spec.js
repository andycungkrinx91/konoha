'use strict';

const { getDb } = require('../db');
const { getAgentSkills, logToolCall } = require('./skills');
const {
  BUILD_FRAMEWORKS,
  humanBuiltFingerprintDirectives,
  frameworkStylingDirectives,
  validateBuildInput,
  resolveBuildSourceDir,
  normalizeFrameworkName,
  loadSkillContentForBuild,
  DESIGN_BRIEF_FIELDS,
  buildDesignBrief,
  frameworkSourceSignals
} = require('./build_spec_common');
const {
  analyzeImageMetadata,
  buildFromSource
} = require('./build_spec_source');
const {
  getFrameworkMotion3dBlueprint
} = require('../workflow/chunin-intel/framer_marketplace_rea');

function resolveTextSkills(displayFramework, agentName) {
  let skills = agentName ? getAgentSkills(agentName) : null;
  if (!skills) skills = getAgentSkills('jonin') || ['jonin-skill'];

  const fwLower = displayFramework.toLowerCase();
  const basePrefix = fwLower.includes('svelte') ? 'svelte' : (fwLower.includes('next') || fwLower.includes('react') ? 'nextjs' : (fwLower.includes('nuxt') ? 'nuxt' : (fwLower.includes('angular') ? 'angular' : null)));

  const frameworkSkills = [
    'jonin-skill/tailwind-design-system',
    'jonin-skill/build-directives-manifest',
    'jonin-skill/source-fidelity-directives',
    'jonin-skill/framer-motion-animator',
    'jonin-skill/svg-animation-motion-expert',
    'jonin-skill/web-3d-graphics-expert',
    'jonin-skill/glsl-shader-expert'
  ];
  if (basePrefix) {
    frameworkSkills.push(
      `jonin-skill/${basePrefix}-ui-expert`,
      `jonin-skill/${basePrefix}-code-expert`,
      `jonin-skill/motion-${basePrefix}`
    );
  }
  frameworkSkills.push('jonin-skill/taste-skill-frontend-expert');

  for (const s of frameworkSkills) {
    if (!skills.includes(s)) skills.push(s);
  }
  return skills;
}

function assembleTextDirectives(options) {
  const { displayFramework, name, description, frameworkSpec, validatedDials } = options;
  const directives = [
    `Build a dynamic, distinctive, professionally composed ${displayFramework} website named '${name}' from this description: '${description}'.`,
    `Design Brief Mandate: author this brief before any code — ${DESIGN_BRIEF_FIELDS.join(', ')} — then derive art direction, IA, and motion from it. No default page composition.`,
    `Standard Project Scaffolding Command: When scaffolding a fresh project, use the official framework CLI command: '${frameworkSpec.scaffold_command || ''}'.`,
    'Use Taste-Skill references only as a craft checklist after the brief is authored; they are not the design source of truth.',
    'Framer Marketplace Component Discovery & Chunin Playwright REA: Use https://www.framer.com/marketplace/components/ as the primary dynamic component discovery source. Have @chunin perform Playwright REA on live Marketplace component previews (inspecting both free and paid components across hover, click, animation, scroll, and responsive viewports). Paid components are evaluated via live preview only — never extract protected source or inject Marketplace iframes; recreate observed design and motion natively in the target framework and record component provenance in project documentation.',
    'Online Design Reference Research Mandate: Before writing code in Build from Text mode, research online design references via konoha.web_search to establish domain art direction, spatial depth, lighting, material hierarchy, and 3D motion choreography.',
    `Use framework-native routing: ${frameworkSpec.routing}`,
    'Install and validate dependencies with pnpm using rtk (e.g. rtk pnpm add <packages> --silent, rtk pnpm install --silent), then run every command returned in validation_commands.',
    'Framework Version Mandates: Next.js builds MUST strictly use Next.js with React 19 and a custom-themed Tailwind CSS setup (pnpm create next-app@latest). Svelte builds use SvelteKit 2 + Svelte 5 with scoped <style> styling (pnpm dlx sv create <project-name>). Nuxt builds use Nuxt (pnpm dlx nuxi@latest init <project-name>). Angular builds use Angular 19+ with hand-written SCSS (pnpm dlx @angular/cli@latest new <project-name> --package-manager=pnpm).',
    `Apply Taste-Skill dials: DESIGN_VARIANCE=${validatedDials.design_variance}/10, MOTION_INTENSITY=${validatedDials.motion_intensity}/10, VISUAL_DENSITY=${validatedDials.visual_density}/10, with one-line rationale for each.`,
    'Anti-Template Gate: (1) brief authored for this domain, (2) every section maps to a brief objective, (3) zero unrequested commerce/SaaS/catalog/pricing/cart/checkout/testimonials, (4) layout not recycled from a prior project, (5) motion/3D justified by the brief, (6) responsive plan for 375/768/1440. Any failure means redesign, not restyle.',
    'Theme Strategy: derive one project-specific color system from the brief; single vs dual theme is an audience/domain decision (dark-only cinema or light-only clinic are both valid). WCAG AA contrast; theme control only when both modes exist. Strictly ZERO emojis or emoticons in UI copy, headings, buttons, badges, or metadata (vector icons only).',
    'Required Konoha Branding & Metadata: Render the exact visible footer text `Build by konoha` and include `<meta name="generator" content="Build by konoha">` in the HTML `<head>`.',
    'Real-Time Live Browser Monitoring & Meaningful Tests: Launch the dev server and open the live browser monitor (`live_browser_monitor`) so the user can watch progress in real time, and include meaningful automated smoke/interaction test scripts (`pnpm test`). After verification, generate/update the project maintenance skill into Konoha Project Knowledge RAG.',
    'Optional Figma & OpenDesign Integration: If Figma or OpenDesign exports (`*.fig`, `design-tokens.json`, `opendesign.json`) or live Figma/OpenDesign MCP tools are available, honor their tokens and layout; otherwise proceed autonomously.',
    'Apply semantic design tokens, accessible keyboard and focus states, reduced-motion fallbacks, transform/opacity-only motion, and teardown for timers, observers, listeners, and animation frames.',
    'Run Taste-Skill audits before completion: zero em-dash or en-dash characters, Pre-Flight Check, section-layout repetition, hero discipline when a hero exists, and preservation/brand fidelity when an existing brand exists.',
    "SSR & Hydration Safety Mandate: All interactive client components accessing localStorage, window, or document MUST use 'use client' (in Next.js) and an explicit mounted guard before rendering client-only state to guarantee 0 hydration mismatch errors.",
    'Essential Dependency Packages: install the framework icon and utility packages during scaffolding using rtk (e.g. rtk pnpm add @phosphor-icons/react clsx --silent) to suppress verbose terminal output and prevent missing module errors.',
    ...humanBuiltFingerprintDirectives('build_from_text'),
    ...frameworkStylingDirectives(displayFramework),
    'Zero Errors & Zero Warnings Mandate: Do not claim completion until every configured framework validation command (pnpm run build, pnpm run lint, pnpm run check for SvelteKit) passes cleanly with 0 errors and 0 warnings.',
    "SDLC & Anti-Slop Delivery Gate: Verify Definition-of-Readiness compliance and run 'rtk aislop scan --changes' to ensure ai_slop_findings: 0 and ai_slop_clean: true before delivery.",
    "Mandatory package.json Scripts Invariant: EVERY build across all frameworks (Next.js, SvelteKit, Nuxt, Angular) MUST strictly provide working package.json scripts for 'pnpm lint', 'pnpm build', and 'pnpm start' (plus 'pnpm check' for SvelteKit)."
  ];
  return Array.from(new Set(directives));
}

function getTextCriticalSkills(fwBase) {
  return [
    fwBase ? `jonin-skill/${fwBase}-ui-expert` : null,
    fwBase ? `jonin-skill/${fwBase}-code-expert` : null,
    fwBase ? `jonin-skill/motion-${fwBase}` : null,
    'jonin-skill/framer-motion-animator',
    'jonin-skill/svg-animation-motion-expert',
    'jonin-skill/web-3d-graphics-expert',
    'jonin-skill/glsl-shader-expert',
    'jonin-skill/build-directives-manifest',
    'jonin-skill/tailwind-design-system',
    'jonin-skill/taste-skill-frontend-expert'
  ].filter(Boolean);
}

function safeCloseDb(conn) {
  if (!conn) return;
  try { conn.close(); } catch (_) { /* intentional fallback */ }
}

function loadEmbeddedTextSkills(displayFramework) {
  let skillBlocks = [];
  const fwLower = displayFramework.toLowerCase();
  const fwBase = fwLower.includes('svelte') ? 'svelte' : (fwLower.includes('next') || fwLower.includes('react') ? 'nextjs' : (fwLower.includes('nuxt') ? 'nuxt' : (fwLower.includes('angular') ? 'angular' : null)));
  const criticalSkills = getTextCriticalSkills(fwBase);
  let textConn = null;
  try {
    textConn = getDb();
    skillBlocks = loadSkillContentForBuild(criticalSkills, textConn);
  } catch (e) {
    process.stderr.write(`[mcp konoha] Error loading skill content for build_from_text: ${e.message}\n`);
  } finally {
    safeCloseDb(textConn);
  }
  return skillBlocks;
}

function buildFromText(name, description, framework, options = {}) {
  const agentName = (options && typeof options === 'object') ? options.agentName : (typeof options === 'string' ? options : null);
  const tasteDials = (options && typeof options === 'object' && !Array.isArray(options) && options.tasteDials !== undefined)
    ? options.tasteDials
    : arguments[4];

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

  const displayFramework = frameworkSpec.display;
  const agentSkills = resolveTextSkills(displayFramework, agentName);
  const motion3dBlueprint = getFrameworkMotion3dBlueprint(frameworkSpec.canonical);
  const directives = assembleTextDirectives({
    displayFramework, name, description, frameworkSpec, validatedDials
  });
  directives.push(
    `Motion & 3D Stack (${motion3dBlueprint.display}): Use ${motion3dBlueprint.motion_architecture.primary_library} for springs/gestures/layout/scroll and ${motion3dBlueprint.three_d_rendering_approach.primary_stack.join(' + ')} for interactive 3D scenes with shaders, lighting, particles, and GPU disposal.`
  );

  const spec = {
    status: 'success',
    project_name: name,
    framework: frameworkSpec.canonical,
    framework_display: displayFramework,
    mode: 'build_from_text',
    creation_mode: 'build_from_text',
    creation_modes_supported: ['build_from_image', 'build_from_text', 'build_from_source'],
    online_reference_research_required: true,
    component_discovery_source: 'https://www.framer.com/marketplace/components/',
    chunin_playwright_rea_required: true,
    chunin_rea_findings: {
      discovery_source: 'https://www.framer.com/marketplace/components/',
      target_framework: motion3dBlueprint.framework,
      motion_library: motion3dBlueprint.motion_architecture.primary_library,
      motion_primitives: motion3dBlueprint.motion_architecture.primitives,
      three_d_stack: motion3dBlueprint.three_d_rendering_approach.primary_stack,
      dependencies: motion3dBlueprint.dependencies_and_versions,
      reference_docs: motion3dBlueprint.reference_docs
    },
    framer_licensing_boundaries: {
      evaluate_free_and_paid: true,
      no_protected_source_extraction: true,
      no_iframe_injection: true,
      native_framework_recreation: true
    },
    description,
    design_brief: buildDesignBrief(name, description),
    taste_skill_source: process.env.KONOHA_TASTE_SKILL_DOCS || 'https://www.tasteskill.dev/guide',
    taste_skill_read: 'Reference Taste-Skill craft notes after the design brief is authored; they are a checklist, not the design source.',
    taste_skill_audits: ['em_dash', 'pre_flight', 'section_layout_repetition', 'hero_discipline', 'preservation', 'brand_fidelity', 'zero_ai_slop', 'sdlc_readiness'],
    design_tokens: {
      perspective: '1200px',
      tilt_max: '12deg',
      transition: '300ms',
      entrance: '500ms',
      hero_content_entrance: '600ms',
      generator_meta: '<meta name="generator" content="Build by konoha">',
      footer_signature: 'Build by konoha',
      zero_emoji_policy: true
    },
    directives,
    required_skills: agentSkills,
    skill_load_sequence: agentSkills,
    delegate_constraints: directives,
    taste_dials: validatedDials,
    scaffold_command: frameworkSpec.scaffold_command || '',
    validation_commands: frameworkSpec.validation,
    embedded_skill_content: loadEmbeddedTextSkills(displayFramework)
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
  DESIGN_BRIEF_FIELDS,
  buildDesignBrief,
  frameworkSourceSignals,
  analyzeImageMetadata,
  buildFromSource,
  buildFromText
};
