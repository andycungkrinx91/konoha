# Angular v19+ UI Expert & Universal Archetype Blueprints

Canonical design system directives and production blueprints for **Angular v19+ (Standalone Components, Signals)** web applications supporting all major archetypes: **E-commerce, Admin & Metric Infra Dashboards, Portfolios, SaaS Landing Pages, and Corporate Profiles**.

---

## 🎨 Universal UI/UX & Storytelling Invariants (Angular 19/20+ Standalone & Signals)

### 1. Dynamic Context-Driven Composition (Astra/Fable Standard)
- Compose hero stages, section layouts, and interactive surfaces dynamically around the product domain and prompt.
- Composition, section order, theme count, and navigation pattern come from the 9-field design brief; never reuse a house template. Place the brand identity cleanly on the left of a horizontal header (`flex items-center justify-between`).

### 2. Adaptive Dark & Light Mode + SSR/Hydration Safety
- Choose the theme strategy from the design brief (single or dual theme) and define semantic color tokens (`--bg-canvas`, `--bg-surface`, `--text-primary`, `--text-muted`, `--border-subtle`, `--accent-primary`) with WCAG AA contrast.
- Use `afterNextRender` or `isPlatformBrowser(this.platformId)` before reading `localStorage`.

### 3. Motion Choreography (`motion` JS API + Signals & `afterNextRender`)
- Integrate the official `'motion'` package (`animate`, `inView`, `scroll`, `stagger`, `spring` — see `jonin-skill/motion-angular`) inside `afterNextRender()` with `DestroyRef.onDestroy()` cleanup for spring-physics card elevation, dock magnification, and staggered hero choreography.

### 4. Konoha Signature & Zero Errors Quality Gate
- Include `<meta name="generator" content="Build by konoha">` in `src/index.html` and render the visible text `Build by konoha` in `<footer>`.
- Scaffolding MUST include `@phosphor-icons/web` or hand-exported inline SVGs — NEVER `lucide-angular` and zero emojis anywhere in UI copy or controls.
- Do not claim completion until `pnpm run build` and `pnpm run lint` pass cleanly with **0 errors and 0 warnings**.
