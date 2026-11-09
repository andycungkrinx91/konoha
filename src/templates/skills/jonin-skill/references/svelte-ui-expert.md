# Svelte UI Expert & Universal Archetype Blueprints

Canonical design system directives and production blueprints for **SvelteKit 2 & Svelte 5 (`src/routes/`)** web applications supporting all major archetypes: **E-commerce, Admin & Metric Infra Dashboards, Portfolios, SaaS Landing Pages, and Corporate Profiles**.

---

## 🎨 Universal UI/UX & Storytelling Invariants (SvelteKit 2 & Svelte 5 Runes)

### 1. Dynamic Context-Driven Composition (Astra/Fable Standard)
- Compose hero stages, section layouts, and interactive surfaces dynamically around the product domain and prompt.
- Composition, section order, theme count, and navigation pattern come from the 9-field design brief; never reuse a house template. Place the brand identity cleanly on the left of a horizontal header (`flex items-center justify-between`).

### 2. Adaptive Dark & Light Mode + SSR Safety
- Choose the theme strategy from the design brief (single or dual theme) and define semantic color tokens (`--bg-canvas`, `--bg-surface`, `--text-primary`, `--text-muted`, `--border-subtle`, `--accent-primary`) with WCAG AA contrast.
- Use `onMount` before reading `localStorage` or updating `data-theme` to guarantee zero SSR/hydration mismatches.

### 3. Motion Choreography (`svelte/motion` `Spring`/`Tween` + `motion` JS API)
- Combine Svelte 5's reactive `Spring` and `Tween` classes (`import { Spring, Tween } from 'svelte/motion'`) with the `motion` JS engine (`animate`, `inView`, `scroll`, `stagger`, `spring` — see `jonin-skill/motion-svelte`) for interactive topology canvases, dock magnification, 3D card tilt, and staggered section reveals.

### 4. Konoha Signature & Zero Errors Quality Gate
- Include `<meta name="generator" content="Build by konoha">` in `<svelte:head>` and render the visible text `Build by konoha` in `<footer>`.
- Scaffolding MUST include `@phosphor-icons/web` or hand-exported inline SVG icons — NEVER `lucide-svelte` and zero emojis anywhere in UI copy or controls.
- Do not claim completion until `pnpm run check`, `pnpm run build`, and `pnpm run lint` pass cleanly with **0 errors and 0 warnings**.

---

## 🛠️ Canonical Code Blueprints

### Blueprint 1: `src/lib/components/DashboardSidebar.svelte` (Admin / Infra Left Sidebar)

```svelte
<script lang="ts">
  import { page } from '$app/stores';
  // Icons via @phosphor-icons/web CSS classes (loaded in the global stylesheet).

  export let brandName = 'Konoha Infra';
  export let items = [
    { label: 'Overview', href: '/dashboard', icon: 'ph-squares-four' },
    { label: 'Nodes & Clusters', href: '/dashboard/nodes', icon: 'ph-hard-drives', badge: '12 Active' },
    { label: 'Telemetry', href: '/dashboard/analytics', icon: 'ph-chart-bar' },
    { label: 'Team Access', href: '/dashboard/users', icon: 'ph-users' },
    { label: 'Settings', href: '/dashboard/settings', icon: 'ph-gear' }
  ];
</script>

<aside class="hidden lg:flex w-64 flex-col border-r border-[var(--theme-border)] bg-white/95 backdrop-blur-md min-h-screen sticky top-0 shrink-0">
  <div class="h-16 flex items-center gap-3 px-6 border-b border-[var(--theme-border)]">
    <div class="h-9 w-9 rounded-xl bg-[var(--theme-primary)] flex items-center justify-center text-white font-black text-lg shadow-sm">
      {brandName.charAt(0)}
    </div>
    <span class="font-bold text-lg text-gray-900 tracking-tight">{brandName}</span>
  </div>

  <nav class="flex-1 px-4 py-6 space-y-1.5 overflow-y-auto">
    {#each items as item}
      {@const isActive = $page.url.pathname === item.href}
      <a
        href={item.href}
        class="flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all {isActive ? 'bg-[var(--theme-secondary)] text-[var(--theme-primary)] font-semibold shadow-xs' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'}"
      >
        <div class="flex items-center gap-3">
          <i class="ph {item.icon}" aria-hidden="true" style="font-size:1.25rem; color: {isActive ? 'var(--theme-primary)' : '#6b7280'}"></i>
          <span>{item.label}</span>
        </div>
        {#if item.badge}
          <span class="rounded-full bg-[var(--theme-primary)]/15 px-2 py-0.5 text-xs font-semibold text-[var(--theme-primary)]">
            {item.badge}
          </span>
        {/if}
      </a>
    {/each}
  </nav>

  <div class="p-4 border-t border-[var(--theme-border)]">
    <div class="flex items-center gap-3 p-2 rounded-xl bg-gray-50/80">
      <div class="h-8 w-8 rounded-full bg-[var(--theme-primary)]/20 text-[var(--theme-primary)] flex items-center justify-center font-bold text-xs">
        OP
      </div>
      <div class="flex-1 min-w-0">
        <p class="text-xs font-semibold text-gray-900 truncate">Admin Operator</p>
        <p class="text-[10px] text-gray-500 truncate flex items-center gap-1">
          <span class="h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block"></span>
          Cluster Online
        </p>
      </div>
    </div>
  </div>
</aside>
```

