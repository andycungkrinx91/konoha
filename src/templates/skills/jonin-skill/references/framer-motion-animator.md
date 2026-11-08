---
name: framer-motion-animator
description: Master Motion (formerly Framer Motion) cross-framework animation & storytelling architecture for Next.js (motion/react), Nuxt (motion-v + motion JS API), SvelteKit (svelte/motion Spring/Tween + motion JS API), and Angular (motion JS API + Signals/afterNextRender).
tags:
  - motion
  - framer-motion
  - animation
  - spring-physics
  - storytelling
  - nextjs
  - nuxt
  - sveltekit
  - angular
---

# Motion (Framer Motion v12+) Cross-Framework Storytelling & Animation Architecture

This reference defines the official **Konoha Motion Standard** for `@jonin` across all four supported frontend frameworks (**Next.js 16 / React 19**, **Nuxt 4 / Vue 3.5**, **SvelteKit 2 / Svelte 5**, and **Angular 19/20+**). Every generated interface must treat motion as functional storytelling and spatial feedback — never as generic fade-in boilerplate.

---

## 1. Cross-Framework Package & Import Matrix

| Framework | Primary Package(s) | Canonical Import | Dedicated Reference |
|---|---|---|---|
| **Next.js 16 (React 19)** | `motion` | `import { motion, AnimatePresence, LayoutGroup, useScroll, useTransform, useSpring, useInView, useReducedMotion } from 'motion/react'` | `jonin-skill/motion-nextjs` |
| **Nuxt 4 (Vue 3.5)** | `motion-v`, `motion` | `import { Motion, AnimatePresence } from 'motion-v'` and `import { animate, scroll, inView, stagger, spring } from 'motion'` | `jonin-skill/motion-nuxt` |
| **SvelteKit 2 (Svelte 5)** | `motion` + built-in `svelte/motion` | `import { Spring, Tween } from 'svelte/motion'` and `import { animate, scroll, inView, stagger, spring } from 'motion'` | `jonin-skill/motion-svelte` |
| **Angular 19/20+** | `motion` | `import { animate, scroll, inView, stagger, spring } from 'motion'` inside `afterNextRender()` with `DestroyRef` | `jonin-skill/motion-angular` |

> **Critical Modernization Rule**: Never import from the legacy `'framer-motion'` package in new builds when `'motion/react'` or `'motion'` is available. Always install via `rtk pnpm add motion --silent` (and `rtk pnpm add motion-v --silent` for Nuxt/Vue).

---

## 2. Astra / Fable Storytelling & Choreography Principles

1. **Purposeful Spatial Continuity**:
   - Elements do not appear out of nowhere; they emerge from their logical origin, share layout identity (`layoutId` or FLIP transitions), and guide the user's eye toward the primary interactive stage.
2. **Spring Physics Over Linear Timers**:
   - Use physical springs (`stiffness`, `damping`, `mass`) for interactive surfaces (cards, docks, drawers, toggles, spider/network nodes) so velocity is preserved when a user interrupts an interaction mid-flight.
   - Standard Spring Presets:
     - **Snappy Micro-Interaction (Buttons, Dock Icons, Toggles)**: `{ type: 'spring', stiffness: 420, damping: 26, mass: 0.8 }`
     - **Fluid Surface / Card Elevation**: `{ type: 'spring', stiffness: 280, damping: 24, mass: 1.0 }`
     - **Architectural Panel / Drawer / Modal**: `{ type: 'spring', stiffness: 220, damping: 28, mass: 1.1 }`
     - **180° Inversion / Flip Choreography**: `{ type: 'spring', stiffness: 180, damping: 20, mass: 1.2 }`
3. **Layered Narrative Pacing**:
   - Choreograph hero and section entrances in three distinct beats:
     - **Beat 1 (0ms)**: Eyebrow badge and structural frame hairline.
     - **Beat 2 (80ms–140ms)**: Editorial display headline and primary narrative copy.
     - **Beat 3 (180ms–260ms)**: Interactive workbench, live telemetry canvas, or primary call-to-action controls.
4. **Interactive Dock & Magnification Physics**:
   - Bottom docks and floating toolbars respond to pointer proximity using Gaussian distance falloff (`Math.exp(-(dist * dist) / (2 * sigma * sigma))`) interpolated through a spring so adjacent icons scale smoothly without layout jitter.
5. **Live Data & Topology Motion**:
   - KPI counters, sparklines, ring gauges, and network/spider graphs animate state transitions smoothly. When an agent or tool node changes state (`idle` -> `running` -> `completed`), pulse the node halo and animate edge traversal particles along the SVG path.

---

## 3. Core Choreography Patterns

### Pattern A: Spring Card Elevation & 3D Perspective Tilt
- Apply `transformPerspective: 1200` with pointer-relative `rotateX` and `rotateY` clamped to `[-8deg, 8deg]`.
- Pair with a radial spotlight gradient bound to pointer coordinates (`--mouse-x`, `--mouse-y`) so surface lighting shifts realistically as the card tilts.

### Pattern B: Scroll-Linked Narrative Stage
- Bind scroll progress (`useScroll` / `scroll()`) directly to `transform` and `opacity` on the compositor thread.
- Avoid triggering framework re-renders on scroll ticks; bind motion values or WAAPI timelines directly to DOM style properties.

### Pattern C: Shared Layout & Active Pill Morphing
- Navigation tabs, segmented controls, and filter pills must use shared layout transitions (`layoutId="active-pill"` in React/Vue or spring-interpolated bounding-box indicator in Svelte/Angular) so the active highlight glides across items.

### Pattern D: SVG Path Drawing & Network Edge Telemetry
- Animate SVG paths using `pathLength` (`0 -> 1`) and `strokeDashoffset` for live topology links, spider leg attachments, and workflow connectors.

---

## 4. Accessibility, Reduced Motion & Lifecycle Teardown (Mandatory)

1. **`prefers-reduced-motion: reduce` Compliance**:
   - Every animation system must check `window.matchMedia('(prefers-reduced-motion: reduce)').matches` (or `useReducedMotion()`).
   - When reduced motion is active, disable spatial translation, 3D tilt, and continuous loops; replace with instant or 120ms opacity crossfades while keeping all interactive states and data inspection 100% functional.
2. **Deterministic Cleanup**:
   - Cancel all running `animate()`, `scroll()`, `inView()`, `requestAnimationFrame()`, and `EventSource` subscriptions inside component teardown (`useEffect` return in React, `onBeforeUnmount` in Vue, `$effect` return / `onDestroy` in Svelte, `DestroyRef.onDestroy` in Angular).
3. **60fps Compositor Discipline**:
   - Animate only `transform` (`translate3d`, `scale`, `rotateX`, `rotateY`, `rotateZ`), `opacity`, `filter`, and SVG `pathLength`/`strokeDashoffset`. Never animate `top`, `left`, `width`, `height`, or `margin` in continuous loops.
