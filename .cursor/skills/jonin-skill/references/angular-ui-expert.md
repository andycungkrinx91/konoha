# Angular UI Expert & Design System Directives

Canonical design system directives for **Angular 18+ Standalone Components (`src/app/`)** web applications.

## 🎨 Mandatory UI/UX Standards

### 1. Full-Width 3D Interactive Hero Carousel Component
- Hero Banner Carousel MUST be **full-width** (`w-full`), featuring interactive mouse/touch 3D perspective tilt animation (`perspective: 1200px; transform: rotateX(...) rotateY(...) scale3d(...)`), full-bleed responsive images, auto-play, slide indicators, and CTA overlay.

### 2. Floating Bottom-Left 10-Theme Switcher Popup
- Theme switcher trigger button MUST be positioned floating at the **bottom-left** (`fixed bottom-6 left-6 z-[1000]`) on both desktop and mobile view.
- Supports 10 curated Light Mode gradient themes.

### 3. Header & Brand Logo Badge (No Mobile Toggle Menu)
- Sticky header (`position: sticky; top: 0; z-index: 900; backdrop-filter: blur(16px);`).
- Do NOT render a mobile hamburger/toggle menu in header (mobile navigation is handled strictly by the sticky mobile bottom dock). Header displays logo badge & action triggers only.

### 4. Sticky Mobile Bottom Navigation Dock
- Fixed mobile navigation dock (`position: fixed; bottom: 0; left: 0; right: 0; z-index: 999; backdrop-filter: blur(16px);`).
- Feature active theme gradient indicators for primary routes.

### 5. Interactive 3D Animations on Widgets & Cards
- 3D perspective tilt hover effects (`transform: perspective(1000px) rotateX(...) rotateY(...) scale3d(...)`), depth shadows, micro-interactions, and glassmorphism styling.

### 6. Rich Animated 4xx / 5xx Error Pages
- Custom error page MUST feature interactive animation effect switchers for Crash Debris, Ice Frost, Rainy Drops, Lightning Storm, and Glass Crack overlays.
