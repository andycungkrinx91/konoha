'use strict';

/**
 * Chunin Playwright-Driven Research, Evaluation, and Assessment (REA)
 * for Framer Marketplace, Framework Motion Engines, and Interactive 3D WebGL/WebGPU.
 * Primary discovery source: https://www.framer.com/marketplace/components/
 */

const fs = require('fs');
const path = require('path');

const FRAMER_MARKETPLACE_URL = 'https://www.framer.com/marketplace/components/';

const RESPONSIVE_VIEWPORTS = [
  { id: 'mobile', width: 375, height: 812 },
  { id: 'tablet', width: 768, height: 1024 },
  { id: 'desktop', width: 1440, height: 900 }
];

const SUPPORTED_FRAMEWORKS = ['nextjs', 'react', 'nuxt', 'vue', 'svelte', 'sveltekit', 'angular'];

const BASE_THREE_DEPS = {
  motion: '^12.6.0',
  three: '^0.174.0',
  '@types/three': '^0.174.0'
};

const FRAMEWORK_MOTION_3D_BLUEPRINTS = {
  nextjs: {
    framework: 'nextjs',
    display: 'Next.js 16 + React 19',
    reference_docs: [
      'https://motion.dev/docs/react-quick-start',
      'https://r3f.docs.pmnd.rs/getting-started/introduction',
      'https://threejs.org/docs/',
      'https://gsap.com/docs/v3/',
      FRAMER_MARKETPLACE_URL
    ],
    motion_architecture: {
      primary_library: 'motion/react',
      secondary_timeline_library: 'gsap',
      primitives: ['motion', 'AnimatePresence', 'LayoutGroup', 'useSpring', 'useMotionValue', 'useTransform', 'useScroll', 'useReducedMotion'],
      capabilities: [
        'Spring-based physics interactions (stiffness, damping, mass)',
        'AnimatePresence enter/exit & cinematic page transitions',
        'Shared-layout (layoutId) & FLIP layout transitions',
        'Pointer gestures, magnetic hover, and bounded drag',
        'Scroll-linked storytelling & GSAP pinned timelines',
        'Staggered variant choreography and state-driven transitions'
      ]
    },
    three_d_rendering_approach: {
      primary_stack: ['@react-three/fiber', '@react-three/drei', 'three'],
      renderer: 'THREE.WebGLRenderer / THREE.WebGPURenderer inside client leaf boundary',
      scene_elements: [
        'PerspectiveCamera with pointer & scroll-reactive orbital rig',
        'Custom GLSL/TSL shader material + physical PBR material hierarchy',
        'Directional key light, rim point light, and ambient hemisphere fill',
        'GPU BufferGeometry particle field with per-vertex phase attributes',
        'Deterministic geometry.dispose(), material.dispose(), and renderer.dispose() on unmount'
      ]
    },
    dependencies_and_versions: {
      ...BASE_THREE_DEPS,
      '@react-three/fiber': '^9.0.0',
      '@react-three/drei': '^10.0.0',
      gsap: '^3.12.7'
    },
    compatibility_and_limitations: [
      "Declare 'use client' at line 1 of every component importing 'motion/react', 'three', or '@react-three/fiber'.",
      'Keep app/layout.tsx and app/page.tsx as Server Components for SEO metadata and wrap interactive 3D canvases in client boundaries with mounted/reduced-motion guards.'
    ]
  },
  nuxt: {
    framework: 'nuxt',
    display: 'Nuxt 4 + Vue 3.5',
    reference_docs: [
      'https://motion.dev/docs/vue',
      'https://docs.tresjs.org/',
      'https://threejs.org/docs/',
      'https://nuxt.com/docs',
      FRAMER_MARKETPLACE_URL
    ],
    motion_architecture: {
      primary_library: 'motion-v',
      secondary_timeline_library: 'motion',
      primitives: ['Motion', 'AnimatePresence', 'useMotionValue', 'useSpring', 'useScroll', 'useTransform', 'animate', 'inView', 'scroll', 'stagger', 'spring'],
      capabilities: [
        'Declarative <Motion> and <AnimatePresence> spring physics in Vue SFCs',
        'Imperative motion WAAPI/spring choreography (animate, inView, scroll, stagger)',
        'Pointer tilt, magnetic hover, press rebound, and drag gestures',
        'Layout state morphing and route transition hooks',
        'Scroll-linked narrative sections with reduced-motion fallback'
      ]
    },
    three_d_rendering_approach: {
      primary_stack: ['@tresjs/core', 'three'],
      renderer: 'TresCanvas or THREE.WebGLRenderer mounted inside <ClientOnly> / onMounted()',
      scene_elements: [
        'Reactive PerspectiveCamera driven by Vue refs and pointer/scroll coordinates',
        'Custom ShaderMaterial with time/pointer uniforms and PBR TorusKnot/Icosahedron centerpiece',
        'Multi-source directional and point lighting with specular highlights',
        'BufferGeometry starfield/particle cloud updated in requestAnimationFrame loop',
        'Deterministic cleanup inside onBeforeUnmount() disposing geometries, materials, and WebGLRenderer'
      ]
    },
    dependencies_and_versions: {
      'motion-v': '^1.0.0',
      ...BASE_THREE_DEPS,
      '@tresjs/core': '^4.3.0'
    },
    compatibility_and_limitations: [
      'Never use React framer-motion or legacy @vueuse/motion in Nuxt 4; use motion-v and motion.',
      'Guard all imperative DOM/WebGL access inside onMounted() and wrap 3D canvases in <ClientOnly> to guarantee zero Nuxt SSR hydration mismatches.'
    ]
  },
  svelte: {
    framework: 'svelte',
    display: 'SvelteKit 2 + Svelte 5 (Runes)',
    reference_docs: [
      'https://svelte.dev/docs/svelte/svelte-motion',
      'https://threlte.xyz/docs/',
      'https://motion.dev/docs/quick-start',
      'https://threejs.org/docs/',
      FRAMER_MARKETPLACE_URL
    ],
    motion_architecture: {
      primary_library: 'svelte/motion',
      secondary_timeline_library: 'motion',
      primitives: ['Spring', 'Tween', 'flip', 'animate', 'inView', 'scroll', 'stagger', 'spring'],
      capabilities: [
        'Svelte 5 class-based Spring and Tween physics bound to $state and $derived Runes',
        'Svelte flip layout animations and transition directives (fly, fade, scale)',
        'Reusable Svelte actions (use:motionReveal) powered by motion inView/animate/stagger',
        'Pointer-tracking 3D card tilt, magnetic dock magnification, and drag gestures',
        'Scroll-linked storytelling with prefers-reduced-motion compliance'
      ]
    },
    three_d_rendering_approach: {
      primary_stack: ['@threlte/core', '@threlte/extras', 'three'],
      renderer: 'Threlte <Canvas> or direct THREE.WebGLRenderer inside Svelte 5 $effect / onMount',
      scene_elements: [
        'Interactive PerspectiveCamera responding to Spring-smoothed pointer and scroll state',
        'Custom GLSL ShaderMaterial + physical crystalline mesh hierarchy',
        'Dynamic key/rim lighting and instanced/buffer particle field',
        'Svelte 5 $effect teardown disposing all Three.js geometries, materials, and renderer'
      ]
    },
    dependencies_and_versions: {
      ...BASE_THREE_DEPS,
      '@threlte/core': '^8.0.0',
      '@threlte/extras': '^9.0.0'
    },
    compatibility_and_limitations: [
      'Use Svelte 5 class primitives (new Spring(), new Tween()) rather than deprecated Svelte 4 writable stores where Svelte 5 Runes are active.',
      'Initialize WebGL contexts inside onMount or $effect so SvelteKit SSR renders clean fallback markup.'
    ]
  },
  angular: {
    framework: 'angular',
    display: 'Angular 19/20+ Standalone & Signals',
    reference_docs: [
      'https://angular.dev/guide/animations',
      'https://angular-three.netlify.app/',
      'https://motion.dev/docs/quick-start',
      'https://gsap.com/docs/v3/',
      'https://threejs.org/docs/',
      FRAMER_MARKETPLACE_URL
    ],
    motion_architecture: {
      primary_library: 'motion',
      secondary_timeline_library: 'gsap',
      primitives: ['animate.enter', 'animate.leave', 'signal', 'computed', 'afterNextRender', 'DestroyRef', 'animate', 'inView', 'scroll', 'stagger', 'spring', 'gsap'],
      capabilities: [
        'Modern Angular animate.enter and animate.leave lifecycle animations (no deprecated @angular/animations DSL)',
        'Signal-driven spring physics and imperative motion/GSAP choreography inside afterNextRender()',
        'Pointer 3D tilt, magnetic hover, press rebound, and drag gestures',
        'Scroll-linked storytelling and staggered section reveals',
        'Deterministic teardown registered via DestroyRef.onDestroy()'
      ]
    },
    three_d_rendering_approach: {
      primary_stack: ['angular-three', 'three'],
      renderer: 'NgtCanvas or THREE.WebGLRenderer initialized in afterNextRender() via NgZone.runOutsideAngular()',
      scene_elements: [
        'PerspectiveCamera with Signal-fed pointer and scroll parallax interpolation',
        'Custom GLSL ShaderMaterial + PBR geometric core with wireframe orbital rings',
        'Directional, point, and ambient lighting with GPU particle buffer',
        'NgZone.runOutsideAngular requestAnimationFrame loop with full DestroyRef GPU disposal'
      ]
    },
    dependencies_and_versions: {
      motion: '^12.6.0',
      gsap: '^3.12.7',
      three: '^0.174.0',
      '@types/three': '^0.174.0',
      'angular-three': '^2.0.0'
    },
    compatibility_and_limitations: [
      'Avoid deprecated @angular/animations trigger/state/transition DSL in modern Angular 19/20+ builds; prefer native animate.enter/animate.leave, motion, and GSAP.',
      'Always execute Three.js requestAnimationFrame loops inside NgZone.runOutsideAngular() inside afterNextRender() to prevent redundant zone change detection.'
    ]
  }
};

function normalizeTargetFramework(raw) {
  const fw = String(raw || 'nextjs').trim().toLowerCase();
  if (fw.includes('next') || fw.includes('react')) return 'nextjs';
  if (fw.includes('nuxt') || fw.includes('vue')) return 'nuxt';
  if (fw.includes('svelte')) return 'svelte';
  if (fw.includes('angular') || fw === 'ng') return 'angular';
  return 'nextjs';
}

function getFrameworkMotion3dBlueprint(rawFramework = 'nextjs') {
  const fw = normalizeTargetFramework(rawFramework);
  return FRAMEWORK_MOTION_3D_BLUEPRINTS[fw] || FRAMEWORK_MOTION_3D_BLUEPRINTS.nextjs;
}

const DOMAIN_HINT_LABELS = {
  corporate_business: 'Corporate & business',
  saas_production: 'SaaS & production product',
  ai_developer_tools: 'AI & developer tools',
  admin_operations: 'Admin & operations console',
  creative_agency_studio: 'Creative agency & studio',
  personal_portfolio: 'Personal portfolio',
  architecture_interior: 'Architecture & interior studio',
  education_research: 'Education & research',
  media_journalism: 'Media & journalism',
  healthcare_wellness: 'Healthcare & wellness',
  finance_fintech: 'Finance & fintech',
  community_social: 'Community & social',
  events_entertainment: 'Events & entertainment',
  nonprofit_public: 'Nonprofit & public service',
  documentation_knowledge: 'Documentation & knowledge base',
  ecommerce_marketplace: 'E-commerce & marketplace'
};

function hintLabel(hint) {
  return DOMAIN_HINT_LABELS[hint] || String(hint).replace(/_/g, ' ');
}

function _buildDomainCandidateCatalog(domainHints = []) {
  const hints = Array.from(new Set(Array.isArray(domainHints) ? domainHints : [])).slice(0, 4);
  return hints.map((hint, index) => ({
    id: `rea-${hint}-${index}`,
    name: `${hintLabel(hint)} reference candidate`,
    category: 'domain-research-target',
    domain_hint: hint,
    marketplace_url: FRAMER_MARKETPLACE_URL,
    preview_url: null,
    pricing: { tier: 'unknown', price_usd: null, license: 'evaluate-at-preview' },
    previewable: false,
    suitability_score: null,
    quality_score: null,
    observed_tokens: null
  }));
}

function discoverFramerMarketplaceComponents(options = {}) {
  const domainHints = Array.isArray(options.domainHints) ? options.domainHints : [];
  const targetFramework = normalizeTargetFramework(options.framework || options.targetFramework);
  const candidates = _buildDomainCandidateCatalog(domainHints);

  return {
    source_url: FRAMER_MARKETPLACE_URL,
    discovered_at: new Date().toISOString(),
    domain_hints: candidates.map((c) => c.domain_hint),
    target_framework: targetFramework,
    framework_blueprint: getFrameworkMotion3dBlueprint(targetFramework),
    total_discovered: candidates.length,
    needs_domain_hint: candidates.length === 0,
    includes_free_and_paid: candidates.some((c) => c.pricing.tier === 'free') && candidates.some((c) => c.pricing.tier === 'paid'),
    research_instruction: 'Inspect 3-5 live references matching each domain hint via Playwright; return observed layout, type scale, motion, and interaction notes. Findings inform original decisions; never reproduce a reference layout.',
    components: candidates
  };
}
async function _measureResponsiveViewports(page) {
  const responsiveChecks = [];
  for (const vp of RESPONSIVE_VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const metrics = await page.evaluate(() => ({
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      viewportWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      bodyWidth: Math.round(document.body.getBoundingClientRect().width),
      canvasCount: document.querySelectorAll('canvas').length
    }));
    responsiveChecks.push({
      viewport: vp.id,
      width: vp.width,
      height: vp.height,
      overflow_x: Boolean(metrics.overflowX),
      client_width: metrics.viewportWidth,
      scroll_width: metrics.scrollWidth,
      body_width: metrics.bodyWidth,
      canvas_count: metrics.canvasCount
    });
  }
  return responsiveChecks;
}

function _isNavigablePreview(component) {
  const url = component && component.preview_url;
  return typeof url === 'string' && url.startsWith('https://');
}

async function _runPlaywrightPreviewProbe(component, observations) {
  let browser = null;
  try {
    const pw = require('@playwright/test');
    if (!pw || !pw.chromium) {
      observations.navigation_failed = true;
      return;
    }
    browser = await pw.chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto(component.preview_url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    observations.navigated = true;
    observations.measured = await page.evaluate(() => ({
      canvas_count: document.querySelectorAll('canvas').length,
      media_count: document.querySelectorAll('video, canvas').length,
      body_transition: getComputedStyle(document.body).transitionDuration
    }));
    observations.measured.has_motion = observations.measured.body_transition !== '0s';
    observations.responsive_viewports = await _measureResponsiveViewports(page);
  } catch (_) {
    observations.navigated = false;
    observations.navigation_failed = true;
  } finally {
    if (browser) {
      try { await browser.close(); } catch (_) { /* ignore */ }
    }
  }
}

async function _inspectPreviewWithPlaywright(component, options = {}) {
  const base = { engine: 'playwright-chromium', attempted: false, navigated: false };
  if (!_isNavigablePreview(component)) {
    return { ...base, reason: 'no_preview_url', measured: null, responsive_viewports: null, interaction_notes: null };
  }
  const observations = { ...base, attempted: true, measured: null, responsive_viewports: null, interaction_notes: null };
  if (options.runPlaywrightProbe !== false) {
    await _runPlaywrightPreviewProbe(component, observations);
  }
  return observations;
}

async function performFramerComponentREA(options = {}) {
  const discovery = discoverFramerMarketplaceComponents(options);
  const targetFramework = discovery.target_framework;
  const blueprint = getFrameworkMotion3dBlueprint(targetFramework);
  const evaluatedComponents = [];

  for (const comp of discovery.components) {
    const isPaid = comp.pricing.tier === 'paid';
    const observations = await _inspectPreviewWithPlaywright(comp, options);
    evaluatedComponents.push({
      component_id: comp.id,
      component_name: comp.name,
      reference_url: comp.preview_url,
      marketplace_url: comp.marketplace_url,
      preview_url: comp.preview_url,
      pricing: comp.pricing,
      preview_evaluated: observations.navigated === true,
      observed: observations.measured,
      motion_architecture: blueprint.motion_architecture,
      three_d_rendering_approach: blueprint.three_d_rendering_approach,
      suitable_framework_implementation: {
        framework: targetFramework,
        display: blueprint.display,
        adaptation_mode: isPaid
          ? 'independent_clean_room_native_recreation_from_observed_preview'
          : 'native_framework_adaptation_from_observed_preview'
      },
      dependencies_and_versions: blueprint.dependencies_and_versions,
      compatibility_and_limitations: blueprint.compatibility_and_limitations,
      evidence_and_recommendations: {
        playwright_live_inspected: observations.navigated === true,
        reference_docs: blueprint.reference_docs,
        astra_fable_storytelling: [
          'Choreograph hero entrance with staggered spring physics + interactive 3D canvas depth',
          'Couple scroll progress and pointer coordinates to 3D camera rig and shader uniforms',
          'Provide instant static fallback when prefers-reduced-motion: reduce is active'
        ]
      },
      quality_assessment: {
        quality_score: comp.quality_score,
        suitability_score: comp.suitability_score,
        accessibility_verified: null,
        reduced_motion_ready: null
      },
      dependencies_assessment: {
        external_framer_runtime_allowed: false,
        iframe_embed_allowed: false,
        native_dependencies: Object.keys(blueprint.dependencies_and_versions)
      },
      framework_compatibility: {
        nextjs: true,
        nuxt: true,
        svelte: true,
        angular: true,
        selected_target: targetFramework
      },
      licensing_boundary: {
        tier: comp.pricing.tier,
        source_license_available: !isPaid,
        protected_source_extracted: false,
        iframe_injected: false,
        arbitrary_code_injected: false,
        implementation_strategy: isPaid
          ? 'independent_clean_room_native_recreation_from_observed_preview'
          : 'native_framework_adaptation_from_observed_preview'
      },
      observations
    });
  }

  const reaReport = {
    status: 'completed',
    agent: 'chunin',
    recipient_agent: 'jonin',
    discovery_source: FRAMER_MARKETPLACE_URL,
    target_framework: targetFramework,
    framework_blueprint: blueprint,
    evaluated_at: new Date().toISOString(),
    free_and_paid_evaluated: evaluatedComponents.some((c) => c.pricing.tier === 'free') &&
      evaluatedComponents.some((c) => c.pricing.tier === 'paid'),
    components: evaluatedComponents
  };

  if (options.taskDir) {
    try {
      fs.mkdirSync(options.taskDir, { recursive: true });
      const outPath = path.join(options.taskDir, 'chunin_framer_rea.json');
      fs.writeFileSync(outPath, JSON.stringify(reaReport, null, 2), 'utf8');
      reaReport.evidence_path = outPath;
    } catch (_) { /* best-effort write */ }
  }

  return reaReport;
}

function adaptFramerComponentToFramework(componentRea, rawFramework = 'nextjs') {
  const fw = normalizeTargetFramework(rawFramework);
  const comp = componentRea || {};
  const observedMotion = comp.observations?.animation_behavior;
  const spring = (observedMotion && typeof observedMotion === 'object')
    ? observedMotion
    : { stiffness: 280, damping: 26, mass: 1 };
  const name = comp.component_name || 'KineticBentoSurface';
  const blueprint = getFrameworkMotion3dBlueprint(fw);

  const templates = {
    nextjs: `'use client';\nimport { motion, AnimatePresence, useMotionValue, useSpring, useTransform, useReducedMotion } from 'motion/react';\nimport { useState } from 'react';\nexport function NativeFramerAdaptedSurface({ title = ${JSON.stringify(name)} }) {\n  const reduceMotion = useReducedMotion();\n  const [expanded, setExpanded] = useState(false);\n  const pointerX = useMotionValue(0);\n  const pointerY = useMotionValue(0);\n  const rotateX = useSpring(useTransform(pointerY, [-0.5, 0.5], [8, -8]), { stiffness: ${spring.stiffness}, damping: ${spring.damping}, mass: ${spring.mass} });\n  const rotateY = useSpring(useTransform(pointerX, [-0.5, 0.5], [-8, 8]), { stiffness: ${spring.stiffness}, damping: ${spring.damping}, mass: ${spring.mass} });\n  return (\n    <motion.section\n      layout\n      style={reduceMotion ? undefined : { rotateX, rotateY, transformPerspective: 1200 }}\n      whileHover={reduceMotion ? undefined : { y: -4, scale: 1.015 }}\n      whileTap={reduceMotion ? undefined : { scale: 0.985 }}\n      onPointerMove={(e) => {\n        const r = e.currentTarget.getBoundingClientRect();\n        pointerX.set((e.clientX - r.left) / r.width - 0.5);\n        pointerY.set((e.clientY - r.top) / r.height - 0.5);\n      }}\n      onPointerLeave={() => { pointerX.set(0); pointerY.set(0); }}\n      onClick={() => setExpanded((v) => !v)}\n      className="rounded-xl border border-sky-500/30 bg-slate-950/90 p-6 shadow-2xl"\n    >\n      <h2 className="text-lg font-bold tracking-tight text-slate-100">{title}</h2>\n      <AnimatePresence>{expanded && <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mt-3 text-sm text-slate-300">Interactive 3D & spring telemetry active.</motion.p>}</AnimatePresence>\n    </motion.section>\n  );\n}`,
    nuxt: `<script setup lang="ts">\nimport { Motion, AnimatePresence } from 'motion-v';\nimport { ref } from 'vue';\nconst props = withDefaults(defineProps<{ title?: string }>(), { title: ${JSON.stringify(name)} });\nconst expanded = ref(false);\nconst tilt = ref({ x: 0, y: 0 });\nfunction onMove(e: PointerEvent) {\n  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();\n  tilt.value = { x: -(((e.clientY - r.top) / r.height) - 0.5) * 10, y: (((e.clientX - r.left) / r.width) - 0.5) * 10 };\n}\n</script>\n<template>\n  <Motion\n    as="section"\n    :initial="{ opacity: 0, y: 20 }"\n    :animate="{ opacity: 1, y: 0, rotateX: tilt.x, rotateY: tilt.y }"\n    :while-hover="{ y: -4, scale: 1.015 }"\n    :while-tap="{ scale: 0.985 }"\n    :transition="{ type: 'spring', stiffness: ${spring.stiffness}, damping: ${spring.damping}, mass: ${spring.mass} }"\n    class="rounded-xl border border-sky-500/30 bg-slate-950/90 p-6 shadow-2xl"\n    @pointermove="onMove"\n    @pointerleave="tilt = { x: 0, y: 0 }"\n    @click="expanded = !expanded"\n  >\n    <h2 class="text-lg font-bold tracking-tight text-slate-100">{{ props.title }}</h2>\n    <AnimatePresence>\n      <Motion v-if="expanded" as="p" :initial="{ opacity: 0, height: 0 }" :animate="{ opacity: 1, height: 'auto' }" :exit="{ opacity: 0, height: 0 }" class="mt-3 text-sm text-slate-300">\n        Interactive 3D & motion-v spring telemetry active.\n      </Motion>\n    </AnimatePresence>\n  </Motion>\n</template>`,
    svelte: `<script lang="ts">\n  import { Spring } from 'svelte/motion';\n  import { slide } from 'svelte/transition';\n  let { title = ${JSON.stringify(name)} } = $props();\n  let expanded = $state(false);\n  const pose = new Spring({ rx: 0, ry: 0, scale: 1 }, { stiffness: ${(spring.stiffness / 1000).toFixed(2)}, damping: ${(spring.damping / 40).toFixed(2)} });\n  function onMove(e: PointerEvent) {\n    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();\n    pose.target = { rx: -(((e.clientY - r.top) / r.height) - 0.5) * 10, ry: (((e.clientX - r.left) / r.width) - 0.5) * 10, scale: 1.015 };\n  }\n</script>\n<section\n  class="rounded-xl border border-sky-500/30 bg-slate-950/90 p-6 shadow-2xl"\n  style="transform: perspective(1200px) rotateX({pose.current.rx}deg) rotateY({pose.current.ry}deg) scale({pose.current.scale});"\n  onpointermove={onMove}\n  onpointerleave={() => { pose.target = { rx: 0, ry: 0, scale: 1 }; }}\n  onpointerdown={() => { pose.target = { ...pose.target, scale: 0.985 }; }}\n  onpointerup={() => { pose.target = { ...pose.target, scale: 1.015 }; }}\n  onclick={() => { expanded = !expanded; }}\n>\n  <h2 class="text-lg font-bold tracking-tight text-slate-100">{title}</h2>\n  {#if expanded}<p transition:slide class="mt-3 text-sm text-slate-300">Svelte 5 Spring & Threlte 3D telemetry active.</p>{/if}\n</section>`,
    angular: `import { Component, Input, ElementRef, DestroyRef, inject, signal, viewChild, afterNextRender } from '@angular/core';\nimport { animate, spring } from 'motion';\n@Component({\n  selector: 'app-native-framer-surface',\n  standalone: true,\n  template: \`<section #cardRef animate.enter="surface-enter" animate.leave="surface-leave" class="rounded-xl border border-sky-500/30 bg-slate-950/90 p-6 shadow-2xl" (pointermove)="onMove($event)" (pointerleave)="onLeave()" (click)="expanded.set(!expanded())"><h2 class="text-lg font-bold tracking-tight text-slate-100">{{ title }}</h2>@if (expanded()) { <p animate.enter="detail-enter" animate.leave="detail-leave" class="mt-3 text-sm text-slate-300">Angular Signals, motion spring & Three.js telemetry active.</p> }</section>\`\n})\nexport class NativeFramerSurfaceComponent {\n  @Input() title = ${JSON.stringify(name)};\n  readonly expanded = signal(false);\n  private readonly cardRef = viewChild<ElementRef<HTMLElement>>('cardRef');\n  private readonly destroyRef = inject(DestroyRef);\n  constructor() {\n    afterNextRender(() => {\n      const el = this.cardRef()?.nativeElement;\n      if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;\n      const ctrl = animate(el, { opacity: [0, 1], transform: ['translateY(20px)', 'translateY(0px)'] }, { type: spring, stiffness: ${spring.stiffness}, damping: ${spring.damping} });\n      this.destroyRef.onDestroy(() => ctrl.stop());\n    });\n  }\n  onMove(e: PointerEvent) {\n    const el = this.cardRef()?.nativeElement;\n    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;\n    const r = el.getBoundingClientRect();\n    const rx = -(((e.clientY - r.top) / r.height) - 0.5) * 10;\n    const ry = (((e.clientX - r.left) / r.width) - 0.5) * 10;\n    animate(el, { transform: \`perspective(1200px) rotateX(\${rx}deg) rotateY(\${ry}deg) scale(1.015)\` }, { type: spring, stiffness: ${spring.stiffness}, damping: ${spring.damping} });\n  }\n  onLeave() {\n    const el = this.cardRef()?.nativeElement;\n    if (!el) return;\n    animate(el, { transform: 'perspective(1200px) rotateX(0deg) rotateY(0deg) scale(1)' }, { type: spring, stiffness: ${spring.stiffness}, damping: ${spring.damping} });\n  }\n}`
  };

  return {
    framework: fw,
    framework_blueprint: blueprint,
    component_id: comp.component_id || 'framer-adapted-surface',
    component_name: name,
    marketplace_url: comp.marketplace_url || FRAMER_MARKETPLACE_URL,
    pricing_tier: comp.pricing?.tier || 'unknown',
    licensing_mode: comp.licensing_boundary?.implementation_strategy || 'native_clean_room_recreation',
    no_iframe_used: true,
    no_protected_source_extracted: true,
    provenance_markdown: `- **${name}**: Source \`${comp.marketplace_url || FRAMER_MARKETPLACE_URL}\` | Tier: \`${comp.pricing?.tier || 'unknown'}\` | Mode: \`${comp.licensing_boundary?.implementation_strategy || 'native_clean_room_recreation'}\` | Framework: \`${fw}\``,
    code: templates[fw] || templates.nextjs
  };
}

module.exports = {
  FRAMER_MARKETPLACE_URL,
  RESPONSIVE_VIEWPORTS,
  SUPPORTED_FRAMEWORKS,
  FRAMEWORK_MOTION_3D_BLUEPRINTS,
  normalizeTargetFramework,
  getFrameworkMotion3dBlueprint,
  _buildDomainCandidateCatalog,
  discoverFramerMarketplaceComponents,
  performFramerComponentREA,
  adaptFramerComponentToFramework
};
