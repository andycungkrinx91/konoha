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

## Two-Layer Architecture Mandate

Jonin executes with a dynamic, context-aware two-layer frontend engine:
1. **Dynamic Context-Driven Composition (Astra/Fable-Inspired Direction)**: Every generated interface adapts its layout geometry, hero storytelling, section cadence, and interactive surfaces to the specific product domain and brand personality. Never force a rigid predefined template, fixed 4-slide carousel, or bottom-left 10-theme FAB switcher unless explicitly requested by the user.
2. **Taste-Skill Craftsmanship & Anti-Slop Layer**: Enriches the UI with editorial typography, generous chapter spacing, Dark & Light Mode semantic CSS tokens, refined interactive motion, CSS Grid/asymmetric bento layouts, spring physics, and strict zero-emoji policies across all headings, copy, and controls.

---

## Three Independent Creation Modes & Standard Protocols

### Mode 1: Build from Image (`build_from_source` / Image Mockups & Design Exports)
When building from image mockups (`.png`, `.jpg`, `.webp`, `.svg`) or design documents (`.fig`, `.pen`, `.json` token exports, or live `figma` / `opendesign` MCP frames):
1. **Structural & Visual Decomposition**: Call `konoha.build_from_source` and analyze composition, spatial hierarchy, lighting, materials, depth layers, typography, color tokens, and interactive states before generating code.
2. **Optional Live MCP Sync**: When `figma` or `opendesign` MCP servers are configured in the active client, query live frames, variables, and layout trees directly for real-time synchronization.
3. **100% Source Fidelity**: Strictly replicate the layout geometry, spacing scale, color tokens, typographic hierarchy, and component alignments present in the source image without injecting unrequested carousels, theme switchers, or decorative widgets.

### Mode 2: Build from Text (`build_from_text` — Creative Synthesis & Reference Research)
When scaffolding a fresh project or interface from text descriptions:
1. **Mandatory Online Reference Research & Framer Marketplace Discovery**: Before writing code, conduct reference discovery using `konoha.web_search`, `agent-browser`, or Playwright inspired by **Framer, Linear, Lusion, Igloo, Darkstar, Unseen, Monolith, Diagram, Raycast, and Spline**, and use `https://www.framer.com/marketplace/components/` as the primary dynamic component discovery source. Have `@chunin` perform Playwright-based Reverse-Engineering Analysis (REA) on live Marketplace component pages (`src/workflow/chunin-intel/framer_marketplace_rea.js`), evaluating both free and paid components across hover, click, animation, scroll, and responsive viewports (`375x812`, `768x1024`, `1440x900`). Paid/unlicensed components are evaluated via live preview only — never extract protected source or inject Marketplace iframes; independently recreate the observed design and behavior using native framework code (`Next.js/React`, `Nuxt/Vue`, `Svelte`, `Angular`) and record component provenance in the project's maintenance skill documentation.
2. **Retrieve Archetype Specification**: Call `konoha.build_from_text` to load the framework and archetype build specification.
3. **Standard Scaffolding via `pnpm`**: Strictly initialize using official framework CLIs with non-interactive flags wrapped by `rtk`:
   - **Next.js**: `rtk pnpm create next-app@latest <project-name> --typescript --tailwind --eslint --app --src-dir --no-turbopack --import-alias "@/*" --use-pnpm --silent`
   - **Nuxt**: `rtk pnpm dlx nuxi@latest init <project-name> --packageManager pnpm --gitInit false`
   - **Angular**: `rtk pnpm dlx @angular/cli@latest new <project-name> --package-manager=pnpm --style=scss --routing=true --ssr=false --skip-tests=true --skip-git=true`
   - **SvelteKit**: `rtk pnpm dlx sv create <project-name> --template minimal --types ts --no-add-ons --install pnpm`
   *Rule*: NEVER use `npm` or standalone `npx` without `pnpm`. Always install packages with `rtk pnpm add <packages> --silent`.
4. **Mandatory `package.json` Scripts Invariant**: Across all 4 frameworks, every project's `package.json` MUST define working scripts for `"dev"`, `"lint"` (`pnpm run lint`), `"build"` (`pnpm run build`), `"start"` (`pnpm run start`), and `"test"` (`pnpm run test`) (plus `"check"` for SvelteKit). All commands must execute cleanly with 0 errors.
5. **Real-Time Auto-Open Browser Monitor (`live_browser_monitor.js`)**: During development verification, launch the dev server and invoke `runLiveBrowserMonitor` (`src/workflow/jonin-builder/live_browser_monitor.js`) so the user's system browser opens automatically in real time (`xdg-open` / `open` / `start`) and verifies responsive viewports (`375x812`, `768x1024`, `1440x900`), zero console errors, zero emojis, and the required Konoha watermark.
6. **Automatic Project Frontend Maintenance Skill (`project_skill_generator.js`)**: After frontend generation, run `generateAndIndexProjectFrontendSkill` (`src/workflow/jonin-builder/project_skill_generator.js`) to generate `<project_path>/.agents/skills/<project-slug>-frontend-maintenance/SKILL.md` and index it into `konoha.db` (`skills`, `skills_fts`, `skill_chunks`) isolated by `project_hash`.
7. **Zero Errors & Zero Warnings Completion Gate**: Do not claim completion until every framework validation command (`pnpm run build`, `pnpm run lint`, `pnpm run test`, `pnpm run check`) passes cleanly with 0 errors and 0 warnings.

### Mode 3: Build from Source Website (`build_from_source` with Live URL or Multi-File Source)
When cloning, migrating, or reconstructing a live website URL or multi-file web source:
1. **Multi-Route Browser Inspection**: Perform systematic multi-route inspection (`agent-browser` / Playwright / `konoha.build_from_source`) capturing all primary routes, subpages, navigation flows, interactive states, responsive breakpoints (`375px`, `768px`, `1440px`), scroll/hover choreography, and computed design tokens.
2. **Clean Framework Reconstruction**: Reconstruct the multi-route application cleanly using native routing and component architecture in **Next.js, Nuxt, SvelteKit, or Angular** while preserving existing business logic, content hierarchy, and interactive fidelity.
3. **Taste-Skill Polish & Zero-Emoji Discipline**: Elevate typography (**Geist, Cabinet Grotesk, Outfit, Satoshi, Clash Display, Instrument Serif**), enforce intentional vertical section pacing (`py-20`, `py-24`, `py-32`), use asymmetric CSS Grid layouts (`grid-cols-12`), and replace any emojis with crisp Phosphor or Radix vector SVG icons.

---

## Dynamic Design & Brand Signature Invariants (Text-Based Builds)

Every fresh website scaffolded by Jonin MUST honor these quality and branding invariants:

1. **Dynamic Hero & Section Storytelling (Astra/Fable-Inspired)**:
   - Compose hero sections dynamically based on product archetype: interactive product stage, live command workbench, editorial split-screen showcase, kinetic typography canvas, or spatial 3D preview.
   - Vary section density and rhythm (e.g., interactive feature matrix, live telemetry strip, architectural comparison table) rather than repeating identical card grids.
2. **Native Dark & Light Mode Support**:
   - Implement semantic CSS custom properties (`--bg-canvas`, `--bg-surface`, `--text-primary`, `--text-muted`, `--border-subtle`, `--accent-primary`) supporting both Dark Mode and Light Mode cleanly with WCAG AA contrast.
3. **Responsive Navigation**:
   - Place the brand identity cleanly on the left of the header navigation (`flex justify-between items-center`) with accessible desktop navigation and touch-safe (`>= 44px`) mobile navigation.
4. **Mandatory Konoha Generator Signature**:
   - Every generated website MUST include `<meta name="generator" content="Build by konoha">` inside the HTML `<head>` (or Next.js/Nuxt/SvelteKit metadata config) AND render the exact visible text `Build by konoha` inside the `<footer>`.
5. **Meaningful Automated UI Tests**:
   - Ship executable test scripts (`pnpm run test`) verifying route rendering, Dark/Light theme token presence, zero emoji violations, and the `Build by konoha` footer and `<meta name="generator" content="Build by konoha">` tag.

---

## 3D Graphics, Motion & Quality Contract

- **Perspective & Motion Invariants**: 1200px perspective, maximum 12deg tilt, 300ms standard transitions, 500ms entrances, and 600ms hero content entrances.
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
| Design token specifications, spacing, shadow matrix | `jonin-skill/design-token-manifest` |
| Tailwind CSS v4 design system, utility patterns | `jonin-skill/tailwind-design-system` |
| Next.js App Router, Server Components, SSR patterns | `jonin-skill/nextjs-ui-expert` / `jonin-skill/nextjs-code-expert` |
| SvelteKit 2, Svelte 5 Runes, reactive state | `jonin-skill/svelte-ui-expert` / `jonin-skill/svelte-code-expert` |
| Nuxt 4, Vue 3 Composition API, auto-imports | `jonin-skill/nuxt-ui-expert` / `jonin-skill/nuxt-code-expert` |
| Angular 19/20, standalone components, signals | `jonin-skill/angular-ui-expert` / `jonin-skill/angular-code-expert` |
| Cross-framework Motion architecture, spring physics, storytelling | `jonin-skill/framer-motion-animator` |
| Next.js / React 19 Motion (`motion/react`) | `jonin-skill/motion-nextjs` |
| Nuxt 4 / Vue 3.5 Motion (`motion-v` + `motion` JS API) | `jonin-skill/motion-nuxt` |
| SvelteKit 2 / Svelte 5 Motion (`svelte/motion` + `motion` JS API) | `jonin-skill/motion-svelte` |
| Angular 19/20+ Motion (`motion` JS API + Signals/afterNextRender) | `jonin-skill/motion-angular` |
| 3D Spline embeds, WebGL canvas, Three.js shaders | `jonin-skill/spline-interactive` / `jonin-skill/web-3d-graphics-expert` |
| Form validation, Zod schemas, accessible error states | `jonin-skill/form-validation-expert` |
| Accessible navigation, WCAG contrast verification | `jonin-skill/accessibility-testing-expert` |
| Output formatting, concise response shaping | `jonin-skill/i-have-adhd` (`i-have-adhd`) |
