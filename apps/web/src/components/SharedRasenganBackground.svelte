<script module>
  export const backgroundScene = {
    instance: null,
    playImpact() {
      if (this.instance && typeof this.instance.playImpact === 'function') {
        this.instance.playImpact();
      }
    },
    triggerThemeSupernova(palette, mode) {
      if (this.instance && typeof this.instance.triggerThemeSupernova === 'function') {
        this.instance.triggerThemeSupernova(palette, mode);
      }
    }
  };
  if (typeof window !== 'undefined') {
    window.backgroundScene = backgroundScene;
  }
</script>

<script>
  import { onMount } from 'svelte';
  import { themeState } from '#lib/state/themeState.svelte.js';
  import { authState } from '#lib/state/authState.svelte.js';

  let canvasEl = $state(null);
  let scene = null;
  let reducedMotion = $state(false);

  const activePalette = $derived(themeState.currentRasengan);
  const isDark = $derived(themeState.currentMode === 'dark');
  const isAuthenticated = $derived(authState.isAuthenticated);

  // Keep the 3D Rasengan scene in sync with live theme and mode switches
  $effect(() => {
    const palette = activePalette;
    const mode = themeState.currentMode;
    if (scene) {
      scene.updatePalette(palette, mode);
    }
  });

  // Switch between 8s login Supernova cycle and peaceful post-login cosmic planetary orbit
  $effect(() => {
    const isAuth = isAuthenticated;
    if (scene && typeof scene.setPostLoginMode === 'function') {
      scene.setPostLoginMode(isAuth);
    }
  });

  onMount(() => {
    const mq = typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
    reducedMotion = Boolean(mq?.matches);

    let disposed = false;
    let resizeObserver = null;

    if (canvasEl) {
      import('#lib/RasenganScene.js')
        .then(({ RasenganScene }) => {
          if (disposed || !canvasEl) return;
          scene = new RasenganScene(canvasEl, {
            colors: activePalette,
            mode: themeState.currentMode,
            transparent: true,
            bloom: isDark,
            pixelRatioCap: 1.5,
            phaseDuration: 8.0,
            isPostLogin: Boolean(authState.isAuthenticated)
          });
          backgroundScene.instance = scene;

          if (typeof ResizeObserver !== 'undefined') {
            resizeObserver = new ResizeObserver(() => {
              if (scene && !disposed) scene.resize();
            });
            resizeObserver.observe(canvasEl);
          }
        })
        .catch(() => {
          // Graceful fallback if WebGL is unavailable
          if (canvasEl) canvasEl.hidden = true;
        });
    }

    const onMotionChange = (ev) => {
      reducedMotion = ev.matches;
      if (scene) scene.reducedMotion = reducedMotion;
    };
    mq?.addEventListener?.('change', onMotionChange);

    return () => {
      disposed = true;
      mq?.removeEventListener?.('change', onMotionChange);
      if (resizeObserver) resizeObserver.disconnect();
      if (scene) {
        scene.dispose();
        scene = null;
      }
      backgroundScene.instance = null;
    };
  });
</script>

<div
  id="shared-rasengan-bg-root"
  class="fixed inset-0 w-screen h-screen pointer-events-none z-0 overflow-hidden select-none"
  style="background: {isDark ? 'var(--theme-bg, #060f1e)' : 'var(--bg-login, #ffffff)'};"
  aria-hidden="true"
>
  <!-- Ambient chakra glow fallback for Dark Mode -->
  {#if isDark}
    <div
      class="absolute inset-0 z-0 pointer-events-none"
      style="background: radial-gradient(circle at 50% 45%, color-mix(in srgb, var(--rasengan-1, #0788c9) 24%, transparent) 0%, transparent 60%);"
      aria-hidden="true"
    ></div>
  {/if}

  <!-- Single shared WebGL 3D Rasengan canvas across login and console -->
  <canvas
    bind:this={canvasEl}
    class="absolute inset-0 w-full h-full block pointer-events-none z-0"
    aria-hidden="true"
  ></canvas>
</div>
