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

  const navItems = [
    { id: 'dashboard', path: '/dashboard', label: 'Dashboard', iconSvg: 'M3 3v7h7M21 21v-7h-7M3 10a9 9 0 0115-5.7L21 8M21 14a9 9 0 01-15 5.7L3 16' },
    { id: 'bridges', path: '/bridges', label: 'Bridges', iconSvg: 'M8 9l4-4 4 4m0 6l-4 4-4-4' },
    { id: 'savings', path: '/savings', label: 'Savings', iconSvg: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
    { id: 'search', path: '/search', label: 'Web Search', iconSvg: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z', badge: 'SearXNG' },
    { id: 'semble', path: '/semble', label: 'Semble MCP', iconSvg: 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4', badge: '98%' },
    { id: 'persona', path: '/persona', label: 'Persona', iconSvg: 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z' },
    { id: 'context', path: '/context', label: 'Context', iconSvg: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10' },
    { id: 'agents', path: '/agents', label: 'Agents', iconSvg: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z' },
    { id: 'skills', path: '/skills', label: 'Skills', iconSvg: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253' },
    { id: 'tasks', path: '/tasks', label: 'SDLC Tasks', iconSvg: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4' },
    { id: 'doctor', path: '/doctor', label: 'Doctor', iconSvg: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' },
    { id: 'clients', path: '/clients', label: 'Clients', iconSvg: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
    { id: 'detector', path: '/detector', label: 'AI Detector', iconSvg: 'M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c.5.633 1.2 1 2 1s1.5-.367 2-1m2-3a2 2 0 100-4 2 2 0 000 4z' },
    { id: 'docs', path: '/docs', label: 'Documentation', iconSvg: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253' }
  ];

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
  <!-- Desktop Fixed Left Sidebar (Mandatory Jonin Dashboard Invariant) -->
  <aside class="glass-frost hidden lg:flex w-64 border-r flex-col justify-between shrink-0 transition-colors duration-200" style="background: var(--glass-sidebar), var(--glass-tint); border-color: var(--color-border); color: var(--color-text);">
    <div>
      <!-- Brand Header (Far-Left Logo) -->
      <div class="p-6 border-b flex items-center gap-3" style="border-color: var(--color-border);">
        <div class="w-10 h-10 rounded-xl overflow-hidden flex items-center justify-center shadow-lg border bg-white" style="border-color: var(--color-primary);">
          <img src="/fox_kyubi_192.png" alt="Konoha Kyubi logo" class="w-full h-full object-cover" width="40" height="40" loading="eager" />
        </div>
        <div>
          <h1 class="text-base font-extrabold tracking-tight flex items-center gap-2" style="color: var(--color-text);">
            Konoha <span class="text-[10px] px-1.5 py-0.5 rounded font-mono border" style="color: var(--color-primary); background-color: var(--color-primary-glow); border-color: var(--color-primary);">v{health.version || '2.0.0'}</span>
          </h1>
          <p class="text-[11px] font-medium" style="color: var(--color-text-muted);">Ninja Agent Village</p>
        </div>
      </div>

      <!-- Navigation -->
      <nav class="p-3 space-y-1">
        {#each navItems as item}
          {@const isActive = page.url.pathname === item.path || (item.path === '/dashboard' && page.url.pathname === '/')}
          <a
            href={item.path}
            class="nav-depth flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all duration-150"
            style="{isActive ? 'color: var(--color-primary); background-color: var(--color-primary-glow); border: 1.5px solid var(--color-primary);' : 'color: var(--color-text-muted);'}"
          >
            <div class="flex items-center gap-3">
              <svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={item.iconSvg} />
              </svg>
              <span>{item.label}</span>
            </div>
            {#if item.badge}
              <span class="px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">{item.badge}</span>
            {/if}
          </a>
        {/each}
      </nav>
    </div>


    <!-- System Status Footer: Live MCP Gateway -->
    <div class="p-4 border-t transition-colors duration-200" style="border-color: var(--color-border); background-color: var(--color-bg);">
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

  <!-- Main Content Stage -->
  <main class="flex-1 flex flex-col overflow-hidden pb-16 lg:pb-0 transition-colors duration-200" style="background-color: var(--color-bg); color: var(--color-text);">
    <!-- Top Header: Brand Logo on Far LEFT (Mandatory Invariant) -->
    <header class="glass-frost h-14 border-b px-6 flex items-center justify-between shrink-0 transition-colors duration-200" style="background: var(--glass-header), var(--glass-tint); border-color: var(--color-border);">
      <!-- Far-Left Logo & Title -->
      <div class="flex items-center gap-3">
        <div class="lg:hidden flex items-center gap-2">
          <img src="/fox_kyubi_64.png" alt="Konoha" class="w-7 h-7 rounded-lg border object-cover bg-white" style="border-color: var(--color-primary);" width="28" height="28" loading="eager" />
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
        <div class="hidden sm:flex items-center gap-2 px-3 py-1 rounded-full border text-[11px] font-mono" style="background-color: var(--color-surface); border-color: var(--color-border); color: var(--color-text);">
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
          <span>127.0.0.1:{health.port || 1404}</span>
        </div>
        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
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
    {#each navItems as item}
      {@const isActive = page.url.pathname === item.path || (item.path === '/dashboard' && page.url.pathname === '/')}
      <a
        href={item.path}
        class="nav-depth flex flex-col items-center gap-1 py-1 px-2.5 rounded-xl text-[10px] font-semibold transition-all shrink-0"
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
        <div class="px-4 py-3 rounded-xl text-xs font-semibold shadow-2xl border backdrop-blur-2xl bg-slate-900/95 text-white border-sky-500/50 flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-sky-400 animate-ping"></span>
          <span>{n.text}</span>
        </div>
      {/each}
    </div>
  {/if}
</div>
