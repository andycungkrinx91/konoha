# Source Fidelity & Three Independent Creation Modes

> Authoritative directives for `@jonin` when executing **Build from Image**, **Build from Text**, and **Build from Source Website**.

## 1. Build from Image (`build_from_source` / Image Mockups & Design Exports)

When building from static image mockups (`.png`, `.jpg`, `.webp`, `.svg`) or design documents (`.fig`, `.pen`, `.json` token exports, or live `figma` / `opendesign` MCP frames):
- **Visual & Spatial Decomposition**: Extract composition, spatial hierarchy, lighting, materials, depth layers, typography, color tokens, and interactive states from the source image before coding.
- **Exact Structural Fidelity**: Reproduce the source layout, spacing scale, typography hierarchy, color palette, and component structure faithfully.
- **Zero Unrequested Chrome**: Do not add generic theme switchers, carousels, modal dialogs, extra pages, or decorative sections absent from the source mockup.
- **Non-Structural Depth Polish**: Add only non-structural 3D and motion enhancements that preserve the source geometry: bounded card tilt (`<= 12deg`), opacity/transform entrance motion, and subtle parallax where it cannot alter layout metrics.

## 2. Build from Text (`build_from_text` — Creative Synthesis & Reference Discovery)

When generating a fresh application or landing experience from a text prompt:
- **Mandatory Online Reference Research**: Conduct live reference research (`konoha.web_search` / `agent-browser` / Playwright) inspired by **Framer, Linear, Lusion, Igloo, Darkstar, Unseen, Monolith, Diagram, Raycast, and Spline** before writing code.
- **Original Creative Direction & 3D Motion-Art Language**: Synthesize a bespoke visual identity, asymmetric grid architecture (`grid-cols-12`), semantic Dark & Light Mode token palette, and spring-physics 3D motion choreography tailored to the user's domain.
- **Brand & Quality Invariants**: Enforce `<meta name="generator" content="Build by konoha">`, visible `Build by konoha` footer text, `min-h-[100dvh]` viewport stability, Phosphor SVG iconography, and zero emojis.

## 3. Build from Source Website (`build_from_source` with Live URL or Multi-File Source)

When cloning, migrating, or reconstructing a live website URL or multi-file source repository:
- **Multi-Route Browser Inspection**: Inspect the live site across routes, subpages, navigation flows, interactive states, responsive breakpoints (`375x812`, `768x1024`, `1440x900`), scroll/hover choreography, and computed CSS design tokens.
- **Clean Multi-Route Reconstruction**: Reconstruct all inspected routes and interactive flows cleanly in **Next.js, Nuxt, SvelteKit, or Angular** using framework-native routing (never hash routing or fake state tabs).
- **Accessibility & Performance**: Respect `prefers-reduced-motion`, enforce keyboard and focus accessibility, optimize media loading, and never expose secrets.
