# Jonin Build Directives Manifest

This manifest is required by `build_from_text` and `build_from_source` for Angular, Next.js, Nuxt, and SvelteKit.


## Architecture: Dynamic Context-Driven Composition + Taste-Skill Enrichment

All web application builds execute in two complementary layers:

1. **Layer 1: Dynamic Context-Driven Foundation (Astra / Fable Direction)**:
   - **Adaptive Color System**: Semantic Dark & Light Mode CSS variables (`--bg-canvas`, `--bg-surface`, `--text-primary`, `--text-muted`, `--border-subtle`, `--accent-primary`) with `localStorage` persistence and WCAG AA contrast.
   - **Bespoke Hero & Section Storytelling**: Compose hero sections dynamically around the product domain (interactive product workbench, kinetic typography stage, editorial split-screen, or 3D spatial preview). Never force a rigid 4-slide carousel or bottom-left 10-theme FAB unless requested.
   - **Cross-Framework Motion Standard**: Implement spring-physics choreography using `motion/react` (Next.js), `motion-v` + `motion` (Nuxt), `svelte/motion` + `motion` (SvelteKit), or `motion` JS API with `afterNextRender` (Angular).
   - **Domain-Scoped Features**: Implement the exact data models and interactive flows required by the project archetype (e.g. 50-item reactive catalog when building e-commerce; live KPI telemetry and topology views when building dashboards).
   - **Framework Standard**: Strictly **Next.js 16.3+ App Router (React 19, Tailwind v4)**, **SvelteKit 2 (Svelte 5 Runes)**, **Nuxt 4.3 (Vue 3.5)**, or **Angular 19/20+**.
   - **Konoha Signature**: `<meta name="generator" content="Build by konoha">` in `<head>` and visible `Build by konoha` signature in `<footer>`.

2. **Layer 2: Taste-Skill Enrichment (Polish, Motion & Anti-Slop)**:
   - **Motion & Sensory Dynamics**: Motion v12+ spring physics, 3D card tilt (`perspective(1200px)`), dynamic hover sheen, `hover:-translate-y-1`, and tactile `active:scale-[0.98]`.
   - **Prettifier & Editorial Typography**: Distinctive fonts (Geist, Cabinet Grotesk, Clash Display), tight tracking, scale contrast (`text-5xl`-`text-7xl` vs micro badges), cinematic section spacing (`py-24`, `py-32`, `py-48`), and 12-column asymmetric bento layouts.
   - **Anti-Slop Discipline**: Zero emojis in UI (Phosphor vector icons only — never Lucide), viewport-safe `min-h-[100dvh]`, accessible mobile navigation, and leaf-component client isolation (`'use client'` strictly on micro-interactions).

## Shared requirements

- Use `pnpm` exclusively. Do not use `npm`, `yarn`, or standalone `npx`.
- Use framework-native routing; never use hash routing or a fake `activePage` router.
- Implement adaptive Dark & Light Mode semantic CSS variables from `design-token-manifest.md`.
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
2. **Build from Text (`build_from_text`)**: Begins with mandatory online reference research (`konoha.web_search` / `agent-browser` / Playwright) inspired by **Framer, Linear, Lusion, Igloo, Darkstar, Unseen, Monolith, Diagram, Raycast, and Spline** to synthesize an original creative direction, adaptive Dark/Light token system, and 3D motion-art language before coding.
3. **Build from Source Website (`build_from_source` with live URL or multi-file source)**: Performs multi-route browser inspection (routes, subpages, navigation flows, interactive states, responsive breakpoints, scroll/hover choreography, design tokens) and reconstructs the application cleanly in **Next.js, Nuxt, SvelteKit, or Angular**.


## Application Archetype Directives (Landing Page vs Multi-Page SPA)

1. **Landing Page Archetype**:
   - Triggered when prompt mentions *landing page*, *one page*, *portfolio*, or *promotional page*.
   - Implements a single-page flowing narrative with section IDs (`#hero`, `#features`, `#showcase`, `#metrics`, `#contact`).
   - Smooth scroll behavior with active section spy.

2. **SPA / Multi-Page Store / Web App Archetype**:
   - Triggered when prompt mentions *SPA*, *multi-page*, *store*, *e-commerce*, *shop*, *dashboard*, *platform*, or *web application*.
   - MUST implement true framework-native multi-page routes with paging/pagination:
     - `/`: Home runway & curated preview.
     - `/catalog` (or `/collections`): Complete archive with category filtering, sorting, and pagination (e.g. Page 1, 2, 3).
     - `/catalog/[id]`: Individual product detail page with 3D showcase, image gallery, size selector, and Add to Bag.
     - `/lookbook` / `/showcase`: Visual lookbook and runway photo essay grid.
     - `/about` / `/atelier`: Atelier timeline, milestones, and brand storytelling.
     - `/cart` / `/checkout`: Complete transactional shopping bag flow.

3. **Iconography Standard**:
   - Strictly use Phosphor Icons (`@phosphor-icons/react` for Next.js, `@phosphor-icons/web` for SvelteKit/Nuxt/Angular CSS-class icons, `@phosphor-icons/vue` for Nuxt component icons) or hand-exported inline SVG icon components. NEVER install or import any Lucide package (`lucide-react`, `lucide-svelte`, `lucide-vue-next`, `lucide-angular`) — Lucide is a named AI-scaffold fingerprint (PLAN_HUMAN_BUILT.md).
   - NEVER use emojis as icons. Wrap icons in styled, rounded glassmorphic containers with subtle borders and hover micro-animations.

4. **Branding & Favicon Standard**:
   - Generate dynamic vector emblem / SVG logos for headers and framework-native `icon.svg` / `favicon.svg` for sharp browser tab icons.

## Critical Layout & UI Architecture Rules

1. **Dynamic Hero Composition (Astra/Fable Standard)**:
   - Compose edge-to-edge or editorial split-screen hero stages (`min-h-[100dvh]`) tailored to the product domain.
   - When a visual showcase or carousel is appropriate for the domain, support GPU 3D perspective (`perspective: 1200px`), smooth spring transitions, and accessible controls.

2. **Top-Left Header Brand Identity**:
   - Position the brand emblem and typography cleanly on the left of the navigation header (`flex items-center justify-between`).
   - Provide clear desktop navigation and touch-safe (`>= 44px`) mobile navigation or an archetype-adaptive bottom dock (`BottomDock`).

3. **Interactive Bottom Dock / Mobile Navigation**:
   - When an application or mobile dock is used, place it in the root layout (`layout.tsx`, `+layout.svelte`, `layouts/default.vue`, `app.component.html`) with spring magnification, `backdrop-blur-xl`, and `pb-20 lg:pb-0` clearance so page content is never obscured.

4. **File Writing & Tool Safety Guardrail**:
   - NEVER provide `ArtifactMetadata` in `write_to_file` when writing or editing project code files outside the artifact directory (`<appDataDir>/brain/<conversation-id>/`).
   - For project files, use `replace_file_content` or `run_command` with bash/heredoc to avoid `is not a valid artifact path` errors.


### 3. Header & Brand Logo Standard (Display Block & Zero Navigation Duplication)
- Header element MUST use `display: block; width: 100%;` (`block sticky top-0 z-[900] w-full`).
- **Zero Duplication Rule**:
  - **Desktop View**: Desktop navigation links render in the center of the top header (`hidden lg:flex`). The mobile bottom dock is HIDDEN on desktop (`lg:hidden`).
  - **Mobile View**: Top header renders Brand Logo (top-left) and action triggers (Search, Wishlist, Bag) only. Do NOT render a hamburger menu or duplicate navigation drawer in the header. Mobile navigation is handled strictly by the sticky mobile bottom dock.


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
- **Audit Verification on First Init**: Run No known vulnerabilities found (or No known vulnerabilities found) on initial installation to guarantee zero high or critical vulnerabilities.
- **Supply-Chain Integrity**: Never install deprecated, unmaintained, or wildcard dependency versions. Always specify pinned or exact caret versions matching modern security baselines.
