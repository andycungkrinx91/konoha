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
  inferBuildArchetype,
  frameworkSourceSignals
} = require('./build_spec_common');
const {
  analyzeImageMetadata,
  buildFromSource
} = require('./build_spec_source');

function resolveTextSkills(displayFramework, agentName) {
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

function getArchetypeDirectives(archetype) {
  const map = {
    commerce: [
      'Commerce features: implement a 50-item production catalog with reactive search, category filters, price range, sorting, pagination, product detail, cart, and checkout routes.',
      'Commerce hero: add the full-width interactive 4-slide 3D carousel with 1200px perspective, max 12deg tilt, 5000ms autoplay, split-drapes transition, thumbnails, and keyboard controls.',
      'Commerce shell: add the ten-theme light-mode switcher popup, sticky header search, mobile dock, lazy images, security headers, custom error pages, and Build by Konoha footer watermark.'
    ],
    dashboard: [
      'Dashboard Shell Architecture: implement a fixed Left Sidebar (hidden lg:flex w-64 flex-col border-r border-[var(--theme-border)] bg-white/95 min-h-screen sticky top-0) with brand logo at top-left, navigation links with badges, and user profile badge.',
      'Dashboard Top Header: sticky top bar (h-16 border-b border-[var(--theme-border)] bg-white/80 backdrop-blur-md px-6 flex items-center justify-between) with breadcrumb, global search bar, live status pill, and notification trigger.',
      'Dashboard KPI & Analytics Widgets: implement 4+ Metric KPI stat cards with trend percentage badges (+12.5%), SSR-safe interactive SVG Area/Line charts with time-range filters (24h, 7d, 30d), and filterable data tables with status pills (Healthy, Warning, Critical).',
      'Dashboard Mobile View: fixed bottom mobile dock (MobileDock) with quick one-tap links (Overview, Analytics, Servers/Users, Settings, Themes) and NO top hamburger menu toggle.'
    ],
    portfolio: [
      'Portfolio Hero Section: developer/designer introduction with editorial typography, interactive status badge, tech stack pills, resume download CTA, and social links.',
      'Projects Bento Grid: showcase 6+ rich projects with category filter tabs (All, Fullstack, AI, Mobile), tags, interactive modal preview dialogs, and live demo / GitHub links.',
      'Interactive Skills & Experience: category-filtered skills matrix (Frontend, Backend, DevOps, AI) with proficiency meters, and interactive career timeline.',
      'Contact & Inquiries: interactive contact form with client-side validation, instant feedback toast, and direct email/calendar booking triggers.',
      'Portfolio Mobile View: fixed bottom mobile dock (Home, Projects, Experience, Skills, Contact, Themes) with zero mobile header menu toggle.'
    ],
    landing: [
      'SaaS/Landing Hero: high-impact value proposition hero with interactive product preview mockup or 4-slide hero banner carousel with 5000ms autoplay.',
      'Feature Bento Grid: interactive feature showcase with glassmorphism cards, hover tilt effects, and clear benefit descriptions.',
      'Interactive Pricing Tier Switcher: Monthly vs Annual billing toggle with 20% discount badge, feature comparison checklist, and highlighted Recommended tier.',
      'Social Proof & FAQ: client testimonials carousel, trusted company logos, and interactive FAQ accordion with smooth spring expansion.',
      'SaaS Mobile View: fixed bottom mobile dock (Home, Features, Pricing, Testimonials, Themes) with zero mobile header menu toggle.'
    ],
    company: [
      'Company Profile Hero: 4-slide mission and achievements banner carousel with high-definition slides and CTA buttons.',
      'Corporate Showcase: About Us narrative, leadership team grid, services/solutions interactive tab switcher, and client case studies.',
      'Contact & Locations: interactive inquiry form, office location cards, and company credentials.',
      'Corporate Mobile View: fixed bottom mobile dock (Home, About, Services, Case Studies, Contact, Themes) with zero mobile header menu toggle.'
    ],
    documentation: [
      'Documentation Layout: two-column or three-column documentation layout with sticky left sidebar navigation, central markdown/content reader, and right-hand On This Page table of contents.',
      'Doc Features: fast search modal (Cmd+K), interactive code blocks with copy-to-clipboard buttons, syntax highlighting, and callout alert boxes.',
      'Docs Mobile View: fixed bottom mobile dock (Docs, Guides, API, Search, Themes).'
    ]
  };
  return map[archetype] || ['Application features: infer only the routes and interactions required by the description, adhering strictly to the 4 layout invariants, 10 light-mode themes, and zero errors contract.'];
}

function assembleTextDirectives(options) {
  const { displayFramework, name, description, frameworkSpec, validatedDials, archetype } = options;
  const directives = [
    `Build a premium, intentional ${displayFramework} website named '${name}' from this description: '${description}'.`,
    `Standard Project Scaffolding Command: When scaffolding a fresh project, use the official framework CLI command: '${frameworkSpec.scaffold_command || ''}'.`,
    'Load Taste-Skill v2 once as the design source, declare the design read and explain each dial before implementation.',
    `Use framework-native routing: ${frameworkSpec.routing}`,
    'Install and validate dependencies with pnpm using rtk (e.g. rtk pnpm add <packages> --silent, rtk pnpm install --silent), then run every command returned in validation_commands.',
    'Framework Version Mandates: Next.js builds MUST strictly use Next.js with React 19 and a fully custom-themed Tailwind CSS setup (pnpm create next-app@latest). Svelte builds use SvelteKit 2 + Svelte 5 with scoped <style> styling (pnpm dlx sv create <project-name>). Nuxt builds use Nuxt (pnpm dlx nuxi@latest init <project-name>). Angular builds use Angular 19+ with hand-written SCSS (pnpm dlx @angular/cli@latest new <project-name> --package-manager=pnpm).',
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
    'Essential Dependency Packages: install the framework icon and utility packages during scaffolding using rtk (e.g. rtk pnpm add @phosphor-icons/react clsx --silent) to suppress verbose terminal output and prevent missing module errors.',
    ...humanBuiltFingerprintDirectives('build_from_text'),
    ...frameworkStylingDirectives(displayFramework),
    'Zero Errors & Zero Warnings Mandate: Do not claim completion until every configured framework validation command (pnpm run build, pnpm run lint, pnpm run check for SvelteKit) passes cleanly with 0 errors and 0 warnings.',
    "SDLC & Anti-Slop Delivery Gate: Verify Definition-of-Readiness compliance and run 'rtk aislop scan --changes' to ensure ai_slop_findings: 0 and ai_slop_clean: true before delivery.",
    ...getArchetypeDirectives(archetype),
    "Mandatory package.json Scripts Invariant: EVERY build across all frameworks (Next.js, SvelteKit, Nuxt, Angular) MUST strictly provide working package.json scripts for 'pnpm lint', 'pnpm build', and 'pnpm start' (plus 'pnpm check' for SvelteKit)."
  ];
  return Array.from(new Set(directives));
}

function getTextCriticalSkills(fwBase) {
  return [
    fwBase ? `jonin-skill/${fwBase}-ui-expert` : null,
    fwBase ? `jonin-skill/${fwBase}-code-expert` : null,
    'jonin-skill/build-directives-manifest',
    'jonin-skill/design-token-manifest',
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

  const archetype = inferBuildArchetype(description);
  const displayFramework = frameworkSpec.display;
  const agentSkills = resolveTextSkills(displayFramework, agentName);
  const directives = assembleTextDirectives({
    displayFramework, name, description, frameworkSpec, validatedDials, archetype
  });

  const spec = {
    status: 'success',
    project_name: name,
    framework: frameworkSpec.canonical,
    framework_display: displayFramework,
    mode: 'build_from_text',
    description,
    archetype,
    taste_skill_source: process.env.KONOHA_TASTE_SKILL_DOCS || 'https://www.tasteskill.dev/guide',
    taste_skill_read: 'Load Taste-Skill v2 once, declare the design read, and explain each dial before implementation.',
    taste_skill_audits: ['em_dash', 'pre_flight', 'section_layout_repetition', 'hero_discipline', 'preservation', 'brand_fidelity', 'zero_ai_slop', 'sdlc_readiness'],
    design_tokens: { perspective: '1200px', tilt_max: '12deg', transition: '300ms', entrance: '500ms', hero_content_entrance: '600ms', hero_autoplay: '6000ms', theme_storage_key: 'konoha-theme' },
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
  inferBuildArchetype,
  frameworkSourceSignals,
  analyzeImageMetadata,
  buildFromSource,
  buildFromText
};
