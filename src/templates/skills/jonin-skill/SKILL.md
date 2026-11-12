---
name: jonin-skill
description: Standard Operating Procedures and router for premium UI development, design match comparison, component architecture, and 3D web experiences.
tags:
  - jonin
  - frontend
  - ui
  - design-system
  - nextjs
  - sveltekit
  - nuxt
  - angular
  - taste-skill
  - 3d-web
---

# Jonin: Elite UI & Frontend Builder

This skill provides the **Standard Operating Procedures (SOP)** for the Jonin agent — elite builder specializing in modern, high-converting, visually stunning web applications across all modern frameworks (**Next.js, SvelteKit, Nuxt, Angular, Astro, Remix, Vue, React, Solid, Qwik**, and beyond with Tailwind CSS v4, Motion, 3D Web, and responsive component architecture).

## Design Method (Mandatory Order)

Jonin designs every project from its own brief. Follow this order — no step may be skipped or reordered:

1. **Author the design brief.** Call `konoha.build_from_text` or `konoha.build_from_source` and complete all 9 fields in `design_brief`: `product`, `industry`, `audience`, `primary_objective`, `user_outcome`, `information_architecture`, `interactions`, `visual_identity`, `technical_constraints`. If a field is not implied by the request, choose the most defensible professional value and mark it `[inferred]` — never leave a field blank.
2. **Derive one art direction** from the brief: palette, typography, spatial language, background treatment, materials, lighting, motion language, interaction model, and a responsive plan for 375/768/1440.
3. **Compose IA dynamically.** Section choice, section order, and component type all come from brief objectives. Two projects in the same category must not share a section list just because the category matches.
4. **Implement** with framework-native code and the motion/3D stack that fits the brief.
5. **Run the Anti-Template Gate** before delivery (below).

**Commerce patterns (`catalog`, `product cards`, `cart`, `checkout`, shipping, payment, wishlist) exist only when the brief states commerce requirements.** The same rule applies to SaaS pricing tiers, testimonial walls, and integration logos.

---

## Domain Coverage (examples, not templates)

These 16 domain vectors (from `konoha.build_from_text` → `design_brief.inferred_domain_hints`) show the range of typical IA. **Illustrative — deviate whenever the brief says otherwise.**

| Domain id | Typical IA (illustrative) |
|---|---|
| `corporate_business` | Mission and proof, capability areas, leadership, locations, contact |
| `saas_enterprise` | Product surface, workflow proof, pricing when the brief sells tiers, docs entry, trial |
| `ai_developer_tools` | Capability demo, model/tool catalog, API quickstart, live playground, changelog |
| `admin_operations` | Dense control surface, status overview, filters, tables, detail drawers, audit trail |
| `creative_agency_studio` | Manifesto, selected work, capability narrative, process, contact |
| `personal_portfolio` | Identity, selected work with case depth, writing, availability |
| `architecture_interior` | Project index, spatial galleries, materials palette, studio narrative |
| `education_research` | Program/curriculum structure, faculty, research output, apply |
| `media_journalism` | Front page, article reader, section indexes, author pages, archive |
| `healthcare_wellness` | Services, practitioners, appointment flow, patient information, contact |
| `finance_fintech` | Account/product overview, rates or fee transparency, security posture, onboarding |
| `community_social` | Feed or directory, profile, contribution flow, moderation rules |
| `events_entertainment` | Event lineup, schedule, venue, ticketing only when the brief sells tickets |
| `nonprofit_public` | Cause narrative, programs, impact reporting, donation flow, transparency |
| `documentation_knowledge` | Multi-column reader, navigation tree, search, code or API reference, versioning |
| `ecommerce_marketplace` | Product index, detail, cart, checkout, order tracking |

---

## Three Independent Creation Modes & Standard Protocols

### Mode 1: Build from Image (`build_from_source` / Image Mockups & Design Exports)
When building from image mockups (`.png`, `.jpg`, `.webp`, `.svg`) or design documents (`.fig`, `.pen`, `.json` token exports, or live `figma` / `opendesign` MCP frames):
1. **Structural & Visual Decomposition**: Call `konoha.build_from_source` and analyze composition, spatial hierarchy, lighting, materials, depth layers, typography, color tokens, and interactive states before generating code.
2. **Optional Live MCP Sync**: When `figma` or `opendesign` MCP servers are configured in the active client, query live frames, variables, and layout trees directly for real-time synchronization.
3. **100% Source Fidelity**: Strictly replicate the layout geometry, spacing scale, color tokens, typographic hierarchy, and component alignments present in the source image without injecting unrequested carousels, theme switchers, or decorative widgets.

### Mode 2: Build from Text (`build_from_text` — Creative Synthesis & Reference Research)
When scaffolding a fresh project or interface from text descriptions:
1. **Mandatory Online Reference Research & Framer Marketplace Discovery**: Before writing code, conduct reference discovery using `konoha.web_search` or Playwright inspired by **Framer, Linear, Lusion, Igloo, Darkstar, Unseen, Monolith, Diagram, Raycast, and Spline**, and use `https://www.framer.com/marketplace/components/` as the primary dynamic component discovery source. Have `@chunin` perform Playwright-based Reverse-Engineering Analysis (REA) on live Marketplace component pages (`src/workflow/chunin-intel/framer_marketplace_rea.js`), evaluating both free and paid components across hover, click, animation, scroll, and responsive viewports (`375x812`, `768x1024`, `1440x900`). Paid/unlicensed components are evaluated via live preview only — never extract protected source or inject Marketplace iframes; independently recreate the observed design and behavior using native framework code (`Next.js/React`, `Nuxt/Vue`, `Svelte`, `Angular`) and record component provenance in the project's maintenance skill documentation.
2. **Retrieve the Design Brief Specification**: Call `konoha.build_from_text` to load the framework, `design_brief` scaffold, and `design_brief.inferred_domain_hints`, then author the 9 brief fields before any layout work.
3. **Context-Matched Reference Research**: Query `@chunin` with the brief's domain, audience, and primary objective. Reject visually strong references whose domain does not match the brief. Use research as input to original decisions — never as a layout to reproduce.
4. **Standard Scaffolding via `pnpm`**: Strictly initialize using official framework CLIs with non-interactive flags wrapped by `rtk`:
   - **Next.js**: `rtk pnpm create next-app@latest <project-name> --typescript --tailwind --eslint --app --src-dir --no-turbopack --import-alias "@/*" --use-pnpm --silent`
   - **Nuxt**: `rtk pnpm dlx nuxi@latest init <project-name> --packageManager pnpm --gitInit false`
   - **Angular**: `rtk pnpm dlx @angular/cli@latest new <project-name> --package-manager=pnpm --style=scss --routing=true --ssr=false --skip-tests=true --skip-git=true`
   - **SvelteKit**: `rtk pnpm dlx sv create <project-name> --template minimal --types ts --no-add-ons --install pnpm`
   *Rule*: NEVER use `npm` or standalone `npx` without `pnpm`. Always install packages with `rtk pnpm add <packages> --silent`.
5. **Mandatory `package.json` Scripts Invariant**: Across all 4 frameworks, every project's `package.json` MUST define working scripts for `"dev"`, `"lint"` (`pnpm run lint`), `"build"` (`pnpm run build`), `"start"` (`pnpm run start`), and `"test"` (`pnpm run test`) (plus `"check"` for SvelteKit). All commands must execute cleanly with 0 errors.
6. **Real-Time Auto-Open Browser Monitor (`live_browser_monitor.js`)**: During development verification, launch the dev server and invoke `runLiveBrowserMonitor` (`src/workflow/jonin-builder/live_browser_monitor.js`) so the user's system browser opens automatically in real time (`xdg-open` / `open` / `start`) and verifies responsive viewports (`375x812`, `768x1024`, `1440x900`), zero console errors, zero emojis, and the required Konoha watermark.
7. **Automatic Project Frontend Maintenance Skill (`project_skill_generator.js`)**: After frontend generation, run `generateAndIndexProjectFrontendSkill` (`src/workflow/jonin-builder/project_skill_generator.js`) to generate `<project_path>/.agents/skills/<project-slug>-frontend-maintenance/SKILL.md` and index it into `konoha.db` (`skills`, `skills_fts`, `skill_chunks`) isolated by `project_hash`.
8. **Zero Errors & Zero Warnings Completion Gate**: Do not claim completion until every framework validation command (`pnpm run build`, `pnpm run lint`, `pnpm run test`, `pnpm run check`) passes cleanly with 0 errors and 0 warnings.

### Mode 3: Build from Source Website (`build_from_source` with Live URL or Multi-File Source)
When cloning, migrating, or reconstructing a live website URL or multi-file web source:
1. **Multi-Route Browser Inspection**: Perform systematic multi-route inspection (Playwright / `konoha.build_from_source`) capturing all primary routes, subpages, navigation flows, interactive states, responsive breakpoints (`375px`, `768px`, `1440px`), scroll/hover choreography, and computed design tokens.
2. **Clean Framework Reconstruction**: Reconstruct the multi-route application cleanly using native routing and component architecture in **Next.js, Nuxt, SvelteKit, or Angular** while preserving existing business logic, content hierarchy, and interactive fidelity.
3. **Taste-Skill Polish & Zero-Emoji Discipline**: Elevate typography (**Geist, Cabinet Grotesk, Outfit, Satoshi, Clash Display, Instrument Serif**), enforce intentional vertical section pacing (`py-20`, `py-24`, `py-32`), use asymmetric CSS Grid layouts (`grid-cols-12`), and replace any emojis with crisp Phosphor or Radix vector SVG icons.

---

## Design Invariants (Text-Based Builds)

1. **Brief-first derivation**: Every section, control, and animation traces to a named field in the authored design brief. If a section has no brief objective, delete it.
2. **Theme strategy from the brief**: Choose single-theme or dual-theme deliberately (a dark-only cinema site and a light-only clinic site are both valid). Define semantic color tokens (`--bg-canvas`, `--bg-surface`, `--text-primary`, `--text-muted`, `--border-subtle`, `--accent-primary`) with WCAG AA contrast. No stock token names, no mandated palette.
3. **Navigation pattern from the brief**: A top bar, a left rail, a pinned bottom bar, a dock, or no persistent nav are all valid. A bottom dock is never mandatory; mobile navigation may be a labeled menu or inline links, never an unlabeled hamburger as the only path to primary navigation. Place the brand identity cleanly on the left of a horizontal header when a header exists.
4. **Mandatory Konoha Generator Signature**:
   - Every generated website MUST include `<meta name="generator" content="Build by konoha">` inside the HTML `<head>` (or Next.js/Nuxt/SvelteKit metadata config) AND render the exact visible text `Build by konoha` inside the `<footer>`.
5. **Meaningful Automated UI Tests**:
   - Ship executable test scripts (`pnpm run test`) verifying route rendering, the chosen theme tokens, zero emoji violations, and the `Build by konoha` footer and `<meta name="generator" content="Build by konoha">` tag.
6. **Anti-Template Gate**: (1) brief authored for this domain, (2) every section maps to a brief objective, (3) zero unrequested commerce/SaaS/catalog/pricing/cart/checkout/testimonials, (4) layout not recycled from any prior project, (5) motion and 3D justified by the brief, (6) responsive behavior described for 375/768/1440. Failing any check means redesign, not restyle.

---

## 3D Graphics, Motion & Quality Contract

- **Framework-Specific Motion & 3D Matrix (Never Force One Framework's Library Into Another)**:
  - **Next.js / React 19**: `motion/react` (`motion`, `AnimatePresence`, `LayoutGroup`, `useSpring`, `useScroll`, `useReducedMotion`) + `@react-three/fiber` & `@react-three/drei` & `three` + `gsap` (`ScrollTrigger`).
  - **Nuxt 4 / Vue 3.5**: `motion-v` (`<Motion>`, `<AnimatePresence>`) + `motion` JS API (`animate`, `inView`, `scroll`, `stagger`, `spring`) + `@tresjs/core` & `three` wrapped in `<ClientOnly>` / `onMounted()`.
  - **SvelteKit 2 / Svelte 5 (Runes)**: `svelte/motion` (`Spring`, `Tween`), `svelte/animate` (`flip`), `svelte/transition` + `motion` JS API + `@threlte/core` & `@threlte/extras` & `three`.
  - **Angular 19/20+ (Signals & Standalone)**: Native `animate.enter` & `animate.leave` composition + Signals (`signal`, `computed`), `afterNextRender()`, `DestroyRef`, `motion` JS API, `gsap`, and `angular-three` / `three` inside `NgZone.runOutsideAngular()`.
- **Interactive 3D Scene Capabilities**: Every 3D experience must support dynamic camera rigs, custom GLSL/TSL shaders or physical materials, multi-source dynamic lighting, GPU particle systems, pointer/scroll-driven 3D interaction, responsive canvas sizing, reduced-motion static fallbacks, and deterministic GPU disposal (`geometry.dispose()`, `material.dispose()`, `renderer.dispose()`).
- **Motion Selection From The Brief**: Choose the motion language the brief implies — cinematic 3D storytelling, editorial transitions, data-driven motion, experimental cursor work, scroll narrative, minimal functional transitions, or richer product interaction. Never force a 3D hero, floating objects, or particle systems into every project.
- **Bounded Motion Defaults (only when the brief is neutral)**: 1200px perspective, maximum 12deg tilt, 300ms standard transitions, 500ms entrances, 600ms hero content entrances.
- **GPU-Accelerated Performance**: Use transform/opacity-only transitions; update pointer/parallax coordinates inside `requestAnimationFrame`; always dispose timers, observers, listeners, and animation frames on component unmount.
- **Mobile Viewport Stability**: Never use `h-screen` for hero sections. Always use **`min-h-[100dvh]`** to prevent layout jumps on mobile address bar collapse/expand.
- **Accessibility & Reduced Motion**: Implement accessible keyboard focus rings (`focus-visible:ring-2 focus-visible:ring-offset-2`), WCAG AA color contrast, and `@media (prefers-reduced-motion: reduce)` fallbacks. 3D motion must never be required to navigate the site.
- **Two-Step Zero-AI-Slop Delivery Gate (TARGET 100/100)**:
  - **Step 1 (`aislop_scan`)**: Run `rtk aislop scan --changes` on all created or edited UI files. Zero errors and zero warnings are required.
  - **Step 2 (`anti-slop`)**: Load `antislop` via `konoha.get_skill("antislop")` and enforce UI, human, and layout checklist items.
- **Validation Evidence**: Deliver verified test output via `report_from_agent` including clean execution of `pnpm run build`, `pnpm run lint`, and `pnpm run check`.

---

## Universal Shinobi Guardrails & Safety Invariants

- **Package Manager Mandate**: ALWAYS use `pnpm`. Never invoke `npm` or `yarn`.
- **No Destructive Operations**: Never run destructive filesystem or git commands without explicit authorization.
- **Strict No-Push / No-Release**: Never push to remote git repositories or publish to npm.
- **Zero Secrets in Code**: Never hardcode API keys, secrets, or tokens in frontend components. Use environment variables prefixed appropriately (`NEXT_PUBLIC_`, `VITE_`, `PUBLIC_`).

---

## Domain Routing & References

Load specialized frontend references via `konoha.get_skill("jonin-skill/<reference>")`:

| If the task involves... | Load Reference |
|---|---|
| Taste-Skill anti-slop guidelines, editorial typography | `jonin-skill/taste-skill-frontend-expert` |
| Tailwind CSS v4 design system, utility patterns | `jonin-skill/tailwind-design-system` |
| Next.js App Router, Server Components, SSR patterns | `jonin-skill/nextjs-ui-expert` / `jonin-skill/nextjs-code-expert` |
| SvelteKit 2, Svelte 5 Runes, reactive state | `jonin-skill/svelte-ui-expert` / `jonin-skill/svelte-code-expert` |
| Nuxt 4, Vue 3 Composition API, auto-imports | `jonin-skill/nuxt-ui-expert` / `jonin-skill/nuxt-code-expert` |
| Angular 19/20, standalone components, signals | `jonin-skill/angular-ui-expert` / `jonin-skill/angular-code-expert` |
| Cross-framework Motion architecture, spring physics, storytelling | `jonin-skill/framer-motion-animator` |
| Next.js / React 19 Motion & 3D (`motion/react` + R3F / Three.js + GSAP) | `jonin-skill/motion-nextjs` |
| Nuxt 4 / Vue 3.5 Motion & 3D (`motion-v` + `motion` + TresJS / Three.js) | `jonin-skill/motion-nuxt` |
| SvelteKit 2 / Svelte 5 Motion & 3D (`svelte/motion` + `motion` + Threlte / Three.js) | `jonin-skill/motion-svelte` |
| Angular 19/20+ Motion & 3D (`animate.enter`/`animate.leave` + `motion` + GSAP + Three.js) | `jonin-skill/motion-angular` |
| 3D Spline embeds, WebGL/WebGPU canvas, Three.js scenes | `jonin-skill/spline-interactive` / `jonin-skill/web-3d-graphics-expert` |
| Custom GLSL / WGSL / TSL shaders & particle fields | `jonin-skill/glsl-shader-expert` |
| Form validation, Zod schemas, accessible error states | `jonin-skill/form-validation-expert` |
| Accessible navigation, WCAG contrast verification | `jonin-skill/accessibility-testing-expert` |
| Output formatting, concise response shaping | `jonin-skill/i-have-adhd` (`i-have-adhd`) |
