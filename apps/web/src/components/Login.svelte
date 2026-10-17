<script>
  import { onMount } from 'svelte';
  import { authState } from '#lib/state/authState.svelte.js';
  import { themeState, THEMES } from '#lib/state/themeState.svelte.js';

  // Single nominal login timeline (3,000 ms) per accepted submission.
  const PHASE_FRACTURE_MS = 900;
  const PHASE_IMPACT_MS = 1400;
  const PHASE_REVEAL_MS = 2100;
  const TIMELINE_MS = 3000;
  // Provisioning hint only — authentication and the policy decision stay server-side.
  const DEFAULT_BOOTSTRAP_HINT = 'konohagakure';

  let password = $state('');
  let showPassword = $state(false);
  let isSubmitting = $state(false);
  // 'idle' | 'charging' | 'fracture' | 'impact' | 'reveal' | 'stable-loading'
  let authPhase = $state('idle');
  let errorMessage = $state('');
  let reducedMotion = $state(false);

  let tiltX = $state(0);
  let tiltY = $state(0);
  let threeCanvasEl = $state(null);
  let passwordInputEl = $state(null);
  let rasenganScene = null;
  let authAttempt = 0; // invalidates superseded submissions/animations

  const activeThemeObj = $derived(
    THEMES.find(t => t.id === themeState.currentTheme) || THEMES[0]
  );

  const activePalette = $derived(
    activeThemeObj?.gradient && activeThemeObj.gradient.length >= 4
      ? [activeThemeObj.gradient[0], activeThemeObj.gradient[1], activeThemeObj.gradient[2], activeThemeObj.gradient[3], activeThemeObj.accent]
      : ['#38bdf8', '#818cf8', '#06b6d4', '#0284c7', '#0ea5e9']
  );

  const phaseLabel = $derived(
    authPhase === 'charging' ? 'Charging chakra core'
      : authPhase === 'fracture' ? 'Fracturing the seal'
        : authPhase === 'impact' ? 'Releasing impact shockwave'
          : authPhase === 'reveal' ? 'Verifying gateway access'
            : authPhase === 'stable-loading' ? 'Synchronizing with gateway'
              : ''
  );

  // Keep the 3D Rasengan palette in sync with live theme switches.
  $effect(() => {
    const palette = activePalette;
    if (rasenganScene) {
      rasenganScene.updatePalette(palette);
    }
  });

  function handlePointerMove(e) {
    if (reducedMotion || typeof window === 'undefined') return;
    const x = (e.clientX / window.innerWidth - 0.5) * 2;
    const y = (e.clientY / window.innerHeight - 0.5) * 2;
    tiltX = x * 8;
    tiltY = -y * 8;
  }

  function handleTouchMove(e) {
    if (reducedMotion || !e.touches || !e.touches[0] || typeof window === 'undefined') return;
    const touch = e.touches[0];
    const x = (touch.clientX / window.innerWidth - 0.5) * 2;
    const y = (touch.clientY / window.innerHeight - 0.5) * 2;
    tiltX = x * 5;
    tiltY = -y * 5;
  }

  function runTimelineGate(attempt, startedAt) {
    // Hold server-confirmed auth until the nominal 3,000 ms mark; when the
    // response arrives later than that, the gate resolves immediately.
    return new Promise(resolve => {
      const remaining = Math.max(0, TIMELINE_MS - (performance.now() - startedAt));
      setTimeout(() => {
        if (attempt === authAttempt) resolve();
      }, remaining);
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (isSubmitting) return;

    if (!password) {
      errorMessage = 'Enter your passphrase to continue.';
      passwordInputEl?.focus();
      return;
    }

    // One request, one animation: each attempt supersedes the previous one.
    const attempt = ++authAttempt;
    const startedAt = performance.now();
    isSubmitting = true;
    errorMessage = '';
    authPhase = 'charging';
    tiltX = 0;
    tiltY = 0;
    rasenganScene?.playImpact();

    const fractureTimer = setTimeout(() => {
      if (attempt === authAttempt && authPhase === 'charging') authPhase = 'fracture';
    }, PHASE_FRACTURE_MS);
    const impactTimer = setTimeout(() => {
      if (attempt === authAttempt && (authPhase === 'charging' || authPhase === 'fracture')) authPhase = 'impact';
    }, PHASE_IMPACT_MS);
    const revealTimer = setTimeout(() => {
      if (attempt === authAttempt && authPhase !== 'stable-loading') authPhase = 'reveal';
    }, PHASE_REVEAL_MS);
    const stableTimer = setTimeout(() => {
      if (attempt === authAttempt && !authSettled) authPhase = 'stable-loading';
    }, TIMELINE_MS);

    let authSettled = false;
    const authPromise = authState.login(password, true)
      .then(data => ({ ok: true, data }))
      .catch(err => ({ ok: false, error: err }))
      .finally(() => { authSettled = true; });

    const earlyResult = await Promise.race([authPromise, runTimelineGate(attempt, startedAt)]);
    if (attempt !== authAttempt) return;

    const outcome = earlyResult && typeof earlyResult.ok === 'boolean'
      ? earlyResult
      : await authPromise;
    if (attempt !== authAttempt) return;

    clearTimeout(fractureTimer);
    clearTimeout(impactTimer);
    clearTimeout(revealTimer);
    clearTimeout(stableTimer);

    if (!outcome.ok) {
      authPhase = 'idle';
      isSubmitting = false;
      errorMessage = outcome.error?.message || 'Authentication failed. Try again.';
      passwordInputEl?.focus();
      passwordInputEl?.select();
      return;
    }

    // Early success waits for the reveal; slow auth has already passed it.
    await runTimelineGate(attempt, startedAt);
    if (attempt !== authAttempt) return;

    authPhase = 'idle';
    isSubmitting = false;
    password = '';
    authState.commitLogin(outcome.data);
  }

  function handlePasswordInput() {
    if (errorMessage) errorMessage = '';
  }

  onMount(() => {
    let disposed = false;
    const motionQuery = typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
    reducedMotion = Boolean(motionQuery?.matches);
    const onMotionChange = (ev) => { reducedMotion = ev.matches; };
    motionQuery?.addEventListener?.('change', onMotionChange);

    passwordInputEl?.focus();

    if (threeCanvasEl) {
      import('#lib/RasenganScene.js')
        .then(({ RasenganScene }) => {
          if (disposed || !threeCanvasEl) return;
          rasenganScene = new RasenganScene(threeCanvasEl, {
            bloom: true,
            pixelRatioCap: 1.5,
            colors: activePalette
          });
        })
        .catch(() => {
          // WebGL unavailable — the static chakra glow below keeps the scene usable.
          if (threeCanvasEl) threeCanvasEl.hidden = true;
        });
    }

    return () => {
      disposed = true;
      motionQuery?.removeEventListener?.('change', onMotionChange);
      if (rasenganScene) {
        rasenganScene.dispose();
        rasenganScene = null;
      }
    };
  });
</script>

<svelte:window onpointermove={handlePointerMove} ontouchmove={handleTouchMove} />

<div
  class="relative min-h-screen w-full flex items-center justify-center p-4 py-10 overflow-hidden"
  style="
    background: radial-gradient(ellipse at 50% 42%, color-mix(in srgb, var(--theme-grad-2, #124a72) 38%, var(--theme-bg)) 0%, var(--theme-bg) 62%, color-mix(in srgb, var(--theme-bg) 80%, #000000) 100%);
    color: var(--theme-text);
 "
>
  <!-- Procedural 3D Rasengan scene -->
  <canvas
    bind:this={threeCanvasEl}
    class="absolute inset-0 w-full h-full block outline-none z-0 pointer-events-none"
    aria-hidden="true"
  ></canvas>

  <!-- Static chakra glow fallback (visible without WebGL) -->
  <div
    class="absolute inset-0 z-0 pointer-events-none"
    style="background: radial-gradient(circle at 50% 45%, color-mix(in srgb, var(--theme-grad-3, #0788c9) 26%, transparent) 0%, transparent 55%);"
    aria-hidden="true"
  ></div>

  <!-- Ambient vignette keeps the form readable over the scene -->
  <div
    class="absolute inset-0 pointer-events-none z-[1]"
    style="background: radial-gradient(ellipse at center, transparent 20%, color-mix(in srgb, var(--theme-bg) 70%, transparent) 75%, var(--theme-bg) 120%);"
    aria-hidden="true"
  ></div>

  <div
    class="relative z-10 w-full max-w-md transition-opacity duration-300"
    class:opacity-60={authPhase !== 'idle'}
    style="transform: perspective(1000px) rotateY({tiltX}deg) rotateX({tiltY}deg); transform-style: preserve-3d;"
  >
    <div
      class="relative rounded-[6px] p-6 sm:p-8 border shadow-2xl overflow-hidden"
      style="
        background: color-mix(in srgb, var(--theme-surface) 94%, transparent);
        border-color: var(--theme-border-strong);
        color: var(--theme-text);
        box-shadow: var(--theme-modal-shadow, 0 25px 60px -15px rgba(0, 0, 0, 0.45));
 "
    >
      <div class="absolute top-0 left-0 right-0 h-[3px]" style="background: var(--theme-4gradient-bar);" aria-hidden="true"></div>

      <header class="flex flex-col items-center text-center mb-6">
        <div
          class="relative w-14 h-14 mb-3 rounded-full border flex items-center justify-center"
          style="border-color: var(--theme-border); background: var(--theme-gradient);"
          aria-hidden="true"
        >
          <svg class="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3c4.97 0 9 4.03 9 9 0 3.12-1.59 5.87-4 7.5M12 21c-4.97 0-9-4.03-9-9 0-3.12 1.59-5.87 4-7.5" />
            <circle cx="12" cy="12" r="3.5" fill="#ffffff" opacity="0.9" />
          </svg>
        </div>
        <h1 class="text-xl font-black tracking-tight theme-text">
          KONOHA CONSOLE
        </h1>
        <p class="text-xs mt-1 theme-text-secondary">
          Enter shinobi passphrase to access secure gateway
        </p>
      </header>

      {#if errorMessage}
        <div
          role="alert"
          class="mb-4 p-3 rounded-[5px] border text-xs font-semibold text-center"
          style="border-color: color-mix(in srgb, var(--theme-danger) 45%, transparent); background-color: color-mix(in srgb, var(--theme-danger) 10%, var(--theme-surface)); color: var(--theme-danger);"
        >
          {errorMessage}
        </div>
      {/if}

      <form onsubmit={handleSubmit} class="space-y-4" novalidate>
        <div>
          <div class="flex items-center justify-between gap-2 mb-1.5">
            <label for="login-password" class="text-[11px] font-bold uppercase tracking-wider theme-text-secondary">
              Access Passphrase
            </label>
            {#if authState.isBootstrap}
              <span
                class="text-[10px] font-mono px-2 py-0.5 rounded-[4px] border theme-bg-muted theme-border theme-text"
                title="Provisioned bootstrap credential — set a permanent password after signing in"
              >
                Default: {DEFAULT_BOOTSTRAP_HINT}
              </span>
            {/if}
          </div>

          <div class="relative">
            <input
              id="login-password"
              bind:this={passwordInputEl}
              type={showPassword ? 'text' : 'password'}
              bind:value={password}
              oninput={handlePasswordInput}
              placeholder="Enter passphrase"
              disabled={isSubmitting}
              required
              aria-invalid={errorMessage ? 'true' : undefined}
              aria-describedby={authState.isBootstrap ? 'login-bootstrap-hint' : undefined}
              class="w-full pl-4 pr-11 py-3 rounded-[5px] text-sm font-mono border input-theme theme-bg-surface theme-border theme-text"
              autocomplete="current-password"
              autocapitalize="off"
              spellcheck="false"
            />
            <button
              type="button"
              onclick={() => showPassword = !showPassword}
              class="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-[5px] cursor-pointer transition-colors hover:brightness-110 theme-text-secondary"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              aria-controls="login-password"
            >
              {#if showPassword}
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                </svg>
              {:else}
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              {/if}
            </button>
          </div>

          {#if authState.isBootstrap}
            <p id="login-bootstrap-hint" class="text-[11px] mt-1.5 theme-text-secondary">
              The provisioned bootstrap password is shown above. You will be required to set a permanent password after signing in.
            </p>
          {/if}
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          class="w-full py-3 rounded-[5px] text-xs font-black tracking-widest uppercase text-white shadow-xl transition-all duration-200 cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed hover:brightness-110 active:scale-[0.99] flex items-center justify-center gap-2"
          style="background: var(--theme-4gradient, linear-gradient(135deg, #0284c7 0%, #06b6d4 50%, #6366f1 100%));"
        >
          {#if isSubmitting}
            <svg class="animate-spin w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" aria-hidden="true">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
            </svg>
            <span>Authenticating…</span>
          {:else}
            <span>Login</span>
          {/if}
        </button>
      </form>
    </div>
  </div>

  {#if authPhase !== 'idle'}
    <div
      class="fixed inset-0 z-20 pointer-events-none flex flex-col justify-end items-center pb-10 sm:pb-14"
      aria-live="polite"
      aria-atomic="true"
    >
      <div
        class="px-5 py-2.5 rounded-full border text-xs sm:text-sm font-mono tracking-widest uppercase font-semibold flex items-center gap-3"
        style="background-color: color-mix(in srgb, var(--theme-bg) 85%, transparent); border-color: var(--theme-border-strong); color: var(--theme-text);"
      >
        <span
          class={authPhase === 'stable-loading' ? 'w-2.5 h-2.5 rounded-full animate-pulse' : 'w-2.5 h-2.5 rounded-full'}
          style="background-color: var(--theme-focus);"
          aria-hidden="true"
        ></span>
        <span>{phaseLabel}…</span>
      </div>
    </div>
  {/if}
</div>
