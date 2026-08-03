# Tailwind CSS v4 — Konoha Design System Integration

> Applies to: Next.js, SvelteKit, Nuxt, Angular projects built via `build_from_text`

## Setup

### tailwind.config file
```js
// tailwind.config.js / tailwind.config.ts
export default {
  content: ['./src/**/*.{html,js,svelte,ts,tsx,vue}', './app/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        accent: '#C89B77',
        'bg-base': '#F8F8F8',
      },
      fontFamily: {
        primary: ['DM Sans', 'sans-serif'],
        body: ['Roboto', 'sans-serif'],
      },
    },
  },
}
```

### Global CSS Order (MANDATORY)
```css
/* 1. Google Fonts — always first */
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Roboto:wght@100;300;400;500;700;900&display=swap');

/* 2. Tailwind directives — before any custom CSS */
@tailwind base;
@tailwind components;
@tailwind utilities;

/* 3. Konoha design tokens — additive, no global resets */
:root {
  --color-bg:      #F8F8F8;
  --color-white:   #FFFFFF;
  --color-black:   #000000;
  --color-accent:  #C89B77;
  --color-muted:   #666666;
  --color-border:  #E5E5E5;
  --font-primary:  'DM Sans', sans-serif;
  --font-body:     'Roboto', sans-serif;
}

/* 4. Konoha component classes (.konoha-*) */
```

## Useful Tailwind Utility Patterns
```html
<!-- Accent text -->
<span class="text-[#C89B77] font-bold font-['DM_Sans']">$30.00</span>

<!-- Hero grid -->
<section class="min-h-screen grid grid-cols-2 max-lg:grid-cols-1">

<!-- Product card 3D hover -->
<div class="group transition-transform duration-300
  hover:[transform:perspective(1000px)_rotateX(4deg)_rotateY(-4deg)_scale3d(1.02,1.02,1)]">

<!-- Theme switcher position -->
<div class="fixed bottom-6 left-6 z-[1000]">

<!-- Mobile dock -->
<nav class="fixed bottom-0 left-0 right-0 z-[999] bg-white/95 backdrop-blur-xl border-t
            border-[#E5E5E5] lg:hidden flex justify-around">
```

## 🎨 Konoha Design System Tokens

```css
:root {
  --color-bg:      #F8F8F8;   /* body background — light off-white */
  --color-white:   #FFFFFF;   /* cards, header on scroll          */
  --color-black:   #000000;   /* primary text                     */
  --color-accent:  #C89B77;   /* warm amber — brand, prices, hover*/
  --color-muted:   #666666;   /* secondary / caption text         */
  --color-border:  #E5E5E5;   /* dividers, card borders           */
  --font-primary:  'DM Sans', sans-serif;   /* headings, labels   */
  --font-body:     'Roboto', sans-serif;    /* body copy          */
}
```

**Google Fonts import (global CSS, top of file):**
```css
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Roboto:wght@100;300;400;500;700;900&display=swap');
```

---

## 🧩 Mandatory Component Standards

### 1. Header (Transparent → Glassmorphism)
```
- Default: transparent background
- On scroll: background rgba(255,255,255,0.95) + backdrop-filter:blur(12px) + box-shadow 0 1px 20px rgba(0,0,0,0.06)
- Layout: Logo (left) | Nav links (center) | Action icons (right — Search, Wishlist, Cart+badge, Filter)
- Mobile: Show LOGO + CART/SEARCH icons ONLY — NO hamburger toggle menu
- Sticky: position sticky, top:0, z-index:900
```

### 2. Hero Split-Panel Carousel
```
- Full viewport height (min-height: 100vh)
- Left panel (50%): product title h1, price in --color-accent, "ADD TO CART" + "VIEW DETAIL" CTA buttons
- Right panel (50%): tall portrait image (aspect 780:1050), 3D mouse-tracking tilt
  transform: perspective(1200px) rotateX({y}deg) rotateY({x}deg)
- Auto-advance: every 4.5 seconds
- Slide indicators: dots below content panel, active = --color-accent scaled
- Mobile (≤1024px): stack vertically — image panel on TOP, text panel below — full width
```

### 3. Product Cards (3D Hover)
```css
.konoha-product-card:hover {
  transform: perspective(1000px) rotateX(4deg) rotateY(-4deg) scale3d(1.02, 1.02, 1);
  box-shadow: 0 24px 60px rgba(0,0,0,0.12);
}
/* Quick-add CTA overlay: translateY(100%) → translateY(0) on hover */
```

### 4. Category Carousel
```
- Horizontal scrollable row, scroll-snap-type: x mandatory
- Each tile: circular image (140×140px border-radius:50%) + label
- Hover: scale(1.06) + accent-tinted box-shadow
```

### 5. 10-Theme Switcher (Bottom-Left — MANDATORY POSITION)
```css
.theme-switcher-trigger {
  position: fixed;
  bottom: 1.5rem;  /* 24px */
  left: 1.5rem;    /* 24px */
  z-index: 1000;
  width: 48px; height: 48px; border-radius: 50%;
}
/* Popup opens upward-right from trigger button */
```
**10 Light Mode Gradient Themes (persist in localStorage key 'konoha-theme'):**
1. Crimson Amber: `linear-gradient(135deg, #ef4444, #f59e0b)`
2. Ocean Cyan: `linear-gradient(135deg, #3b82f6, #06b6d4)`
3. Emerald Teal: `linear-gradient(135deg, #10b981, #14b8a6)`
4. Violet Pink: `linear-gradient(135deg, #8b5cf6, #ec4899)`
5. Sunset Orange: `linear-gradient(135deg, #f97316, #eab308)`
6. Midnight Indigo: `linear-gradient(135deg, #6366f1, #a855f7)`
7. Rose Gold: `linear-gradient(135deg, #f43f5e, #fb7185)`
8. Forest Mint: `linear-gradient(135deg, #059669, #34d399)`
9. Royal Blue: `linear-gradient(135deg, #2563eb, #38bdf8)`
10. Amber Copper: `linear-gradient(135deg, #d97706, #f59e0b)`

### 6. Sticky Mobile Bottom Navigation Dock (MANDATORY — PRESERVE)
```css
.mobile-bottom-dock {
  position: fixed;
  bottom: 0; left: 0; right: 0;
  z-index: 999;
  background: rgba(255,255,255,0.96);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-top: 1px solid var(--color-border);
  padding-bottom: env(safe-area-inset-bottom);
}
/* 5 items: Home | Shop/Showroom | Wishlist | Cart | Account */
/* Active item: accent color #C89B77 indicator dot/bar */
/* ONLY shown on mobile (≤1024px) */
```

### 7. Error Pages (4xx / 5xx)
```
- Premium 3D animated illustration (SVG or canvas)
- Interactive animation effect switcher — 5 modes:
    [🔥 Crash] [❄️ Frost] [🌧️ Rain] [⚡ Storm] [🪟 Glass Crack]
- Each mode: canvas-based particle/effect overlay on the error page background
- CTA: "Back to Home" primary button + "Contact Support" link
- Error code: giant outlined text (font-size: clamp(5rem,15vw,12rem); -webkit-text-stroke: 3px #000; color: transparent)
```

### 8. Footer
```
- Dark background (#111), light text
- Multi-column layout: Brand logo + description | Links col | Links col | Newsletter
- Bottom bar: copyright + "Build by Konoha" watermark (small, muted: font-size:11px; color:#999)
```

---

## ⚠️ Mandatory Rules

1. **build_from_text ONLY** — These design directives are injected exclusively via `build_from_text`. Do NOT inject into `build_from_source`.
2. **Light Mode ONLY** — No dark mode unless explicitly requested.
3. **pnpm exclusively** — `pnpm dlx create-next-app@latest`, `pnpm install`, `pnpm run dev --open`
4. **Tailwind first** — `@tailwind base; @tailwind components; @tailwind utilities;` MUST precede custom CSS.
5. **NO hamburger on mobile** — Mobile navigation = sticky bottom dock ONLY.
6. **NO Pixio mentions** — This is the Konoha Design System.
7. **10-theme switcher + mobile bottom dock** are NON-NEGOTIABLE preserved features in every build.

