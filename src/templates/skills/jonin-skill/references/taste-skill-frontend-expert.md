# Konoha Craft Checklist (Taste-Skill Enrichment)
Reference: https://www.tasteskill.dev/ | https://github.com/leonxlnx/taste-skill
Upstream Pin: Tag `v2.1.5` | Commit `12af471` | License `MIT` | https://github.com/leonxlnx/taste-skill

> **This is a craft checklist applied AFTER the design brief.** It never selects the art direction, layout, theme count, or domain features — the 9-field design brief does that. Use these items to raise execution quality once direction is set.

---

## Two-Layer Architecture Overview

```mermaid
flowchart TD
    subgraph Layer1 ["Layer 1: Dynamic Context-Driven Composition (Astra / Fable Direction)"]
        K1["Brief-Derived Semantic Tokens (single or dual theme)"]
        K2["Bespoke Hero Storytelling (Interactive Stage, Command Workbench, or Editorial Split)"]
        K3["Cross-Framework Motion Architecture (motion/react, motion-v, svelte/motion, motion JS)"]
        K4["Navigation Pattern Chosen From The Brief"]
        K5["Domain-Scoped Data & Flows (only what the brief requires)"]
        K6["Next.js 16.3+ / SvelteKit 2 (Svelte 5) / Nuxt 4 / Angular 19+"]
    end

    subgraph Layer2 ["Layer 2: Taste-Skill Enrichment (The Polish)"]
        T1["Spring Physics & Gesture Choreography (Motion v12+)"]
        T2["Editorial Prettifier & True Italic Typographic Scale (Geist / Boska 401)"]
        T3["Cinematic Section Spacing (py-24 / py-32 / py-48) & 12-col Bento"]
        T4["Anti-Slop & Data Safety (Zero emojis, 100dvh, Safe-Text Charts, Phosphor icons)"]
        T5["Keyboard & Accessible Names + Leaf Client Isolation"]
    end

    Layer1 --> Layer2
    Layer2 --> ProductionUI["Bespoke High-Converting Frontend Web App"]
```

---

## 1. Layer 1: Dynamic Context-Driven Design System (Astra / Fable Foundation)

Every build composes its visual architecture dynamically around the product domain and user prompt — never forcing a rigid boilerplate template:

1. **Project Semantic Tokens**:
   - Define semantic CSS custom properties (`--bg-canvas`, `--bg-surface`, `--bg-elevated`, `--text-primary`, `--text-muted`, `--border-subtle`, `--accent-primary`, `--accent-glow`) from the brief. Single or dual theme is a brief decision; add `prefers-color-scheme` handling and a persisted toggle only for dual-theme projects.
2. **Bespoke Hero Storytelling (Zero Forced Carousels)**:
   - Choose the hero composition that best serves the product narrative: an interactive product stage, live command/telemetry workbench, editorial split-screen showcase, kinetic typography canvas, or spatial 3D preview. Do not force a 4-slide banner carousel or bottom-left FAB unless requested.
3. **Cross-Framework Motion Choreography (`framer-motion-animator`)**:
   - **Next.js 16**: `motion/react` (`jonin-skill/motion-nextjs`)
   - **Nuxt 4**: `motion-v` + `motion` JS API (`jonin-skill/motion-nuxt`)
   - **SvelteKit 2**: `svelte/motion` (`Spring`, `Tween`) + `motion` JS API (`jonin-skill/motion-svelte`)
   - **Angular 19/20+**: `motion` JS API with `afterNextRender`, Signals, and `DestroyRef` (`jonin-skill/motion-angular`)
4. **Header Architecture & Responsive Navigation**:
   - Place the brand identity cleanly on the left of a horizontal header (`flex justify-between items-center`), with accessible desktop navigation and touch-safe (`>= 44px`) mobile navigation. The pattern (menu, inline links, pinned bar, or dock) comes from the brief.
5. **Domain-Scoped Data & Interactive Flows**:
   - Scope functional requirements to the brief: reactive catalog and cart only for commerce briefs; KPI and topology views only for operations briefs; pricing stages only when the product sells tiers; case-study filters only when the work is the product.
6. **Required Konoha Generator Signature**:
   - Include `<meta name="generator" content="Build by konoha">` in the HTML `<head>` and render the visible text `Build by konoha` in the `<footer>`.

---

## 2. Layer 2: Taste-Skill Enrichment & Anti-Slop Polish

Taste-Skill enriches the Konoha foundation with 3 core pillars:

### A. 3D Animation Effects & Tactile Physics
- **Spring Physics**: Use physics-based springs (`type: "spring", stiffness: 300, damping: 25` in Motion 12 / Svelte transitions) instead of linear CSS transitions.
- **3D Card Perspective Tilt**:
  ```tsx
  <div
    style={{ transform: `perspective(1200px) rotateX(${tilt.y}deg) rotateY(${tilt.x}deg) translateZ(10px)` }}
    className="relative transition-transform duration-200 ease-out rounded-2xl bg-[var(--theme-card)] border border-[var(--theme-border)] shadow-sm hover:shadow-xl group"
  >
    {/* Subtle dynamic sheen on hover */}
    <div className="absolute inset-0 rounded-2xl bg-gradient-to-tr from-white/0 via-white/5 to-white/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
    {children}
  </div>
  ```
- **Sensory Tactile Feedback**:
  - Interactive buttons have tactile scale feedback: `active:scale-[0.98] transition-transform duration-100`.
  - Cards lift on hover: `hover:-translate-y-1 hover:shadow-lg`.
  - Staggered entrance animations for catalog grids (`staggerChildren: 0.05`).
- **Accessibility & Reduced-Motion Safety**:
  - Automatically disable 3D tilt and use opacity-only fades when `prefers-reduced-motion: reduce` is detected.

### B. Prettifier & Typographic Polish
- **Editorial Typography Stacks**:
  - Display / Headlines: **Cabinet Grotesk, Clash Display, Space Grotesk** with tight tracking (`tracking-tight` / `tracking-tighter`).
  - Body / Data: **Geist, Satoshi, Outfit, Inter Variable** for maximum readability.
- **True Italic Faces Loading (Upstream 2.1.5)**:
  - When utilizing editorial serif or display typefaces (e.g., **Boska, Erode, Sentient** via Fontshare), always request explicit italic weight parameters in the stylesheet link (e.g. `api.fontshare.com/v2/css?f[]=boska@400,401,500&display=swap` where `401` specifies the 400 italic weight; similarly `erode@400,401,500,600`). Never permit the browser to fake oblique italics synthetically.
- **Dramatic Scale Contrast**:
  - Pair massive bold headlines (`text-5xl md:text-7xl lg:text-8xl font-bold leading-[1.02]`) with micro metadata kickers (`text-[11px] font-semibold uppercase tracking-widest`).
- **Cinematic Chapter Spacing**:
  - Generous section padding: **`py-24`, `py-32`, or `py-48`** with clean structural dividers (`border-b border-[var(--theme-border)]`).
- **12-Column Asymmetric Bento Composition**:
  - Use asymmetric CSS Grid splits (e.g. 8:4, 7:5, 2:1 bento modules) instead of monotonous 3-identical-card rows.
  - Hairline structural borders (`border-[var(--theme-border)]`).

### C. Strict Anti-Slop Enforcement & Data Security
- **Safe-Text Charts & Split Headings (Upstream 2.1.5)**:
  - Every label, metric, or user-sourced heading rendered inside SVG charts or split-text headings MUST escape markup before entering `innerHTML` (`const esc = (v) => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);`) or bind via DOM `textContent`. Chart labels or headings originating from database or user data can no longer inject executable markup.
- **Keyboard Navigation & Accessible Names (Upstream 2.1.5)**:
  - Every interactive control (buttons, tabs, carousel chevrons, filter pills, chart elements, theme toggles) MUST be fully operable via keyboard alone in logical DOM reading order and carry an unambiguous accessible name (`aria-label` or visible text).
  - A control must explain itself by its visual form and affordance, never relying on a redundant explanatory sentence placed beside it.
- **Zero-Emoji Policy**: Emojis are strictly banned from UI buttons, badges, and headings. Always use crisp vector icons from Phosphor Icons (`@phosphor-icons/react` / `@phosphor-icons/web` / `@phosphor-icons/vue`) or hand-exported inline SVGs — never a Lucide package (AI-scaffold fingerprint).
- **No Generic AI Gradients**: Avoid generic `from-purple-600 to-indigo-600` AI-slop gradients. Use semantic theme tokens (`var(--theme-accent)`) and subtle radial mesh glares.
- **Mobile Viewport Stability**:
  - Full-viewport sections must use **`min-h-[100dvh]`** (never `h-screen` which jumps on mobile address bar collapse).
  - Sticky mobile bottom navigation dock (`fixed bottom-0 left-0 right-0 z-[999] lg:hidden bg-[var(--theme-bg)]/90 backdrop-blur-md border-t border-[var(--theme-border)]`).
- **Leaf-Component Client Isolation**:
  - Page routes and layouts remain Server Components.
  - `'use client'` is placed strictly on interactive leaf micro-components (`ThemeSwitcher`, `HeroCarousel`, `CartDrawer`, `FilterBar`).

---

## Taste Dials (1–10 Tuning Parameters)

Jonin tunes visual dynamism via 3 dials:
1. **`DESIGN_VARIANCE` (Default: 8)**:
   - 1–3: Conservative, clean enterprise tables and forms.
   - 4–7: Polished SaaS with subtle asymmetry and structured bento grids.
   - 8–10: High-novelty editorial showcase, bespoke interactions, and bold typography.
2. **`MOTION_INTENSITY` (Default: 7)**:
   - 1–3: Static transitions, instant CSS state swaps.
   - 4–7: Smooth spring physics (`motion`/Svelte transitions), subtle 3D card perspective tilt.
   - 8–10: Kinetic scroll parallax, cursor-reactive 3D depth, and staggered entrance choreography.
3. **`VISUAL_DENSITY` (Default: 6)**:
   - 1–4: Airy editorial spacing, giant headlines, single focal points per viewport.
   - 5–7: Balanced SaaS layout with high scannability.
   - 8–10: Dense developer console / analytics dashboard with compact data tables.

---

## Pre-Flight Quality Gate Checklist (Konoha + Taste-Skill)

> **Production Build Inspection Gate (Upstream 2.1.5)**: Always run the final quality gate on the built production artifact (`pnpm run build && pnpm run start`, or static preview), not solely on the dev server. Minifiers and bundlers alter shipping artifacts (e.g. dropping unsupported `backdrop-filter` or modifying CSS transform chains). The quality inspector warns when examining a dev server (`next dev`, `vite`, `webpack`).

Before claiming any UI task complete, verify against this checklist:
- [ ] **Adaptive Dark & Light Mode Tokens**: Semantic CSS variables (`--bg-canvas`, `--bg-surface`, `--text-primary`, `--accent-primary`) with WCAG AA contrast.
- [ ] **Dynamic Storytelling Hero**: Bespoke hero composition tailored to the product archetype (zero forced boilerplate carousels unless requested).
- [ ] **Cross-Framework Motion Choreography**: Verified Motion implementation (`motion/react`, `motion-v`, `svelte/motion`, or `motion` JS API) with spring physics and `prefers-reduced-motion` fallbacks.
- [ ] **Konoha Generator Signature**: `<meta name="generator" content="Build by konoha">` in `<head>` and visible `Build by konoha` signature in `<footer>`.
- [ ] **Framework Baseline**: Strictly **Next.js 16.3+ App Router (React 19, Tailwind v4)**, SvelteKit 2 (Svelte 5), Nuxt 4, or Angular 19+.
- [ ] **Taste-Skill Typography & True Italics**: Distinctive font stack (Geist/Cabinet Grotesk); Fontshare serif faces (Boska, Erode, Sentient) request explicit italic weights (e.g. `401`) preventing synthetic browser faking.
- [ ] **Taste-Skill Spacing**: Cinematic chapter rhythm (`py-24` / `py-32` / `py-48`) and 12-column asymmetric bento grids.
- [ ] **Safe-Text Charts & Split Headings**: Chart labels and split-text headings strictly escaped or bound via `textContent`, eliminating markup injection.
- [ ] **Keyboard & Accessible Names**: Every control keyboard-operable in reading order with descriptive accessible name (`aria-label` or visible text).
- [ ] **Anti-Slop Discipline**: Zero emojis in UI controls (Phosphor SVGs only — never Lucide), safe `min-h-[100dvh]`, leaf-component client isolation.
- [ ] **Production Build Gate**: Tested against the built production artifact (`pnpm run build`), not dev server alone; passes with 0 errors and 0 warnings.
