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
    <!-- Authentic Swirling Rasengan Chakra Orb Icon with Orbiting Lightning Bolt -->
    <div class="relative w-8 h-8 flex items-center justify-center">
      <!-- Outer Pulsing Chakra Glow Halo -->
      <span class="absolute inset-0 rounded-full bg-cyan-400/35 blur-[3px] animate-pulse-rasengan"></span>

      <!-- Orbiting Electric Lightning Bolt Layer 1 (Clockwise) -->
      <div class="absolute inset-[-4px] animate-orbit-lightning pointer-events-none z-20">
        <svg class="w-full h-full animate-lightning-flicker" viewBox="0 0 40 40" fill="none">
          <!-- Top Orbiting Lightning Bolt -->
          <path
            d="M20 2 L22 8 L18.5 9 L21.5 15 L16 8.5 L19.5 8 Z"
            fill="#38bdf8"
            stroke="#ffffff"
            stroke-width="0.5"
            stroke-linejoin="round"
          />
          <!-- Bottom Orbiting Lightning Spark -->
          <path
            d="M20 38 L18 32 L21.5 31 L18.5 25 L24 31.5 L20.5 32 Z"
            fill="#7dd3fc"
            stroke="#ffffff"
            stroke-width="0.5"
            stroke-linejoin="round"
          />
        </svg>
      </div>

      <!-- Orbiting Electric Lightning Bolt Layer 2 (Counter-Clockwise) -->
      <div class="absolute inset-[-6px] animate-orbit-lightning-reverse pointer-events-none z-20">
        <svg class="w-full h-full animate-lightning-flicker" viewBox="0 0 44 44" fill="none">
          <!-- Left Orbiting Electric Arc -->
          <path
            d="M4 22 L10 20 L9 23.5 L15 20.5 L8.5 26 L8 22.5 Z"
            fill="#ffffff"
            stroke="#38bdf8"
            stroke-width="0.6"
            stroke-linejoin="round"
          />
          <!-- Right Orbiting Electric Arc -->
          <path
            d="M40 22 L34 24 L35 20.5 L29 23.5 L35.5 18 L36 21.5 Z"
            fill="#bae6fd"
            stroke="#0284c7"
            stroke-width="0.6"
            stroke-linejoin="round"
          />
        </svg>
      </div>

      <!-- Central Always-Spinning Rasengan Core SVG -->
      <svg class="w-8 h-8 relative z-10 group-hover:scale-110 transition-transform" viewBox="0 0 100 100" fill="none">
        <defs>
          <radialGradient id="rasengan-outer-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#ffffff" stop-opacity="1" />
            <stop offset="35%" stop-color="#38bdf8" stop-opacity="0.9" />
            <stop offset="70%" stop-color="#0284c7" stop-opacity="0.6" />
            <stop offset="100%" stop-color="#0369a1" stop-opacity="0" />
          </radialGradient>
          <radialGradient id="rasengan-core-sphere" cx="40%" cy="38%" r="48%">
            <stop offset="0%" stop-color="#ffffff" />
            <stop offset="45%" stop-color="#7dd3fc" />
            <stop offset="85%" stop-color="#0284c7" />
            <stop offset="100%" stop-color="#0369a1" />
          </radialGradient>
          <linearGradient id="rasengan-chakra-stream" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#ffffff" />
            <stop offset="50%" stop-color="#38bdf8" />
            <stop offset="100%" stop-color="#0284c7" />
          </linearGradient>
        </defs>

        <!-- Spherical Base Orb with Depth -->
        <circle cx="50" cy="50" r="44" fill="url(#rasengan-outer-glow)" opacity="0.85" />

        <!-- Outer Rapid Clockwise Spiral Filaments -->
        <g class="animate-spin-rasengan">
          <path d="M50 8 C68 12, 88 28, 92 50 C94 65, 84 82, 68 90 C52 96, 30 92, 18 78 C8 66, 8 45, 18 32 C28 18, 42 12, 50 14" stroke="url(#rasengan-chakra-stream)" stroke-width="3" stroke-linecap="round" fill="none" opacity="0.9" />
          <path d="M50 18 C62 20, 78 32, 80 48 C82 60, 74 74, 62 80 C50 84, 34 80, 26 70 C18 60, 20 44, 28 34 C36 24, 45 20, 50 20" stroke="#bae6fd" stroke-width="2.5" stroke-linecap="round" fill="none" opacity="0.95" />
          <path d="M50 28 C58 30, 68 38, 70 48 C72 58, 64 68, 54 70 C44 72, 34 66, 30 56 C26 48, 32 38, 40 32 C45 28, 48 28, 50 28" stroke="#ffffff" stroke-width="2" stroke-linecap="round" fill="none" />
        </g>

        <!-- Inner Counter-Clockwise Spiral Chakra Filaments -->
        <g class="animate-spin-rasengan-reverse">
          <path d="M50 92 C32 88, 12 72, 8 50 C6 35, 16 18, 32 10 C48 4, 70 8, 82 22 C92 34, 92 55, 82 68 C72 82, 58 88, 50 86" stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round" fill="none" opacity="0.8" />
          <path d="M50 82 C38 80, 22 68, 20 52 C18 40, 26 26, 38 20 C50 16, 66 20, 74 30 C82 40, 80 56, 72 66 C64 76, 55 80, 50 80" stroke="#ffffff" stroke-width="2" stroke-linecap="round" fill="none" opacity="0.9" />
        </g>

        <!-- Whirling High-Density Micro-Vortex Trails -->
        <g class="animate-spin-rasengan-fast">
          <path d="M50 36 C55 36, 62 42, 62 50 C62 56, 56 62, 50 62 C44 62, 38 56, 38 50 C38 43, 44 38, 50 36" stroke="#e0f2fe" stroke-width="2.5" stroke-linecap="round" fill="none" />
          <circle cx="50" cy="50" r="11" fill="url(#rasengan-core-sphere)" class="animate-pulse-rasengan" />
          <circle cx="47" cy="46" r="4" fill="#ffffff" opacity="0.95" />
        </g>
      </svg>
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
