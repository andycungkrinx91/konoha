<script>
  import { themeState, THEMES } from '../lib/state/themeState.svelte.js';
  import { useScrollLock } from '#lib/scrollLock.svelte.js';

  let isModalOpen = $state(false);
  let isRasenganActive = $state(false);
  let impactTimer = null;
  let themeCanvasEl = $state(null);
  let themeRasenganScene = null;

  useScrollLock(() => isModalOpen);

  $effect(() => {
    if (isRasenganActive && themeCanvasEl) {
      const activeThemeObj = THEMES.find(t => t.id === themeState.currentTheme);
      const palette = activeThemeObj?.gradient && activeThemeObj.gradient.length >= 4
        ? [activeThemeObj.gradient[0], activeThemeObj.gradient[1], activeThemeObj.gradient[2], activeThemeObj.gradient[3], activeThemeObj.accent]
        : ['#38bdf8', '#818cf8', '#06b6d4', '#38bdf8', '#0284c7'];

      let disposed = false;

      import('#lib/RasenganScene.js')
        .then(({ RasenganScene }) => {
          if (disposed || !isRasenganActive || !themeCanvasEl) return;
          themeRasenganScene = new RasenganScene(themeCanvasEl, {
            colors: palette,
            phaseDuration: 2.0,
            transparent: true,
            bloom: true
          });
          themeRasenganScene.playImpact();
        })
        .catch(err => {
          console.warn('Three.js ThemeSwitcher dynamic import fallback:', err);
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

  function selectTheme(id) {
    isModalOpen = false;

    // Apply the chosen theme
    themeState.applyTheme(id);

    // Trigger 2-Second Procedural 3D Rasengan Animation
    if (impactTimer) clearTimeout(impactTimer);

    isRasenganActive = true;

    impactTimer = setTimeout(() => {
      isRasenganActive = false;
    }, 2000);
  }

  function toggleModal() {
    isModalOpen = !isModalOpen;
  }

  function handleModalKeydown(e) {
    if (e.key === 'Escape' && isModalOpen) isModalOpen = false;
  }
</script>

<svelte:window onkeydown={handleModalKeydown} />

<!-- Floating Bottom-Right Theme Switcher Button (FAB) with Rasengan Icon -->
<div class="fixed bottom-6 right-6 z-[100] pointer-events-auto">
  <button
    type="button"
    onclick={toggleModal}
    class="w-12 h-12 rounded-full border shadow-2xl flex items-center justify-center transition-all duration-300 hover:scale-115 active:scale-95 cursor-pointer group glass-frost"
    style="background-color: var(--color-surface); border-color: var(--color-border); color: var(--color-primary); box-shadow: var(--shadow-3d);"
    title="Switch Theme ({themeState.currentTheme.replace('-', ' ')}) — Rasengan Theme Selector"
    aria-label="Toggle Theme Selection Modal"
  >
    <!-- Sleek 3D Chakra Palette Orb Icon -->
    <div class="relative w-8 h-8 flex items-center justify-center">
      <span class="absolute inset-0 rounded-full blur-[4px] transition-all duration-300" style="background: var(--theme-4gradient, linear-gradient(135deg, #38bdf8, #818cf8)); opacity: 0.6;"></span>
      <div
        class="w-7 h-7 rounded-full border flex items-center justify-center shadow-md transition-transform duration-300 group-hover:scale-110"
        style="background: var(--theme-4gradient, linear-gradient(135deg, #38bdf8, #818cf8)); border-color: rgba(255, 255, 255, 0.4);"
      >
        <svg class="w-3.5 h-3.5 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
        </svg>
      </div>
    </div>
  </button>
</div>

<!-- 2-Second Procedural 3D Three.js Rasengan Theme Transition Overlay -->
{#if isRasenganActive}
  <div
    class="fixed inset-0 z-[9999] pointer-events-none overflow-hidden flex items-center justify-center"
    aria-hidden="true"
  >
    <!-- Optical Refraction Backdrop Blur & Ambient Vignette -->
    <div class="absolute inset-0 bg-slate-950/40 backdrop-blur-[3px] transition-opacity duration-300"></div>

    <!-- Final Glass Shatter White Flash -->
    <div class="absolute inset-0 animate-shatter-flash pointer-events-none"></div>

    <!-- 3D Three.js Procedural Rasengan in Center Stage -->
    <div class="relative w-80 h-80 sm:w-96 sm:h-96 flex items-center justify-center animate-huge-rasengan z-20 pointer-events-none">
      <canvas
        bind:this={themeCanvasEl}
        class="w-full h-full rounded-full"
        aria-label="Interactive 3D Three.js Rasengan Canvas"
      ></canvas>
    </div>
  </div>
{/if}

<!-- Shared Full Popup Modal (Fixed Center Overlay for Both Desktop & Mobile) -->
{#if isModalOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/35 backdrop-blur-sm animate-in fade-in duration-150"
    onclick={() => isModalOpen = false}
  >
    <!-- Centered Modal Popup Dialog with 3D 4-Color Gradient Engine -->
    <div
      class="modal-card modal-3d w-full max-w-lg p-6 rounded-[5px] border shadow-2xl space-y-4 animate-in zoom-in-95 duration-150 glass-frost-strong"
      style="border-color: var(--theme-modal-border, color-mix(in srgb, var(--theme-grad-1) 38%, var(--color-border))); color: var(--color-text); box-shadow: var(--theme-modal-shadow, var(--shadow-3d));"
      onclick={(e) => e.stopPropagation()}
    >
      <!-- Header -->
      <div class="flex items-center justify-between pb-3 border-b" style="border-color: var(--color-border);">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-[5px] flex items-center justify-center border animate-gradient-flow" style="background: var(--theme-4gradient, linear-gradient(135deg, var(--color-primary), var(--color-accent))); border-color: var(--color-primary); color: #ffffff;">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
            </svg>
          </div>
          <div>
            <h3 class="text-sm font-bold tracking-tight" style="color: var(--color-text);">Konoha 4-Gradient Theme Palette</h3>
            <p class="text-[11px]" style="color: var(--color-text-muted);">10 Light-Mode calibrated palettes with 4-stop vibrant gradients</p>
          </div>
        </div>
        <button
          type="button"
          onclick={() => isModalOpen = false}
          class="w-7 h-7 rounded-[5px] flex items-center justify-center text-xs font-bold border transition-colors hover:scale-105 cursor-pointer"
          style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text-muted);"
          aria-label="Close theme modal"
        >
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Luminous Gradient Accent Flow Strip -->
      <div class="h-1 w-full rounded-full animate-gradient-flow" style="background: var(--theme-4gradient-bar);"></div>

      <!-- 10 Themes Grid (2 Columns) -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-[60vh] overflow-y-auto pr-1">
        {#each THEMES as t}
          {@const isCurrent = themeState.currentTheme === t.id}
          {@const gradBg = t.gradient ? `linear-gradient(135deg, ${t.gradient[0]} 0%, ${t.gradient[1]} 33%, ${t.gradient[2]} 66%, ${t.gradient[3]} 100%)` : `linear-gradient(135deg, ${t.color}, ${t.accent})`}
          <button
            type="button"
            class="w-full flex items-center gap-3 p-3 rounded-[5px] border text-left transition-all duration-150 hover:scale-[1.02] cursor-pointer"
            style="{isCurrent
              ? 'border-color: var(--color-primary); background-color: var(--color-primary-glow); box-shadow: 0 0 0 1.5px var(--color-primary);'
              : 'border-color: var(--color-border); background-color: var(--color-surface);'}"
            onclick={() => selectTheme(t.id)}
          >
            <div class="relative shrink-0">
              <span class="w-8 h-8 rounded-[5px] flex items-center justify-center shadow-md border border-black/10" style="background: {gradBg};">
                {#if isCurrent}
                  <span class="w-2.5 h-2.5 rounded-full bg-white shadow-sm ring-1 ring-black/20"></span>
                {/if}
              </span>
            </div>
            <div class="flex flex-col min-w-0 flex-1">
              <div class="flex items-center justify-between gap-1">
                <span class="text-xs font-black truncate" style="color: var(--color-text);">{t.name}</span>
                {#if isCurrent}
                  <span class="text-[10px] font-bold px-2 py-0.5 rounded-full gradient-badge shrink-0">Active</span>
                {/if}
              </div>
              <span class="text-[10px] truncate" style="color: var(--color-text-muted);">{t.description}</span>
              {#if t.gradient}
                <div class="flex items-center gap-1 pt-1.5">
                  {#each t.gradient as colorHex}
                    <span class="w-2.5 h-2 rounded-[2px] shadow-xs" style="background-color: {colorHex};"></span>
                  {/each}
                </div>
              {/if}
            </div>
          </button>
        {/each}
      </div>
    </div>
  </div>
{/if}
