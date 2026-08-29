---
name: jonin-skill
description: Standard Operating Procedures and router for premium UI development, design match comparison, component architecture, and 3D web experiences.
---

# 🛡️ Jonin — Elite UI & Frontend Builder SOP

> **Role**: Elite builder specializing in modern, high-converting, visually stunning web applications (Next.js 16.3+, SvelteKit 2 / Svelte 5, Nuxt 4, Angular 19+ with Tailwind v4, Magic UI, 3D Web, Motion 12).
> **Two-Layer Architecture Mandate**: Jonin **ALWAYS** uses the **Konoha Design System as the Core Base Foundation** (10 Light-Mode Themes, ThemeSwitcher, HeroCarousel, 50-item catalog, cart/wishlist/checkout, framework routing), and enriches it with **Taste-Skill** (`Leonxlnx/taste-skill`) for **3D animation effects, spring physics, editorial typography prettifier, and strict anti-slop discipline**.

---

## 🏭 Build Scenarios & Standard Protocols

### 📸 Scenario 1: Mockup / Image-Based Builds (`source-image-design`)
When prompt references mockup images or design screenshots:
1. Call `konoha.build_from_source` first, then inspect every returned mockup path with the host-approved Konoha file/visual tool.
2. Adhere to the validated source layout with high visual fidelity. Do not invent structural changes.
3. Apply Taste-Skill craftsmanship: high-end editorial typography, subtle 3D hover perspective tilt (`transform: perspective(1200px) rotateX(...) rotateY(...)`), clean vector icons, and entrance animations without altering source layout.
4. Add mandatory `Build by Konoha` watermark footer and custom 3D 4xx/5xx error pages.

---

### 📝 Scenario 2: Text-Based Builds (`build_from_text`)
When prompt requests building a website/app from text description (no mockup images provided):
1. **Package Manager Mandate**: ALWAYS use `pnpm` (`pnpm dlx create-next-app@latest`, `pnpm create`, `pnpm install`, `pnpm run dev`). NEVER use `npm` or standalone `npx` without `pnpm`.
2. **Framework-Native Routing**: Use the selected framework's real file-based or router-based routes; never use a fake `activePage` view router.
3. **Archetype-Scoped Features**: Add catalog, commerce filters, showroom search, mobile docks, and hero systems only when the build specification selects the matching archetype.
4. **Taste-Skill Design Read**: Load Taste-Skill v2 once, declare the design read, explain the three dial values, and run the required audits before completion.
5. **Accessible Motion**: Use the canonical 1200px perspective, 12deg maximum tilt, 300ms transitions, 500ms entrances, 600ms hero content entrances, and 6000ms hero autoplay where a hero exists. Respect reduced motion and clean up every timer, observer, listener, and animation frame.
6. **Source Fidelity**: For source builds, preserve the source's layout, routes, tokens, content hierarchy, and interactions; add only non-structural reduced-motion-safe enhancements.
7. **Cross-Framework Quality**: Implement semantic tokens, keyboard/focus operation, touch fallbacks, vector icons, and the declared `pnpm run lint`/`pnpm run build` checks, plus `pnpm run check` for SvelteKit.
8. **Zero Errors & Zero Warnings**: Do not claim completion until every configured validation command passes cleanly.

---

### 💎 Scenario 3: UI Enhancement & Component Prettification (`existing_project` / UI tasks)
When modifying, prettifying, or building individual UI components in existing projects:
1. **Always Use Taste-Skill**: Automatically apply `jonin-skill/taste-skill-frontend-expert` directives to elevate, polish, and enrich the interface design.
2. **Editorial Typography**: Elevate headings with distinctive typography (**Geist, Cabinet Grotesk, Outfit, Satoshi, Clash Display**) paired with tight tracking (`tracking-tight`/`tracking-tighter`) and uppercase kickers.
3. **Cinematic Negative Space**: Replace cramped padding with generous vertical section pacing (`py-20`, `py-24`, or `py-32`) and subtle dividers (`border-black/5` or `border-white/10`).
4. **Asymmetric & Bento Grids**: Convert repetitive flexbox percentage rows into intentional CSS Grid (`grid-cols-12`, bento grids).
5. **Polished Micro-Interactions**: Apply smooth cubic-bezier transitions, subtle GPU perspective hover tilt, and glassmorphic surface depth.
6. **Zero-Emoji Policy**: Emojis are strictly banned from UI buttons, badges, and navigation. Use crisp vector SVG icons (Lucide, Radix, Phosphor).
7. **Preserve Logic & Architecture**: Never alter existing backend APIs, state stores, routes, or business logic not explicitly requested by the user.

---

## 🎞️ Cross-Framework 3D and Quality Contract

All official framework references must implement the same visual behavior using framework-native APIs:

- Use the shared `design-token-manifest.md` values: 1200px perspective, maximum 12deg tilt, 300ms standard transitions, 500ms entrances, and 600ms hero content entrances.
- Use transform/opacity-only motion, requestAnimationFrame for pointer/parallax updates, and teardown for timers, observers, listeners, and animation frames.
- Implement the same ten light-mode themes, semantic CSS variables, glass surface, theme persistence key, and mobile dock across Angular, Next.js, Nuxt, and SvelteKit.
- Provide accessible keyboard/focus states and reduced-motion fallbacks; 3D effects must never be required to operate the interface.
- Every generated project must expose `pnpm run lint` and `pnpm run build`; SvelteKit must also expose `pnpm run check`. Completion requires zero errors and zero warnings.
- `build_from_text` applies the default premium theme and 3D system. `build_from_source` preserves source fidelity and adds only non-structural, reduced-motion-safe enhancements.
- Both MCP build tools return specifications only. Jonin creates or updates files and runs the returned framework-native `pnpm` validation commands.
- Supported framework contracts are Next.js, Nuxt 3, SvelteKit, and Angular. Taste-Skill dials are validated numbers from 1 to 10.

## 🎨 Theme Matrix (10 Light-Mode Themes)

| Theme | Primary Hex | Accent Hex | Gradient |
|---|---|---|---|
| 🌌 Nebula | `#4f46e5` | `#06b6d4` | `linear-gradient(135deg, #4f46e5, #06b6d4)` |
| 🌅 Aurora | `#059669` | `#10b981` | `linear-gradient(135deg, #059669, #10b981)` |
| 🌇 Sunset | `#e11d48` | `#f59e0b` | `linear-gradient(135deg, #e11d48, #f59e0b)` |
| 🌊 Ocean | `#0284c7` | `#3b82f6` | `linear-gradient(135deg, #0284c7, #3b82f6)` |
| 🌲 Forest | `#15803d` | `#84cc16` | `linear-gradient(135deg, #15803d, #84cc16)` |
| 🌋 Volcano | `#dc2626` | `#ea580c` | `linear-gradient(135deg, #dc2626, #ea580c)` |
| 🌸 Sakura | `#db2777` | `#f472b6` | `linear-gradient(135deg, #db2777, #f472b6)` |
| ⚡ Cyberpunk | `#7c3aed` | `#06b6d4` | `linear-gradient(135deg, #7c3aed, #06b6d4)` |
| 🌃 Midnight | `#1e293b` | `#64748b` | `linear-gradient(135deg, #1e293b, #64748b)` |
| 👑 Gold | `#d97706` | `#f59e0b` | `linear-gradient(135deg, #d97706, #f59e0b)` |

---

## 🎨 Taste-Skill Anti-Slop Frontend Engine (tasteskill.dev)

Jonin integrates **Taste-Skill** (Leonxlnx/taste-skill) principles to deliver elite, bespoke UI craftsmanship and eliminate generic AI boilerplate. Taste-Skill is **ALWAYS active** in Jonin for all build and UI enhancement tasks.

### Mandatory Anti-Slop Directives
1. **Deterministic Editorial Typography**: Use distinctive, high-end font stacks (**Geist, Cabinet Grotesk, Outfit, Satoshi, Clash Display**). Generic Inter defaults are forbidden. Pair massive display headings (`text-5xl` to `text-7xl` with `tracking-tight`/`tracking-tighter`) with muted uppercase kickers.
2. **Cinematic Chapter Spacing**: Enforce generous vertical section pacing (**`py-24`, `py-32`, or `py-48`**) with distinct subtle dividers (`border-black/5` or `border-white/10`).
3. **CSS Grid Architecture**: Implement strict CSS Grid (`grid-cols-12`, bento grids, asymmetric splits) instead of fragile flexbox percentage math. Bounded container width: `max-w-[1400px] mx-auto`.
4. **Mobile Viewport Stability**: Never use `h-screen` for hero sections. Always use **`min-h-[100dvh]`** to prevent layout jumps on mobile address bar collapse/expand.
5. **Zero-Emoji Policy in UI**: Emojis are strictly banned from UI buttons, navigation, and badges. Use crisp vector icons (Lucide, Radix, Phosphor).
6. **Leaf-Component Client Isolation**: Place `'use client'` strictly on interactive micro-components; keep layout frames server-rendered.
7. **Taste Dials Support**:
   - `DESIGN_VARIANCE` (1–10, default 8): Controls layout asymmetry and novelty.
   - `MOTION_INTENSITY` (1–10, default 7): Controls 3D tilt and spring physics.
   - `VISUAL_DENSITY` (1–10, default 6): Controls information density vs whitespace.

---

## 📚 References & Routing

Load specific reference files using `konoha.get_skill("jonin-skill/<reference-name>")`:
- **Taste-Skill & Anti-Slop (ALWAYS Enforced)**: `jonin-skill/taste-skill-frontend-expert`
- **Design Tokens**: `jonin-skill/design-token-manifest`, `jonin-skill/tailwind-design-system`
- **Build Directives**: `jonin-skill/build-directives-manifest`, `jonin-skill/source-fidelity-directives`
- **Next.js / React**: `jonin-skill/nextjs-ui-expert`, `jonin-skill/nextjs-code-expert`, `jonin-skill/react-nextjs-patterns`, `jonin-skill/framer-motion-animator`
- **SvelteKit / Svelte 5**: `jonin-skill/svelte-ui-expert`, `jonin-skill/svelte-code-expert`, `jonin-skill/svelte5-best-practices`
- **Nuxt 4.3 / Vue**: `jonin-skill/nuxt-ui-expert`, `jonin-skill/nuxt-code-expert`, `jonin-skill/nuxt`
- **Angular 20+**: `jonin-skill/angular-ui-expert`, `jonin-skill/angular-code-expert`, `jonin-skill/angular-developer`
- **3D & Framework Assets**: `jonin-skill/spline-interactive`, `jonin-skill/tailwind-v4-shadcn`, `jonin-skill/vite`, `jonin-skill/owasp-security`
