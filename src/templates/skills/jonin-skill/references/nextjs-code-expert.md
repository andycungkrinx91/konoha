# Next.js Code Writer

> Read when: building Next.js pages, routes, Server vs Client components, Server Actions, state management, ESLint/Prettier configs, or React app-level architecture and security.

## Next.js Component conventions

| Concept | Purpose | Details |
|---|---|---|
| **Server Components** | Default; fetch data, render static layout | No `"use client"`. Runs only on server. |
| **Client Components** | Interactive UI, state, hooks, browser APIs | Add `"use client"` at the top. |
| **Server Actions** | Handle form submissions/mutations | Add `"use server"` at the top of file or action. |
| **@phosphor-icons/react** | SVG icon usage | Styled using theme variables and tailwind. NEVER lucide-react (AI-scaffold fingerprint). |

```tsx
// app/shop/page.tsx (Server Component)
import { ThreeDCarousel } from '@/components/ThreeDCarousel'
import { getFeaturedProducts } from '@/lib/api'

export default async function ShopPage() {
  const products = await getFeaturedProducts();
  return (
    <main className="p-8">
      <h1 className="text-3xl font-bold tracking-tight mb-8">Premium Showroom</h1>
      <ThreeDCarousel items={products} autoplay={true} />
    </main>
  )
}
```

## Critical Anti-Patterns

```
✗  Making all components client components  → default to Server Components
✗  Running canvas/WebGL outside of useEffect → Server Side Rendering will crash (disable SSR or lazy load)
✗  Mutating state directly                   → use standard React useState/useReducer or Zustand
✗  Missing cleanup functions in useEffect     → revert GSAP timelines, clear setIntervals
✗  Template-built Tailwind classes (text-${color}-500)
✗  Using npm or yarn                         → always use pnpm
✗  Missing lint/format scripts               → set up ESLint + Prettier on every project
✗  Leaving unused imports / variables         → typescript-eslint rules will fail the build
```

## CLI Tools

**Always use pnpm.** Never use npm or yarn.

*Tip: If installation fails with ERR_PNPM_UNSUPPORTED_ENGINE, run pnpm install --no-engine-strict to bypass version constraints.*

```bash
pnpm run lint                      # Run ESLint + Prettier checks
pnpm run format                    # Auto-fix formatting
pnpm exec eslint .                 # Run ESLint checks
pnpm run build                     # Verify compilation and production build
```

> [!IMPORTANT]
> **STRICT NEXT.JS 16+ MANDATE (ZERO NEXT.JS 15 TOLERANCE)**:
> When creating or scaffolding a fresh React/Next.js application, you MUST strictly use **Next.js 16+ (`"next": "^16.3.3"`)** with **React 19 (`"react": "^19.0.0"`)** and **Tailwind CSS v4**.
> Under NO circumstances should Next.js 15, Next.js 14, or older versions be installed or written to `package.json`.
>
> When using `create-next-app`, execute:
> `pnpm dlx create-next-app@16 <path> --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-pnpm`

## Canonical Next.js 16 `package.json` Baseline Template

When creating `package.json` for a fresh Next.js 16 project:

```json
{
  "name": "app",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "prettier --check . && next lint",
    "format": "prettier --write ."
  },
  "dependencies": {
    "clsx": "^2.1.1",
    "@phosphor-icons/react": "^2.1.7",
    "motion": "^12.4.0",
    "next": "^16.3.3",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "tailwind-merge": "^3.0.0"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.0.0",
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "eslint": "^9.0.0",
    "eslint-config-next": "^16.3.3",
    "prettier": "^3.5.0",
    "prettier-plugin-tailwindcss": "^0.6.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.7.0"
  },
  "engines": {
    "node": ">=22"
  }
}
```

## Node.js Requirement

Minimum **Node.js 22**. Specify inside `package.json`:

```json
{
  "engines": {
    "node": ">=22"
  }
}
```

## Lint & Formatter Setup (Required for Fresh Projects)

Fresh Next.js projects need prettier and flat ESLint setups. Always set up lint and formatting on new projects:

```bash
pnpm add -D eslint prettier eslint-config-prettier eslint-plugin-prettier prettier-plugin-tailwindcss
```

Create `eslint.config.mjs` (for Next.js 16+ flat config style):

```javascript
import { FlatCompat } from "@eslint/eslintrc";
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  prettier,
  {
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "react/react-in-jsx-scope": "off",
      "@next/next/no-img-element": "off",
      "react/no-unescaped-entities": "off",
      "react-hooks/exhaustive-deps": "off"
    }
  }
];

export default eslintConfig;
```

Create `.prettierrc`:

```json
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "plugins": ["prettier-plugin-tailwindcss"]
}
```

Add these scripts to `package.json`:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "prettier --check . && next lint",
    "format": "prettier --write ."
  }
}
```

## JSX Accessibility (a11y) & Compiler Compliance

React builds will output warnings or fail if tags are semantically incorrect or accessibility tags are missing. Follow these rules for all client/interactive JSX components:

1. **Click/Interaction Handlers on Non-interactive Elements**:
   Any element like a `div` or `span` that handles clicks, keydowns, or mouse movements (e.g. for card perspective effect glows) must explicitly declare an ARIA role:
   - For visual effects only: `role="presentation"`
   - For actual custom controls: `role="button"` or `role="dialog"`
   ```tsx
   <div 
     onMouseMove={handleMouseMove}
     className="card-glow"
     role="presentation"
   >
     {children}
   </div>
   ```

2. **Keyboard Events and Tabindex**:
   When using roles like `role="dialog"` or `role="button"` on custom overlay structures (e.g. custom product zoom modals, filter drawers):
   - Add `tabIndex={-1}` (for dialogs/overlays) or `tabIndex={0}` (for focusable buttons).
   - Add an `onKeyDown` handler to handle accessibility clicks or closing with Escape.
   ```tsx
   <div
     className="modal-backdrop"
     onClick={closeModal}
     onKeyDown={(e) => e.key === 'Escape' && closeModal()}
     role="button"
     tabIndex={0}
     aria-label="Close modal background"
   >
     <div 
       className="modal-panel"
       role="dialog"
       aria-modal="true"
       aria-labelledby="modal-title"
       tabIndex={-1}
     >
       <h2 id="modal-title">Product Details</h2>
     </div>
   </div>
   ```

3. **Hidden Interactive Elements**:
   Form hidden controls (like `<button type="submit" className="hidden">` inside custom forms) must have an `aria-label="..."` or `title="..."` attribute to ensure accessibility sweeps pass.

4. **Unused Imports & Variables**:
   Clean up any unused imports and variables before running `next build` or `pnpm run lint`, as typescript-eslint configurations in Next.js will treat unused imports as fatal build errors.

## Verification Pipeline

Whenever generating or modifying Next.js frontend code, execute this pipeline to ensure zero errors and zero warnings:

1. **Format Check & Clean**: Run `pnpm run format` to auto-format files.
2. **Interactive A11y Verification**: Ensure all custom modal divs, slide decks, drawers, and cards have proper `role`, `tabIndex`, and keyboard handlers.
3. **Run Linting**: Execute `pnpm run lint` and verify there are no ESLint issues.
4. **Compile Production Build**: Run `pnpm run build` and ensure the next build completes successfully with no warnings or type errors.

## 🎨 Visual Standards (Brief-Derived)

Visual direction comes from the 9-field design brief — no fixed palette, theme count, carousel count, or dataset size.

1. **Palette & Type**: Define one project-specific token set in `@theme` (`--color-brand`, `--color-accent`, surfaces, text, borders) from the brief, with WCAG AA contrast. Single theme unless the brief asks for user-selectable themes.
2. **Theme Control**: Optional. Add a switcher only when multiple themes exist, and persist the choice under the project's own key — never a shared house key.
3. **Imagery & Motion**: Choose hero treatment, carousel usage, and hover choreography from the brief. 3D tilt, glow, and gradient treatments are options, not requirements.
4. **Custom Styled SVG/CSS Logo**: Inline SVG built from the project's token colors, paired with typography matching the actual project name.
5. **Data Volume**: Dataset size follows the brief's real content. Never generate a fixed-size filler catalog.
6. **Zero-Emoji Policy in UI**: Vector icons from `@phosphor-icons/react` or hand-exported inline SVGs. Emojis in buttons, navigation, or badges are forbidden.


---

## 💻 Production-Ready Next.js App Router Component Templates

### 1. `app/globals.css` (Tailwind v4 Project Tokens)
```css
@import "tailwindcss";

:root {
  /* Project tokens from the design brief — replace these values. */
  --theme-primary: #4f46e5;
  --theme-accent: #06b6d4;
  --theme-gradient: linear-gradient(135deg, var(--theme-primary), var(--theme-accent));
  --theme-glow: rgba(79, 70, 229, 0.35);
  --theme-surface: rgba(255, 255, 255, 0.85);
  --theme-border: rgba(0, 0, 0, 0.08);
}
/* Add [data-theme="..."] blocks ONLY when the brief defines multiple themes. */
```

### 2. `components/ThemeSwitcher.tsx` (Optional — only when the brief has multiple themes)

```tsx
'use client';

// Emit this component ONLY when the design brief defines more than one theme.
// Token ids come from the project brief; persist under a project-specific key.
export function ThemeSwitcher({ themes }: { themes: { id: string; label: string }[] }) {
  const [active, setActive] = React.useState(themes[0]?.id);
  React.useEffect(() => {
    const saved = localStorage.getItem('theme-preference');
    if (saved) { setActive(saved); document.documentElement.dataset.theme = saved; }
  }, []);
  const select = (id: string) => {
    setActive(id);
    document.documentElement.dataset.theme = id;
    localStorage.setItem('theme-preference', id);
  };
  if (themes.length < 2) return null;
  return (
    <div role="group" aria-label="Theme" className="flex gap-2">
      {themes.map((t) => (
        <button key={t.id} type="button" aria-pressed={active === t.id} onClick={() => select(t.id)} className="rounded-full px-3 py-1 text-sm">
          {t.label}
        </button>
      ))}
    </div>
  );
}
```

---

### 3. `components/HeroBanner.tsx` (Optional — only when the brief calls for a banner)

> Emit a banner only when the brief asks for one. Slide count, autoplay timing, and tilt depth are project decisions.

```tsx
'use client';

import React, { useState, useEffect, useRef } from 'react';
import { CaretLeft, CaretRight, Play, Pause, Sparkle } from '@phosphor-icons/react/dist/ssr';

export interface SlideItem {
  id: string | number;
  title: string;
  subtitle: string;
  tag: string;
  specs: { label: string; value: string }[];
  image: string;
}

export function HeroBanner({ slides, autoplayMs = 6000 }: { slides: SlideItem[]; autoplayMs?: number }) {
  const [current, setCurrent] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isPlaying || slides.length <= 1) return;
    const interval = setInterval(() => {
      setCurrent((prev) => (prev + 1) % slides.length);
    }, autoplayMs);
    return () => clearInterval(interval);
  }, [isPlaying, slides.length]);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width - 0.5) * 16;
    const y = ((e.clientY - rect.top) / rect.height - 0.5) * -16;
    setTilt({ x, y });
  };

  const handleMouseLeave = () => setTilt({ x: 0, y: 0 });

  if (!slides || slides.length === 0) return null;
  const slide = slides[current];

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="relative w-full overflow-hidden rounded-3xl bg-zinc-950 text-white min-h-[460px] md:min-h-[560px] flex items-center shadow-2xl"
      style={{
        perspective: '1200px',
      }}
    >
      {/* Background Image with 3D Depth */}
      <div
        className="absolute inset-0 transition-transform duration-500 ease-out"
        style={{
          transform: `scale(1.05) rotateX(${tilt.y}deg) rotateY(${tilt.x}deg) translateZ(10px)`,
        }}
      >
        <img
          src={slide.image}
          alt={slide.title}
          className="w-full h-full object-cover opacity-40 brightness-75"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/40 to-transparent" />
      </div>

      {/* Content Overlay */}
      <div className="relative z-10 max-w-5xl mx-auto px-8 py-16 w-full flex flex-col justify-between min-h-[460px] md:min-h-[560px]">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold tracking-wider uppercase bg-white/10 backdrop-blur-md border border-white/20 text-white mb-6">
            <Sparkle className="w-3.5 h-3.5" style={{ color: 'var(--theme-accent)' }} />
            <span>{slide.tag}</span>
          </div>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight max-w-3xl leading-[1.1] mb-4">
            {slide.title}
          </h1>
          <p className="text-base md:text-lg text-zinc-300 max-w-xl mb-8">
            {slide.subtitle}
          </p>

          {/* High-Contrast Spec Badges */}
          <div className="flex flex-wrap gap-4 mb-8">
            {slide.specs.map((spec, i) => (
              <div
                key={i}
                className="px-4 py-2 rounded-xl bg-black/60 backdrop-blur-md border border-white/10 flex flex-col"
              >
                <span className="text-[11px] uppercase tracking-wider text-zinc-400 font-medium">{spec.label}</span>
                <span className="text-sm font-bold text-white">{spec.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Carousel Navigation & Controls */}
        <div className="flex items-center justify-between pt-6 border-t border-white/10">
          <div className="flex items-center gap-2">
            {slides.map((_, idx) => (
              <button
                key={idx}
                onClick={() => setCurrent(idx)}
                aria-label={`Go to slide ${idx + 1}`}
                className={`h-2 rounded-full transition-all ${
                  current === idx ? 'w-8 bg-white' : 'w-2 bg-white/30 hover:bg-white/60'
                }`}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              aria-label={isPlaying ? 'Pause carousel' : 'Play carousel'}
              className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md flex items-center justify-center text-white transition-all"
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>
            <button
              onClick={() => setCurrent((prev) => (prev - 1 + slides.length) % slides.length)}
              aria-label="Previous slide"
              className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md flex items-center justify-center text-white transition-all"
            >
              <CaretLeft className="w-5 h-5" />
            </button>
            <button
              onClick={() => setCurrent((prev) => (prev + 1) % slides.length)}
              aria-label="Next slide"
              className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md flex items-center justify-center text-white transition-all"
            >
              <CaretRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

---

## 📋 Taste-Skill Pre-Flight Checklist for Next.js
- [ ] Tailwind v4 `@import "tailwindcss";` configured in `app/globals.css`.
- [ ] One project token set derived from the design brief (extra `[data-theme]` blocks only when multi-theme is intended).
- [ ] Theme control rendered only when the brief defines more than one theme.
- [ ] Banner or hero treatment matches the brief (no default carousel, no default slide count).
- [ ] Dataset size and filters follow the brief's real content (no filler catalog).
- [ ] All interactive SVG icons strictly imported from `@phosphor-icons/react` (zero emojis in UI).
- [ ] `Build by konoha` watermark included in footer.
- [ ] `pnpm run lint` and `pnpm run build` finish with 0 errors and 0 warnings.

---

## Development Guidelines

- **Image-to-Code Generation**: Agents can and should generate user interfaces from design images/mockups (such as png, jpg, webp, svg) present in the workspace. The agent must search the directory for design assets, analyze them, and translate the visual mockups into Next.js components.

  ### Next.js-Specific Image-to-Code Design Match Comparison Workflow:
  1. **Select Build Method**: If a design mockup or source folder is present, call `build_with_image_design` or its equivalent `build_from_source` tool. Both use source-fidelity rules and do not apply the default text-build template. Otherwise, call `build_from_text` to use the default premium visual effects template.
  2. **Direct SVG/HTML Translation**: If a mockup is `.svg` or `.html`, inspect the source directly and translate it into React/JSX code to achieve 100% layout fidelity without vision token overhead.
  3. **Single-Image Vision Reading**: For binary images (`.png`, `.jpg`, `.webp`), open only the primary layout image first via `view_file` to identify the general structure.
  4. **Start Development Server**: Launch the Next.js development server with `pnpm run dev`.
  5. **Visual Verification Loop**: Launch the dev server, then invoke `runLiveBrowserMonitor` (`src/workflow/jonin-builder/live_browser_monitor.js`) to open the app in the user's real browser and capture console errors plus responsive viewports (`375x812`, `768x1024`, `1440x900`). Compare the captured render against the design mockup. The former `konoha render` command no longer exists; do not call it.
  6. **Layout Refinement via Diff Metrics**: Reconcile observed spacing, type-scale, and colour mismatches by adjusting Next.js JSX layout classes (`px`, `mx`, `flex`, `grid`, etc.), then re-run the monitor to confirm the difference is gone. Loop this refinement without re-reading image files to conserve tokens.
- **Preserving Existing Codebase (Flow, Logic, and Style)**: When working inside an existing Svelte or Next.js project directory/workdir, the agent is strictly prohibited from altering the existing flow, core logic, or style guidelines of the project. It must respect and follow the current architecture, styling systems (like specific CSS setups or custom Tailwind configs), and logic flows without introducing breaking changes or refactoring existing styles.


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
