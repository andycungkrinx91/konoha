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

Jonin executes with a deterministic two-layer frontend engine:
1. **Core Base Foundation**: The Konoha Design System (10 Light-Mode Themes, ThemeSwitcher modal, HeroBanner carousel with $\ge 4$ slides, archetype-adaptive MobileDock, far-left logo, framework routing, and zero hamburger menus in mobile headers).
2. **Taste-Skill Prettification Layer** (`Leonxlnx/taste-skill`): Enriches the UI with editorial typography, generous chapter spacing, 3D perspective hover tilts (`transform: perspective(1200px) rotateX(...) rotateY(...)`), CSS Grid/bento layouts, spring physics, and strict zero-emoji control policies.

---

## Build Scenarios & Standard Protocols

### Scenario 1: Mockup / Image-Based Builds (`build_from_source`)
When design screenshots, Figma exports, or mockup images are provided:
1. Call `konoha.build_from_source` first to generate the structural design specification.
2. **100% Exact Mockup Fidelity**: Strictly replicate visual layout, color palette, typography hierarchy, vertical spacing, and component alignments present in the source images. Do NOT force default text invariants (such as carousels or theme switchers) unless visible in the source images or explicitly requested.
3. Apply Taste-Skill craftsmanship non-destructively: high-end font pairings, smooth micro-interactions, clean vector icons (Phosphor/Radix), and accessible transitions without altering layout geometry.
4. Conclude with responsive verification and 3D 4xx/5xx error pages.

### Scenario 2: Text-Based Builds (`build_from_text`)
When scaffolding a fresh project or interface from text descriptions:
1. Call `konoha.build_from_text` first to retrieve the archetype build specification.
2. **Standard Scaffolding via `pnpm`**: Strictly initialize using official framework CLIs with non-interactive flags wrapped by `rtk`:
   - **Next.js**: `rtk pnpm create next-app@latest <project-name> --typescript --tailwind --eslint --app --src-dir --no-turbopack --import-alias "@/*" --use-pnpm --silent`
   - **Nuxt**: `rtk pnpm dlx nuxi@latest init <project-name> --packageManager pnpm --gitInit false`
   - **Angular**: `rtk pnpm dlx @angular/cli@latest new <project-name> --package-manager=pnpm --style=scss --routing=true --ssr=false --skip-tests=true --skip-git=true`
   - **SvelteKit**: `rtk pnpm dlx sv create <project-name> --template minimal --types ts --no-add-ons --install pnpm`
   *Rule*: NEVER use `npm` or standalone `npx` without `pnpm`. Always install packages with `rtk pnpm add <packages> --silent`.
3. **Mandatory package.json Scripts Invariant**: Across all 4 frameworks, every project's `package.json` MUST define working scripts for `"dev"`, `"lint"` (`pnpm run lint`), `"build"` (`pnpm run build`), and `"start"` (`pnpm run start`) (plus `"check"` for SvelteKit). All commands must execute cleanly with 0 errors.
4. **Zero Errors & Zero Warnings Completion Gate**: Do not claim completion until every framework validation command (`pnpm run build`, `pnpm run lint`, `pnpm run check`) passes cleanly with 0 errors and 0 warnings.

### Scenario 3: UI Enhancement & Component Prettification (`existing_project`)
When modifying, modernizing, or polishing existing projects or individual components:
1. **Preserve Logic & Business Architecture**: Keep existing backend APIs, state stores, database models, and unaffected routes 100% intact.
2. **Apply Taste-Skill Polish**: Elevate typography with distinctive font stacks (**Geist, Cabinet Grotesk, Outfit, Satoshi, Clash Display**), tight tracking (`tracking-tight`/`tracking-tighter`), and uppercase kickers.
3. **Cinematic Negative Space**: Replace cramped padding with intentional vertical section pacing (`py-20`, `py-24`, `py-32`) and subtle dividers (`border-black/5` or `border-stone-200`).
4. **Grid Architecture**: Transition repetitive flexbox rows into deliberate CSS Grid layouts (`grid-cols-12`, bento grids).
5. **Zero-Emoji Policy**: Emojis are strictly forbidden from UI buttons, badges, and controls. Use crisp SVG vector icons (Phosphor or Radix — never generic Lucide AI defaults).

---

## Mandatory Website Architecture & Layout Invariants (Text-Based Builds)

Every fresh website scaffolded by Jonin MUST implement these 5 structural invariants:

1. **Header Architecture (Logo on Far LEFT)**:
   - The brand logo MUST always be placed on the **far LEFT** of the header navigation (`flex justify-between items-center` with brand logo at top-left, navigation links adjacent or centered, and action buttons on the far right). NEVER center or push the logo right.
2. **Mobile View Invariant (NO Hamburger Toggle in Header)**:
   - In mobile viewports (`lg:hidden`), **NEVER render a top hamburger menu toggle button in the header**. Mobile navigation is powered exclusively by the fixed bottom Mobile Dock.
3. **Archetype-Adaptive Mobile Navigation Dock**:
   - On mobile viewports (`lg:hidden`), render a fixed bottom mobile navigation dock (`fixed bottom-0 left-0 right-0 z-40 bg-white/90 backdrop-blur-md border-t border-slate-200 shadow-lg`) with quick one-tap links adapted dynamically to the archetype:
     - *E-commerce*: Home, Shop/Catalog, Themes, Wishlist (badge count), Cart (badge count).
     - *Portfolio*: Home, Projects, Case Studies, About, Contact.
     - *Dashboard*: Overview, Analytics, Users, Settings.
     - *SaaS*: Home, Features, Pricing, Testimonials, Contact.
4. **Dashboard & Admin Left Sidebar Invariant**:
   - For Admin, Dashboard, and Infrastructure builds, render a fixed Left Sidebar on desktop (`lg:flex flex-col w-64 fixed inset-y-0 left-0 bg-white border-r border-slate-200 z-30`) with brand logo at top-left, navigation items with badge indicators, and user profile badge at bottom. On mobile viewports (`lg:hidden`), navigation transitions seamlessly to the Mobile Dock with zero broken header menu toggles.
5. **Floating Bottom-Left 10-Theme Switcher Popup**:
   - In both desktop and mobile viewports, the interactive Konoha 10-Theme Light-Mode Switcher button floats in the **bottom-left corner** (`fixed bottom-6 left-6 z-50`, like a customer chat/FAB button). Clicking it opens the 10-theme selection popup modal with dynamic CSS variables and `localStorage` persistence. Pure Light Mode is first-class (zero dark mode enforcement).
6. **Hero Banner Carousel ($\ge 4$ Slides)**:
   - The homepage hero section MUST implement an interactive banner carousel with a **minimum of 4 high-definition slides**, 5000ms autoplay with hover pause, previous/next chevron buttons, indicator thumbnails/dots, slide badges, and call-to-action buttons.

---

## 🎨 Official Konoha 10 Light-Mode Themes Matrix

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
