# Nuxt 3 UI Expert & Universal Archetype Blueprints

Canonical design system directives and production blueprints for **Nuxt 3 (`app.vue`, `pages/`, `components/`)** web applications supporting all major archetypes: **E-commerce, Admin & Metric Infra Dashboards, Portfolios, SaaS Landing Pages, and Corporate Profiles**.

---

## 🎨 Universal UI/UX & Storytelling Invariants (Nuxt 4 / Vue 3.5)

### 1. Dynamic Context-Driven Composition (Astra/Fable Standard)
- Compose hero stages, section layouts, and interactive surfaces dynamically around the product domain and prompt.
- Composition, section order, theme count, and navigation pattern come from the 9-field design brief; never reuse a house template. Place the brand identity cleanly on the left of a horizontal header (`flex items-center justify-between`).

### 2. Adaptive Dark & Light Mode + SSR Safety
- Choose the theme strategy from the design brief (single or dual theme) and define semantic color tokens (`--bg-canvas`, `--bg-surface`, `--text-primary`, `--text-muted`, `--border-subtle`, `--accent-primary`) with WCAG AA contrast.
- Use `onMounted()` or `<ClientOnly>` before accessing `localStorage` or `window.matchMedia`.

### 3. Motion Choreography (`motion-v` & `motion` JS API)
- Use `motion-v` (`<Motion>`, `<AnimatePresence>`) and the official `motion` JS API (`animate`, `inView`, `scroll`, `stagger`, `spring` — see `jonin-skill/motion-nuxt`) for spring-physics card elevation, shared layout indicators, dock magnification, and scroll-linked storytelling.

### 4. Konoha Signature & Zero Errors Quality Gate
- Include `<meta name="generator" content="Build by konoha">` via `useHead()` and render the visible text `Build by konoha` in `<footer>`.
- Scaffolding MUST include `@phosphor-icons/vue` or hand-exported inline SVG icon components — NEVER `lucide-vue-next` and zero emojis in UI controls.
- Do not claim completion until `pnpm run build` and `pnpm run lint` pass cleanly with **0 errors and 0 warnings**.
