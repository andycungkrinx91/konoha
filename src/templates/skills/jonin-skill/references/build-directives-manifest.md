# Jonin Build Directives Manifest

This manifest is required by `build_from_text` and `build_from_source` for Angular, Next.js, Nuxt, and SvelteKit.


## Architecture: Dynamic Context-Driven Composition + Taste-Skill Enrichment

All web application builds execute in two complementary layers:

1. **Layer 1: Dynamic Context-Driven Foundation (Astra / Fable Direction)**:
   - **Adaptive Color System**: Semantic color variables (`--bg-canvas`, `--bg-surface`, `--text-primary`, `--text-muted`, `--border-subtle`, `--accent-primary`) derived from the brief with WCAG AA contrast; single or dual theme as the brief decides.
   - **Bespoke Hero & Section Storytelling**: Compose hero and section order from the design brief (interactive product workbench, kinetic typography stage, editorial split-screen, or 3D spatial preview). No house hero, carousel, or theme-widget preset.
   - **Cross-Framework Motion Standard**: Implement spring-physics choreography using `motion/react` (Next.js), `motion-v` + `motion` (Nuxt), `svelte/motion` + `motion` (SvelteKit), or `motion` JS API with `afterNextRender` (Angular).
   - **Domain-Scoped Features**: Implement exactly the data models and interactive flows the brief requires. Commerce, catalog, and cart features appear only when the brief states commerce requirements; dashboards get telemetry views only when the brief states them.
   - **Framework Standard**: Strictly **Next.js 16.3+ App Router (React 19, Tailwind v4)**, **SvelteKit 2 (Svelte 5 Runes)**, **Nuxt 4.3 (Vue 3.5)**, or **Angular 19/20+**.
   - **Konoha Signature**: `<meta name="generator" content="Build by konoha">` in `<head>` and visible `Build by konoha` signature in `<footer>`.

2. **Layer 2: Taste-Skill Enrichment (Polish, Motion & Anti-Slop)**:
   - **Motion & Sensory Dynamics**: Motion v12+ spring physics, 3D card tilt (`perspective(1200px)`), dynamic hover sheen, `hover:-translate-y-1`, and tactile `active:scale-[0.98]`.
   - **Prettifier & Editorial Typography**: Distinctive fonts (Geist, Cabinet Grotesk, Clash Display), tight tracking, scale contrast (`text-5xl`-`text-7xl` vs micro badges), cinematic section spacing (`py-24`, `py-32`, `py-48`), and 12-column asymmetric bento layouts.
   - **Anti-Slop Discipline**: Zero emojis in UI (Phosphor vector icons only — never Lucide), viewport-safe `min-h-[100dvh]`, accessible mobile navigation, and leaf-component client isolation (`'use client'` strictly on micro-interactions).

## Shared requirements

- Use `pnpm` exclusively. Do not use `npm`, `yarn`, or standalone `npx`.
- Use framework-native routing; never use hash routing or a fake `activePage` router.
- Implement the brief's chosen theme strategy as semantic CSS variables (single or dual theme).
- Add bounded 3D perspective interactions, spring-driven entrance motion, glass surfaces, and responsive behavior without harming readability.
- Respect `prefers-reduced-motion`; disable tilt/parallax and use opacity-only transitions when requested.
- Clean up event listeners, timers, animation frames, and observers on component teardown.
- Add `pnpm run lint` and `pnpm run build`; SvelteKit also requires `pnpm run check`.
- Completion requires zero errors and zero warnings from all configured validation commands.

## Mandatory package.json Scripts Invariant

Every project built from text or source across all 4 frameworks MUST define working scripts in `package.json` for all canonical lifecycle phases:

| Framework | `pnpm dev` | `pnpm build` | `pnpm start` | `pnpm lint` | `pnpm check` (if applicable) |
|---|---|---|---|---|---|
| **Next.js** | `next dev` | `next build` | `next start` | `next lint` | N/A |
| **SvelteKit** | `vite dev` | `vite build` | `vite preview` | `prettier --check . && eslint .` | `svelte-kit sync && svelte-check --tsconfig ./tsconfig.json` |
| **Nuxt** | `nuxt dev` | `nuxt build` | `nuxt preview` | `eslint .` | N/A |
| **Angular** | `ng serve` | `ng build` | `ng serve` | `ng lint` | N/A |

Running `pnpm lint`, `pnpm build`, and `pnpm start` must all be fully operational with 0 errors.

## Framework routing

| Framework | Required routing | Required validation |
|---|---|---|
| Angular | Standalone Angular Router with `app.routes.ts` | `pnpm run lint && pnpm run build` |
| Next.js | App Router under `app/` | `pnpm run lint && pnpm run build` |
| Nuxt 4.3 | File-based `app/pages/` and `app/layouts/` | `pnpm run lint && pnpm run build` |
| SvelteKit | File-based `src/routes/` | `pnpm run lint && pnpm run check && pnpm run build` |

## Build-mode boundary (Three Independent Creation Modes)

1. **Build from Image (`build_from_source` with image mockups)**: Preserves exact source composition, spatial hierarchy, lighting, materials, depth layers, typography, color tokens, and interactive states; adds only non-structural, reduced-motion-safe polish. Do not inject unrequested carousels, dialogs, or theme switchers absent from the mockup.
2. **Build from Text (`build_from_text`)**: Begins with mandatory online reference research (`konoha.web_search` / `agent-browser` / Playwright) inspired by **Framer, Linear, Lusion, Igloo, Darkstar, Unseen, Monolith, Diagram, Raycast, and Spline** to synthesize an original creative direction, brief-derived token system, and 3D motion-art language before coding.
3. **Build from Source Website (`build_from_source` with live URL or multi-file source)**: Performs multi-route browser inspection (routes, subpages, navigation flows, interactive states, responsive breakpoints, scroll/hover choreography, design tokens) and reconstructs the application cleanly in **Next.js, Nuxt, SvelteKit, or Angular**.


## Route & Page Composition (Brief-Derived)

Route composition is derived from the design brief's `information_architecture`. There is no fixed archetype list.

- Every route must map to a named user objective from the brief; delete routes that do not.
- Single-page flowing narratives, multi-route applications, and hybrid structures are all valid.
- Commerce routes (`/catalog`, `/cart`, `/checkout`, product detail) exist **only when the brief states commerce requirements**.
- Pagination, filtering, and sorting appear only where the content volume and objectives demand them.

## Content Standards

1. **Iconography Standard**:
   - Strictly use Phosphor Icons (`@phosphor-icons/react` for Next.js, `@phosphor-icons/web` for SvelteKit/Nuxt/Angular CSS-class icons, `@phosphor-icons/vue` for Nuxt component icons) or hand-exported inline SVG icon components. NEVER install or import any Lucide package (`lucide-react`, `lucide-svelte`, `lucide-vue-next`, `lucide-angular`) — Lucide is a named AI-scaffold fingerprint (PLAN_HUMAN_BUILT.md).
   - NEVER use emojis as icons. Wrap icons in styled, rounded glassmorphic containers with subtle borders and hover micro-animations.

2. **Branding & Favicon Standard**:
   - Generate dynamic vector emblem / SVG logos for headers and framework-native `icon.svg` / `favicon.svg` for sharp browser tab icons.

## Critical Layout & UI Architecture Rules

1. **Dynamic Hero Composition (Astra/Fable Standard)**:
   - Compose edge-to-edge or editorial split-screen hero stages (`min-h-[100dvh]`) tailored to the product domain.
   - When a visual showcase or carousel is appropriate for the domain, support GPU 3D perspective (`perspective: 1200px`), smooth spring transitions, and accessible controls.

2. **Left-Aligned Brand Identity (when a horizontal header exists)**:
   - Position the brand emblem and typography on the left of the header (`flex items-center justify-between`).
   - Provide clear desktop navigation and touch-safe (`>= 44px`) mobile navigation that is discoverable and labeled.

3. **Mobile Navigation**:
   - Choose menu, inline links, pinned bar, or dock from the brief. When a dock is used, mount it in the root layout (`layout.tsx`, `+layout.svelte`, `layouts/default.vue`, `app.component.html`) with `pb-20 lg:pb-0` clearance so page content is never obscured.

4. **File Writing & Tool Safety Guardrail**:
   - NEVER provide `ArtifactMetadata` in `write_to_file` when writing or editing project code files outside the artifact directory (`<appDataDir>/brain/<conversation-id>/`).
   - For project files, use `replace_file_content` or `run_command` with bash/heredoc to avoid `is not a valid artifact path` errors.


### 3. Header & Brand Logo Standard (Display Block & Zero Navigation Duplication)
- Header element MUST use `display: block; width: 100%;` (`block sticky top-0 z-[900] w-full`).
- **Zero Duplication Rule**: Primary navigation must not be rendered twice on any viewport. Whatever pattern the brief selects (menu, inline links, pinned bar, dock), render it once and hide the desktop variant on mobile (`hidden lg:flex` / `lg:hidden`).


## Mandatory Package Manager & Modern Versioning Standards

1. **Strict `pnpm` Only**:
   - ALL dependency installations, script executions, and validation commands MUST use `pnpm` (`pnpm install`, `pnpm run build`, `pnpm dev`, `pnpm add <pkg>`).
   - NEVER use `npm` or `yarn`.

2. **Current Stable Framework Policy (verified 2026-08-27)**:
   - Resolve package versions from official release pages and the pnpm registry immediately before scaffolding; never treat this document as a permanent `latest` pin.
   - Tested stable baselines: **Next.js 16.3 + React 19**, **SvelteKit 2 stable + Svelte 5** (SvelteKit 3 is release-candidate and must not be selected unless explicitly requested), **Nuxt 4.3 + Vue 3.5**, and **Angular 20+** with standalone components and Signals.
   - Use the framework's mandated styling approach (fully custom-themed Tailwind v4 for Next.js, scoped `<style>` blocks for SvelteKit, hand-written theme for Nuxt, SCSS for Angular) and the framework-specific Phosphor Icons package (`@phosphor-icons/react` / `@phosphor-icons/web` / `@phosphor-icons/vue`) — never a Lucide package. Commit the generated `pnpm-lock.yaml`, run `pnpm audit --audit-level=high`, and run every framework validation command before completion.


### Pre-Scaffolding CVE & Security Verification Protocol (CRITICAL)
- **Vulnerability & CVE Pre-Flight Check**: Prior to scaffolding dependencies, ensure that all selected package versions are current and free from known CVEs, malicious supply-chain packages, or high/critical security advisories.
- **Audit Verification on First Init**: Run `pnpm audit --audit-level=high` after install and require zero high or critical advisories.
- **Supply-Chain Integrity**: Never install deprecated, unmaintained, or wildcard dependency versions. Always specify pinned or exact caret versions matching modern security baselines.
