<script>
  import { themeState, THEMES } from '../lib/state/themeState.svelte.js';
  import { useScrollLock } from '#lib/scrollLock.svelte.js';

  let isModalOpen = $state(false);
  let isRasenganImpact = $state(false);
  let impactCountdown = $state(10);
  let impactTimer = null;
  let countdownInterval = null;

  useScrollLock(() => isModalOpen);

  function selectTheme(id) {
    themeState.applyTheme(id);
    isModalOpen = false;

    // Trigger full 3D Wall Got Hit by Rasengan Impact effect for 10s
    if (impactTimer) clearTimeout(impactTimer);
    if (countdownInterval) clearInterval(countdownInterval);

    isRasenganImpact = true;
    impactCountdown = 10;

    countdownInterval = setInterval(() => {
      if (impactCountdown > 1) {
        impactCountdown -= 1;
      } else {
        clearInterval(countdownInterval);
      }
    }, 1000);

    if (typeof document !== 'undefined') {
      const rootStage = document.getElementById('konoha-app-root') || document.body;
      rootStage.classList.remove('rasengan-wall-hit-active');
      void rootStage.offsetWidth; // Reflow to restart animation
      rootStage.classList.add('rasengan-wall-hit-active');
    }

    impactTimer = setTimeout(() => {
      isRasenganImpact = false;
      if (countdownInterval) clearInterval(countdownInterval);
      if (typeof document !== 'undefined') {
        const rootStage = document.getElementById('konoha-app-root') || document.body;
        rootStage.classList.remove('rasengan-wall-hit-active');
      }
    }, 10000);
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
<div class="fixed bottom-20 right-5 lg:bottom-6 lg:right-6 z-50 mb-[2em]" style="margin-bottom: 2em;">
  <button
    type="button"
    onclick={toggleModal}
    class="w-12 h-12 rounded-full border shadow-2xl flex items-center justify-center transition-all duration-300 hover:scale-115 active:scale-95 cursor-pointer group glass-frost"
    style="background-color: var(--color-surface); border-color: var(--color-border); color: var(--color-primary); box-shadow: var(--shadow-3d);"
    title="Switch Theme ({themeState.currentTheme.replace('-', ' ')}) — Rasengan Theme Selector"
    aria-label="Toggle Theme Selection Modal"
  >
    <!-- Authentic Swirling Rasengan Chakra Orb Icon -->
    <div class="relative w-8 h-8 flex items-center justify-center">
      <!-- Outer Pulsing Chakra Glow Halo -->
      <span class="absolute inset-0 rounded-full bg-cyan-400/35 blur-[3px] animate-pulse-rasengan"></span>
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

<!-- 10-Second 3D Rasengan Impact Wall Hit Effect Overlay -->
{#if isRasenganImpact}
  <!-- Full-Screen 3D Rasengan Impact Overlay (10s Lifespan) -->
  <div
    class="fixed inset-0 z-[9999] pointer-events-none overflow-hidden flex items-center justify-center animate-rasengan-crater"
    aria-hidden="true"
  >
    <!-- Sudden Shock Flash -->
    <div class="absolute inset-0 bg-cyan-400/20 backdrop-blur-[2px] transition-opacity duration-1000"></div>

    <!-- Massive SVG 3D Wall Crater, Fracture Fissures & Spiral Chakra Vortex -->
    <svg class="w-full h-full max-w-[1400px] max-h-[1400px] relative z-10" viewBox="0 0 1000 1000" fill="none">
      <defs>
        <!-- Intense Radial Chakra Blast Glow -->
        <radialGradient id="crater-depth-core" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#0284c7" stop-opacity="0.95" />
          <stop offset="20%" stop-color="#0369a1" stop-opacity="0.85" />
          <stop offset="45%" stop-color="#0f172a" stop-opacity="0.7" />
          <stop offset="70%" stop-color="#0284c7" stop-opacity="0.25" />
          <stop offset="100%" stop-color="transparent" stop-opacity="0" />
        </radialGradient>
        <radialGradient id="crater-electric-burst" cx="50%" cy="50%" r="40%">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="1" />
          <stop offset="25%" stop-color="#7dd3fc" stop-opacity="0.9" />
          <stop offset="60%" stop-color="#0284c7" stop-opacity="0.5" />
          <stop offset="100%" stop-color="transparent" stop-opacity="0" />
        </radialGradient>
        <filter id="fissure-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <!-- Center Crater Indentation Shadow -->
      <circle cx="500" cy="500" r="320" fill="url(#crater-depth-core)" />
      <circle cx="500" cy="500" r="140" fill="url(#crater-electric-burst)" class="animate-pulse-rasengan" />

      <!-- Concentric Shockwave Ellipses Radiating from Impact Center -->
      <ellipse cx="500" cy="500" rx="420" ry="380" stroke="#38bdf8" stroke-width="2.5" stroke-dasharray="16 12" opacity="0.6" />
      <ellipse cx="500" cy="500" rx="340" ry="300" stroke="#7dd3fc" stroke-width="3" stroke-dasharray="24 16" opacity="0.75" />
      <ellipse cx="500" cy="500" rx="220" ry="190" stroke="#ffffff" stroke-width="3.5" stroke-dasharray="12 8" opacity="0.85" />

      <!-- Major Radial Wall Fracture Fissures Blasting Outward into 4 Quadrants -->
      <!-- Top-Left Fissure -->
      <path
        d="M500 500 L440 390 L390 340 L340 360 L280 270 L210 230 L160 160 L90 120 L20 40 M390 340 L410 270 L360 210 L320 120 M280 270 L240 310 L180 290"
        stroke="#38bdf8" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" filter="url(#fissure-glow)" opacity="0.95"
      />
      <path
        d="M500 500 L440 390 L390 340 L340 360 L280 270 L210 230 L160 160 L90 120 L20 40"
        stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"
      />

      <!-- Top-Right Fissure -->
      <path
        d="M500 500 L570 410 L640 350 L610 280 L690 220 L760 180 L840 110 L920 40 M640 350 L710 370 L790 320 M690 220 L660 150 L720 90"
        stroke="#38bdf8" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" filter="url(#fissure-glow)" opacity="0.95"
      />
      <path
        d="M500 500 L570 410 L640 350 L610 280 L690 220 L760 180 L840 110 L920 40"
        stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"
      />

      <!-- Bottom-Left Fissure -->
      <path
        d="M500 500 L430 590 L360 650 L390 720 L310 800 L240 850 L150 920 L50 980 M360 650 L290 640 L210 690 M310 800 L340 880 L290 940"
        stroke="#38bdf8" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" filter="url(#fissure-glow)" opacity="0.95"
      />
      <path
        d="M500 500 L430 590 L360 650 L390 720 L310 800 L240 850 L150 920 L50 980"
        stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"
      />

      <!-- Bottom-Right Fissure -->
      <path
        d="M500 500 L580 590 L650 670 L600 740 L690 810 L770 870 L870 930 L960 970 M650 670 L730 670 L800 720 M690 810 L670 890 L730 960"
        stroke="#38bdf8" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" filter="url(#fissure-glow)" opacity="0.95"
      />
      <path
        d="M500 500 L580 590 L650 670 L600 740 L690 810 L770 870 L870 930 L960 970"
        stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"
      />

      <!-- Dense High-Velocity Spiral Chakra Vortex Arms in Crater -->
      <g class="animate-spin-rasengan-fast" style="transform-origin: 500px 500px;">
        <path d="M500 500 Q 580 420, 680 460 T 820 620" stroke="#38bdf8" stroke-width="8" stroke-linecap="round" fill="none" opacity="0.85" filter="url(#fissure-glow)" />
        <path d="M500 500 Q 420 580, 320 540 T 180 380" stroke="#38bdf8" stroke-width="8" stroke-linecap="round" fill="none" opacity="0.85" filter="url(#fissure-glow)" />
        <path d="M500 500 Q 420 420, 460 320 T 620 180" stroke="#7dd3fc" stroke-width="7" stroke-linecap="round" fill="none" opacity="0.85" filter="url(#fissure-glow)" />
        <path d="M500 500 Q 580 580, 540 680 T 380 820" stroke="#7dd3fc" stroke-width="7" stroke-linecap="round" fill="none" opacity="0.85" filter="url(#fissure-glow)" />
      </g>

      <g class="animate-spin-rasengan-reverse" style="transform-origin: 500px 500px;">
        <path d="M500 500 Q 620 480, 720 380 T 800 240" stroke="#ffffff" stroke-width="5" stroke-linecap="round" fill="none" opacity="0.9" />
        <path d="M500 500 Q 380 520, 280 620 T 200 760" stroke="#ffffff" stroke-width="5" stroke-linecap="round" fill="none" opacity="0.9" />
      </g>
    </svg>

    <!-- Tactical Chakra HUD Banner -->
    <div class="absolute bottom-10 inset-x-0 flex items-center justify-center">
      <div class="px-5 py-2.5 rounded-2xl glass-frost-strong border border-cyan-400/50 shadow-2xl flex items-center gap-3 backdrop-blur-md animate-bounce">
        <span class="w-3 h-3 rounded-full bg-cyan-400 animate-ping"></span>
        <span class="font-mono text-xs font-black tracking-wider text-cyan-600 dark:text-cyan-300 uppercase">
          ⚡ 3D RASENGAN WALL IMPACT // REPAIRING MATRIX IN {impactCountdown}s
        </span>
      </div>
    </div>
  </div>
{/if}

<!-- Shared Full Popup Modal (Fixed Center Overlay for Both Desktop & Mobile) -->
{#if isModalOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/35 backdrop-blur-sm animate-in fade-in duration-150"
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
