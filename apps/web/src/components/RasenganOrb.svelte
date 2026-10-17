<script>
  import { onMount } from 'svelte';
  import { themeState } from '#lib/state/themeState.svelte.js';

  let reducedMotion = $state(false);

  const isDark = $derived(themeState.currentMode === 'dark');

  onMount(() => {
    const motionQuery = typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
    reducedMotion = Boolean(motionQuery?.matches);
    const onMotionChange = (ev) => { reducedMotion = ev.matches; };
    motionQuery?.addEventListener?.('change', onMotionChange);
    return () => {
      motionQuery?.removeEventListener?.('change', onMotionChange);
    };
  });
</script>

<div
  class="relative flex items-center justify-center p-1 rounded-[5px] select-none pointer-events-auto"
  title="3D Rasengan — {isDark ? 'Dark Mode (Electric Blue Chakra)' : 'Light Mode (Crimson Red Chakra)'}"
  aria-label="3D Rasengan Chakra Sphere ({isDark ? 'Electric Blue' : 'Crimson Red'})"
  role="img"
>
  <div
    class="relative w-9 h-9 rounded-full flex items-center justify-center transition-all duration-300"
    style="box-shadow: {isDark ? '0 0 16px rgba(14, 165, 233, 0.45)' : '0 0 16px rgba(239, 68, 68, 0.4)'};"
  >
    <!-- Outer ambient chakra glow ring -->
    <span
      class="absolute inset-0 rounded-full blur-[4px] {reducedMotion ? '' : 'animate-pulse-rasengan'}"
      style="background: {isDark ? 'radial-gradient(circle, rgba(14,165,233,0.5) 0%, rgba(56,189,248,0.2) 60%, transparent 100%)' : 'radial-gradient(circle, rgba(239,68,68,0.55) 0%, rgba(248,113,113,0.2) 60%, transparent 100%)'};"
      aria-hidden="true"
    ></span>

    <!-- 3D Vector Rasengan Orb SVG -->
    <svg
      class="w-8 h-8 relative z-10 transition-transform duration-300"
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <!-- Dynamic Mode Gradients: Red in Light Mode, Blue in Dark Mode -->
        <radialGradient id="rasengan-core-sphere-dyn" cx="40%" cy="38%" r="48%">
          {#if isDark}
            <stop offset="0%" stop-color="#e0f2fe" />
            <stop offset="35%" stop-color="#38bdf8" />
            <stop offset="75%" stop-color="#0284c7" />
            <stop offset="100%" stop-color="#0369a1" />
          {:else}
            <stop offset="0%" stop-color="#fff1f2" />
            <stop offset="35%" stop-color="#f87171" />
            <stop offset="75%" stop-color="#dc2626" />
            <stop offset="100%" stop-color="#991b1b" />
          {/if}
        </radialGradient>

        <linearGradient id="rasengan-stream-dyn-1" x1="0%" y1="0%" x2="100%" y2="100%">
          {#if isDark}
            <stop offset="0%" stop-color="#e0f2fe" stop-opacity="0.95" />
            <stop offset="50%" stop-color="#38bdf8" stop-opacity="0.9" />
            <stop offset="100%" stop-color="#0284c7" stop-opacity="0.75" />
          {:else}
            <stop offset="0%" stop-color="#fff1f2" stop-opacity="0.95" />
            <stop offset="50%" stop-color="#f87171" stop-opacity="0.9" />
            <stop offset="100%" stop-color="#dc2626" stop-opacity="0.75" />
          {/if}
        </linearGradient>

        <linearGradient id="rasengan-stream-dyn-2" x1="100%" y1="0%" x2="0%" y2="100%">
          {#if isDark}
            <stop offset="0%" stop-color="#7dd3fc" />
            <stop offset="50%" stop-color="#0ea5e9" />
            <stop offset="100%" stop-color="#0369a1" />
          {:else}
            <stop offset="0%" stop-color="#fca5a5" />
            <stop offset="50%" stop-color="#ef4444" />
            <stop offset="100%" stop-color="#b91c1c" />
          {/if}
        </linearGradient>

        <radialGradient id="rasengan-outer-halo" cx="50%" cy="50%" r="50%">
          {#if isDark}
            <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.4" />
            <stop offset="70%" stop-color="#0284c7" stop-opacity="0.15" />
            <stop offset="100%" stop-color="#0369a1" stop-opacity="0" />
          {:else}
            <stop offset="0%" stop-color="#f87171" stop-opacity="0.4" />
            <stop offset="70%" stop-color="#dc2626" stop-opacity="0.15" />
            <stop offset="100%" stop-color="#991b1b" stop-opacity="0" />
          {/if}
        </radialGradient>
      </defs>

      <!-- Outer Boundary Shell -->
      <circle cx="50" cy="50" r="44" fill="url(#rasengan-outer-halo)" />

      <!-- Clockwise Vortex Chakra Stream -->
      <g class={reducedMotion ? '' : 'animate-spin-rasengan'}>
        <path
          d="M50 8 C68 12, 88 28, 92 50 C94 65, 84 82, 68 90 C52 96, 30 92, 18 78 C8 66, 8 45, 18 32 C28 18, 42 12, 50 14"
          stroke="url(#rasengan-stream-dyn-1)"
          stroke-width="3"
          stroke-linecap="round"
          fill="none"
        />
        <path
          d="M50 18 C62 20, 78 32, 80 48 C82 60, 74 74, 62 80 C50 84, 34 80, 26 70 C18 60, 20 44, 28 34 C36 24, 45 20, 50 20"
          stroke={isDark ? '#38bdf8' : '#f87171'}
          stroke-width="2.2"
          stroke-linecap="round"
          fill="none"
        />
      </g>

      <!-- Counter-Clockwise Vortex Chakra Stream -->
      <g class={reducedMotion ? '' : 'animate-spin-rasengan-reverse'}>
        <path
          d="M50 92 C32 88, 12 72, 8 50 C6 35, 16 18, 32 10 C48 4, 70 8, 82 22 C92 34, 92 55, 82 68 C72 82, 58 88, 50 86"
          stroke="url(#rasengan-stream-dyn-2)"
          stroke-width="2.5"
          stroke-linecap="round"
          fill="none"
        />
        <path
          d="M50 82 C38 80, 22 68, 20 52 C18 40, 26 26, 38 20 C50 16, 66 20, 74 30 C82 40, 80 56, 72 66 C64 76, 55 80, 50 80"
          stroke={isDark ? '#bae6fd' : '#fecaca'}
          stroke-width="2"
          stroke-linecap="round"
          fill="none"
          opacity="0.85"
        />
      </g>

      <!-- High-Speed Tight Core Orbit & Sphere -->
      <g class={reducedMotion ? '' : 'animate-spin-rasengan-fast'}>
        <path
          d="M50 36 C55 36, 62 42, 62 50 C62 56, 56 62, 50 62 C44 62, 38 56, 38 50 C38 43, 44 38, 50 36"
          stroke={isDark ? '#e0f2fe' : '#ffffff'}
          stroke-width="2.5"
          stroke-linecap="round"
          fill="none"
        />
        <circle cx="50" cy="50" r="13" fill="url(#rasengan-core-sphere-dyn)" class={reducedMotion ? '' : 'animate-pulse-rasengan'} />
        <circle cx="46" cy="45" r="3.5" fill={isDark ? '#f0f9ff' : '#ffffff'} opacity="0.9" />
      </g>
    </svg>
  </div>
</div>
