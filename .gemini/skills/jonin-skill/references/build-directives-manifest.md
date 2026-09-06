# Jonin Build Directives Manifest

This manifest is required by `build_from_text` and `build_from_source` for Angular, Next.js, Nuxt, and SvelteKit.


## Architecture: Konoha Core Base + Taste-Skill Enrichment

All web application builds execute in two complementary layers:

1. **Layer 1: Konoha Core Design Base (Foundation)**:
   - **Themes**: 10 Light-Mode Themes (`[data-theme="..."]`) via CSS custom variables (`--theme-bg`, `--theme-fg`, `--theme-card`, `--theme-border`, `--theme-accent`, etc.).
   - **ThemeSwitcher**: Fixed at `bottom-6 left-6 z-[999]` with `localStorage` persistence.
   - **Hero Carousel**: Full-width 3D `HeroCarousel` with 1200px perspective, tilt physics, thumbnails, play/pause, and spec badges.
   - **Catalog & Commerce**: 50-item production-grade catalog dataset with reactive filters, category search, sort, pagination, cart drawer, and checkout modals.
   - **Framework Standard**: Strictly **Next.js 16.3+ App Router (React 19, Tailwind v4)**, **SvelteKit 2 (Svelte 5 Runes)**, **Nuxt 3.15+/4.3**, or **Angular 19+**.
   - **Footer Watermark**: `Build by Konoha` watermark.

2. **Layer 2: Taste-Skill Enrichment (Polish, 3D & Anti-Slop)**:
   - **3D Animation & Sensory Dynamics**: Motion 12 spring physics, 3D card tilt (`perspective(1200px)`), dynamic hover sheen, `hover:-translate-y-1`, and tactile `active:scale-[0.98]`.
   - **Prettifier & Editorial Typography**: Distinctive fonts (Geist, Cabinet Grotesk, Clash Display), tight tracking, scale contrast (`text-6xl`-`text-8xl` vs micro badges), cinematic section spacing (`py-24`, `py-32`, `py-48`), and 12-column asymmetric bento layouts.
   - **Anti-Slop Discipline**: Zero emojis in UI (Lucide vector icons only), viewport-safe `min-h-[100dvh]`, sticky mobile bottom dock, and leaf-component client isolation (`'use client'` strictly on micro-interactions).

## Shared requirements

- Use `pnpm` exclusively. Do not use `npm`, `yarn`, or standalone `npx`.
- Use framework-native routing; never use hash routing or a fake `activePage` router.
- Implement the official ten light-mode themes and semantic CSS variables from `design-token-manifest.md`.
- Add bounded 3D perspective interactions, entrance motion, glass surfaces, and responsive behavior without harming readability.
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

## Build-mode boundary

`build_from_text` applies the default premium theme and 3D system. `build_from_source` preserves source layout, content hierarchy, and visual language; it may add only non-structural, reduced-motion-safe enhancement. Do not inject generic themes, carousels, dialogs, or watermarks into source builds unless the source explicitly contains them.


## Application Archetype Directives (Landing Page vs Multi-Page SPA)

1. **Landing Page Archetype**:
   - Triggered when prompt mentions *landing page*, *one page*, *portfolio*, or *promotional page*.
   - Implements a single-page flowing narrative with section IDs (, , , , ).
   - Smooth scroll behavior with active section spy.

2. **SPA / Multi-Page Store / Web App Archetype**:
   - Triggered when prompt mentions *SPA*, *multi-page*, *store*, *e-commerce*, *shop*, *dashboard*, *platform*, or *web application*.
   - MUST implement true framework-native multi-page routes with paging/pagination:
     - : Home runway & curated preview.
     -  (or ): Complete archive with category filtering, sorting, and pagination (e.g. Page 1, 2, 3).
     - : Individual product detail page with 3D showcase, image gallery, size selector, and Add to Bag.
     -  / : Visual lookbook and runway photo essay grid.
     -  / : Atelier timeline, milestones, and brand storytelling.
     -  / : Complete transactional shopping bag flow.

3. **Iconography Standard**:
   - Strictly use official Lucide icon libraries (, , , ).
   - NEVER use emojis as icons. Wrap icons in styled, rounded glassmorphic containers with subtle borders and hover micro-animations.

4. **Branding & Favicon Standard**:
   - Generate dynamic vector emblem / SVG logos for headers and framework-native  /  for sharp browser tab icons.

## Critical Layout & UI Architecture Rules

1. **Full-Width Hero Banner Carousel**:
   - MUST be edge-to-edge full width (`w-full min-w-full`). Do NOT constrain the outer container to a narrow `max-w`.
   - Feature 4+ real high-definition photography slides with GPU 3D perspective tilt (`perspective: 1400px`), crossfade transitions, play/pause controls, and indicator dots.

2. **Top-Left Header Brand Logo**:
   - The brand emblem and typography MUST be positioned at the **top-left** of the navigation header on both desktop and mobile view.
   - Desktop navigation links occupy the center, and action triggers (Search, Wishlist, Cart) are placed on the right.

3. **Sticky Mobile Bottom Navigation Dock**:
   - The mobile bottom navigation dock (`MobileDock`) MUST be placed in the root layout (`layout.tsx`, `+layout.svelte`, `layouts/default.vue`, `app.component.html`) so it is present across all routes.
   - Positioned as `fixed bottom-0 left-0 right-0 z-[999] lg:hidden` with `backdrop-blur-2xl` and high contrast.
   - The `<body>` or root wrapper must have `pb-20 lg:pb-0` so bottom page content is never obscured by the mobile dock.

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
   - Use Tailwind CSS v4 and the framework-specific Lucide package. Commit the generated `pnpm-lock.yaml`, run `pnpm audit --audit-level=high`, and run every framework validation command before completion.


### Pre-Scaffolding CVE & Security Verification Protocol (CRITICAL)
- **Vulnerability & CVE Pre-Flight Check**: Prior to scaffolding dependencies, ensure that all selected package versions are current and free from known CVEs, malicious supply-chain packages, or high/critical security advisories.
- **Audit Verification on First Init**: Run No known vulnerabilities found (or No known vulnerabilities found) on initial installation to guarantee zero high or critical vulnerabilities.
- **Supply-Chain Integrity**: Never install deprecated, unmaintained, or wildcard dependency versions. Always specify pinned or exact caret versions matching modern security baselines.
