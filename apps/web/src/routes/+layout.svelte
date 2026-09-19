<script>
  import '../app.css';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { apiRequest, initToken } from '#lib/api.js';
  import { uiState } from '#lib/state/uiState.svelte.js';
  import { themeState } from '#lib/state/themeState.svelte.js';
  import ThemeSwitcher from '../components/ThemeSwitcher.svelte';
  import SweetAlertModal from '../components/SweetAlertModal.svelte';

  let { children } = $props();

  let health = $state({ status: 'checking', port: 1404, version: '2.0.0-beta.7' });

  const navSections = [
    {
      title: 'Overview',
      items: [
        { id: 'dashboard', path: '/dashboard', label: 'Dashboard', iconSvg: 'M3 3v7h7M21 21v-7h-7M3 10a9 9 0 0115-5.7L21 8M21 14a9 9 0 01-15 5.7L3 16' }
      ]
    },
    {
      title: 'Clients & Finance',
      items: [
        { id: 'clients', path: '/clients', label: 'Clients', iconSvg: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
        { id: 'savings', path: '/savings', label: 'Savings', iconSvg: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
        { id: 'bridges', path: '/bridges', label: 'Bridges', iconSvg: 'M8 9l4-4 4 4m0 6l-4 4-4-4' }
      ]
    },
    {
      title: 'Tools & Integrations',
      items: [
        { id: 'search', path: '/search', label: 'Web Search', iconSvg: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z', badge: 'SearXNG' },
        { id: 'semble', path: '/semble', label: 'Semble MCP', iconSvg: 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4', badge: '98%' },
        { id: 'detector', path: '/detector', label: 'AI Detector', iconSvg: 'M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c.5.633 1.2 1 2 1s1.5-.367 2-1m2-3a2 2 0 100-4 2 2 0 000 4z', badge: 'Web & Docs' }
      ]
    },
    {
      title: 'Configuration',
      items: [
        { id: 'persona', path: '/persona', label: 'Persona', iconSvg: 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z' },
        { id: 'context', path: '/context', label: 'Context', iconSvg: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10' },
        { id: 'agents', path: '/agents', label: 'Agents', iconSvg: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z' },
        { id: 'skills', path: '/skills', label: 'Skills', iconSvg: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253' }
      ]
    },
    {
      title: 'Operations',
      items: [
        { id: 'tasks', path: '/tasks', label: 'SDLC Tasks', iconSvg: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4' },
        { id: 'doctor', path: '/doctor', label: 'Doctor', iconSvg: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' }
      ]
    },
    {
      title: 'Resources',
      items: [
        { id: 'docs', path: '/docs', label: 'Documentation', iconSvg: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253' }
      ]
    }
  ];

  const allNavItems = navSections.flatMap(s => s.items);

  let isSidebarOpen = $state(true);
  let openSections = $state(new Set(navSections.map(s => s.title)));

  function toggleSection(title) {
    if (openSections.has(title)) {
      openSections.delete(title);
    } else {
      openSections.add(title);
    }
    openSections = new Set(openSections);
  }

  function toggleSidebar() {
    isSidebarOpen = !isSidebarOpen;
  }

  $effect(() => {
    const activeSection = navSections.find(s =>
      s.items.some(it => page.url.pathname === it.path || (it.path === '/dashboard' && page.url.pathname === '/'))
    );
    if (activeSection && !openSections.has(activeSection.title)) {
      openSections.add(activeSection.title);
      openSections = new Set(openSections);
    }
  });

  async function checkHealth() {
    try {
      const data = await apiRequest('/api/v1/health');
      health = data;
      uiState.isConnected = true;
    } catch (_) {
      uiState.isConnected = false;
    }
  }

  onMount(() => {
    themeState.init();
    initToken();
    checkHealth();
    const interval = setInterval(checkHealth, 10000);

    let eventSource;
    try {
      eventSource = new EventSource('/api/v1/events');
      eventSource.onopen = () => { uiState.isConnected = true; };
      eventSource.onerror = () => { uiState.isConnected = false; };
      eventSource.addEventListener('bridge_status', (e) => {
        try {
          const payload = JSON.parse(e.data);
          uiState.addNotification(`Bridge ${payload.name || ''} updated`, 'info');
        } catch (_) {}
      });
    } catch (_) {}

    return () => {
      clearInterval(interval);
      if (eventSource) eventSource.close();
    };
  });
</script>

<div class="flex h-screen overflow-hidden font-sans transition-colors duration-200" style="background-color: var(--color-bg); color: var(--color-text);">
  <!-- Desktop Fixed Left Sidebar (Collapsible for Maximum Center Space) -->
  <aside
    class="glass-frost hidden lg:flex border-r flex-col shrink-0 transition-all duration-300 ease-in-out overflow-hidden {isSidebarOpen ? 'w-64' : 'w-0 border-r-0 opacity-0 pointer-events-none'}"
    style="background: var(--glass-sidebar), var(--glass-tint); border-color: var(--color-border); color: var(--color-text);"
  >
    <div class="flex-1 overflow-y-auto scrollbar-thin w-64">
      <!-- Brand Header (Far-Left Logo + Sidebar Collapse Button) -->
      <div class="p-4 border-b flex items-center justify-between sticky top-0 z-10 glass-frost" style="border-color: var(--color-border); background: var(--glass-sidebar), var(--glass-tint);">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-9 h-9 rounded-[5px] overflow-hidden flex items-center justify-center shadow-md border bg-white shrink-0" style="border-color: var(--color-primary);">
            <img src="/fox_kyubi_192.png" alt="Konoha Kyubi logo" class="w-full h-full object-cover" width="36" height="36" loading="eager" />
          </div>
          <div class="min-w-0">
            <h1 class="text-sm font-extrabold tracking-tight flex items-center gap-1.5" style="color: var(--color-text);">
              Konoha <span class="text-[9px] px-1.5 py-0.5 rounded-[5px] font-mono border" style="color: var(--color-primary); background-color: var(--color-primary-glow); border-color: var(--color-primary);">v{health.version || '2.0.0'}</span>
            </h1>
            <p class="text-[10px] font-medium truncate" style="color: var(--color-text-muted);">Ninja Agent Village</p>
          </div>
        </div>
        <button
          type="button"
          onclick={toggleSidebar}
          class="w-7 h-7 rounded-[5px] border flex items-center justify-center text-xs transition-colors hover:bg-slate-200/50 dark:hover:bg-slate-800/50 cursor-pointer shrink-0"
          style="border-color: var(--color-border); color: var(--color-text-muted);"
          title="Collapse sidebar to give more space in center"
          aria-label="Collapse sidebar"
        >
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          </svg>
        </button>
      </div>

      <!-- Grouped Navigation with Clickable Sub-menu Accordions -->
      <nav class="p-2 space-y-1.5">
        {#each navSections as section}
          {@const isExpanded = openSections.has(section.title)}
          {@const hasActiveChild = section.items.some(it => page.url.pathname === it.path || (it.path === '/dashboard' && page.url.pathname === '/'))}
          <div class="rounded-[5px] overflow-hidden border border-transparent transition-colors {hasActiveChild ? 'bg-sky-500/5 dark:bg-sky-500/10 border-sky-500/20' : ''}">
            <button
              type="button"
              onclick={() => toggleSection(section.title)}
              class="w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider select-none hover:bg-black/5 dark:hover:bg-white/5 rounded-[5px] transition-colors cursor-pointer"
              style="color: {hasActiveChild ? 'var(--color-primary)' : 'var(--color-text-muted)'};"
              aria-expanded={isExpanded}
            >
              <div class="flex items-center gap-1.5">
                <span class="w-1.5 h-1.5 rounded-full {hasActiveChild ? 'bg-sky-500' : 'bg-slate-400/40'}"></span>
                <span>{section.title}</span>
              </div>
              <svg class="w-3.5 h-3.5 transition-transform duration-200 {isExpanded ? 'rotate-90' : 'rotate-0'}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
              </svg>
            </button>

            {#if isExpanded}
              <div class="space-y-0.5 pt-0.5 pb-1 pl-1 transition-all duration-200">
                {#each section.items as item}
                  {@const isActive = page.url.pathname === item.path || (item.path === '/dashboard' && page.url.pathname === '/')}
                  <a
                    href={item.path}
                    class="nav-depth flex items-center justify-between px-2.5 py-1.5 rounded-[5px] text-xs font-semibold transition-all duration-150"
                    style="{isActive ? 'color: var(--color-primary); background-color: var(--color-primary-glow); border: 1.5px solid var(--color-primary); box-shadow: 0 0 12px var(--color-primary-glow);' : 'color: var(--color-text-muted);'}"
                  >
                    <div class="flex items-center gap-2 min-w-0">
                      <svg class="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={item.iconSvg} />
                      </svg>
                      <span class="truncate">{item.label}</span>
                    </div>
                    {#if item.badge}
                      <span class="px-1.5 py-0.5 rounded-[5px] text-[9px] font-mono bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 shrink-0">{item.badge}</span>
                    {/if}
                  </a>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </nav>
    </div>

    <!-- System Status Footer: Live MCP Gateway -->
    <div class="p-4 border-t shrink-0 transition-colors duration-200 w-64" style="border-color: var(--color-border); background-color: var(--color-bg);">
      <div class="flex items-center justify-between text-xs mb-2" style="color: var(--color-text-muted);">
        <span class="flex items-center gap-2">
          <span class="w-2 h-2 rounded-full {uiState.isConnected ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]' : 'bg-rose-500'}"></span>
          <span class="text-xs font-medium">{uiState.isConnected ? 'Live MCP Gateway' : 'Disconnected'}</span>
        </span>
        <span class="font-mono text-[11px]" style="color: var(--color-text-muted);">:{health.port || 1404}</span>
      </div>
      <div class="text-[10px] flex justify-between pt-1" style="color: var(--color-text-muted);">
        <span>SQLite FTS5 + Semble</span>
        <span>Localhost</span>
      </div>
    </div>
  </aside>

  <!-- Main Content Stage (Expands to Full Width When Sidebar is Collapsed) -->
  <main class="flex-1 flex flex-col overflow-hidden pb-16 lg:pb-0 transition-all duration-300 ease-in-out" style="background-color: var(--color-bg); color: var(--color-text);">
    <!-- Top 4-Gradient Vibrant Accent Stripe -->
    <div class="h-1 w-full shrink-0" style="background: var(--theme-4gradient-bar);"></div>

    <!-- Top Header: Brand Logo on Far LEFT + Sidebar Toggle (Mandatory Invariant) -->
    <header class="glass-frost h-14 border-b px-4 lg:px-6 flex items-center justify-between shrink-0 transition-colors duration-200" style="background: var(--glass-header), var(--glass-tint); border-color: var(--color-border);">
      <!-- Far-Left Logo & Title + Sidebar Open/Close Toggle Button -->
      <div class="flex items-center gap-3">
        <!-- Desktop Sidebar Toggle Button -->
        <button
          type="button"
          onclick={toggleSidebar}
          class="hidden lg:flex w-8 h-8 rounded-[5px] border items-center justify-center text-xs transition-all hover:scale-105 cursor-pointer shrink-0"
          style="border-color: var(--color-border); background-color: var(--color-surface); color: var(--color-text);"
          title={isSidebarOpen ? "Close sidebar to give more space in center" : "Open sidebar"}
          aria-label="Toggle sidebar"
        >
          <svg class="w-4 h-4 transition-transform duration-200 {isSidebarOpen ? '' : 'rotate-180'}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h7" />
          </svg>
        </button>

        <div class="lg:hidden flex items-center gap-2">
          <img src="/fox_kyubi_64.png" alt="Konoha" class="w-7 h-7 rounded-[5px] border object-cover bg-white" style="border-color: var(--color-primary);" width="28" height="28" loading="eager" />
          <span class="text-sm font-bold tracking-tight" style="color: var(--color-text);">Konoha</span>
        </div>
        <div class="hidden sm:flex items-center gap-2 text-xs">
          <span class="uppercase tracking-widest text-[10px] font-bold" style="color: var(--color-text-muted);">Dashboard</span>
          <span style="color: var(--color-border);">/</span>
          <span class="font-semibold capitalize" style="color: var(--color-primary);">{page.url.pathname.replace('/', '') || 'dashboard'}</span>
        </div>
      </div>

      <!-- Action Buttons & Status -->
      <div class="flex items-center gap-3">
        <div class="hidden sm:flex items-center gap-2 px-3 py-1 rounded-[5px] border text-[11px] font-mono" style="background-color: var(--color-surface); border-color: var(--color-border); color: var(--color-text);">
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
          <span>127.0.0.1:{health.port || 1404}</span>
        </div>
        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[5px] text-[11px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
          SSE Active
        </span>
      </div>
    </header>

    <!-- Page Body (extra bottom padding clears the mobile dock + theme FAB) -->
    <div class="flex-1 overflow-y-auto p-6 pb-28 lg:p-8 lg:pb-8 transition-colors duration-200" style="background-color: var(--color-bg);">
      {@render children()}
    </div>
  </main>

  <!-- Mobile Navigation Dock (Mandatory Invariant — Zero Hamburger Menu in Header) -->
  <nav class="glass-frost lg:hidden fixed bottom-0 inset-x-0 z-40 border-t flex flex-nowrap items-center gap-1 overflow-x-auto scrollbar-none py-2 px-2 shadow-2xl transition-colors duration-200" style="background: var(--glass-dock), var(--glass-tint); border-color: var(--color-border); padding-bottom: max(0.5rem, env(safe-area-inset-bottom));">
    {#each allNavItems as item}
      {@const isActive = page.url.pathname === item.path || (item.path === '/dashboard' && page.url.pathname === '/')}
      <a
        href={item.path}
        class="nav-depth flex flex-col items-center gap-1 py-1 px-2.5 rounded-[5px] text-[10px] font-semibold transition-all shrink-0"
        style="{isActive ? 'color: var(--color-primary); background-color: var(--color-primary-glow);' : 'color: var(--color-text-muted);'}"
      >
        <svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={item.iconSvg} />
        </svg>
        <span class="whitespace-nowrap">{item.label}</span>
      </a>
    {/each}
  </nav>

  <!-- Floating Theme Switcher Button -->
  <ThemeSwitcher />

  <!-- Global 3D SweetAlert Modal -->
  <SweetAlertModal />

  <!-- Global Notification Toasts (lifted above the mobile dock on small screens) -->
  {#if uiState.notifications.length > 0}
    <div class="fixed bottom-20 right-5 z-[90] lg:bottom-6 lg:right-6 space-y-2 max-w-[calc(100vw-2.5rem)]">
      {#each uiState.notifications as n (n.id)}
        <div class="px-4 py-3 rounded-[5px] text-xs font-semibold shadow-2xl border backdrop-blur-2xl bg-slate-900/95 text-white border-sky-500/50 flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-sky-400 animate-ping"></span>
          <span>{n.text}</span>
        </div>
      {/each}
    </div>
  {/if}
</div>
