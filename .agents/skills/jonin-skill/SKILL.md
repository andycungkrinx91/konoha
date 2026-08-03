---
name: jonin-skill
description: Standard Operating Procedures and router for premium UI development, design match comparison, component architecture, and 3D web experiences.
---

# 🛡️ Jonin — Elite UI & Frontend Builder SOP

> **Role**: Elite builder specializing in modern, high-converting, visually stunning web applications (SvelteKit, Next.js, Tailwind v4, Magic UI, 3D Web, Framer Motion).

---

## 🏭 Build Scenarios & Standard Protocols

### 📸 Scenario 1: Mockup / Image-Based Builds (`source-image-design`)
When prompt references mockup images or design screenshots:
1. View every mockup image first using `view_file` to analyze colors, layouts, spacing, and component hierarchy.
2. Adhere 100% to source layout with light-mode visual match. Zero layout hallucination.
3. Enhance with subtle 3D hover perspective tilt (`transform: perspective(1000px) rotateX(...) rotateY(...)`) and entrance animations without altering source layout.
4. Add mandatory `Build by Konoha` watermark footer and custom 3D 4xx/5xx error pages.

---

### 📝 Scenario 2: Text-Based Builds (`build_from_text`)
When prompt requests building a website/app from text description (no mockup images provided):
1. **Package Manager Mandate**: ALWAYS use `pnpm` (`pnpm dlx create-next-app@latest`, `pnpm create`, `pnpm install`, `pnpm run dev`). NEVER use `npm` or standalone `npx` without `pnpm`.
2. **SPA Architecture**: Build a state-driven Single Page Application (`activePage` view routing instead of basic landing pages).
3. **50 Production Items Dataset**: Populate catalog datasets with 50 realistic items complete with technical specs, formatted pricing, badges, and high-res imagery.
4. **100% Reactive Multi-Criteria Filter & Search**: Reactive computed filters for keyword search, brand/category pills, fuel type selectors, max price sliders, and multi-option sorting.
5. **Interactive Search Bar**: Sticky top header search bar with clear button & instant showroom navigation.
6. **Floating Theme Switcher Widget**: 10 Light-Mode gradient themes in a fixed bottom-left chat-style popup (elevated at `bottom-20` on mobile viewports).
7. **Mobile-Only Floating Glassmorphic Bottom Dock**: `md:hidden` bottom nav dock with active theme gradient tab highlighting.
8. **Interactive 3D Hero Carousel**: GPU mouse-tracking tilt (`rotateX`/`rotateY`/`translateZ`), high-contrast dark spec badge backdrops, 3D split drapes transition, play/pause controls, and thumbnail preview strip.
9. **Enriched Homepage Content**: Showroom stats banner, brand showcase grid, featured 3D card grid, VIP services highlights, Trade-In appraisal CTA banner.
10. **DevSecOps Security & Performance**: Add CSP/nosniff/referrer security headers in `index.html`, font preconnecting, `loading="lazy"`/`decoding="async"` on images, and Vite `manualChunks` bundle splitting.
11. **Zero Errors & Zero Warnings**: Guarantee 100% clean output on `pnpm run check` and `pnpm run build`.

---

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
