<script>
  import '../app.css';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { apiRequest, initToken } from '#lib/api.js';
  import { uiState } from '#lib/state/uiState.svelte.js';
  import { themeState } from '#lib/state/themeState.svelte.js';
  import ThemeSwitcher from '../components/ThemeSwitcher.svelte';
  import SweetAlertModal from '../components/SweetAlertModal.svelte';
  import PasswordChangeModal from '../components/PasswordChangeModal.svelte';
  import Login from '../components/Login.svelte';
  import { authState } from '#lib/state/authState.svelte.js';

  let { children } = $props();

  let health = $state({ status: 'checking', port: 1404, version: '2.1.18' });

  const navSections = [
    {
      title: 'Overview',
      items: [
        { id: 'dashboard', path: '/dashboard', label: 'Dashboard', iconSvg: 'M3 3v7h7M21 21v-7h-7M3 10a9 9 0 0115-5.7L21 8M21 14a9 9 0 01-15 5.7L3 16' }
      ]
    },
    {
      title: 'Connectivity & Gateways',
      items: [
        { id: 'clients', path: '/clients', label: 'Client IDEs', iconSvg: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
        { id: 'bridges', path: '/bridges', label: 'LLM Bridges', iconSvg: 'M8 9l4-4 4 4m0 6l-4 4-4-4' },
        { id: 'remote', path: '/remote', label: 'Remote Access', iconSvg: 'M13 10V3L4 14h7v7l9-11h-7z', badge: 'Telegram' }
      ]
    },
    {
      title: 'Token Optimization',
      items: [
        { id: 'savings', path: '/savings', label: 'Token Savings', iconSvg: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z', badge: 'Telemetry' }
      ]
    },
    {
      title: 'Agent Intelligence',
      items: [
        { id: 'agents', path: '/agents', label: 'Ninja Agents', iconSvg: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z' },
        { id: 'skills', path: '/skills', label: 'Skills & Vectors', iconSvg: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253', badge: 'FTS5' },
        { id: 'persona', path: '/persona', label: 'Persona & Memory', iconSvg: 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z' },
        { id: 'context', path: '/context', label: 'Workspace Context', iconSvg: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10' }
      ]
    },
    {
      title: 'Developer Tools',
      items: [
        { id: 'search', path: '/search', label: 'Web Search', iconSvg: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z', badge: 'SearXNG' },
        { id: 'semble', path: '/semble', label: 'Semble MCP', iconSvg: 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4', badge: '98%' },
        { id: 'detector', path: '/detector', label: 'AI Detector', iconSvg: 'M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c.5.633 1.2 1 2 1s1.5-.367 2-1m2-3a2 2 0 100-4 2 2 0 000 4z', badge: 'Web & Docs' }
      ]
    },
    {
      title: 'OPRATION & DIAGNOSTICS',
      items: [
        { id: 'tasks', path: '/tasks', label: 'SDLC Tasks', iconSvg: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4' },
        { id: 'doctor', path: '/doctor', label: 'Health & Doctor', iconSvg: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' },
        { id: 'docs', path: '/docs', label: 'Documentation', iconSvg: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
        { id: 'settings', path: '/settings', label: 'Settings & Auth', iconSvg: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
        { id: 'logout', action: 'logout', label: 'Logout / Lock', iconSvg: 'M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1', badge: 'Lock' }
      ]
    }
  ];

  const allNavItems = navSections.flatMap(s => s.items);
  const activeNavItem = $derived(
    allNavItems.find(it => it.path === page.url.pathname || (it.path === '/dashboard' && page.url.pathname === '/'))
  );
  const currentSection = $derived(
    navSections.find(s => s.items.some(it => it.path === page.url.pathname || (it.path === '/dashboard' && page.url.pathname === '/')))
  );

  let isSidebarOpen = $state(true);
  let isMobileSidebarOpen = $state(false);
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

  function toggleMobileSidebar() {
    isMobileSidebarOpen = !isMobileSidebarOpen;
  }

  function closeMobileSidebar() {
    isMobileSidebarOpen = false;
  }

  $effect(() => {
    if (page.url.pathname) {
      isMobileSidebarOpen = false;
    }
  });

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
    authState.checkAuth();
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

{#if authState.isChecking}
  <div class="fixed inset-0 flex items-center justify-center bg-slate-950 text-white z-50">
    <div class="flex flex-col items-center gap-3">
      <div class="w-10 h-10 rounded-full border-2 border-sky-400 border-t-transparent animate-spin"></div>
      <p class="text-xs font-mono text-sky-300">SYNCHRONIZING WITH KONOHA GATEWAY...</p>
    </div>
  </div>
{:else if !authState.isAuthenticated}
  <Login />
  <ThemeSwitcher />
  <SweetAlertModal />
{:else}
<div id="konoha-app-root" class="flex h-screen overflow-hidden font-sans transition-colors duration-200" style="background-color: var(--color-bg); color: var(--color-text);">
  <!-- Mobile Sidebar Backdrop Overlay -->
  {#if isMobileSidebarOpen}
    <div
      class="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs lg:hidden transition-opacity duration-200"
      onclick={closeMobileSidebar}
      role="button"
      tabindex="-1"
      aria-label="Close mobile navigation sidebar"
      onkeydown={(e) => { if (e.key === 'Escape') closeMobileSidebar(); }}
    ></div>
  {/if}

  <!-- Fixed Left Sidebar (Desktop Collapsible & Mobile Drawer) -->
  <aside
    class="glass-frost flex-col shrink-0 border-r transition-all duration-300 ease-in-out overflow-hidden {isMobileSidebarOpen ? 'fixed inset-y-0 left-0 z-50 w-64 flex shadow-2xl lg:static lg:z-auto lg:shadow-none' : 'hidden lg:flex'} {isSidebarOpen ? 'lg:w-64 lg:opacity-100' : 'lg:w-0 lg:border-r-0 lg:opacity-0 lg:pointer-events-none'}"
    style="background: var(--theme-sidebar-bg); border-color: color-mix(in srgb, var(--theme-grad-2) 25%, var(--color-border)); color: var(--color-text);"
  >
    <div class="flex-1 overflow-y-auto scrollbar-thin w-64">
      <!-- Brand Header (Far-Left Logo + Sidebar Collapse Button) -->
      <div class="p-4 border-b flex items-center justify-between sticky top-0 z-10 glass-frost" style="border-color: color-mix(in srgb, var(--theme-grad-2) 20%, var(--color-border)); background: var(--theme-sidebar-header-bg);">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-9 h-9 rounded-[5px] overflow-hidden flex items-center justify-center shadow-md border bg-white shrink-0" style="border-color: var(--color-primary);">
            <img src="/fox_kyubi_192.png" alt="Konoha Kyubi logo" class="w-full h-full object-cover" width="36" height="36" loading="eager" />
          </div>
          <div class="min-w-0">
            <h1 class="text-sm font-extrabold tracking-tight flex items-center gap-1.5" style="color: var(--color-text);">
              Konoha <span class="text-[9px] px-1.5 py-0.5 rounded-[5px] font-mono border font-bold gradient-badge">v{health.version || '2.1.18'}</span>
            </h1>
            <p class="text-[10px] font-medium truncate" style="color: var(--color-text-muted);">Ninja Agent Village</p>
          </div>
        </div>
        <button
          type="button"
          onclick={() => {
            if (isMobileSidebarOpen) {
              closeMobileSidebar();
            } else {
              toggleSidebar();
            }
          }}
          class="w-7 h-7 rounded-[5px] border flex items-center justify-center text-xs transition-colors hover:bg-slate-200/50 dark:hover:bg-slate-800/50 cursor-pointer shrink-0"
          style="border-color: var(--color-border); color: var(--color-text-muted);"
          title={isMobileSidebarOpen ? "Close mobile menu" : "Collapse sidebar"}
          aria-label={isMobileSidebarOpen ? "Close mobile menu" : "Collapse sidebar"}
        >
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            {#if isMobileSidebarOpen}
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            {:else}
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            {/if}
          </svg>
        </button>
      </div>

      <!-- Grouped Navigation with Clickable Sub-menu Accordions -->
      <nav class="p-2 space-y-1.5">
        {#each navSections as section}
          {@const isExpanded = openSections.has(section.title)}
          {@const hasActiveChild = section.items.some(it => page.url.pathname === it.path || (it.path === '/dashboard' && page.url.pathname === '/'))}
          <div class="rounded-[5px] overflow-hidden border transition-all duration-200 {hasActiveChild ? 'border-sky-500/30 shadow-xs' : 'border-transparent'}" style="{hasActiveChild ? 'background: linear-gradient(90deg, color-mix(in srgb, var(--theme-grad-1) 14%, transparent) 0%, color-mix(in srgb, var(--theme-grad-2) 6%, transparent) 100%);' : ''}">
            <button
              type="button"
              onclick={() => toggleSection(section.title)}
              class="w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider select-none hover:bg-black/5 dark:hover:bg-white/5 rounded-[5px] transition-colors cursor-pointer text-left"
              style="color: {hasActiveChild ? 'var(--color-primary)' : 'var(--color-text-muted)'};"
              aria-expanded={isExpanded}
            >
              <div class="flex items-center gap-1.5 ml-1 text-left justify-start">
                <span class="w-1.5 h-1.5 rounded-full shrink-0 {hasActiveChild ? 'shadow-xs' : 'bg-slate-400/40'}" style="{hasActiveChild ? 'background: var(--theme-4gradient);' : ''}"></span>
                <span class="text-left">{section.title}</span>
              </div>
              <svg class="w-3.5 h-3.5 transition-transform duration-200 {isExpanded ? 'rotate-90' : 'rotate-0'}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
              </svg>
            </button>

            {#if isExpanded}
              <div class="space-y-0.5 pt-0.5 pb-1 pl-1 transition-all duration-200">
                {#each section.items as item}
                  {#if item.action === 'logout'}
                    <button
                      type="button"
                      onclick={() => { closeMobileSidebar(); authState.logout(); }}
                      class="nav-depth gradient-sidemenu-item w-full flex items-center justify-between px-2.5 py-1.5 rounded-[5px] text-xs font-semibold transition-all duration-150 cursor-pointer text-rose-500 hover:text-rose-600 hover:bg-rose-500/10"
                    >
                      <div class="flex items-center gap-2 min-w-0">
                        <svg class="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={item.iconSvg} />
                        </svg>
                        <span class="truncate">{item.label}</span>
                      </div>
                      {#if item.badge}
                        <span class="px-1.5 py-0.5 rounded-[5px] text-[9px] font-mono shrink-0 bg-rose-500/20 text-rose-500 border border-rose-500/30">{item.badge}</span>
                      {/if}
                    </button>
                  {:else}
                    {@const isActive = page.url.pathname === item.path || (item.path === '/dashboard' && page.url.pathname === '/')}
                    <a
                      href={item.path}
                      onclick={closeMobileSidebar}
                      class="nav-depth gradient-sidemenu-item flex items-center justify-between px-2.5 py-1.5 rounded-[5px] text-xs font-semibold transition-all duration-150 {isActive ? 'gradient-sidemenu-active' : ''}"
                      style="{isActive ? '' : 'color: var(--color-text-muted);'}"
                    >
                      <div class="flex items-center gap-2 min-w-0">
                        <svg class="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={item.iconSvg} />
                        </svg>
                        <span class="truncate">{item.label}</span>
                      </div>
                      {#if item.badge}
                        <span class="px-1.5 py-0.5 rounded-[5px] text-[9px] font-mono shrink-0 {isActive ? 'bg-white/25 text-white border border-white/40' : 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'}">{item.badge}</span>
                      {/if}
                    </a>
                  {/if}
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </nav>
    </div>

    <!-- System Status Footer: Live MCP Gateway -->
    <div class="p-4 border-t shrink-0 transition-colors duration-200 w-64" style="border-color: color-mix(in srgb, var(--theme-grad-2) 20%, var(--color-border)); background: var(--theme-sidebar-footer-bg);">
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
      <div class="text-[10px] flex items-center justify-between pt-1.5 border-t mt-1.5" style="border-color: color-mix(in srgb, var(--theme-grad-2) 15%, var(--color-border)); color: var(--color-text-muted);">
        <span>Created by</span>
        <a
          href="https://www.linkedin.com/in/andy-setiyawan-452396170/"
          target="_blank"
          rel="noopener noreferrer"
          class="font-semibold transition-colors hover:underline"
          style="color: var(--color-primary);"
        >
          Andy Setiyawan
        </a>
      </div>
    </div>
  </aside>

  <!-- Main Content Stage (Expands to Full Width When Sidebar is Collapsed) -->
  <main class="flex-1 flex flex-col overflow-hidden transition-all duration-300 ease-in-out" style="background-color: var(--color-bg); color: var(--color-text);">
    <!-- Top 4-Gradient Vibrant Accent Stripe -->
    <div class="h-1 w-full shrink-0 animate-gradient-flow" style="background: var(--theme-4gradient-bar);"></div>

    <!-- Top Header: Brand Logo on Far LEFT + Sidebar Toggle (Mandatory Invariant) -->
    <header class="glass-frost h-14 border-b px-4 lg:px-6 flex items-center justify-between shrink-0 transition-all duration-200" style="background: var(--theme-header-bg); border-color: color-mix(in srgb, var(--theme-grad-3) 25%, var(--color-border)); box-shadow: 0 4px 20px -6px color-mix(in srgb, var(--theme-grad-1) 12%, transparent);">
      <!-- Far-Left Logo & Title + Sidebar Open/Close Toggle Button -->
      <div class="flex items-center gap-2.5">
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

        <!-- Mobile View Sidebar Menu Toggle Button (Left Header) -->
        <button
          type="button"
          onclick={toggleMobileSidebar}
          class="lg:hidden flex w-8 h-8 rounded-[5px] border items-center justify-center text-xs transition-all hover:scale-105 cursor-pointer shrink-0"
          style="border-color: var(--color-border); background-color: var(--color-surface); color: var(--color-text);"
          title={isMobileSidebarOpen ? "Close mobile menu" : "Open mobile menu"}
          aria-label="Toggle mobile menu sidebar"
        >
          <svg class="w-4 h-4 transition-transform duration-200 {isMobileSidebarOpen ? 'rotate-90' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            {#if isMobileSidebarOpen}
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            {:else}
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
            {/if}
          </svg>
        </button>

        <div class="flex items-center gap-2">
          <img src="/fox_kyubi_64.png" alt="Konoha" class="w-7 h-7 rounded-[5px] border object-cover bg-white shrink-0" style="border-color: var(--color-primary);" width="28" height="28" loading="eager" />
          <span class="text-sm font-bold tracking-tight" style="color: var(--color-text);">Konoha</span>
        </div>
        <div class="hidden sm:flex items-center gap-2 text-xs">
          {#if currentSection}
            <span class="uppercase tracking-widest text-[10px] font-bold" style="color: var(--color-text-muted);">{currentSection.title}</span>
            <span style="color: var(--color-border);">/</span>
          {/if}
          <span class="font-extrabold capitalize text-xs gradient-text">{activeNavItem?.label || page.url.pathname.replace('/', '') || 'Overview'}</span>
        </div>
      </div>

      <!-- Action Buttons & Status -->
      <div class="flex items-center gap-2 sm:gap-3">
        <!-- Change Password Button -->
        <button
          type="button"
          onclick={() => authState.openPasswordChangeModal()}
          class="btn-3d px-2.5 py-1 rounded-[5px] border text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer hover:scale-105 transition-all"
          style="background-color: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
          title="Security Passphrase Settings"
          aria-label="Security Settings"
        >
          <svg class="w-3.5 h-3.5 text-sky-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <span class="hidden md:inline">Password</span>
        </button>

        <!-- Lock / Logout Button -->
        <button
          type="button"
          onclick={() => authState.logout()}
          class="btn-3d px-2.5 py-1 rounded-[5px] border text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer text-rose-500 hover:text-rose-600 border-rose-200 dark:border-rose-900/40 hover:scale-105 transition-all"
          title="Lock Console / Logout"
          aria-label="Logout"
        >
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          <span class="hidden md:inline">Logout</span>
        </button>

        <div class="hidden sm:flex items-center gap-2 px-3 py-1 rounded-[5px] border text-[11px] font-mono" style="background-color: var(--color-surface); border-color: var(--color-border); color: var(--color-text);">
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
          <span>127.0.0.1:{health.port || 1404}</span>
        </div>
        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[5px] text-[11px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
          SSE Active
        </span>
      </div>
    </header>

    <!-- Page Body (padding clears the bottom floating theme FAB on mobile) -->
    <div class="flex-1 overflow-y-auto p-4 pb-20 lg:p-8 lg:pb-8 transition-colors duration-200 perspective-container" style="background-color: var(--color-bg);">
      {@render children()}
    </div>
  </main>

  <!-- Floating Theme Switcher Button -->
  <ThemeSwitcher />

  <!-- Global 3D SweetAlert Modal -->
  <SweetAlertModal />

  <!-- Mandatory / On-Demand Password Change Modal -->
  <PasswordChangeModal />

  <!-- Global Notification Toasts (Top-Right Placement - Zero Overlap with Bottom-Right Theme Switcher) -->
  {#if uiState.notifications.length > 0}
    <div class="fixed top-5 right-5 z-[100] space-y-2 max-w-[calc(100vw-2.5rem)] pointer-events-none">
      {#each uiState.notifications as n (n.id)}
        <div class="px-4 py-3 rounded-[5px] text-xs font-semibold shadow-2xl border backdrop-blur-2xl bg-slate-900/95 text-white border-sky-500/50 flex items-center gap-2 pointer-events-auto animate-in fade-in zoom-in-95 duration-200">
          <span class="w-2 h-2 rounded-full bg-sky-400 animate-ping"></span>
          <span>{n.text}</span>
        </div>
      {/each}
    </div>
  {/if}
</div>
{/if}
