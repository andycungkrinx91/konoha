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

## Build Scenarios & Standard Protocols

### Scenario 1: Mockup / Design-Source Builds (`build_from_source` — Optional Figma / OpenDesign Dual-Mode)
Figma and OpenDesign are **optional enhancers** (never required to run `@jonin`). When available, Jonin supports two seamless modes:
1. **Mode A — Exported Design Files (`build_from_source`)**: Consume exported mockup images (`.png`, `.jpg`, `.webp`, `.svg`) or design documents (`.fig`, `.pen`, `.json` token exports) via `konoha.build_from_source`.
2. **Mode B — Live MCP Connection (Real-Time Design Sync)**: When `figma` or `opendesign` MCP servers are configured in the active client, query live frames, variables, and layout trees directly for real-time synchronization.
3. **100% Exact Mockup Fidelity**: Strictly replicate visual layout, color palette, typography hierarchy, vertical spacing, and component alignments present in the source design without injecting unrequested carousels or widgets.

### Scenario 2: Text-Based Builds (`build_from_text`)
When scaffolding a fresh project or interface from text descriptions:
1. Call `konoha.build_from_text` first to retrieve the archetype build specification.
2. **Standard Scaffolding via `pnpm`**: Strictly initialize using official framework CLIs with non-interactive flags wrapped by `rtk`:
   - **Next.js**: `rtk pnpm create next-app@latest <project-name> --typescript --tailwind --eslint --app --src-dir --no-turbopack --import-alias "@/*" --use-pnpm --silent`
   - **Nuxt**: `rtk pnpm dlx nuxi@latest init <project-name> --packageManager pnpm --gitInit false`
   - **Angular**: `rtk pnpm dlx @angular/cli@latest new <project-name> --package-manager=pnpm --style=scss --routing=true --ssr=false --skip-tests=true --skip-git=true`
   - **SvelteKit**: `rtk pnpm dlx sv create <project-name> --template minimal --types ts --no-add-ons --install pnpm`
   *Rule*: NEVER use `npm` or standalone `npx` without `pnpm`. Always install packages with `rtk pnpm add <packages> --silent`.
3. **Mandatory `package.json` Scripts Invariant**: Across all 4 frameworks, every project's `package.json` MUST define working scripts for `"dev"`, `"lint"` (`pnpm run lint`), `"build"` (`pnpm run build`), `"start"` (`pnpm run start`), and `"test"` (`pnpm run test`) (plus `"check"` for SvelteKit). All commands must execute cleanly with 0 errors.
4. **Real-Time Auto-Open Browser Monitor (`live_browser_monitor.js`)**: During development verification, launch the dev server and invoke `runLiveBrowserMonitor` (`src/workflow/jonin-builder/live_browser_monitor.js`) so the user's system browser opens automatically in real time (`xdg-open` / `open` / `start`) and verifies responsive viewports (`375x812`, `768x1024`, `1440x900`), zero console errors, zero emojis, and the required Konoha watermark.
5. **Automatic Project Frontend Maintenance Skill (`project_skill_generator.js`)**: After frontend generation, run `generateAndIndexProjectFrontendSkill` (`src/workflow/jonin-builder/project_skill_generator.js`) to generate `<project_path>/.agents/skills/<project-slug>-frontend-maintenance/SKILL.md` and index it into `konoha.db` (`skills`, `skills_fts`, `skill_chunks`) isolated by `project_hash`.
6. **Zero Errors & Zero Warnings Completion Gate**: Do not claim completion until every framework validation command (`pnpm run build`, `pnpm run lint`, `pnpm run test`, `pnpm run check`) passes cleanly with 0 errors and 0 warnings.

### Scenario 3: UI Enhancement & Component Prettification (`existing_project`)
When modifying, modernizing, or polishing existing projects or individual components:
1. **Preserve Logic & Business Architecture**: Keep existing backend APIs, state stores, database models, and unaffected routes 100% intact.
2. **Apply Taste-Skill Polish**: Elevate typography with distinctive font stacks (**Geist, Cabinet Grotesk, Outfit, Satoshi, Clash Display, Instrument Serif**), tight tracking (`tracking-tight`/`tracking-tighter`), and purposeful hierarchy.
3. **Cinematic Negative Space**: Replace cramped padding with intentional vertical section pacing (`py-20`, `py-24`, `py-32`) and subtle hairline borders.
4. **Grid Architecture**: Transition repetitive 3-card flexbox rows into deliberate asymmetric CSS Grid layouts (`grid-cols-12`, bento grids, editorial split screens).
5. **Zero-Emoji Policy**: Emojis and emoticons are strictly forbidden across all UI buttons, badges, headings, and body copy. Use crisp SVG vector icons (Phosphor or Radix).

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

## 🎞️ 3D Graphics, Motion & Quality Contract

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
| Framer Motion, micro-interactions, exit animations | `jonin-skill/framer-motion-animator` |
| 3D Spline embeds, WebGL canvas, Three.js shaders | `jonin-skill/spline-interactive` / `jonin-skill/web-3d-graphics-expert` |
| Form validation, Zod schemas, accessible error states | `jonin-skill/form-validation-expert` |
| Accessible navigation, WCAG contrast verification | `jonin-skill/accessibility-testing-expert` |
| Output formatting, concise response shaping | `jonin-skill/i-have-adhd` (`i-have-adhd`) |
