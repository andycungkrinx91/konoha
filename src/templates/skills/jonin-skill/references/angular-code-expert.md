# Angular 20+ Code Expert & Architectural Guidelines

Comprehensive implementation standards for **Angular 20+** (Standalone Components + Signals + Tailwind CSS v4) projects using `pnpm` exclusively.

## 🏗️ Technical Directives
- **Package Manager**: `pnpm` exclusively (`pnpm dlx @angular/cli@latest new <path> --style=scss --routing=true --ssr=false`, `pnpm install`, `pnpm run start --open`).
- **Reactivity**: Angular Signals (`signal()`, `computed()`, `effect()`) for state management and reactive filters.
- **Components**: Standalone components (`standalone: true` or default in Angular 19/20+).
- **Theme Engine**: Adaptive Dark & Light Mode semantic CSS variables (`--bg-canvas`, `--bg-surface`, `--text-primary`, `--accent-primary`).
- **Motion Engine**: Official `motion` JS API (`animate`, `inView`, `scroll`, `stagger`, `spring`) inside `afterNextRender()` with `DestroyRef` cleanup — see `jonin-skill/motion-angular`.
- **Signature**: `<meta name="generator" content="Build by konoha">` in `src/index.html` and visible `Build by konoha` signature in `<footer>`.

---

## 🎨 Dynamic Storytelling & Visual Standards (Astra/Fable Direction)

All generated Angular code must follow dynamic, domain-driven composition rather than a rigid boilerplate template:
1. **Theme Strategy From The Brief**: Choose single or dual theme from the design brief; define semantic CSS variables and persist any user choice under a project-specific key.
2. **Bespoke Hero Storytelling**: Compose the hero around the product domain (interactive workbench, kinetic typography stage, editorial split showcase, or 3D preview). Do not force a 4-slide hero carousel or 5 carousels per site unless requested.
3. **Motion & 3D Spring Choreography**: Use `motion` spring physics (`jonin-skill/motion-angular`) for card elevation, shared layout indicators, dock magnification, and reduced-motion-safe scroll reveals.
4. **Domain-Scoped Data & Filters**: When building e-commerce or catalog apps, provide rich reactive datasets with search, category filters, and sorting using Angular `computed()`; for SaaS, dashboards, or portfolios, scope data structures to that specific domain.
5. **Zero-Emoji Policy in UI**: Clean vector icons strictly from `@phosphor-icons/web` CSS classes or hand-exported inline SVGs. Emojis in buttons, navigation, and badges are strictly forbidden.
6. **Konoha Generator Signature**: Mandatory `<meta name="generator" content="Build by konoha">` and footer signature `Build by konoha`.

---

## 💻 Production-Ready Angular 19+ Component Templates

### 1. `src/styles.css` (Tailwind v4 & 10 Theme Directives)
```css
@import "tailwindcss";

:root {
  --theme-primary: #4f46e5;
  --theme-accent: #06b6d4;
  --theme-gradient: linear-gradient(135deg, #4f46e5, #06b6d4);
  --theme-glow: rgba(79, 70, 229, 0.35);
  --theme-surface: rgba(255, 255, 255, 0.85);
  --theme-border: rgba(0, 0, 0, 0.08);
}

[data-theme="nebula"] {
  --theme-primary: #4f46e5;
  --theme-accent: #06b6d4;
  --theme-gradient: linear-gradient(135deg, #4f46e5, #06b6d4);
  --theme-glow: rgba(79, 70, 229, 0.35);
}
[data-theme="aurora"] {
  --theme-primary: #059669;
  --theme-accent: #10b981;
  --theme-gradient: linear-gradient(135deg, #059669, #10b981);
  --theme-glow: rgba(5, 150, 105, 0.35);
}
[data-theme="sunset"] {
  --theme-primary: #e11d48;
  --theme-accent: #f59e0b;
  --theme-gradient: linear-gradient(135deg, #e11d48, #f59e0b);
  --theme-glow: rgba(225, 29, 72, 0.35);
}
[data-theme="ocean"] {
  --theme-primary: #0284c7;
  --theme-accent: #3b82f6;
  --theme-gradient: linear-gradient(135deg, #0284c7, #3b82f6);
  --theme-glow: rgba(2, 132, 199, 0.35);
}
[data-theme="forest"] {
  --theme-primary: #15803d;
  --theme-accent: #84cc16;
  --theme-gradient: linear-gradient(135deg, #15803d, #84cc16);
  --theme-glow: rgba(21, 128, 61, 0.35);
}
[data-theme="volcano"] {
  --theme-primary: #dc2626;
  --theme-accent: #ea580c;
  --theme-gradient: linear-gradient(135deg, #dc2626, #ea580c);
  --theme-glow: rgba(220, 38, 38, 0.35);
}
[data-theme="sakura"] {
  --theme-primary: #db2777;
  --theme-accent: #f472b6;
  --theme-gradient: linear-gradient(135deg, #db2777, #f472b6);
  --theme-glow: rgba(219, 39, 119, 0.35);
}
[data-theme="cyberpunk"] {
  --theme-primary: #7c3aed;
  --theme-accent: #06b6d4;
  --theme-gradient: linear-gradient(135deg, #7c3aed, #06b6d4);
  --theme-glow: rgba(124, 58, 237, 0.35);
}
[data-theme="midnight"] {
  --theme-primary: #1e293b;
  --theme-accent: #64748b;
  --theme-gradient: linear-gradient(135deg, #1e293b, #64748b);
  --theme-glow: rgba(30, 41, 59, 0.35);
}
[data-theme="gold"] {
  --theme-primary: #d97706;
  --theme-accent: #f59e0b;
  --theme-gradient: linear-gradient(135deg, #d97706, #f59e0b);
  --theme-glow: rgba(217, 119, 6, 0.35);
}

@keyframes pulse-glow {
  0%, 100% { box-shadow: 0 0 8px 0 var(--theme-glow); }
  50% { box-shadow: 0 0 20px 4px var(--theme-glow); }
}

.glow-card {
  position: relative;
  transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.3s ease;
  will-change: transform;
}
.glow-card:hover {
  animation: pulse-glow 2s ease-in-out infinite;
}
```

### 2. `theme-switcher.component.ts` (Optional — only when the brief has multiple themes)

> Emit a theme control only when the design brief defines more than one theme. Token ids and storage key are project decisions.

---

## 📋 Taste-Skill Pre-Flight Checklist for Angular 19/20+ Projects (Scoped to Angular Builds Only)
- [ ] Adaptive Dark & Light Mode semantic CSS variables configured in `src/styles.scss` / `src/styles.css`.
- [ ] Bespoke hero storytelling and section layout tailored to the domain.
- [ ] Motion choreography (`motion` JS API with `afterNextRender` & `DestroyRef`) with spring physics and `prefers-reduced-motion` support.
- [ ] All interactive icons rendered via `@phosphor-icons/web` CSS classes or inline SVGs (zero emojis in UI).
- [ ] `<meta name="generator" content="Build by konoha">` in `src/index.html` and `Build by konoha` signature in `<footer>`.
- [ ] `pnpm run lint` and `pnpm run build` finish with 0 errors and 0 warnings.


## Mandatory Package Manager & Modern Versioning Standards

1. **Strict `pnpm` Only**:
   - ALL dependency installations, script executions, and validation commands MUST use `pnpm` (`pnpm install`, `pnpm run build`, `pnpm dev`, `pnpm add <pkg>`).
   - NEVER use `npm` or `yarn`.

2. **Current Stable Framework Policy (verified 2026-08-27)**:
   - Resolve package versions from official release pages and the pnpm registry immediately before scaffolding; never treat this document as a permanent `latest` pin.
   - Tested stable baselines: **Next.js 16.3 + React 19**, **SvelteKit 2 stable + Svelte 5** (SvelteKit 3 is release-candidate and must not be selected unless explicitly requested), **Nuxt 4.3 + Vue 3.5**, and **Angular 20+** with standalone components and Signals.
   - Use the framework's mandated styling approach (fully custom-themed Tailwind v4 for Next.js, scoped `<style>` blocks for SvelteKit, hand-written theme for Nuxt, SCSS for Angular) and the framework-specific Phosphor Icons package (`@phosphor-icons/react` / `@phosphor-icons/web` / `@phosphor-icons/vue`) — never a Lucide package. Commit the generated `pnpm-lock.yaml`, run `pnpm audit --audit-level=high`, and run every framework validation command before completion.


### Pre-Scaffolding Security & CVE Pre-Flight Standards
- **Zero-Day & CVE Vulnerability Guard**: Verify all package versions against known security advisories before installation.
- **Audit Verification on First Init**: Run No known vulnerabilities found after installation to confirm 0 high/critical vulnerabilities.
- **Supply-Chain Hardening**: Use exact or strict caret ranges for verified stable releases (e.g. Next.js 16 / React 19, Svelte 5, Nuxt 3.15+, Angular 19+).
