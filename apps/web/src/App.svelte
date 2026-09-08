<script>
  import { onMount } from 'svelte';
  import { api } from './lib/api.js';
  import Bridges from './components/Bridges.svelte';
  import Agents from './components/Agents.svelte';
  import Skills from './components/Skills.svelte';
  import Savings from './components/Savings.svelte';
  import Doctor from './components/Doctor.svelte';
  import Clients from './components/Clients.svelte';

  let currentTab = 'bridges';
  let health = null;
  let serverPort = 1404;

  const tabs = [
    { id: 'bridges', name: 'Bridges', icon: '🌉' },
    { id: 'agents', name: 'Subagents', icon: '👤' },
    { id: 'skills', name: 'Skills & DB', icon: '📚' },
    { id: 'savings', name: 'Token Savings', icon: '📊' },
    { id: 'doctor', name: 'Doctor', icon: '🩺' },
    { id: 'clients', name: 'Clients Setup', icon: '🔌' }
  ];

  async function checkHealth() {
    try {
      health = await api.get('/api/v1/health');
      if (health && health.port) serverPort = health.port;
    } catch (_) {
      health = null;
    }
  }

  function setupSSE() {
    try {
      const sse = new EventSource('/api/v1/events');
      sse.addEventListener('doctor_repaired', () => checkHealth());
      sse.addEventListener('bridges_updated', () => {});
      sse.addEventListener('agents_updated', () => {});
    } catch (_) {}
  }

  onMount(() => {
    checkHealth();
    setupSSE();
    const interval = setInterval(checkHealth, 5000);
    return () => clearInterval(interval);
  });
</script>

<div class="layout">
  <!-- Sidebar -->
  <aside class="sidebar">
    <div class="brand">
      <div class="brand-logo">🍃</div>
      <div class="brand-info">
        <h1 class="brand-name">Konoha</h1>
        <span class="brand-tag">Ninja Village UI</span>
      </div>
    </div>

    <nav class="nav">
      {#each tabs as tab}
        <button
          class="nav-item {currentTab === tab.id ? 'active' : ''}"
          on:click={() => currentTab = tab.id}
        >
          <span class="nav-icon">{tab.icon}</span>
          <span class="nav-label">{tab.name}</span>
        </button>
      {/each}
    </nav>

    <div class="sidebar-footer">
      <div class="health-card">
        <div class="health-dot {health ? 'online' : 'offline'}"></div>
        <div class="health-info">
          <span class="health-status">{health ? 'Core Operational' : 'Connecting...'}</span>
          <span class="health-port">Port {serverPort} • v{health ? health.version : '2.0.0'}</span>
        </div>
      </div>
    </div>
  </aside>

  <!-- Main Content Area -->
  <div class="main-wrapper">
    <!-- Topbar -->
    <header class="topbar">
      <div class="topbar-title">
        <span class="text-muted">Konoha /</span>
        <span class="font-bold">{tabs.find(t => t.id === currentTab)?.name}</span>
      </div>

      <div class="topbar-right">
        <div class="port-pill">
          <span class="dot"></span>
          <span>127.0.0.1:{serverPort}</span>
        </div>
        <a
          href="https://github.com/andycungkrinx91/konoha"
          target="_blank"
          rel="noreferrer"
          class="github-link"
          title="View on GitHub"
        >
          GitHub ↗
        </a>
      </div>
    </header>

    <!-- Screen Content -->
    <main class="content-area">
      {#if currentTab === 'bridges'}
        <Bridges />
      {:else if currentTab === 'agents'}
        <Agents />
      {:else if currentTab === 'skills'}
        <Skills />
      {:else if currentTab === 'savings'}
        <Savings />
      {:else if currentTab === 'doctor'}
        <Doctor />
      {:else if currentTab === 'clients'}
        <Clients />
      {/if}
    </main>
  </div>
</div>

<style>
  .layout { display: flex; width: 100vw; height: 100vh; overflow: hidden; background: #0b0f19; color: #f8fafc; }
  .sidebar { width: 250px; flex-shrink: 0; background: #0f172a; border-right: 1px solid #1e293b; display: flex; flex-direction: column; padding: 1.25rem 0.75rem; }
  .brand { display: flex; align-items: center; gap: 0.75rem; padding: 0 0.5rem 1.25rem 0.5rem; border-bottom: 1px solid #1e293b; margin-bottom: 1rem; }
  .brand-logo { font-size: 1.75rem; }
  .brand-name { font-size: 1.25rem; font-weight: 800; letter-spacing: -0.025em; color: #f8fafc; line-height: 1; }
  .brand-tag { font-size: 0.6875rem; color: #10b981; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
  .nav { display: flex; flex-direction: column; gap: 0.375rem; flex-grow: 1; }
  .nav-item { display: flex; align-items: center; gap: 0.75rem; padding: 0.625rem 0.75rem; background: transparent; border: none; border-radius: 0.375rem; color: #94a3b8; font-size: 0.875rem; font-weight: 500; cursor: pointer; text-align: left; transition: all 0.15s; }
  .nav-item:hover { background: #1e293b; color: #f8fafc; }
  .nav-item.active { background: rgba(16, 185, 129, 0.12); color: #10b981; font-weight: 600; }
  .nav-icon { font-size: 1rem; }
  .sidebar-footer { border-top: 1px solid #1e293b; padding-top: 1rem; }
  .health-card { display: flex; align-items: center; gap: 0.625rem; background: #111827; padding: 0.625rem 0.75rem; border-radius: 0.375rem; border: 1px solid #1e293b; }
  .health-dot { width: 8px; height: 8px; border-radius: 50%; }
  .health-dot.online { background: #10b981; box-shadow: 0 0 6px #10b981; }
  .health-dot.offline { background: #ef4444; }
  .health-info { display: flex; flex-direction: column; }
  .health-status { font-size: 0.75rem; font-weight: 600; color: #f8fafc; }
  .health-port { font-size: 0.6875rem; color: #64748b; }
  .main-wrapper { flex-grow: 1; display: flex; flex-direction: column; overflow: hidden; }
  .topbar { height: 60px; border-bottom: 1px solid #1e293b; background: #0f172a; display: flex; align-items: center; justify-content: space-between; padding: 0 2rem; flex-shrink: 0; }
  .topbar-title { font-size: 0.9375rem; }
  .text-muted { color: #64748b; margin-right: 0.25rem; }
  .font-bold { font-weight: 700; color: #f8fafc; }
  .topbar-right { display: flex; align-items: center; gap: 1rem; }
  .port-pill { display: flex; align-items: center; gap: 0.5rem; background: #111827; border: 1px solid #1e293b; padding: 0.25rem 0.75rem; border-radius: 9999px; font-family: monospace; font-size: 0.75rem; color: #06b6d4; }
  .port-pill .dot { width: 6px; height: 6px; border-radius: 50%; background: #06b6d4; }
  .github-link { font-size: 0.8125rem; color: #94a3b8; text-decoration: none; padding: 0.25rem 0.5rem; border-radius: 0.25rem; transition: color 0.15s; }
  .github-link:hover { color: #f8fafc; }
  .content-area { flex-grow: 1; overflow-y: auto; padding: 2rem; }
</style>
