<script>
  import { onMount } from 'svelte';
  import { authState } from '#lib/state/authState.svelte.js';
  import { themeState, THEMES } from '#lib/state/themeState.svelte.js';

  let password = $state('');
  let showPassword = $state(false);
  let isSubmitting = $state(false);
  let errorMessage = $state('');
  let authPhase = $state('idle'); // 'idle' | 'charging' | 'fracture' | 'impact' | 'reveal' | 'stable-loading'
  let currentScenePhase = $state('CHARGING');

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

    // Trigger backend authentication
    const authPromise = authState.login(password)
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
    } else {
      authPhase = 'idle';
      isSubmitting = false;
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
            colors: palette,
            onPhaseChange: (p) => {
              currentScenePhase = p;
            }
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

  <!-- HUD Eyebrow Badge & Scene Telemetry -->
  <div class="absolute left-6 top-6 pointer-events-none z-10 hidden sm:flex flex-col gap-1.5 text-shadow">
    <div class="flex items-center gap-2.5 text-[10px] font-mono tracking-widest font-semibold uppercase" style="color: var(--color-accent, #79dfff);">
      <span class="inline-block w-2 h-2 rounded-full animate-ping" style="background-color: var(--color-primary, #57e7ff); box-shadow: 0 0 12px var(--color-primary, #23bfff);"></span>
      <span>KONOHA CHAKRA ENGINE // 3D PROCEDURAL</span>
    </div>
    <div class="text-[11px] font-mono opacity-65 flex items-center gap-2" style="color: var(--color-text, #e2e8f0);">
      <span>PHASE: <strong style="color: var(--color-primary, #38bdf8);">{currentScenePhase}</strong></span>
      <span>•</span>
      <span>THEME: <strong class="uppercase" style="color: var(--color-accent, #7dd3fc);">{themeState.currentTheme.replace('-', ' ')}</strong></span>
    </div>
  </div>

  <!-- 3D Parallax Login Container -->
  <div
    class="relative z-10 w-full max-w-md transition-transform duration-200 ease-out"
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

      <!-- Header with Central Rasengan Chakra Indicator -->
      <div class="flex flex-col items-center text-center mb-7">
        <div class="relative w-16 h-16 mb-3 flex items-center justify-center">
          <!-- Chakra Aura Halo -->
          <span
            class="absolute inset-0 rounded-full blur-[8px] animate-pulse-rasengan"
            style="background-color: color-mix(in srgb, var(--color-primary, #38bdf8) 50%, transparent);"
          ></span>

          <!-- Swirling Mini-Orb SVG in Card -->
          <svg class="w-14 h-14 relative z-10 animate-spin-rasengan" viewBox="0 0 100 100" fill="none">
            <defs>
              <radialGradient id="login-card-rasengan-core" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stop-color="#ffffff" />
                <stop offset="45%" stop-color="var(--color-primary, #38bdf8)" />
                <stop offset="100%" stop-color="var(--theme-grad-1, #0284c7)" />
              </radialGradient>
            </defs>
            <circle cx="50" cy="50" r="42" fill="url(#login-card-rasengan-core)" opacity="0.85" />
            <path d="M50 8 C70 12, 90 28, 92 50 C94 65, 84 82, 68 90 C52 96, 30 92, 18 78 C8 66, 8 45, 18 32 C28 18, 42 12, 50 14" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" />
            <path d="M50 92 C32 88, 12 72, 8 50 C6 35, 16 18, 32 10 C48 4, 70 8, 82 22 C92 34, 92 55, 82 68 C72 82, 58 88, 50 86" stroke="var(--color-accent, #7dd3fc)" stroke-width="2" stroke-linecap="round" />
            <circle cx="50" cy="50" r="12" fill="#ffffff" class="animate-pulse-rasengan" />
          </svg>
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

  <!-- Mandatory 3-Second Cinematic Rasengan Login Transition Overlay -->
  {#if authPhase !== 'idle'}
    <div
      class="fixed inset-0 z-[9999] pointer-events-none overflow-hidden flex items-center justify-center"
      aria-hidden="true"
    >
      <!-- Atmospheric Backdrop Blur -->
      <div class="absolute inset-0 bg-slate-950/70 backdrop-blur-md transition-opacity duration-300"></div>

      <!-- Phase C: Shatter White Flash -->
      {#if authPhase === 'impact' || authPhase === 'reveal'}
        <div class="absolute inset-0 animate-shatter-flash pointer-events-none"></div>
      {/if}

      <!-- Phase B & C: Radial Glass Crack Layer -->
      {#if authPhase === 'fracture' || authPhase === 'impact' || authPhase === 'reveal'}
        <svg class="absolute inset-0 w-full h-full animate-glass-crack" viewBox="0 0 1000 1000" preserveAspectRatio="none" fill="none">
          <defs>
            <filter id="login-glass-specular" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <radialGradient id="login-crack-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stop-color="#ffffff" stop-opacity="0.9" />
              <stop offset="35%" stop-color="var(--color-primary, #38bdf8)" stop-opacity="0.6" />
              <stop offset="70%" stop-color="var(--color-accent, #818cf8)" stop-opacity="0.25" />
              <stop offset="100%" stop-color="transparent" stop-opacity="0" />
            </radialGradient>
          </defs>

          <!-- Central Point of Impact Fracture -->
          <circle cx="500" cy="500" r="160" fill="url(#login-crack-glow)" />

          <!-- Deep Radial Impact Fissures -->
          <g stroke="#ffffff" stroke-linecap="round" filter="url(#login-glass-specular)" opacity="0.95">
            <path d="M500 500 L560 380 L620 320 L740 240 L880 160" stroke-width="3.5" />
            <path d="M500 500 L420 370 L340 310 L220 220 L100 140" stroke-width="3" />
            <path d="M500 500 L590 580 L680 660 L800 780 L920 890" stroke-width="3.5" />
            <path d="M500 500 L410 590 L320 670 L210 790 L90 910" stroke-width="3.2" />
            <path d="M500 500 L510 320 L505 180 L495 50" stroke-width="2.8" />
            <path d="M500 500 L510 680 L515 820 L520 950" stroke-width="2.8" />
            <path d="M500 500 L320 505 L180 495 L40 500" stroke-width="2.8" />
            <path d="M500 500 L680 508 L820 512 L960 515" stroke-width="2.8" />
          </g>
        </svg>
      {/if}

      <!-- Center Big Charging/Exploding Rasengan Orb in Transition -->
      <div class="relative flex items-center justify-center">
        <div
          class="w-44 h-44 rounded-full flex items-center justify-center transition-transform duration-300"
          class:animate-ping-once={authPhase === 'impact'}
        >
          <span
            class="absolute inset-0 rounded-full blur-[14px] animate-pulse-rasengan"
            style="background-color: color-mix(in srgb, var(--color-primary, #38bdf8) 60%, transparent);"
          ></span>
          <svg class="w-36 h-36 relative z-10 animate-spin-rasengan" viewBox="0 0 100 100" fill="none">
            <circle cx="50" cy="50" r="44" fill="url(#login-card-rasengan-core)" />
            <circle cx="50" cy="50" r="14" fill="#ffffff" class="animate-pulse-rasengan" />
          </svg>
        </div>
      </div>

      <!-- Real-Time Phase Status Text -->
      <div class="absolute bottom-16 left-1/2 -translate-x-1/2 text-center pointer-events-none">
        <p class="text-xs font-mono tracking-widest uppercase text-sky-300 animate-pulse">
          {#if authPhase === 'charging'}
            [PHASE 1/4] CHARGING CHAKRA CORE...
          {:else if authPhase === 'fracture'}
            [PHASE 2/4] GLASS FRACTURE RESONANCE...
          {:else if authPhase === 'impact'}
            [PHASE 3/4] IMPACT SHOCKWAVE DISCHARGE...
          {:else if authPhase === 'reveal'}
            [PHASE 4/4] GATEWAY REVEAL & VERIFICATION...
          {:else if authPhase === 'stable-loading'}
            [SYNCHRONIZING WITH GATEWAY...]
          {/if}
        </p>
      </div>
    </div>
  {/if}
</div>

<style>
  @keyframes spinRasengan {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  @keyframes pulseRasengan {
    0%, 100% { transform: scale(1); opacity: 0.8; }
    50% { transform: scale(1.08); opacity: 1; }
  }

  @keyframes glassCrack {
    0% { transform: scale(0.96); opacity: 0; }
    30% { transform: scale(1); opacity: 1; }
    100% { transform: scale(1.03); opacity: 0.9; }
  }

  @keyframes shatterFlash {
    0% { background-color: rgba(255, 255, 255, 0.7); }
    100% { background-color: transparent; }
  }

  .animate-spin-rasengan {
    animation: spinRasengan 1.5s linear infinite;
  }

  .animate-pulse-rasengan {
    animation: pulseRasengan 1.2s ease-in-out infinite;
  }

  .animate-glass-crack {
    animation: glassCrack 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  .animate-shatter-flash {
    animation: shatterFlash 0.5s ease-out forwards;
  }

  @media (prefers-reduced-motion: reduce) {
    .animate-spin-rasengan,
    .animate-pulse-rasengan,
    .animate-glass-crack,
    .animate-shatter-flash {
      animation: none !important;
    }
  }
</style>
