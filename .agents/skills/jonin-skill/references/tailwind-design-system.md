# Tailwind 4 Design System Expert

> Read when: styling UI with Tailwind CSS v4, defining design tokens, building responsive layouts, adding dark mode, animations, or extracting CSS components.

## Tailwind v4 Setup

- **Stable Version Only**: ALWAYS install and use the stable version of Tailwind CSS. NEVER use beta, alpha, or pre-release tags (e.g. do NOT use `@next`, `@beta`, `@rc`, or `@alpha` when running `pnpm add` or configuring package versions).
- Use `@import "tailwindcss";` instead of legacy `@tailwind` directives.
- Prefer CSS-first configuration with `@theme` rather than `tailwind.config.ts`.
- Use native container query variants such as `@md:`.

```css
/* app.css / globals.css */
@import "tailwindcss";

@theme {
  /* Shared Base */
  --color-surface: #fafafa;
  --color-surface-elevated: #ffffff;
  --color-text-primary: #18181b;
  --color-text-secondary: #52525b;
  --font-sans: "Inter", "Outfit", ui-sans-serif, system-ui, sans-serif;
  --font-display: "Clash Display", ui-sans-serif, system-ui, sans-serif;
  --radius-card: 1.5rem;

  /* Default Theme: Nebula Light (purple → blue) */
  --color-brand: #7c3aed;
  --color-brand-foreground: #ffffff;
  --color-accent: #4f46e5;
  --gradient-primary: linear-gradient(135deg, #7c3aed, #4f46e5, #2563eb);
  --gradient-subtle: linear-gradient(135deg, rgba(124, 58, 237, 0.05), rgba(79, 70, 229, 0.03));
  --color-glow: rgba(124, 58, 237, 0.15);
  --color-glow-accent: rgba(79, 70, 229, 0.1);
}

/* Theme 2: Aurora Light (emerald → cyan) */
[data-theme="aurora"] {
  --color-brand: #059669;
  --color-accent: #0891b2;
  --gradient-primary: linear-gradient(135deg, #059669, #0891b2, #0284c7);
  --gradient-subtle: linear-gradient(135deg, rgba(5, 150, 105, 0.05), rgba(8, 145, 178, 0.03));
  --color-glow: rgba(5, 150, 105, 0.15);
  --color-glow-accent: rgba(8, 145, 178, 0.1);
}

/* Theme 3: Sunset Light (rose → amber) */
[data-theme="sunset"] {
  --color-brand: #e11d48;
  --color-accent: #d97706;
  --gradient-primary: linear-gradient(135deg, #e11d48, #db2777, #d97706);
  --gradient-subtle: linear-gradient(135deg, rgba(225, 29, 72, 0.05), rgba(217, 119, 6, 0.03));
  --color-glow: rgba(225, 29, 72, 0.15);
  --color-glow-accent: rgba(217, 119, 6, 0.1);
}

/* Theme 4: Ocean Light (blue → teal) */
[data-theme="ocean"] {
  --color-brand: #2563eb;
  --color-accent: #0d9488;
  --gradient-primary: linear-gradient(135deg, #2563eb, #0284c7, #0d9488);
  --gradient-subtle: linear-gradient(135deg, rgba(37, 99, 235, 0.05), rgba(13, 148, 136, 0.03));
  --color-glow: rgba(37, 99, 235, 0.15);
  --color-glow-accent: rgba(13, 148, 136, 0.1);
}
```

> **Note on Themes:** Every new UI generated from scratch MUST include these 4 light-theme definitions in `globals.css`/`app.css` and a floating chat-like theme switcher implementation to allow the user to toggle them. The theme switcher MUST save the chosen theme to `localStorage` (or cookies) and apply it immediately on page load (via a head script) so the theme never reverts to default on refresh.

Token names automatically create utility classes (e.g., `--color-brand` becomes `bg-brand`, `text-brand`, `border-brand`).

## Visual Excellence & Micro-Animations

Never deliver flat, basic designs. Use premium aesthetics:

1. **Gradients over Solid Colors**: Always prefer the gradient variants (`bg-[image:var(--gradient-primary)]`, `text-transparent bg-clip-text bg-[image:var(--gradient-primary)]`) for primary buttons, heroic text, and active states.
2. **Icons**: ALWAYS use `@lucide/svelte` (or `lucide-react` for Next.js). **Crucially, all icons MUST use the active theme's gradient color.** Do not use flat colors. To achieve this, define an SVG `<linearGradient>` using the theme's CSS variables (`var(--color-primary)`, `var(--color-accent)`) and apply it via `stroke="url(#theme-gradient)"`, or use Tailwind CSS masking (`mask-image`). Do not hallucinate raw SVGs.
   ```css
   @theme {
     --gradient-primary: linear-gradient(135deg, #8b5cf6, #6366f1, #3b82f6);
   }
   ```
2. **Glassmorphism**: Use `bg-white/70 backdrop-blur-xl border border-black/12` for premium cards.
3. **Typography**: Use tracking (letter-spacing) tight on headers (`tracking-tight`) and relaxed leading on body (`leading-relaxed`). Use font-weights deliberately (`font-medium`, `font-semibold`).
4. **Shadows**: Use soft, high-fidelity light shadows.
   ```html
   <div class="shadow-2xl shadow-zinc-300/50 border border-zinc-200/80">
   ```

## Utility-First Conventions

Order classes consistently:
`layout` → `sizing` → `spacing` → `typography` → `color` → `border` → `effects` → `state` → `responsive`

Example:
```html
<button class="inline-flex h-10 items-center justify-center rounded-lg px-4 text-sm font-medium bg-brand text-white shadow-md transition-all duration-300 hover:scale-105 hover:bg-brand/90 hover:shadow-brand/50 focus-visible:ring-2 focus-visible:ring-brand disabled:pointer-events-none disabled:opacity-50">
  Save
</button>
```

## Responsive Layout & Semantic Light Mode Colors

- **No Hardcoded Dark Backgrounds / Borders**: You MUST use semantic theme-aware utilities:
  - Backgrounds: `bg-surface` (base page background) and `bg-surface-elevated` (cards, headers, menus).
  - Texts: `text-text-primary` (headings, body) and `text-text-secondary` (subtitles, helper text).
  - Borders: `border-border-subtle` (soft card and divider borders).
  - NEVER use hardcoded slate/zinc dark backgrounds (`bg-zinc-950`, `bg-black`, `text-white`, `border-white/10`) unless it is a specific, theme-invariant dark element (like a dark footer).
- **Mobile-first**: Base classes target mobile screens, while prefixes (`md:`, `lg:`) override for desktop.
- **Mobile Bottom Navigation (MANDATORY)**: For mobile view (screens below `md` breakpoint), you MUST implement a sticky bottom navigation dock (e.g., `fixed bottom-0 left-0 right-0 z-40 bg-surface-elevated/85 backdrop-blur-lg border-t border-border-subtle h-16`) containing 4-5 navigation options (e.g., Home, Shop, Cart, Profile) using Lucide icons. Do NOT use hamburger menus on mobile.
- Use container queries for reusable cards/components that depend on parent width.
- Prefer `grid` for page layout and `flex` for local alignment.

```tsx
<section className="@container rounded-card border border-border-subtle p-4 md:p-6 bg-surface-elevated">
  <div className="grid gap-4 @md:grid-cols-2 @xl:grid-cols-3">
    <!-- Grid items -->
  </div>
</section>
```

## Component Styling (CSS extraction)

For repeated non-component utilities, use `@utility`:

```css
@utility neon-text {
  color: var(--color-brand);
  text-shadow: 0 0 1rem color-mix(in srgb, var(--color-brand), transparent 50%);
}

@utility glass-panel {
  background-color: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(24, 24, 27, 0.12);
  border-radius: var(--radius-card);
}
```

## Animations and Transitions

- Use 150-300ms for micro-interactions (`duration-300`) and 300-500ms for larger entrances.
- Prefer `transform` and `opacity` animations over animating width/height/layout.
- Respect `prefers-reduced-motion`:
  ```html
  <div class="transition-all duration-300 hover:-translate-y-1 motion-reduce:transition-none motion-reduce:hover:translate-y-0">
  ```
- **3D Modals & Carousels (MANDATORY)**: All modals, popups, and carousels MUST use 3D animations (e.g., flipping, tilting, depth scaling) to feel immersive. However, performance must not drop. Achieve this exclusively using native CSS 3D transforms (`perspective`, `rotateX`, `rotateY`, `scale`, `translateZ`) combined with `will-change: transform`. Do not use heavy JS physics for basic entrances. Example: a modal entrance should use `scale-95 rotate-x-12 opacity-0` transitioning to `scale-100 rotate-x-0 opacity-100` with `duration-500 ease-out`.
- **Alert Dialogs (SweetAlert2)**: For all system alerts, warnings, and simple confirmation dialogs, ALWAYS use `sweetalert2` (or its framework wrapper like `sweetalert2-react-content`). You MUST customize the SweetAlert2 popup to use a 3D animation entrance (via `showClass` and CSS transforms) and apply the active theme's gradient (`var(--gradient-primary)`) to its confirm buttons and borders.

## Output Conventions for the Jonin

When asked to style or build a UI component, provide:
1. Complete component markup with all Tailwind classes.
2. The exact CSS snippet for `globals.css` or `app.css` if custom `@theme` tokens or `@utility` classes are needed.
3. Hover, focus, and disabled states explicitly handled.
4. Mobile-first responsive breakpoints handled.

## Dark Mode Contrast Overrides & Dynamic Icon Gradients

To resolve low contrast issues in dark mode across multiple gradient-themed designs, follow these rules:

1. **Dynamic Icon Gradients**:
   Instead of using hardcoded gold colors in global SVG icon gradients, define stop-colors to inherit from the active CSS variables (e.g. `--color-primary-start` and `--color-primary-end`):
   ```xml
   <svg width="0" height="0" class="absolute pointer-events-none select-none">
     <defs>
       <linearGradient id="gold-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
         <stop offset="0%" stop-color="var(--color-primary-start)" />
         <stop offset="100%" stop-color="var(--color-primary-end)" />
       </linearGradient>
     </defs>
   </svg>
   ```

2. **Contrast Theme Overrides in CSS**:
   Define specific overrides under `.dark` and combination rules (like `html.dark.theme-nebula`) to supply brighter/lighter variants of primary and accent colors specifically when dark mode is enabled:
   ```css
   .dark {
     --color-primary-start: #e2cfa7; /* Brighter gold variant */
     --color-primary-end: #b29168;
     --color-primary-glow: rgba(226, 207, 167, 0.2);
   }
   html.dark.theme-nebula {
     --color-gold-400: #c084fc; /* High contrast bright purple */
     --color-gold-500: #8b5cf6;
     --color-gold-600: #60a5fa;
     --color-primary-start: #c084fc;
     --color-primary-end: #60a5fa;
   }
   html.dark.theme-aurora {
     --color-gold-400: #34d399; /* High contrast bright teal */
     --color-gold-500: #10b981;
     --color-gold-600: #22d3ee;
     --color-primary-start: #34d399;
     --color-primary-end: #22d3ee;
   }
   html.dark.theme-sunset {
     --color-gold-400: #fb7185; /* High contrast bright rose */
     --color-gold-500: #f43f5e;
     --color-gold-600: #facc15;
     --color-primary-start: #fb7185;
     --color-primary-end: #facc15;
   }
   html.dark.theme-ocean {
     --color-gold-400: #60a5fa; /* High contrast bright blue */
     --color-gold-500: #3b82f6;
     --color-gold-600: #2dd4bf;
     --color-primary-start: #60a5fa;
     --color-primary-end: #2dd4bf;
   }
   ```
