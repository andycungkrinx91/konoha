# Svelte UI Expert & Universal Archetype Blueprints

Canonical design system directives and production blueprints for **SvelteKit 2 & Svelte 5 (`src/routes/`)** web applications supporting all major archetypes: **E-commerce, Admin & Metric Infra Dashboards, Portfolios, SaaS Landing Pages, and Corporate Profiles**.

---

## 🎨 Universal UI/UX Invariants (Mandatory Across All Archetypes)

### 1. Header Architecture (Far-Left Logo & Zero Mobile Hamburger Toggle)
- **Far-Left Brand Logo**: Brand logo MUST always be placed on the far LEFT (`flex items-center gap-3`) of the navigation header.
- **Zero Mobile Hamburger Menu**: In mobile view (`lg:hidden`), **NEVER render a hamburger menu or top menu toggle button in the header**. Mobile navigation is handled exclusively by the fixed bottom Mobile Dock.

### 2. Floating Bottom-Left 10-Theme Switcher Popup
- **Placement**: Theme switcher trigger button MUST be positioned floating in the **bottom-left corner** (`fixed bottom-6 left-6 z-50`) on both desktop and mobile viewports.
- **Pure Light Mode**: 10 curated Light Mode gradient themes. Zero dark mode enforcement.
- **SSR Safety**: Use `onMount` before reading `localStorage` or updating `data-theme`.

### 3. Archetype-Adaptive Sticky Mobile Bottom Navigation Dock
- **Placement**: Fixed mobile navigation dock (`fixed bottom-0 left-0 right-0 z-40 lg:hidden backdrop-blur-lg bg-white/90 border-t border-[var(--theme-border)] pb-safe`).
- **Adaptive Routes**: Maps quick one-tap links to Dashboard (Overview, Analytics, Servers, Alerts, Themes), Portfolio (Home, Projects, Skills, Contact, Themes), SaaS, and Commerce.

### 4. Zero Errors & Zero Warnings Quality Gate
- Scaffolding MUST include required packages: `lucide-svelte`, `clsx`, `tailwind-merge`.
- Do not claim completion until `pnpm run check`, `pnpm run build`, and `pnpm run lint` pass cleanly with **0 errors and 0 warnings**.

---

## 🛠️ Canonical Code Blueprints

### Blueprint 1: `src/lib/components/DashboardSidebar.svelte` (Admin / Infra Left Sidebar)

```svelte
<script lang="ts">
  import { page } from '$app/stores';
  import { LayoutDashboard, Server, BarChart3, Users, Settings, ShieldCheck } from 'lucide-svelte';

  export let brandName = 'Konoha Infra';
  export let items = [
    { label: 'Overview', href: '/dashboard', icon: LayoutDashboard },
    { label: 'Nodes & Clusters', href: '/dashboard/nodes', icon: Server, badge: '12 Active' },
    { label: 'Telemetry', href: '/dashboard/analytics', icon: BarChart3 },
    { label: 'Team Access', href: '/dashboard/users', icon: Users },
    { label: 'Settings', href: '/dashboard/settings', icon: Settings }
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
      {@const Icon = item.icon}
      {@const isActive = $page.url.pathname === item.href}
      <a
        href={item.href}
        class="flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all {isActive ? 'bg-[var(--theme-secondary)] text-[var(--theme-primary)] font-semibold shadow-xs' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'}"
      >
        <div class="flex items-center gap-3">
          <svelte:component this={Icon} class="h-5 w-5 {isActive ? 'text-[var(--theme-primary)]' : 'text-gray-500'}" />
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

---

### Blueprint 2: `src/lib/components/ThemeSwitcher.svelte` (Hydration-Safe FAB Modal)

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { Palette, Check, X } from 'lucide-svelte';

  const THEMES = [
    { id: 'imperial-gold', name: 'Imperial Gold', primary: '#d97706' },
    { id: 'nebula-indigo', name: 'Nebula Indigo', primary: '#4f46e5' },
    { id: 'aurora-emerald', name: 'Aurora Emerald', primary: '#059669' },
    { id: 'sunset-amber', name: 'Sunset Amber', primary: '#ea580c' },
    { id: 'ocean-sapphire', name: 'Ocean Sapphire', primary: '#0284c7' },
    { id: 'forest-jade', name: 'Forest Jade', primary: '#15803d' },
    { id: 'volcano-crimson', name: 'Volcano Crimson', primary: '#dc2626' },
    { id: 'sakura-rose', name: 'Sakura Rose', primary: '#db2777' },
    { id: 'cyber-violet', name: 'Cyber Violet', primary: '#7c3aed' },
    { id: 'midnight-slate', name: 'Midnight Slate', primary: '#334155' }
  ];

  let mounted = $state(false);
  let isOpen = $state(false);
  let currentTheme = $state('imperial-gold');

  onMount(() => {
    mounted = true;
    const saved = localStorage.getItem('konoha-theme') || 'imperial-gold';
    currentTheme = saved;
    document.documentElement.setAttribute('data-theme', saved);
  });

  function selectTheme(themeId: string) {
    currentTheme = themeId;
    document.documentElement.setAttribute('data-theme', themeId);
    localStorage.setItem('konoha-theme', themeId);
    isOpen = false;
  }
</script>

{#if mounted}
  <button
    onclick={() => (isOpen = !isOpen)}
    aria-label="Open theme switcher"
    class="fixed bottom-6 left-6 z-50 flex h-13 w-13 items-center justify-center rounded-full bg-[var(--theme-primary)] text-white shadow-xl hover:scale-105 active:scale-95 transition-transform duration-200 border-2 border-white/80 cursor-pointer"
  >
    <Palette class="h-6 w-6" />
  </button>

  {#if isOpen}
    <div class="fixed inset-0 z-50 flex items-end sm:items-center justify-start p-4 sm:p-6 bg-black/30 backdrop-blur-xs">
      <div class="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl border border-[var(--theme-border)]">
        <div class="flex items-center justify-between pb-3 border-b border-gray-100">
          <div class="flex items-center gap-2">
            <Palette class="h-5 w-5 text-[var(--theme-primary)]" />
            <h3 class="font-semibold text-gray-900 text-sm">Light Mode Themes</h3>
          </div>
          <button onclick={() => (isOpen = false)} class="rounded-lg p-1 text-gray-400 hover:bg-gray-100 text-gray-600">
            <X class="h-4 w-4" />
          </button>
        </div>

        <div class="grid grid-cols-2 gap-2.5 pt-4 max-h-[60vh] overflow-y-auto">
          {#each THEMES as theme}
            {@const isActive = currentTheme === theme.id}
            <button
              onclick={() => selectTheme(theme.id)}
              class="flex items-center gap-2.5 rounded-xl p-2.5 text-left text-xs font-medium transition-all border {isActive ? 'border-[var(--theme-primary)] bg-[var(--theme-secondary)] text-[var(--theme-text)] font-semibold shadow-xs' : 'border-gray-200 bg-gray-50/50 hover:bg-gray-100/70 text-gray-700'}"
            >
              <span class="h-4 w-4 rounded-full border border-black/10 shrink-0 flex items-center justify-center" style:background-color={theme.primary}>
                {#if isActive}
                  <Check class="h-2.5 w-2.5 text-white stroke-[3]" />
                {/if}
              </span>
              <span class="truncate">{theme.name}</span>
            </button>
          {/each}
        </div>
      </div>
    </div>
  {/if}
{/if}
```
