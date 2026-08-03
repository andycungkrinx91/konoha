# Design Token Manifest (Cross-Framework Source of Truth)

> Read when: building any UI component, fixing visual divergences, or verifying that SvelteKit, Nuxt, Angular, and Next.js generations produce IDENTICAL designs.
>
> **THIS IS THE SINGLE SOURCE OF TRUTH.** Every `--token`, every duration, every gradient radius, every animation timing is defined here. When any framework-specific UI expert (svelte-ui-expert.md, nuxt-ui-expert.md, angular-ui-expert.md, nextjs-ui-expert.md) references a value, it MUST match an entry in this manifest. If it doesn't, the manifest wins and the reference must be updated.

## How to Use This Manifest

1. **Before writing any component**: Inspect the manifest entry for the visual aspect you're implementing (e.g., `glow-circle-radius`, `ease-smooth`).
2. **Always reference the canonical value**: Use the canonical value in the component, not a derived value.
3. **Cross-framework parity**: When the manifest specifies a value, ALL frameworks (Svelte, Next.js, Nuxt, Angular) MUST use it. **No exceptions.**
4. **Verification**: SOP 6 audits every component against this manifest.

---

## 1. Glow Card Tokens

The "Glow Card" pattern is a primary brand element used for product cards, feature cards, blog cards, and pricing tiers. All values MUST match across frameworks.

### Pulse keyframes (identical in all frameworks)
```css
@keyframes pulse-glow {
  0%, 100% { box-shadow: 0 0 8px 0 var(--color-glow-start); }
  50%      { box-shadow: 0 0 20px 4px var(--color-glow-start); }
}
```

| Token ID | Aspect | Canonical Value | Svelte | Next.js | Nuxt | Angular |
|----------|--------|-----------------|--------|---------|------|---------|
| `glow-circle-radius` | Radial gradient circle radius | `150px` (bounded to card) | `radial-gradient(circle 150px at var(--mouse-x, 50%) var(--mouse-y, 50%), ...)` | `radial-gradient(150px circle at var(--mouse-x, 50%) var(--mouse-y, 50%), ...)` | `radial-gradient(circle 150px, var(--color-glow), transparent)` | `radial-gradient(circle 150px, var(--color-glow), transparent)` |
| `glow-transition-duration` | Fade in/out duration | `300ms` | `transition: opacity 0.3s ease` (in `.glow-card::before`) | `transition-duration: 300ms` | `transition-duration: 300ms` |
| `glow-card-radius` | Outer card border radius | `rounded-2xl` (16px) | `class="rounded-2xl"` | `className="rounded-2xl"` | `class="rounded-2xl"` | `class="rounded-2xl"` |
| `glow-card-bg` | Glass background opacity | `bg-white/70` | `class="bg-white/70 backdrop-blur-md"` | `className="bg-white/70 backdrop-blur-md"` | `class="bg-white/70 backdrop-blur-md"` | `class="bg-white/70 backdrop-blur-md"` |
| `glow-card-border` | Subtle border | `border-zinc-200/80` | `class="border border-zinc-200/80"` | `className="border border-zinc-200/80"` | `class="border border-zinc-200/80"` | `class="border border-zinc-200/80"` |
| `glow-card-pulse` | Pulse animation keyframes | `@keyframes pulse-glow` (2s ease-in-out infinite) | `@utility animate-pulse-glow` | `@keyframes pulse-glow` + `@utility animate-pulse-glow` | `@keyframes pulse-glow` in app.css | `@keyframes pulse-glow` in component CSS |

---

## 2. Animation Tokens

All animation timings use the same easing curves and durations across frameworks. **Svelte uses native CSS transitions; Next.js uses Framer Motion with matching numeric values.**

| Token ID | Aspect | Canonical Value | Svelte | Next.js | Nuxt | Angular |
|----------|--------|-----------------|--------|---------|------|---------|
| `duration-micro` | Micro-interaction (hover, focus) | `150ms` | `duration-150` | Framer Motion `duration: 0.15` | `transition: all 0.15s ease` | CSS `transition-duration: 150ms` |
| `duration-standard` | Standard transition (button, card) | `300ms` | `duration-300` | Framer Motion `duration: 0.3` | `transition: all 0.3s ease` | CSS `transition-duration: 300ms` |
| `duration-entrance` | Page/section entrance | `500ms` | `duration-500` | Framer Motion `duration: 0.5` | `transition: all 0.5s ease` | CSS `transition-duration: 500ms` |
| `duration-content-fade` | Hero content crossfade | `600ms` | `in:fade={{ duration: 600 }}` | Framer Motion `duration: 0.6` | `<Transition name="fade">` + CSS | CSS `transition-duration: 600ms` |
| `ease-smooth` | Standard easing | `cubic-bezier(0.2, 0.8, 0.2, 1)` | `ease-[cubic-bezier(0.2,0.8,0.2,1)]` | Framer Motion `ease: [0.2, 0.8, 0.2, 1]` | CSS `cubic-bezier(0.2,0.8,0.2,1)` | CSS `cubic-bezier(0.2,0.8,0.2,1)` |
| `ease-bounce` | Bounce easing | `cubic-bezier(0.34, 1.56, 0.64, 1)` | `ease-[cubic-bezier(0.34,1.56,0.64,1)]` | Framer Motion `ease: [0.34, 1.56, 0.64, 1]` | CSS `cubic-bezier(0.34,1.56,0.64,1)` | CSS `cubic-bezier(0.34,1.56,0.64,1)` |
| `ease-snap` | Snap easing | `cubic-bezier(0.25, 0.1, 0.25, 1)` | `ease-[cubic-bezier(0.25,0.1,0.25,1)]` | Framer Motion `ease: [0.25, 0.1, 0.25, 1]` | CSS `cubic-bezier(0.25,0.1,0.25,1)` | CSS `cubic-bezier(0.25,0.1,0.25,1)` |

---

## 3. Typography Tokens

| Token ID | Aspect | Canonical Value | Notes |
|----------|--------|-----------------|-------|
| `font-sans` | Sans-serif stack | `"Inter", "Outfit", ui-sans-serif, system-ui, sans-serif` | Already in tailwind-design-system |
| `font-display` | Display stack | `"Clash Display", ui-sans-serif, system-ui, sans-serif` | Already in tailwind-design-system |
| `tracking-heading` | Heading letter-spacing | `tracking-tight` | -0.025em |
| `tracking-eyebrow` | Eyebrow text | `tracking-[0.4em]` uppercase | Used in hero banner tags |
| `tracking-widest` | Widest tracking | `tracking-widest` | 0.1em |
| `leading-body` | Body line-height | `leading-relaxed` | 1.625 |
| `leading-tight` | Heading line-height | `leading-tight` | 1.25 |

---

## 4. Perspective & 3D Tokens

| Token ID | Aspect | Canonical Value | Notes |
|----------|--------|-----------------|-------|
| `perspective-default` | 3D scene perspective | `1200px` | Used in 3D carousels |
| `perspective-swal` | SweetAlert2 perspective | `1000px` | Slightly tighter for modals |
| `perspective-dropdown` | Dropdown perspective | `500px` | Compact for menus |
| `tilt-max` | Max tilt angle for cards | `12deg` | Used in 3D carousel cards |
| `radius-3d` | 3D carousel translateZ | `280px` | Distance from center in 3D ring |
| `duration-3d-rotate` | 3D rotation transition | `700ms` | When clicking a 3D card to center it |
| `cubic-bezier-3d` | 3D rotation easing | `cubic-bezier(0.2, 0.8, 0.2, 1)` | Same as `ease-smooth` |

### 3D Carousel card sizing (shared)
- Card width: `280px`
- Card height: `350px`
- Card border-radius: `rounded-xl` (12px) ← Note: this is `rounded-xl`, NOT `rounded-2xl`; the carousel stage uses tighter corners.
- Inactive card: `opacity-50 scale-90 z-10 brightness(0.55) blur(1.5px)`
- Active card: `opacity-100 scale-100 z-30 brightness(1) blur(0)`

---

## 5. Color Migration Map

Hardcoded colors are replaced with semantic tokens wherever possible. The carousel stage keeps hardcoded dark colors because the carousel is the one theme-invariant dark element (per the existing rule).

| Hardcoded | Use Semantic Token | Token CSS Variable | When to keep hardcoded |
|-----------|---------------------|---------------------|------------------------|
| `bg-zinc-950` (general cards) | `bg-surface-elevated` | `--color-surface-elevated` | Carousel stage background only |
| `bg-zinc-900` (hero banner) | `bg-surface` | `--color-surface` | Hero banner background (per existing rule, dark hero is allowed) |
| `text-zinc-800` | `text-text-primary` | `--color-text-primary` | Never |
| `text-zinc-700` | `text-text-primary` | `--color-text-primary` | Never |
| `text-zinc-400` | `text-text-secondary` | `--color-text-secondary` | Carousel description font, where appropriate |
| `border-zinc-200/80` | `border-border-subtle` | `--color-border-subtle` | Carousel stage borders only |
| `border-zinc-100` | `border-border-subtle` | `--color-border-subtle` | Never |
| `border-zinc-300` | `border-border-subtle` | `--color-border-subtle` | Never |
| `border-zinc-800/80` | `border-border-subtle` | `--color-border-subtle` | Carousel stage borders only |
| `hover:bg-zinc-50` | `hover:bg-surface-elevated` | `--color-surface-elevated` | Never |
| `hover:bg-zinc-100` | `hover:bg-surface-elevated` | `--color-surface-elevated` | Never |
| `bg-zinc-100` | `bg-surface-elevated` | `--color-surface-elevated` | Never |

### Theme-Invarient Dark Elements (HARDCODE allowed)
- Hero banner background (`bg-zinc-900`)
- 3D carousel stage (`bg-zinc-950`)
- Footer watermark (if rendered in dark mode)
- Carousel inactive card borders (`border-zinc-800/80`)

---

## 6. Bento Grid Tokens

| Token ID | Aspect | Canonical Value | Notes |
|----------|--------|-----------------|-------|
| `bento-gap` | Gap between cards | `1.5rem` (24px) | `gap-6` |
| `bento-cols-mobile` | Mobile columns | `1` | Grid fits 1 card |
| `bento-cols-tablet` | Tablet columns | `2` | `md:grid-cols-2` |
| `bento-cols-desktop` | Desktop columns | `3` | `lg:grid-cols-3` |
| `bento-card-radius` | Bento card border-radius | `rounded-2xl` (16px) | Same as glow cards |
| `bento-card-hover-translate` | Lift on hover | `-translate-y-1` | hover:-translate-y-1 |
| `bento-card-hover-scale` | Scale on hover | `scale-1.01` | hover:scale-[1.01] |
| `bento-card-hover-shadow` | Shadow on hover | `shadow-2xl shadow-black/10` | |

---

## 7. Scroll Animation Tokens

| Token ID | Aspect | Canonical Value | Notes |
|----------|--------|-----------------|-------|
| `scroll-fade-up-distance` | Initial translateY | `20px` | `translate-y-5` |
| `scroll-fade-up-duration` | Fade-up duration | `500ms` | `duration-500` |
| `scroll-scale-in-start` | Initial scale | `0.95` | `scale-95` |
| `scroll-scale-in-duration` | Scale-in duration | `400ms` | `duration-400` |
| `scroll-stagger-base` | Base stagger delay | `100ms` | Used with `style="animation-delay: ..."` |
| `scroll-stagger-step` | Step between staggered items | `100ms` | Item i gets `i * 100ms` delay |
| `scroll-trigger-threshold` | IntersectionObserver threshold | `0.15` | When to start animation |
| `scroll-trigger-root-margin` | Root margin | `0px 0px -50px 0px` | Trigger 50px before entering |

---

## 8. Parallax Tokens

| Token ID | Aspect | Canonical Value | Notes |
|----------|--------|-----------------|-------|
| `parallax-slow` | Slow layer speed | `0.3` | Background atmosphere |
| `parallax-medium` | Medium layer speed | `0.6` | Mid-ground elements |
| `parallax-fast` | Fast layer speed | `1.0` | Foreground-specific elements |

Usage: `translate3d(0, scrollY * var(--parallax-slow), 0)` after reading scroll position from a shared `requestAnimationFrame` callback.

---

## 9. Micro-Interaction Library

| Token ID | Effect | Canonical Value | Duration | Easing |
|----------|--------|-----------------|----------|--------|
| `micro-chip-pop` | Chip button pop | `scale(0.8)` → `scale(1.05)` → `scale(1.0)` | `200ms` | `ease-bounce` |
| `micro-ripple` | Ripple expand | radial gradient scale 0 → 2 | `400ms` | `ease-smooth` |
| `micro-press-feedback` | Active press | `scale(0.97)` | `100ms` | `ease-smooth` |
| `micro-shimmer` | Loading shimmer | background-position shift | `1500ms` infinite | `linear` |
| `micro-magnetic` | Magnetic hover | translateX/Y up to 8px toward cursor | `150ms` | `ease-smooth` |

---

## 10. Hero Banner Carousel Tokens

| Token ID | Aspect | Canonical Value | Svelte | Next.js | Nuxt | Angular |
|----------|--------|-----------------|--------|---------|------|---------|
| `hero-height` | Hero section height | `85vh` | `class="h-[85vh]"` | `className="h-[85vh]"` | `class="h-[85vh]"` | `[style.height]="'85vh'"` |
| `hero-min-banners` | Minimum banner count | `4` | Hardcoded in banner array | Hardcoded in banner array | Hardcoded in banner array | `this.banners.length === 4` |
| `hero-autoplay-interval` | Autoplay interval | `6000ms` | `setInterval(..., 6000)` | `setInterval(..., 6000)` | `setInterval(..., 6000)` | `setInterval(..., 6000)` |
| `hero-image-zoom` | Ken Burns zoom | `scale: 1 → 1.05` over `40s` infinite linear | `animate-[zoom-in_40s_infinite_linear]` | Framer Motion `scale: [1,1.05] dur:40` | `animate-[zoom-in_40s_infinite_linear]` | CSS `@keyframes zoom-in` 40s |
| `hero-content-entrance` | Slide-up on enter | `y: 20px → 0`, `opacity: 0 → 1` | `in:fly={{ y: 20, duration: 600 }}` | Framer Motion `initial:{y:20} anim:{y:0}` | `<Transition name="fade">` + CSS keyframe | CSS `@keyframes slide-in` 600ms |
| `hero-content-exit` | Slide-up on exit | `y: 0 → -20px`, `opacity: 1 → 0` | (auto by AnimatePresence) | `exit={{ opacity: 0, y: -20 }}` | `<Transition name="fade">` + CSS keyframe | `@keyframes slide-out` CSS |
| `hero-overlay-top` | Top gradient overlay | `from-zinc-950/80 to-zinc-950/20` | `class="bg-gradient-to-t from-zinc-950/80 ..."` | Same Tailwind utility | Same Tailwind utility | Same Tailwind utility |
| `hero-image-opacity` | Image opacity | `60%` | `class="opacity-60"` | `className="opacity-60"` | `[class]="bannerOpacity"` | `[style.opacity]="0.6"` |

---

## 11. Theme Dropdown Selector Tokens

| Token ID | Aspect | Canonical Value | Svelte | Next.js | Nuxt | Angular |
|----------|--------|-----------------|--------|---------|------|---------|
| `dropdown-entrance` | Entrance animation | Fade + slide-up from top (8px) + slight scale | `animate-in fade-in slide-in-from-top-2 duration-150` | Framer Motion `initial:{y:-8,scale:.95} anim:{y:0,scale:1} dur:150ms` | `<Transition name="dropdown-slide">` + CSS keyframe | `@keyframes slide-in-bottom` 300ms |
| `dropdown-bg` | Menu background | `bg-surface-elevated/95` | `class="bg-surface-elevated/95 backdrop-blur-md"` | Same Tailwind utility | Same Tailwind utility | `bg-white/95 backdrop-blur-xl` |
| `dropdown-border` | Menu border | `border-border-subtle` | `class="border border-border-subtle"` | Same Tailwind utility | Same Tailwind utility | `border border-zinc-200/80` |
| `dropdown-width` | Menu width | `w-48` (192px) | `class="w-48"` | `className="w-48"` | `[class]="['w-64']"` | `class="w-64"` |
| `dropdown-radius` | Menu radius | `rounded-lg` | `class="rounded-lg"` | `className="rounded-lg"` | `class="rounded-2xl"` | `[style.border-radius]="'16px'"` |
| `dropdown-z-index` | Menu z-index | `z-50` | `class="z-50"` | `className="z-50"` | `[class]="'z-50'"` | `[class]="'z-50'"` |
| `dropdown-backdrop-z` | Backdrop z-index | `z-40` | `class="fixed inset-0 z-40"` | `className="fixed inset-0 z-40"` | `[class]="'fixed inset-0 z-40'"` | `[class]="'fixed inset-0 z-40'"` |

---

## 12. Glass Panel Tokens

| Token ID | Aspect | Canonical Value | Notes |
|----------|--------|-----------------|-------|
| `glass-bg` | Glass background | `rgba(255, 255, 255, 0.7)` | `@utility glass-panel` |
| `glass-blur` | Backdrop blur | `blur(16px)` | `backdrop-blur-xl` (16px equivalent) |
| `glass-border` | Glass border | `rgba(24, 24, 27, 0.12)` | `border border-black/12` |
| `glass-radius` | Glass radius | `var(--radius-card)` (1.5rem) | `rounded-2xl` |
| `glass-shadow` | Soft shadow | `0 25px 50px -12px rgba(0,0,0,0.25)` | `shadow-2xl shadow-zinc-300/50` |

---

## 13. Mobile Bottom Navigation Tokens

| Token ID | Aspect | Canonical Value | Notes |
|----------|--------|-----------------|-------|
| `mbnav-height` | Bar height | `4rem` (64px) | `h-16` |
| `mbnav-bg` | Background | `bg-surface-elevated/80` | `bg-surface-elevated/80 backdrop-blur-lg` |
| `mbnav-border` | Top border | `border-border-subtle` | `border-t border-border-subtle` |
| `mbnav-z` | Z-index | `z-40` | `z-40` |
| `mbnav-tab-count` | Min tabs | `4` | Home, Shop, Cart, Profile |
| `mbnav-icon-size` | Icon size | `20px` | `<Home size={20} />` |
| `mbnav-text-size` | Label size | `text-xs` | `text-xs font-medium` |
| `mbnav-active-color` | Active tab color | `text-brand` | `text-brand` |
| `mbnav-inactive-color` | Inactive tab color | `text-text-secondary` | `text-text-secondary` |
| `mbnav-breakpoint` | Show only below | `md:hidden` | Hidden on desktop |

---

## 14. Brand & Logo Tokens

| Token ID | Aspect | Canonical Value | Svelte | Next.js | Nuxt | Angular |
|----------|--------|-----------------|--------|---------|------|---------|
| `logo-text-style` | Gradient text | `text-transparent bg-clip-text bg-[image:var(--gradient-primary)]` | `bg-[image:var(--gradient-primary)]` | `bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent` | `class="bg-[image:var(--gradient-primary)]"` | `class="bg-[image:var(--gradient-primary)]"` |
| `logo-icon-stroke` | Icon stroke | `url(#theme-gradient)` | Refer to SVG `<linearGradient>` in layout | Same | Same | Same via inline SVG |
| `logo-mark-size` | Mark icon size | `1.75rem` (28px) | `h-7 w-7` | `h-7 w-7` | `[class]="['h-7','w-7']"` | `[style.width]="'28px'" [style.height]="'28px'"` |

---

## 15. Required Theme List (10 themes)

All 10 themes MUST be defined in ALL frameworks (Svelte, Next.js, Nuxt, Angular) with identical hex values for `--color-brand`, `--color-accent`, `--color-glow-start`, `--color-glow-end`, and the gradient trio.

| ID | Name | Brand | Accent |
|----|------|-------|--------|
| `nebula` | Nebula | `#7c3aed` | `#4f46e5` |
| `aurora` | Aurora | `#059669` | `#0891b2` |
| `sunset` | Sunset | `#e11d48` | `#d97706` |
| `ocean` | Ocean | `#2563eb` | `#0d9488` |
| `matrix` | Matrix | `#10b981` | `#065f46` |
| `crimson` | Crimson | `#dc2626` | `#7f1d1d` |
| `cyber` | Cyber | `#d946ef` | `#7c3aed` |
| `gold` | Gold | `#d97706` | `#ca8a04` |
| `nordic` | Nordic | `#475569` | `#1e293b` |
| `amethyst` | Amethyst | `#8b5cf6` | `#4c1d95` |

> **Note**: Theme names were standardized across all four frameworks (Svelte, Next.js, Nuxt, Angular). Earlier versions had divergent names (e.g., `forest`/`matrix`, `volcano`/`crimson`). All four files must now use the exact IDs from this table. The dark `--color-glow-start` rgba values per theme are identical across all files (already correct). See `tailwind-design-system.md` for the full hex values.

---

## 16. Build Method Discrimination

The 10-theme switcher, 3D carousels, glow cards, SweetAlert2, mobile bottom nav, and footer watermark are **default premium effects** that ship with `build_from_text`. **They MUST be skipped when using `build_from_source`** unless the source file explicitly shows them.

| Build Method | Default Premium Effects | Source Files Drive Design |
|--------------|-------------------------|-----------------------------|
| `build_from_text` | ✅ Apply ALL mandatory visual effects | No, use full premium template |
| `build_from_source` | ❌ Skip unless explicitly present in source | YES, replicate source strictly |

---

## Compliance Check

When a component is built, verify against this manifest:

```markdown
- [ ] Border radius matches `glow-card-radius` or `glass-radius` (rounded-2xl)
- [ ] Transitions use `duration-standard` (300ms) or `duration-micro` (150ms)
- [ ] Glass panels use `glass-bg` (bg-white/70) and `glass-blur` (backdrop-blur-xl)
- [ ] Text uses semantic tokens, not hardcoded zinc-*
- [ ] Z-index uses `z-50` for menus, `z-40` for backdrops
- [ ] Glow gradient uses `glow-circle-radius` (150px)
- [ ] Pulse animation `glow-card-pulse` is present if it's a featured card
- [ ] Dropdown uses `dropdown-entrance` (slide-up + fade)
- [ ] Hero banner uses `hero-image-zoom` (Ken Burns) and `hero-content-entrance` (slide-up)
- [ ] Build method: if `build_from_source`, premium effects were skipped unless in source
```

A component that fails ANY of these checks is non-compliant and must be patched.
