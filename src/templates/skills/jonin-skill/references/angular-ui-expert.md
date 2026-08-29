# Angular v19+ UI Expert & Universal Archetype Blueprints

Canonical design system directives and production blueprints for **Angular v19+ (Standalone Components, Signals)** web applications supporting all major archetypes: **E-commerce, Admin & Metric Infra Dashboards, Portfolios, SaaS Landing Pages, and Corporate Profiles**.

---

## 🎨 Universal UI/UX Invariants (Mandatory Across All Archetypes)

### 1. Header Architecture (Far-Left Logo & Zero Mobile Hamburger Toggle)
- **Far-Left Brand Logo**: Brand logo MUST always be placed on the far LEFT (`flex items-center gap-3`) of the navigation header.
- **Zero Mobile Hamburger Menu**: In mobile view (`lg:hidden`), **NEVER render a hamburger menu or top menu toggle button in the header**. Mobile navigation is handled strictly by the fixed bottom Mobile Dock.

### 2. Floating Bottom-Left 10-Theme Switcher Popup
- **Placement**: Theme switcher trigger button MUST be positioned floating in the **bottom-left corner** (`fixed bottom-6 left-6 z-50`) on both desktop and mobile viewports.
- **Pure Light Mode**: 10 curated Light Mode gradient themes. Zero dark mode enforcement.
- **SSR/Hydration Safety**: Use `afterNextRender` or `isPlatformBrowser(this.platformId)` before reading `localStorage`.

### 3. Archetype-Adaptive Sticky Mobile Bottom Navigation Dock
- **Placement**: Fixed mobile navigation dock (`fixed bottom-0 left-0 right-0 z-40 lg:hidden backdrop-blur-lg bg-white/90 border-t border-[var(--theme-border)] pb-safe`).
- **Adaptive Routes**: Maps quick one-tap links to Dashboard (Overview, Analytics, Servers, Alerts, Themes), Portfolio (Home, Projects, Skills, Contact, Themes), SaaS, and Commerce.

### 4. Zero Errors & Zero Warnings Quality Gate
- Scaffolding MUST include required packages: `lucide-angular`, `clsx`, `tailwind-merge`.
- Do not claim completion until `pnpm run build` and `pnpm run lint` pass cleanly with **0 errors and 0 warnings**.
