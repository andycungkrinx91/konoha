<script>
  import { themeState, groupThemes } from '../lib/state/themeState.svelte.js';
  import { useScrollLock } from '#lib/scrollLock.svelte.js';

  const TRANSITION_MS = 2000; // existing 2-second theme transition — preserved

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

  const groups = groupThemes();

  let isModalOpen = $state(false);
  let isRasenganActive = $state(false);
  let liveMessage = $state('');
  let dialogEl = $state(null);
  let impactTimer = null;
  let liveTimer = null;
  let themeCanvasEl = $state(null);
  let themeRasenganScene = null;

  useScrollLock(() => isModalOpen);

  const activeTheme = $derived(
    themeState.themes.find(t => t.id === themeState.currentTheme) || themeState.themes[0]
  );

  function themeGradient(t) {
    return t.gradient && t.gradient.length >= 4
      ? `linear-gradient(135deg, ${t.gradient[0]} 0%, ${t.gradient[1]} 33%, ${t.gradient[2]} 66%, ${t.gradient[3]} 100%)`
      : `linear-gradient(135deg, ${t.color}, ${t.accent})`;
  }

  $effect(() => {
    if (isRasenganActive && themeCanvasEl) {
      const palette = activeTheme.gradient && activeTheme.gradient.length >= 4
        ? [activeTheme.gradient[0], activeTheme.gradient[1], activeTheme.gradient[2], activeTheme.gradient[3], activeTheme.accent]
        : [activeTheme.color, activeTheme.accent, activeTheme.color, activeTheme.accent, activeTheme.color];

      let disposed = false;

      import('#lib/RasenganScene.js')
        .then(({ RasenganScene }) => {
          if (disposed || !isRasenganActive || !themeCanvasEl) return;
          themeRasenganScene = new RasenganScene(themeCanvasEl, {
            colors: palette,
            phaseDuration: TRANSITION_MS / 1000,
            transparent: true,
            bloom: true
          });
          themeRasenganScene.playImpact();
        })
        .catch(() => {
          // WebGL unavailable — the CSS shatter flash still marks the change.
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
    if (lastFocused && typeof lastFocused.focus === 'function') {
      lastFocused.focus();
      lastFocused = null;
    }
  }

  function selectTheme(id) {
    closeModal();
    themeState.applyTheme(id);
    announce(`Theme changed to ${themeState.themes.find(t => t.id === id)?.name || id}`);

    if (impactTimer) clearTimeout(impactTimer);
    isRasenganActive = true;
    impactTimer = setTimeout(() => {
      isRasenganActive = false;
      impactTimer = null;
    }, TRANSITION_MS);
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

  // Announced via the close button's live region (buttons are not landmark
  // descendants), so screen readers receive the change exactly once.
  function announce(message) {
    if (liveTimer) clearTimeout(liveTimer);
    liveMessage = '';
    liveTimer = setTimeout(() => {
      liveMessage = message;
      liveTimer = null;
    }, 50);
  }

  // Remember what had focus so closing the dialog returns the user there.
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

<!-- 2-Second Procedural 3D Rasengan Theme Transition Overlay -->
{#if isRasenganActive}
  <div class="fixed inset-0 z-[9999] pointer-events-none overflow-hidden flex items-center justify-center" aria-hidden="true">
    <div class="absolute inset-0 animate-shatter-flash"></div>
    <div class="relative w-80 h-80 sm:w-96 sm:h-96 flex items-center justify-center animate-huge-rasengan z-20">
      <canvas bind:this={themeCanvasEl} class="w-full h-full rounded-full"></canvas>
    </div>
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
      style="border-color: var(--theme-modal-border, var(--color-border)); color: var(--theme-text); box-shadow: var(--theme-modal-shadow, var(--shadow-3d));"
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
            {activeTheme?.category} · {themeState.currentMode === 'dark' ? 'Dark' : 'Light'} appearance
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

      <!-- Appearance Mode Selector -->
      <div class="flex items-center justify-between gap-3 px-5 py-3 border-b theme-border">
        <div class="flex items-center gap-2 min-w-0">
          <span class="text-xs font-bold theme-text">Appearance Mode</span>
          <span class="text-[10px] px-1.5 py-0.5 rounded-[4px] font-mono border theme-bg-muted theme-border theme-text-secondary">
            {themeState.currentMode === 'dark' ? 'Dark' : 'Light (Default)'}
          </span>
        </div>
        <div role="group" aria-label="Appearance mode" class="flex items-center gap-1 p-0.5 rounded-[5px] border theme-bg-muted theme-border">
          {#each MODES as m (m.id)}
            {@const isActive = themeState.currentMode === m.id}
            <button
              type="button"
              class="px-2.5 py-1 rounded-[4px] text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer border {isActive ? 'theme-bg-surface theme-text theme-border-hover font-bold' : 'border-transparent theme-text-secondary hover-bg-subtle hover:theme-text'}"
              onclick={() => selectMode(m.id)}
              aria-label={m.aria}
              aria-pressed={isActive}
            >
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d={m.icon} />
              </svg>
              <span>{m.label}</span>
            </button>
          {/each}
        </div>
      </div>

      <!-- Palettes grouped by category -->
      <div class="flex-1 overflow-y-auto px-5 py-4 space-y-4" role="group" aria-label="Theme palettes">
        {#each groups as group (group.category)}
          <section aria-labelledby={`theme-group-${group.category.replace(/\s+/g, '-').toLowerCase()}`}>
            <h4 id={`theme-group-${group.category.replace(/\s+/g, '-').toLowerCase()}`} class="text-[10px] font-black uppercase tracking-widest mb-2 theme-text-secondary">
              {group.category}
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
                  <span class="relative w-9 h-9 shrink-0 rounded-[5px] border-black/15 shadow-sm" style="background: {themeGradient(t)};" aria-hidden="true">
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
                      {#if isCurrent}
                        <span class="text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 gradient-badge">Active</span>
                      {/if}
                    </span>
                    <span class="text-[10px] leading-snug line-clamp-2 theme-text-secondary">{t.description}</span>
                    <span class="flex items-center gap-1 pt-1.5" aria-hidden="true">
                      {#each t.gradient as stop}
                        <span class="w-3 h-1.5 rounded-[2px]" style="background-color: {stop};"></span>
                      {/each}
                    </span>
                  </span>
                </button>
              {/each}
            </div>
          </section>
        {/each}
      </div>

      <div class="px-5 py-2.5 border-t flex items-center justify-between text-[10px] font-mono theme-border theme-text-secondary">
        <span>Esc to close</span>
        <span>{themeState.themes.length} palettes · 4 stops each</span>
      </div>
    </div>
  </div>
{/if}

<style>
  .active-palette {
    box-shadow: 0 0 0 1.5px var(--theme-focus);
  }
</style>
