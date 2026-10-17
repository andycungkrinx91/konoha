<script>
  import { onMount } from 'svelte';
  import { authState } from '#lib/state/authState.svelte.js';
  import { themeState, THEMES } from '#lib/state/themeState.svelte.js';

  let password = $state('');
  let showPassword = $state(false);
  let isSubmitting = $state(false);
  let errorMessage = $state('');
  let authPhase = $state('idle'); // 'idle' | 'charging' | 'fracture' | 'impact' | 'reveal' | 'stable-loading'

  let tiltX = $state(0);
  let tiltY = $state(0);
  let threeCanvasEl;
  let rasenganScene = null;

  // Active theme properties derived from themeState
  const activeThemeObj = $derived(
    THEMES.find(t => t.id === themeState.currentTheme) || THEMES[0]
  );

  // When theme changes, update Rasengan 3D palette in real time
  $effect(() => {
    if (rasenganScene && activeThemeObj) {
      const palette = activeThemeObj.gradient && activeThemeObj.gradient.length >= 4
        ? [activeThemeObj.gradient[0], activeThemeObj.gradient[1], activeThemeObj.gradient[2], activeThemeObj.gradient[3], activeThemeObj.accent]
        : [activeThemeObj.color, activeThemeObj.accent, '#38bdf8', '#818cf8', '#0284c7'];
      rasenganScene.updatePalette(palette);
    }
  });

  // Track pointer for 3D parallax
  function handlePointerMove(e) {
    if (typeof window === 'undefined') return;
    const { innerWidth, innerHeight } = window;
    const x = (e.clientX / innerWidth - 0.5) * 2; // -1 to 1
    const y = (e.clientY / innerHeight - 0.5) * 2; // -1 to 1
    tiltX = x * 8; // degrees
    tiltY = -y * 8;
  }

  function handleTouchMove(e) {
    if (!e.touches || !e.touches[0]) return;
    const touch = e.touches[0];
    const { innerWidth, innerHeight } = window;
    const x = (touch.clientX / innerWidth - 0.5) * 2;
    const y = (touch.clientY / innerHeight - 0.5) * 2;
    tiltX = x * 5;
    tiltY = -y * 5;
  }

  // 3-Second (3000ms) Rasengan Login Animation Timeline Orchestration
  async function handleSubmit(e) {
    e.preventDefault();
    if (isSubmitting) return; // Prevent duplicate submissions

    if (!password) {
      errorMessage = 'Please enter your password.';
      return;
    }

    isSubmitting = true;
    errorMessage = '';
    authPhase = 'charging'; // Phase A: 0 - 900ms

    // Trigger Three.js Rasengan impact sequence immediately
    if (rasenganScene) {
      rasenganScene.playImpact();
    }

    let authPromiseSettled = false;
    let authResult = null;
    let authError = null;

    // Trigger backend authentication with deferred commit
    const authPromise = authState.login(password, true)
      .then(res => {
        authPromiseSettled = true;
        authResult = res;
      })
      .catch(err => {
        authPromiseSettled = true;
        authError = err;
        // On invalid credentials, don't play full 3s animation - abort immediately
        authPhase = 'idle';
        isSubmitting = false;
        errorMessage = err.message || 'Invalid password';
      });

    // Phase B milestone at 900ms: Glass Fracture
    const phaseBTimer = setTimeout(() => {
      if (isSubmitting && !authError) authPhase = 'fracture';
    }, 900);

    // Phase C milestone at 1400ms: Impact shockwave
    const phaseCTimer = setTimeout(() => {
      if (isSubmitting && !authError) authPhase = 'impact';
    }, 1400);

    // Phase D milestone at 2100ms: Recovery and Reveal
    const phaseDTimer = setTimeout(() => {
      if (isSubmitting && !authError) authPhase = 'reveal';
    }, 2100);

    // Wait for the full nominal 3000ms timeline for successful logins
    for (let i = 0; i < 30; i++) {
      if (authError) break;
      await new Promise(r => setTimeout(r, 100));
    }

    // If auth is still taking longer, transition to stable loading state without re-exploding
    if (!authPromiseSettled && !authError) {
      authPhase = 'stable-loading';
      await authPromise;
    }

    clearTimeout(phaseBTimer);
    clearTimeout(phaseCTimer);
    clearTimeout(phaseDTimer);

    if (authError) {
      authPhase = 'idle';
      isSubmitting = false;
      errorMessage = authError.message || 'Invalid password';
    } else if (authResult) {
      authPhase = 'idle';
      isSubmitting = false;
      // Commit authenticated state now that nominal 3s animation has concluded
      authState.commitLogin(authResult);
    }
  }

  // Mount Three.js Rasengan Scene (Dynamic Import for optimized code splitting)
  onMount(() => {
    let disposed = false;
    if (threeCanvasEl) {
      const palette = activeThemeObj?.gradient && activeThemeObj.gradient.length >= 4
        ? [activeThemeObj.gradient[0], activeThemeObj.gradient[1], activeThemeObj.gradient[2], activeThemeObj.gradient[3], activeThemeObj.accent]
        : ['#11aaff', '#45eaff', '#075dff', '#9beeff', '#167aff'];

      import('#lib/RasenganScene.js')
        .then(({ RasenganScene }) => {
          if (disposed || !threeCanvasEl) return;
          rasenganScene = new RasenganScene(threeCanvasEl, {
            bloom: true,
            pixelRatioCap: 1.5,
            colors: palette
          });
        })
        .catch(err => {
          // Fallback gracefully if WebGL fails
          console.warn('Rasengan Three.js dynamic import fallback:', err);
        });
    }

    return () => {
      disposed = true;
      if (rasenganScene) {
        rasenganScene.dispose();
        rasenganScene = null;
      }
    };
  });
</script>

<svelte:window onpointermove={handlePointerMove} ontouchmove={handleTouchMove} />

<!-- Full Viewport Container: Background responds to active theme custom properties and gradients -->
<div
  class="relative min-h-screen w-full flex items-center justify-center p-4 overflow-hidden select-none transition-colors duration-500"
  style="
    background: radial-gradient(ellipse at 50% 45%, color-mix(in srgb, var(--theme-grad-1, #071d3c) 45%, #030814) 0%, #030814 60%, #01030a 100%);
    color: var(--color-text, #f8fafc);
  "
>
  <!-- Three.js Procedural Rasengan Canvas (100% match from rasengan-threejs) -->
  <canvas
    bind:this={threeCanvasEl}
    class="absolute inset-0 w-full h-full block outline-none z-0"
    aria-label="Interactive 3D Three.js Rasengan Canvas"
  ></canvas>

  <!-- Ambient Vignette Refraction Overlay -->
  <div
    class="absolute inset-0 pointer-events-none z-[1]"
    style="background: radial-gradient(ellipse at center, transparent 25%, rgba(1,4,12,0.45) 70%, rgba(1,3,9,0.92) 120%);"
    aria-hidden="true"
  ></div>

  <!-- Central Dynamic Chakra Glow Aura Tracking Active Theme -->
  <div
    class="absolute w-[600px] h-[600px] rounded-full pointer-events-none transition-transform duration-700 ease-out z-[1] blur-[90px]"
    style="
      background: radial-gradient(circle, color-mix(in srgb, var(--color-primary, #38bdf8) 35%, transparent) 0%, color-mix(in srgb, var(--color-accent, #818cf8) 20%, transparent) 45%, transparent 70%);
      transform: translate3d({tiltX * 6}px, {tiltY * 6}px, 0);
    "
    aria-hidden="true"
  ></div>

  <!-- 3D Parallax Login Container -->
  <div
    class="relative z-10 w-full max-w-md transition-all duration-500 ease-out"
    class:opacity-40={authPhase !== 'idle'}
    class:scale-95={authPhase !== 'idle'}
    style="
      transform: perspective(1000px) rotateY({tiltX}deg) rotateX({tiltY}deg);
      transform-style: preserve-3d;
    "
  >
    <!-- Cyberpunk Glass Card -->
    <div
      class="relative rounded-[8px] p-7 sm:p-9 border shadow-2xl backdrop-blur-xl transition-all duration-300 overflow-hidden"
      style="
        background: color-mix(in srgb, var(--theme-grad-1, #0f172a) 25%, rgba(15, 23, 42, 0.82));
        border-color: color-mix(in srgb, var(--color-primary, #38bdf8) 40%, rgba(255, 255, 255, 0.15));
        box-shadow: 0 25px 60px -15px color-mix(in srgb, var(--color-primary, #0284c7) 30%, transparent), inset 0 1px 0 rgba(255, 255, 255, 0.2);
      "
    >
      <!-- Cyberpunk Neon Top Trim with 4-Gradient Theme Bar -->
      <div
        class="absolute top-0 left-0 right-0 h-[3px] animate-gradient-flow"
        style="background: var(--theme-4gradient-bar, linear-gradient(90deg, #38bdf8, #818cf8, #06b6d4, #38bdf8));"
      ></div>

      <!-- Header with Shinobi Chakra Emblem -->
      <div class="flex flex-col items-center text-center mb-7">
        <div class="relative w-16 h-16 mb-3 flex items-center justify-center">
          <!-- Chakra Aura Halo -->
          <span
            class="absolute inset-0 rounded-full blur-[10px] transition-all duration-500"
            style="background-color: color-mix(in srgb, var(--color-primary, #38bdf8) 45%, transparent);"
          ></span>

          <!-- High-Tech Shinobi Seal Icon -->
          <div
            class="relative z-10 w-14 h-14 rounded-full border flex items-center justify-center shadow-lg transition-transform duration-300 group-hover:scale-105"
            style="background: radial-gradient(circle, color-mix(in srgb, var(--color-primary, #38bdf8) 25%, transparent) 0%, rgba(15, 23, 42, 0.9) 80%); border-color: color-mix(in srgb, var(--color-primary, #38bdf8) 50%, transparent);"
          >
            <svg class="w-8 h-8 text-sky-300 drop-shadow-[0_0_8px_rgba(56,189,248,0.7)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="9" stroke="var(--color-accent, #818cf8)" stroke-width="1.2" stroke-dasharray="3 2" opacity="0.75" />
              <path d="M12 3c4.97 0 9 4.03 9 9 0 3.12-1.59 5.87-4 7.5M12 21c-4.97 0-9-4.03-9-9 0-3.12 1.59-5.87 4-7.5" stroke="var(--color-primary, #38bdf8)" stroke-width="2" />
              <circle cx="12" cy="12" r="3.5" fill="var(--color-primary, #38bdf8)" opacity="0.9" />
              <circle cx="12" cy="12" r="1.5" fill="#ffffff" />
            </svg>
          </div>
        </div>

        <h1 class="text-2xl font-black tracking-tight text-white flex items-center gap-2">
          <span>🍃</span>
          <span class="bg-clip-text text-transparent" style="background-image: var(--theme-4gradient, linear-gradient(90deg, #38bdf8, #818cf8));">
            KONOHA CONSOLE
          </span>
        </h1>
        <p class="text-xs text-sky-200/70 mt-1 font-medium tracking-wide">
          Enter shinobi passphrase to access secure gateway
        </p>
      </div>

      <!-- Error Feedback -->
      {#if errorMessage}
        <div class="mb-5 p-3 rounded-[5px] border border-rose-500/40 bg-rose-950/60 text-rose-300 text-xs font-semibold text-center animate-in fade-in">
          {errorMessage}
        </div>
      {/if}

      <!-- Password-Only Authentication Form -->
      <form onsubmit={handleSubmit} class="space-y-5">
        <div>
          <div class="flex items-center justify-between mb-1.5">
            <label for="login-password" class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--color-accent, #7dd3fc);">
              Access Passphrase
            </label>
            <span class="text-[11px] font-mono px-2 py-0.5 rounded border" style="background: rgba(15, 23, 42, 0.7); border-color: color-mix(in srgb, var(--color-primary, #38bdf8) 40%, transparent); color: var(--color-accent, #38bdf8);">
              Default: <strong class="text-white">konohagakure</strong>
            </span>
          </div>

          <div class="relative">
            <input
              id="login-password"
              type={showPassword ? "text" : "password"}
              bind:value={password}
              placeholder="konohagakure"
              disabled={isSubmitting}
              required
              class="w-full px-4 py-3 rounded-[5px] text-sm font-mono tracking-wide text-white bg-slate-900/80 border focus:ring-1 focus:outline-none transition-all placeholder:text-slate-500"
              style="border-color: color-mix(in srgb, var(--color-primary, #38bdf8) 45%, rgba(255,255,255,0.15));"
              autocomplete="current-password"
            />

            <!-- Show/Hide Password Button -->
            <button
              type="button"
              onclick={() => showPassword = !showPassword}
              class="absolute right-3 top-1/2 -translate-y-1/2 text-sky-300/70 hover:text-sky-200 transition-colors cursor-pointer p-1"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {#if showPassword}
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                </svg>
              {:else}
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              {/if}
            </button>
          </div>
          <p class="text-[11px] text-slate-400 mt-1.5">
            Initial bootstrap password is communicated above. You will be prompted to set a permanent password upon first login.
          </p>
        </div>

        <!-- Button name verbatim 'Login' as requested in Feedback Point 2 -->
        <button
          type="submit"
          disabled={isSubmitting}
          class="w-full py-3.5 rounded-[5px] text-xs font-black tracking-widest uppercase text-white shadow-xl transition-all duration-300 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed hover:brightness-110 active:scale-[0.98] flex items-center justify-center gap-2"
          style="
            background: var(--theme-4gradient, linear-gradient(135deg, #0284c7 0%, #06b6d4 50%, #6366f1 100%));
            box-shadow: 0 10px 30px -5px color-mix(in srgb, var(--color-primary, #0284c7) 40%, transparent);
          "
        >
          {#if isSubmitting}
            <span class="inline-flex items-center gap-2">
              <svg class="animate-spin w-4 h-4 text-white" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
              </svg>
              AUTHENTICATING...
            </span>
          {:else}
            Login
          {/if}
        </button>
      </form>
    </div>
  </div>

  <!-- Mandatory 3-Second Cinematic Rasengan Login Transition HUD (Unobstructed 3D View) -->
  {#if authPhase !== 'idle'}
    <div
      class="fixed inset-0 z-50 pointer-events-none overflow-hidden flex flex-col justify-end pb-12 sm:pb-16 items-center"
      aria-hidden="true"
    >
      <!-- Real-Time Phase Status Telemetry HUD -->
      <div class="relative z-10 px-6 py-3 rounded-full border border-sky-400/40 bg-slate-950/75 backdrop-blur-md shadow-[0_0_30px_rgba(2,132,199,0.35)] text-center animate-in fade-in zoom-in-95 duration-200">
        <p class="text-xs sm:text-sm font-mono tracking-widest uppercase font-semibold flex items-center gap-3" style="color: var(--color-accent, #79dfff);">
          <span class="inline-block w-2.5 h-2.5 rounded-full animate-ping" style="background-color: var(--color-primary, #38bdf8); box-shadow: 0 0 10px var(--color-primary, #38bdf8);"></span>
          {#if authPhase === 'charging'}
            <span>[PHASE 1/4] CHARGING 3D CHAKRA CORE...</span>
          {:else if authPhase === 'fracture'}
            <span>[PHASE 2/4] GLASS FRACTURE RESONANCE...</span>
          {:else if authPhase === 'impact'}
            <span>[PHASE 3/4] IMPACT SHOCKWAVE DISCHARGE...</span>
          {:else if authPhase === 'reveal'}
            <span>[PHASE 4/4] GATEWAY REVEAL & VERIFICATION...</span>
          {:else if authPhase === 'stable-loading'}
            <span>[SYNCHRONIZING WITH GATEWAY...]</span>
          {/if}
        </p>
      </div>
    </div>
  {/if}
</div>
