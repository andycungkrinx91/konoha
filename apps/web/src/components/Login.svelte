<script>
  import { onMount } from 'svelte';
  import { authState } from '#lib/state/authState.svelte.js';
  import { themeState } from '#lib/state/themeState.svelte.js';
  import { toast } from '#lib/state/toast.svelte.ts';
  import { backgroundScene } from './SharedRasenganBackground.svelte';

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
  let passwordInputEl = $state(null);
  let authAttempt = 0; // invalidates superseded submissions/animations

  const phaseLabel = $derived(
    authPhase === 'charging' ? 'Charging chakra core'
      : authPhase === 'fracture' ? 'Fracturing the seal'
        : authPhase === 'impact' ? 'Releasing impact shockwave'
          : authPhase === 'reveal' ? 'Verifying gateway access'
            : authPhase === 'stable-loading' ? 'Synchronizing with gateway'
              : ''
  );

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
      toast.warning('Enter your passphrase to continue.');
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
    backgroundScene.playImpact();

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
      const status = outcome.error?.status;
      if (status === 429) {
        const retryAfter = outcome.error?.data?.retry_after || '60';
        errorMessage = `Too many attempts. Gateway cooling down — retry in ${retryAfter}s.`;
        toast.warning(errorMessage);
      } else if (status === 0 || outcome.error?.errorId === 'err_offline') {
        errorMessage = 'Gateway server is unreachable or offline.';
        toast.error(errorMessage);
      } else {
        errorMessage = 'Invalid passphrase (invalid password). Access denied.';
        toast.error('Invalid passphrase. Access denied.');
      }
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
    const motionQuery = typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
    reducedMotion = Boolean(motionQuery?.matches);
    const onMotionChange = (ev) => { reducedMotion = ev.matches; };
    motionQuery?.addEventListener?.('change', onMotionChange);

    passwordInputEl?.focus();

    return () => {
      motionQuery?.removeEventListener?.('change', onMotionChange);
    };
  });
</script>

<svelte:window onpointermove={handlePointerMove} ontouchmove={handleTouchMove} />

<div
  class="relative min-h-screen w-full flex items-center justify-center p-4 py-10 overflow-hidden"
  style="
    background: transparent;
    color: var(--theme-text);
  "
>
  <div
    class="relative z-10 w-full max-w-md transition-opacity duration-300"
    class:opacity-60={authPhase !== 'idle'}
    style="transform: perspective(1000px) rotateY({tiltX}deg) rotateX({tiltY}deg); transform-style: preserve-3d;"
  >
    <div
      class="relative rounded-[6px] p-6 sm:p-8 border shadow-2xl overflow-hidden"
      style="
        background: {themeState.currentMode === 'light' ? 'rgba(255, 255, 255, 0.94)' : 'color-mix(in srgb, var(--theme-surface) 94%, transparent)'};
        backdrop-filter: blur(16px);
        border-color: {themeState.currentMode === 'light' ? '#cbd5e1' : 'var(--theme-border-strong)'};
        color: var(--theme-text);
        box-shadow: {themeState.currentMode === 'light' ? '0 20px 40px -15px rgba(0, 0, 0, 0.08), 0 0 1px rgba(0, 0, 0, 0.12)' : 'var(--theme-modal-shadow, 0 25px 60px -15px rgba(0, 0, 0, 0.45))'};
      "
    >
      <div class="absolute top-0 left-0 right-0 h-[3px]" style="background: var(--theme-4gradient-bar);" aria-hidden="true"></div>

      <header class="flex flex-col items-center text-center mb-6">
        <div
          class="relative w-14 h-14 mb-3 rounded-full border flex items-center justify-center shadow-sm"
          style="border-color: var(--theme-border); background: var(--theme-gradient);"
          aria-hidden="true"
        >
          <svg class="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3c4.97 0 9 4.03 9 9 0 3.12-1.59 5.87-4 7.5M12 21c-4.97 0-9-4.03-9-9 0-3.12 1.59-5.87 4-7.5" />
            <circle cx="12" cy="12" r="3.5" fill="#ffffff" opacity="0.9" />
          </svg>
        </div>
        <h1 class="text-xl font-black tracking-tight" style="color: var(--theme-text);">
          KONOHA CONSOLE
        </h1>
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
            <label for="login-password" class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--theme-text-secondary);">
              Default Passphrase (konohagakure)
            </label>
            {#if authState.isBootstrap}
              <span
                class="text-[10px] font-mono px-2 py-0.5 rounded-[4px] border"
                style="background-color: var(--theme-surface-hover); border-color: var(--theme-border); color: var(--theme-text);"
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
              class="w-full pl-4 pr-11 py-3 rounded-[5px] text-sm font-mono border transition-all focus:outline-none focus:ring-2 focus:ring-[var(--theme-focus)] focus:border-transparent placeholder:text-slate-500"
              style="
                background-color: var(--color-surface, #ffffff);
                color: var(--theme-text, #0f172a);
                border-color: var(--theme-border-strong, #94a3b8);
              "
              autocomplete="current-password"
              autocapitalize="off"
              spellcheck="false"
            />
            <button
              type="button"
              onclick={() => showPassword = !showPassword}
              class="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-[5px] cursor-pointer transition-colors hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-[var(--theme-focus)]"
              style="color: var(--theme-text-secondary);"
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
            <p id="login-bootstrap-hint" class="text-[11px] mt-1.5" style="color: var(--theme-text-secondary);">
              The provisioned bootstrap password is shown above. You will be required to set a permanent password after signing in.
            </p>
          {/if}
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          class="w-full py-3 rounded-[5px] text-xs font-black tracking-widest uppercase text-white shadow-xl transition-all duration-200 cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed hover:brightness-110 active:scale-[0.99] flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-[var(--theme-focus)] focus:ring-offset-2"
          style="background: var(--theme-btn-3d-bg, var(--theme-4gradient)); color: #ffffff; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);"
        >
          {#if isSubmitting}
            <svg class="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24" aria-hidden="true">
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
