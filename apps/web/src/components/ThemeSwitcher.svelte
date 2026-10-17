<script>
  import { onMount } from 'svelte';
  import { themeState, groupThemes, THEME_CATEGORIES, getRasenganTokens } from '../lib/state/themeState.svelte.js';
  import { useScrollLock } from '#lib/scrollLock.svelte.js';

  const TRANSITION_MS = 1400; // Fast and cinematic 1.4s full-screen theme transition
  const COVER_MS = 450; // Apply theme under full expansion cover

  const MODES = [
    {
      id: 'light',
      label: 'Light',
      aria: 'Set Light Appearance Mode',
      icon: 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z'
    },
    {
      id: 'dark',
      label: 'Dark',
      aria: 'Set Dark Appearance Mode',
      icon: 'M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z'
    }
  ];

  const categories = ['All', ...THEME_CATEGORIES];
  const allGroups = groupThemes();

  let isModalOpen = $state(false);
  let isRasenganActive = $state(false);
  let transitionPalette = $state(['#0369a1', '#0284c7', '#075985', '#0e7490']);
  let reducedMotion = $state(false);
  let liveMessage = $state('');
  let dialogEl = $state(null);
  let impactTimer = null;
  let applyTimer = null;
  let liveTimer = null;
  let themeCanvasEl = $state(null);
  let themeRasenganScene = null;
  let searchQuery = $state('');
  let selectedCategory = $state('All');

  onMount(() => {
    const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    reducedMotion = Boolean(mq?.matches);
    const onChange = (e) => { reducedMotion = e.matches; };
    mq?.addEventListener?.('change', onChange);
    return () => {
      mq?.removeEventListener?.('change', onChange);
      if (impactTimer) clearTimeout(impactTimer);
      if (applyTimer) clearTimeout(applyTimer);
      if (themeRasenganScene) {
        themeRasenganScene.dispose();
        themeRasenganScene = null;
      }
    };
  });

  useScrollLock(() => isModalOpen);

  const activeTheme = $derived(
    themeState.themes.find(t => t.id === themeState.currentTheme) || themeState.themes[0]
  );

  const filteredThemes = $derived(
    themeState.themes.filter(t => {
      const matchCat = selectedCategory === 'All' || t.category === selectedCategory;
      const q = searchQuery.trim().toLowerCase();
      const matchQuery = !q ||
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q);
      return matchCat && matchQuery;
    })
  );

  const displayedGroups = $derived(
    selectedCategory === 'All' && !searchQuery.trim()
      ? allGroups
      : [{ category: selectedCategory === 'All' ? 'Filtered Palettes' : selectedCategory, themes: filteredThemes }]
  );

  function themeGradient(t) {
    return t.gradient && t.gradient.length >= 4
      ? `linear-gradient(135deg, ${t.gradient[0]} 0%, ${t.gradient[1]} 33%, ${t.gradient[2]} 66%, ${t.gradient[3]} 100%)`
      : `linear-gradient(135deg, ${t.color}, ${t.accent})`;
  }

  $effect(() => {
    if (isRasenganActive && themeCanvasEl && !reducedMotion) {
      const palette = transitionPalette;
      const mode = themeState.currentMode;
      let disposed = false;

      import('#lib/RasenganScene.js')
        .then(({ RasenganScene }) => {
          if (disposed || !isRasenganActive || !themeCanvasEl) return;
          if (themeRasenganScene) {
            themeRasenganScene.dispose();
            themeRasenganScene = null;
          }
          themeRasenganScene = new RasenganScene(themeCanvasEl, {
            colors: palette,
            mode: mode,
            phaseDuration: TRANSITION_MS / 1000,
            transparent: true,
            bloom: mode === 'dark'
          });
          themeRasenganScene.playImpact();
        })
        .catch(() => {
          if (themeCanvasEl) themeCanvasEl.hidden = true;
        });

      return () => {
        disposed = true;
        if (themeRasenganScene) {
          themeRasenganScene.dispose();
          themeRasenganScene = null;
        }
      };
    }
  });

  function closeModal() {
    isModalOpen = false;
    searchQuery = '';
    selectedCategory = 'All';
    if (lastFocused && typeof lastFocused.focus === 'function') {
      lastFocused.focus();
      lastFocused = null;
    }
  }

  function selectTheme(id) {
    closeModal();

    // 1. Read NEWLY SELECTED theme's 4-gradient tokens immediately
    const mode = themeState.currentMode;
    const targetPalette = getRasenganTokens(id, mode);
    transitionPalette = targetPalette;

    // 2. Clear any running transition to safely restart
    if (impactTimer) {
      clearTimeout(impactTimer);
      impactTimer = null;
    }
    if (applyTimer) {
      clearTimeout(applyTimer);
      applyTimer = null;
    }

    isRasenganActive = true;

    // Apply new theme immediately so the underlying page is ready under the full-screen effect
    themeState.applyTheme(id, mode);
    announce(`Theme changed to ${themeState.themes.find(t => t.id === id)?.name || id}`);

    // If an existing scene is live, update its palette immediately
    if (themeRasenganScene) {
      themeRasenganScene.updatePalette(targetPalette, mode);
      themeRasenganScene.playImpact();
    }

    // Conclude transition and cleanly dispose
    impactTimer = setTimeout(() => {
      isRasenganActive = false;
      if (themeRasenganScene) {
        themeRasenganScene.dispose();
        themeRasenganScene = null;
      }
      impactTimer = null;
    }, TRANSITION_MS);
  }

  function resetToDefault() {
    selectMode('light');
    selectTheme('byakugan');
  }

  function selectMode(mode) {
    if (themeState.currentMode === mode) return;
    themeState.setMode(mode);
    announce(`${mode === 'dark' ? 'Dark' : 'Light'} appearance mode enabled`);
  }

  function toggleMode() {
    themeState.toggleMode();
    announce(`${themeState.currentMode === 'dark' ? 'Dark' : 'Light'} appearance mode enabled`);
  }

  function announce(message) {
    if (liveTimer) clearTimeout(liveTimer);
    liveMessage = '';
    liveTimer = setTimeout(() => {
      liveMessage = message;
      liveTimer = null;
    }, 50);
  }

  let lastFocused = null;

  function toggleModal() {
    if (!isModalOpen) lastFocused = typeof document !== 'undefined' ? document.activeElement : null;
    isModalOpen = !isModalOpen;
  }

  function handleModalKeydown(e) {
    if (!isModalOpen) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeModal();
      return;
    }
    if (dialogEl && ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'].includes(e.key)) {
      const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
      if (activeEl && activeEl.hasAttribute('data-theme-id')) {
        const themeButtons = Array.from(dialogEl.querySelectorAll('button[data-theme-id]'));
        const currentIndex = themeButtons.indexOf(activeEl);
        if (currentIndex !== -1) {
          e.preventDefault();
          let nextIndex = currentIndex;
          if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
            nextIndex = (currentIndex + 1) % themeButtons.length;
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
            nextIndex = (currentIndex - 1 + themeButtons.length) % themeButtons.length;
          } else if (e.key === 'Home') {
            nextIndex = 0;
          } else if (e.key === 'End') {
            nextIndex = themeButtons.length - 1;
          }
          themeButtons[nextIndex]?.focus();
          return;
        }
      }
    }
    if (e.key === 'Tab' && dialogEl) {
      const focusables = Array.from(
        dialogEl.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])')
      ).filter(el => el.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  $effect(() => {
    if (!isModalOpen) return;
    queueMicrotask(() => {
      if (!dialogEl) return;
      const target = dialogEl.querySelector(`button[data-theme-id="${themeState.currentTheme}"]`);
      (target || dialogEl.querySelector('button[aria-label="Close theme modal"]'))?.focus();
    });
  });
</script>

<svelte:window onkeydown={handleModalKeydown} />

<div class="fixed bottom-6 right-6 z-[100] pointer-events-auto flex items-center gap-2">
  <!-- Quick appearance toggle (mode only, active palette preserved) -->
  <button
    type="button"
    onclick={toggleMode}
    class="w-10 h-10 rounded-full border shadow-xl flex items-center justify-center transition-all duration-200 hover:scale-105 active:scale-95 cursor-pointer theme-bg-surface theme-border theme-text"
    style="box-shadow: var(--shadow-3d);"
    title={themeState.currentMode === 'dark' ? 'Light appearance mode' : 'Dark appearance mode'}
    aria-label={themeState.currentMode === 'dark' ? 'Light appearance mode' : 'Dark appearance mode'}
  >
    {#if themeState.currentMode === 'dark'}
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d={MODES[0].icon} />
      </svg>
    {:else}
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d={MODES[1].icon} />
      </svg>
    {/if}
  </button>

  <!-- Theme picker FAB with Rasengan icon -->
  <button
    type="button"
    onclick={toggleModal}
    class="w-12 h-12 rounded-full border shadow-2xl flex items-center justify-center transition-all duration-300 hover:scale-105 active:scale-95 cursor-pointer group glass-frost theme-border theme-text"
    style="background-color: var(--color-surface); box-shadow: var(--shadow-3d);"
    title="Switch Theme ({activeTheme?.name || themeState.currentTheme}) — Rasengan Theme Selector"
    aria-label="Toggle Theme Selection Modal"
    aria-haspopup="dialog"
    aria-expanded={isModalOpen}
    aria-controls="konoha-theme-picker"
  >
    <span class="relative w-8 h-8 flex items-center justify-center" aria-hidden="true">
      <span class="absolute inset-0 rounded-full blur-[3px] animate-pulse-rasengan" style="background-color: color-mix(in srgb, var(--theme-focus) 35%, transparent);"></span>

      <span class="absolute inset-[-4px] animate-orbit-lightning pointer-events-none z-20">
        <svg class="w-full h-full animate-lightning-flicker" viewBox="0 0 40 40" fill="none">
          <path d="M20 2 L22 8 L18.5 9 L21.5 15 L16 8.5 L19.5 8 Z" fill="var(--theme-focus)" stroke="var(--theme-surface)" stroke-width="0.5" stroke-linejoin="round" />
          <path d="M20 38 L18 32 L21.5 31 L18.5 25 L24 31.5 L20.5 32 Z" fill="var(--theme-link)" stroke="var(--theme-surface)" stroke-width="0.5" stroke-linejoin="round" />
        </svg>
      </span>

      <span class="absolute inset-[-6px] animate-orbit-lightning-reverse pointer-events-none z-20">
        <svg class="w-full h-full animate-lightning-flicker" viewBox="0 0 44 44" fill="none">
          <path d="M4 22 L10 20 L9 23.5 L15 20.5 L8.5 26 L8 22.5 Z" fill="var(--theme-surface)" stroke="var(--theme-focus)" stroke-width="0.6" stroke-linejoin="round" />
          <path d="M40 22 L34 24 L35 20.5 L29 23.5 L35.5 18 L36 21.5 Z" fill="var(--theme-link)" stroke="var(--theme-focus)" stroke-width="0.6" stroke-linejoin="round" />
        </svg>
      </span>

      <svg class="w-8 h-8 relative z-10 group-hover:scale-105 transition-transform" viewBox="0 0 100 100" fill="none">
        <defs>
          <radialGradient id="rasengan-outer-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="var(--theme-surface)" stop-opacity="0.9" />
            <stop offset="35%" stop-color="var(--theme-focus)" stop-opacity="0.9" />
            <stop offset="70%" stop-color="var(--theme-link)" stop-opacity="0.6" />
            <stop offset="100%" stop-color="var(--theme-link)" stop-opacity="0" />
          </radialGradient>
          <radialGradient id="rasengan-core-sphere" cx="40%" cy="38%" r="48%">
            <stop offset="0%" stop-color="var(--theme-surface)" />
            <stop offset="45%" stop-color="var(--theme-focus)" />
            <stop offset="85%" stop-color="var(--theme-link)" />
            <stop offset="100%" stop-color="var(--theme-link)" />
          </radialGradient>
          <linearGradient id="rasengan-chakra-stream" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="var(--theme-surface)" />
            <stop offset="50%" stop-color="var(--theme-focus)" />
            <stop offset="100%" stop-color="var(--theme-link)" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r="44" fill="url(#rasengan-outer-glow)" opacity="0.85" />
        <g class="animate-spin-rasengan">
          <path d="M50 8 C68 12, 88 28, 92 50 C94 65, 84 82, 68 90 C52 96, 30 92, 18 78 C8 66, 8 45, 18 32 C28 18, 42 12, 50 14" stroke="url(#rasengan-chakra-stream)" stroke-width="3" stroke-linecap="round" fill="none" opacity="0.9" />
          <path d="M50 18 C62 20, 78 32, 80 48 C82 60, 74 74, 62 80 C50 84, 34 80, 26 70 C18 60, 20 44, 28 34 C36 24, 45 20, 50 20" stroke="var(--theme-focus)" stroke-width="2.5" stroke-linecap="round" fill="none" opacity="0.95" />
          <path d="M50 28 C58 30, 68 38, 70 48 C72 58, 64 68, 54 70 C44 72, 34 66, 30 56 C26 48, 32 38, 40 32 C45 28, 48 28, 50 28" stroke="var(--theme-surface)" stroke-width="2" stroke-linecap="round" fill="none" />
        </g>
        <g class="animate-spin-rasengan-reverse">
          <path d="M50 92 C32 88, 12 72, 8 50 C6 35, 16 18, 32 10 C48 4, 70 8, 82 22 C92 34, 92 55, 82 68 C72 82, 58 88, 50 86" stroke="var(--theme-link)" stroke-width="2.5" stroke-linecap="round" fill="none" opacity="0.8" />
          <path d="M50 82 C38 80, 22 68, 20 52 C18 40, 26 26, 38 20 C50 16, 66 20, 74 30 C82 40, 80 56, 72 66 C64 76, 55 80, 50 80" stroke="var(--theme-surface)" stroke-width="2" stroke-linecap="round" fill="none" opacity="0.9" />
        </g>
        <g class="animate-spin-rasengan-fast">
          <path d="M50 36 C55 36, 62 42, 62 50 C62 56, 56 62, 50 62 C44 62, 38 56, 38 50 C38 43, 44 38, 50 36" stroke="var(--theme-focus)" stroke-width="2.5" stroke-linecap="round" fill="none" />
          <circle cx="50" cy="50" r="11" fill="url(#rasengan-core-sphere)" class="animate-pulse-rasengan" />
          <circle cx="47" cy="46" r="4" fill="var(--theme-surface)" opacity="0.95" />
        </g>
      </svg>
    </span>
  </button>
</div>

<!-- Full-Viewport Procedural 3D Rasengan Theme Transition Overlay (Topmost Layer) -->
{#if isRasenganActive}
  <div class="fixed inset-0 z-[9999] pointer-events-none overflow-hidden w-screen h-screen flex items-center justify-center animate-huge-rasengan" aria-hidden="true">
    <!-- Theme palette-tinted ambient flash -->
    <div
      class="absolute inset-0 transition-opacity duration-300 animate-shatter-flash"
      style="background: radial-gradient(circle at center, {transitionPalette[0]}33 0%, {transitionPalette[1]}18 50%, transparent 80%);"
    ></div>

    {#if !reducedMotion}
      <canvas
        bind:this={themeCanvasEl}
        class="absolute inset-0 w-full h-full block pointer-events-none"
      ></canvas>
    {:else}
      <!-- Reduced motion: clean full-screen color wash without 3D spinning -->
      <div
        class="absolute inset-0 transition-opacity duration-500"
        style="background-color: {transitionPalette[0]}; opacity: 0.22;"
      ></div>
    {/if}
  </div>
{/if}

<!-- Theme Picker Dialog -->
{#if isModalOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-in fade-in duration-150"
    style="background-color: var(--theme-overlay);"
    onclick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
  >
    <div
      id="konoha-theme-picker"
      bind:this={dialogEl}
      role="dialog"
      aria-modal="true"
      aria-labelledby="theme-picker-title"
      aria-describedby="theme-picker-description theme-picker-active"
      tabindex="-1"
      class="modal-card modal-3d w-full max-w-2xl max-h-[calc(100dvh-2rem)] flex flex-col rounded-[5px] border shadow-2xl overflow-hidden glass-frost-strong"
      style="border-color: var(--theme-modal-border, var(--color-border)); color: var(--theme-text); box-shadow: var(--theme-modal-shadow, var(--shadow-3d)); {themeState.currentMode === 'dark' ? 'background: linear-gradient(180deg, color-mix(in srgb, var(--theme-gradient-1, var(--theme-grad-1)) 22%, var(--color-surface)) 0%, color-mix(in srgb, var(--theme-gradient-2, var(--theme-grad-2)) 14%, var(--color-surface)) 45%, color-mix(in srgb, var(--theme-gradient-3, var(--theme-grad-3)) 18%, var(--color-card-bg)) 100%), radial-gradient(ellipse at top left, color-mix(in srgb, var(--theme-gradient-4, var(--theme-grad-4)) 25%, transparent) 0%, transparent 70%);' : ''}"
    >
      <div class="h-1 w-full shrink-0 animate-gradient-flow" style="background: var(--theme-4gradient-bar);" aria-hidden="true"></div>

      <!-- Header -->
      <div class="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b theme-border">
        <div class="min-w-0">
          <h3 id="theme-picker-title" class="text-sm font-bold tracking-tight theme-text">
            Konoha 4-Gradient Theme Palette
          </h3>
          <p id="theme-picker-description" class="text-[11px] mt-0.5 theme-text-secondary">
            10 Light-Mode calibrated palettes with 4-stop vibrant gradients
          </p>
          <p id="theme-picker-active" class="text-[11px] mt-0.5 truncate theme-text-secondary">
            Active category: {activeTheme?.category} · {themeState.currentMode === 'dark' ? 'Dark' : 'Light'} appearance
          </p>
        </div>
        <button
          type="button"
          onclick={closeModal}
          class="relative w-8 h-8 shrink-0 rounded-[5px] flex items-center justify-center border transition-colors hover:brightness-110 cursor-pointer theme-bg-surface theme-border theme-text"
          aria-label="Close theme modal"
        >
          <span class="sr-only" aria-live="polite" aria-atomic="true">{liveMessage}</span>
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Search & Category Filter Bar -->
      <div class="px-5 pt-3 pb-2.5 border-b theme-border flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
        <div class="relative flex-1">
          <svg class="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 theme-text-secondary pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="search"
            bind:value={searchQuery}
            placeholder="Search 10 palettes (Byakugan, Hokage, Emerald)..."
            class="w-full pl-8 pr-7 py-1.5 rounded-[4px] text-xs border theme-bg-surface theme-border theme-text placeholder:theme-text-secondary focus:outline-none focus:ring-1 focus:ring-[var(--theme-focus)]"
            aria-label="Search theme palettes"
          />
          {#if searchQuery}
            <button
              type="button"
              onclick={() => { searchQuery = ''; }}
              class="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs opacity-60 hover:opacity-100 theme-text cursor-pointer"
              aria-label="Clear search input"
            >
              ✕
            </button>
          {/if}
        </div>
        <div role="tablist" aria-label="Theme categories" class="flex items-center gap-1 overflow-x-auto pb-0.5 sm:pb-0">
          {#each categories as cat}
            {@const count = cat === 'All' ? themeState.themes.length : themeState.themes.filter(t => t.category === cat).length}
            {@const isSel = selectedCategory === cat}
            <button
              type="button"
              role="tab"
              aria-selected={isSel}
              onclick={() => { selectedCategory = cat; }}
              class="px-2 py-1 rounded-[4px] text-[11px] font-semibold whitespace-nowrap transition-all cursor-pointer border {isSel ? 'theme-bg-surface theme-border-hover font-bold theme-text' : 'border-transparent theme-text-secondary hover-bg-subtle'}"
            >
              {cat} <span class="text-[9px] opacity-75 font-mono">({count})</span>
            </button>
          {/each}
        </div>
      </div>

      <!-- Palettes grouped by category -->
      <div class="flex-1 overflow-y-auto px-5 py-4 space-y-4" role="group" aria-label="Theme palettes">
        {#if displayedGroups.every(g => g.themes.length === 0)}
          <div class="py-8 text-center theme-text-secondary text-xs">
            No theme palettes match "{searchQuery}" in {selectedCategory}.
          </div>
        {/if}
        {#each displayedGroups as group (group.category)}
          {#if group.themes.length > 0}
            <section aria-labelledby={`theme-group-${group.category.replace(/\s+/g, '-').toLowerCase()}`}>
              <h4 id={`theme-group-${group.category.replace(/\s+/g, '-').toLowerCase()}`} class="text-[10px] font-black uppercase tracking-widest mb-2 theme-text-secondary flex items-center justify-between">
                <span>{group.category}</span>
                <span class="text-[9px] font-mono opacity-60 font-normal">{group.themes.length} palette{group.themes.length > 1 ? 's' : ''}</span>
              </h4>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {#each group.themes as t (t.id)}
                  {@const isCurrent = themeState.currentTheme === t.id}
                  <button
                    type="button"
                    data-theme-id={t.id}
                    aria-pressed={isCurrent}
                    aria-label={`${t.name}${isCurrent ? ' (active)' : ''}`}
                    class="w-full flex items-center gap-3 p-2.5 rounded-[5px] border text-left transition-all duration-150 hover:scale-[1.01] cursor-pointer {isCurrent ? 'theme-bg-muted theme-border-hover active-palette' : 'theme-bg-surface hover-bg-muted theme-border'}"
                    onclick={() => selectTheme(t.id)}
                  >
                    <span class="relative w-9 h-9 shrink-0 rounded-[5px] border border-black/15 shadow-sm" style="background: {themeGradient(t)};" aria-hidden="true">
                      {#if isCurrent}
                        <span class="absolute inset-0 flex items-center justify-center">
                          <svg class="w-4 h-4 drop-shadow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="color: var(--theme-text-inverse);">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        </span>
                      {/if}
                    </span>
                    <span class="flex flex-col min-w-0 flex-1">
                      <span class="flex items-center gap-1.5">
                        <span class="text-xs font-bold truncate theme-text">{t.name}</span>
                        <span class="text-[9px] px-1 py-0.2 rounded font-mono opacity-60 theme-bg-muted theme-border border">{t.category}</span>
                        {#if isCurrent}
                          <span class="text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 gradient-badge">Active</span>
                        {/if}
                      </span>
                      <span class="text-[10px] leading-snug line-clamp-2 theme-text-secondary">{t.description}</span>
                      <span class="flex items-center gap-1 pt-1.5" aria-hidden="true">
                        {#each t.gradient as stop, sIdx}
                          <span class="w-3.5 h-1.5 rounded-[2px] border border-black/10" style="background-color: {stop};" title={`Stop ${sIdx + 1}: ${stop}`}></span>
                        {/each}
                      </span>
                    </span>
                  </button>
                {/each}
              </div>
            </section>
          {/if}
        {/each}
      </div>

      <!-- Footer with token summary & keyboard instructions -->
      <div class="px-5 py-2.5 border-t flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono theme-border theme-text-secondary">
        <span><kbd class="px-1 py-0.5 rounded border theme-bg-surface theme-border">Esc</kbd> close · <kbd class="px-1 py-0.5 rounded border theme-bg-surface theme-border">↑</kbd><kbd class="px-1 py-0.5 rounded border theme-bg-surface theme-border">↓</kbd> navigate</span>
        <div class="flex items-center gap-3">
          <button
            type="button"
            onclick={resetToDefault}
            class="px-2 py-0.5 rounded-[4px] text-[10px] font-semibold border transition-all cursor-pointer theme-bg-surface theme-border hover-bg-muted theme-text flex items-center gap-1"
            title="Restore default Byakugan Light theme"
          >
            <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>Reset Default</span>
          </button>
          <span>{themeState.themes.length} palettes · 4 stops each</span>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .active-palette {
    box-shadow: 0 0 0 2px var(--theme-focus);
  }
</style>
