<script>
  import { page } from "$app/state";
  import { goto, invalidateAll } from "$app/navigation";
  import { toast } from "#lib/state/toast.svelte.ts";

  const status = $derived(page.status || 500);
  const errorObj = $derived(page.error || {});
  const errorMessage = $derived(errorObj.message || "An unexpected error occurred");
  const errorId = $derived(errorObj.error_id || "err_system");

  // Determine error category
  const is404 = $derived(status === 404);
  const isAuth = $derived(status === 401 || status === 403);
  const isRateLimit = $derived(status === 429);
  const isTimeout = $derived(status === 408 || status === 504);
  const isServer = $derived(status >= 500 && status !== 504);

  const errorTitle = $derived(
    is404 ? "Page Not Found" :
    status === 401 ? "Authentication Required" :
    status === 403 ? "Access Forbidden" :
    isRateLimit ? "Too Many Requests" :
    isTimeout ? "Gateway Timeout" :
    status === 502 ? "Bad Gateway" :
    status === 503 ? "Service Unavailable" :
    isServer ? "Internal Server Error" :
    "Application Error"
  );

  const errorDescription = $derived(
    is404 ? "The requested scroll or village resource could not be found. It may have moved or been decommissioned." :
    status === 401 ? "Your ninja session has expired or requires a valid authentication token. Please log in again." :
    status === 403 ? "You do not have the required clearance level to access this restricted jutsu or endpoint." :
    isRateLimit ? "Rate limit exceeded. The gateway is cooling down — please wait a brief moment before issuing more commands." :
    isTimeout ? "The gateway upstream server took too long to respond. The background service might be busy." :
    status === 502 ? "The backend bridge or gateway received an invalid upstream response." :
    status === 503 ? "The service is temporarily unavailable or undergoing routine maintenance." :
    isServer ? "A server-side shinobi exception occurred while processing this request." :
    "An unexpected condition occurred within the application."
  );

  let isRetrying = $state(false);

  async function handleRetry() {
    isRetrying = true;
    toast.info("Re-synchronizing gateway state...", { duration: 2000 });
    try {
      await invalidateAll();
      toast.success("Synchronized successfully");
    } catch (err) {
      toast.error("Retry failed: " + (err.message || "Server unreachable"));
    } finally {
      isRetrying = false;
    }
  }

  function handleGoBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
    } else {
      goto("/");
    }
  }

  async function copySanitizedDetails() {
    const details = {
      status,
      title: errorTitle,
      path: page.url.pathname,
      timestamp: new Date().toISOString(),
      error_id: errorId
    };

    const textToCopy = JSON.stringify(details, null, 2);

    try {
      await navigator.clipboard.writeText(textToCopy);
      toast.success("Sanitized error details copied to clipboard");
    } catch (_) {
      toast.error("Unable to copy to clipboard");
    }
  }
</script>

<div class="min-h-[70vh] flex flex-col items-center justify-center p-6 text-center select-text">
  <!-- Container Card with 4-Gradient Accent & 3D Depth -->
  <div
    class="w-full max-w-xl rounded-[5px] border p-8 sm:p-10 shadow-2xl relative overflow-hidden backdrop-blur-md"
    style="
      background-color: var(--theme-surface-glass, rgba(15, 22, 36, 0.94));
      border-color: var(--theme-modal-border, color-mix(in srgb, var(--theme-grad-1, #38bdf8) 35%, var(--color-border)));
      box-shadow: 0 20px 48px -8px rgba(0, 0, 0, 0.55), 0 8px 16px -4px rgba(0, 0, 0, 0.3);
    "
  >
    <!-- Top 4-Gradient Accent Bar -->
    <div
      class="h-1.5 w-full absolute top-0 left-0 right-0"
      style="background: linear-gradient(90deg, var(--theme-grad-1, #38bdf8), var(--theme-grad-2, #818cf8), var(--theme-grad-3, #c084fc), var(--theme-grad-4, #f472b6));"
    ></div>

    <!-- Animated Inline SVG Illustrations -->
    <div class="flex justify-center mb-6">
      {#if is404}
        <!-- 404 Radar / Scanning Ring -->
        <div class="relative w-28 h-28 flex items-center justify-center">
          <svg class="w-full h-full" viewBox="0 0 100 100" fill="none">
            <!-- Background circles -->
            <circle cx="50" cy="50" r="42" stroke="var(--color-border)" stroke-width="2" stroke-dasharray="4 4" class="opacity-40" />
            <circle cx="50" cy="50" r="28" stroke="var(--color-border)" stroke-width="1.5" class="opacity-50" />
            <circle cx="50" cy="50" r="14" stroke="var(--color-border)" stroke-width="1.5" class="opacity-60" />

            <!-- Rotating Radar Sweep Line -->
            <g class="radar-sweep" style="transform-origin: 50px 50px;">
              <path d="M 50 50 L 50 8 A 42 42 0 0 1 85 25 Z" fill="url(#radar-grad)" opacity="0.3" />
              <line x1="50" y1="50" x2="50" y2="8" stroke="var(--theme-grad-1, #38bdf8)" stroke-width="2.5" stroke-linecap="round" />
            </g>

            <!-- Center Target Dot -->
            <circle cx="50" cy="50" r="4" fill="var(--theme-focus, #38bdf8)" class="pulse-glow" />

            <defs>
              <linearGradient id="radar-grad" x1="50" y1="50" x2="85" y2="25" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stop-color="var(--theme-grad-1, #38bdf8)" stop-opacity="0" />
                <stop offset="100%" stop-color="var(--theme-grad-2, #818cf8)" stop-opacity="0.8" />
              </linearGradient>
            </defs>
          </svg>
        </div>
      {:else if isAuth}
        <!-- 401/403 Security Chakra Lock -->
        <div class="relative w-28 h-28 flex items-center justify-center">
          <svg class="w-full h-full" viewBox="0 0 100 100" fill="none">
            <!-- Outer Chakra Ring -->
            <circle cx="50" cy="50" r="40" stroke="var(--theme-danger, #ef4444)" stroke-width="2.5" class="chakra-ring-spin" stroke-dasharray="12 6" />

            <!-- Padlock Body -->
            <rect x="32" y="44" width="36" height="30" rx="4" fill="color-mix(in srgb, var(--theme-danger, #ef4444) 20%, transparent)" stroke="var(--theme-danger, #ef4444)" stroke-width="2.5" />

            <!-- Padlock Shackle -->
            <path d="M38 44 V34 A12 12 0 0 1 62 34 V44" stroke="var(--theme-danger, #ef4444)" stroke-width="3" stroke-linecap="round" fill="none" />

            <!-- Keyhole -->
            <circle cx="50" cy="56" r="3" fill="var(--theme-danger, #ef4444)" />
            <path d="M48.5 56 L47 66 H53 L51.5 56 Z" fill="var(--theme-danger, #ef4444)" />
          </svg>
        </div>
      {:else if isRateLimit}
        <!-- 429 Cooldown Spinning Ring -->
        <div class="relative w-28 h-28 flex items-center justify-center">
          <svg class="w-full h-full" viewBox="0 0 100 100" fill="none">
            <circle cx="50" cy="50" r="40" stroke="var(--color-border)" stroke-width="3" opacity="0.3" />
            <!-- Cooldown Arc -->
            <circle cx="50" cy="50" r="40" stroke="var(--theme-warning, #f59e0b)" stroke-width="4" stroke-linecap="round" stroke-dasharray="60 190" class="cooldown-spin" />
            <!-- Inner Hourglass Icon -->
            <path d="M36 30 H64 M36 70 H64 M40 30 L60 70 M60 30 L40 70" stroke="var(--theme-warning, #f59e0b)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
            <circle cx="50" cy="50" r="3" fill="var(--theme-warning, #f59e0b)" class="pulse-glow" />
          </svg>
        </div>
      {:else if isTimeout}
        <!-- Timeout / Offline Signal Waves -->
        <div class="relative w-28 h-28 flex items-center justify-center">
          <svg class="w-full h-full" viewBox="0 0 100 100" fill="none">
            <path d="M25 35 A35 35 0 0 1 75 35" stroke="var(--theme-warning, #f59e0b)" stroke-width="3" stroke-linecap="round" stroke-dasharray="6 6" class="wave-pulse-1" />
            <path d="M35 48 A22 22 0 0 1 65 48" stroke="var(--theme-warning, #f59e0b)" stroke-width="3" stroke-linecap="round" stroke-dasharray="4 4" class="wave-pulse-2" />
            <!-- Broken Antenna -->
            <circle cx="50" cy="62" r="5" fill="var(--theme-danger, #ef4444)" class="pulse-glow" />
            <line x1="50" y1="67" x2="50" y2="82" stroke="var(--color-border)" stroke-width="3" stroke-linecap="round" />
            <line x1="38" y1="82" x2="62" y2="82" stroke="var(--color-border)" stroke-width="3" stroke-linecap="round" />
            <!-- Disconnect slash -->
            <line x1="30" y1="25" x2="70" y2="75" stroke="var(--theme-danger, #ef4444)" stroke-width="3" stroke-linecap="round" />
          </svg>
        </div>
      {:else}
        <!-- 5xx Server Error: Cracked Reactor Core -->
        <div class="relative w-28 h-28 flex items-center justify-center">
          <svg class="w-full h-full" viewBox="0 0 100 100" fill="none">
            <!-- Pulsing outer hexagonal core -->
            <polygon points="50,10 85,30 85,70 50,90 15,70 15,30" stroke="var(--theme-danger, #ef4444)" stroke-width="2.5" fill="color-mix(in srgb, var(--theme-danger, #ef4444) 10%, transparent)" class="reactor-pulse" />
            <!-- Inner crack lines -->
            <path d="M50 15 L46 38 L56 52 L44 68 L50 85" stroke="var(--theme-danger, #ef4444)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
            <circle cx="50" cy="50" r="10" fill="var(--theme-danger, #ef4444)" opacity="0.3" />
            <circle cx="50" cy="50" r="5" fill="var(--theme-danger, #ef4444)" class="pulse-glow" />
          </svg>
        </div>
      {/if}
    </div>

    <!-- Status Code Tag -->
    <div class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold border mb-3"
      style="
        background-color: color-mix(in srgb, var(--theme-grad-1, #38bdf8) 12%, transparent);
        border-color: color-mix(in srgb, var(--theme-grad-1, #38bdf8) 35%, transparent);
        color: var(--theme-focus, var(--color-primary));
      "
    >
      <span>STATUS {status}</span>
      <span class="opacity-60">•</span>
      <span>{errorId}</span>
    </div>

    <!-- Title and Human Readable Description -->
    <h2 class="text-2xl sm:text-3xl font-extrabold theme-text tracking-tight mb-2.5">
      {errorTitle}
    </h2>

    <p class="text-sm sm:text-base font-medium theme-text-secondary leading-relaxed max-w-lg mx-auto mb-6">
      {errorDescription}
    </p>

    <!-- Dev Mode Diagnostic Details (Never in Production) -->
    {#if import.meta.env.DEV && errorMessage}
      <div class="mb-6 p-3 rounded-[5px] bg-[var(--theme-overlay)]/40 border theme-border text-left font-mono text-xs text-[var(--theme-warning,#f59e0b)] max-h-32 overflow-y-auto">
        <div class="font-bold uppercase tracking-wider text-[11px] mb-1 opacity-70">Development Trace:</div>
        <p class="break-words [overflow-wrap:anywhere]">{errorMessage}</p>
      </div>
    {/if}

    <!-- Action Buttons Matrix -->
    <div class="flex flex-wrap items-center justify-center gap-3 pt-2">
      <button
        type="button"
        onclick={() => goto('/')}
        class="px-5 py-2.5 rounded-[5px] text-xs sm:text-sm font-bold text-white transition-all duration-150 cursor-pointer shadow-lg hover:shadow-xl flex items-center gap-2"
        style="
          background: linear-gradient(135deg, var(--theme-grad-1, #38bdf8), var(--theme-grad-2, #818cf8));
          border: 1px solid color-mix(in srgb, white 20%, transparent);
        "
      >
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </svg>
        <span>Go to Dashboard</span>
      </button>

      {#if isServer || isTimeout}
        <button
          type="button"
          onclick={handleRetry}
          disabled={isRetrying}
          class="px-4 py-2.5 rounded-[5px] text-xs sm:text-sm font-bold theme-text hover:theme-text hover-bg-subtle border theme-border transition-all duration-150 cursor-pointer flex items-center gap-2 disabled:opacity-50"
        >
          <svg class="w-4 h-4 {isRetrying ? 'animate-spin' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span>{isRetrying ? "Retrying..." : "Retry"}</span>
        </button>
      {/if}

      <button
        type="button"
        onclick={handleGoBack}
        class="px-4 py-2.5 rounded-[5px] text-xs sm:text-sm font-medium theme-text-secondary hover:theme-text hover-bg-subtle border theme-border transition-all duration-150 cursor-pointer flex items-center gap-2"
      >
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
        </svg>
        <span>Go Back</span>
      </button>

      <button
        type="button"
        onclick={copySanitizedDetails}
        class="px-4 py-2.5 rounded-[5px] text-xs sm:text-sm font-medium theme-text-muted hover:theme-text hover-bg-subtle border theme-border transition-all duration-150 cursor-pointer flex items-center gap-1.5"
        title="Copy sanitized diagnostic payload"
      >
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
        <span>Copy Details</span>
      </button>
    </div>
  </div>
</div>

<style>
  /* Calm slow animations for SVG error graphics */
  @keyframes radarSpin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  .radar-sweep {
    animation: radarSpin 5s linear infinite;
  }

  @keyframes pulseGlow {
    0%, 100% {
      opacity: 0.6;
      transform: scale(0.95);
    }
    50% {
      opacity: 1;
      transform: scale(1.1);
    }
  }

  .pulse-glow {
    animation: pulseGlow 2.5s ease-in-out infinite;
  }

  @keyframes chakraSpin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(-360deg);
    }
  }

  .chakra-ring-spin {
    transform-origin: 50px 50px;
    animation: chakraSpin 12s linear infinite;
  }

  @keyframes cooldownSpin {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
    }
  }

  .cooldown-spin {
    transform-origin: 50px 50px;
    animation: cooldownSpin 3s cubic-bezier(0.4, 0, 0.2, 1) infinite;
  }

  @keyframes reactorPulse {
    0%, 100% {
      stroke-width: 2.5;
      filter: drop-shadow(0 0 2px rgba(239, 68, 68, 0.3));
    }
    50% {
      stroke-width: 3.5;
      filter: drop-shadow(0 0 10px rgba(239, 68, 68, 0.6));
    }
  }

  .reactor-pulse {
    animation: reactorPulse 3.5s ease-in-out infinite;
  }

  @keyframes wavePulse {
    0%, 100% {
      opacity: 0.3;
    }
    50% {
      opacity: 1;
    }
  }

  .wave-pulse-1 {
    animation: wavePulse 2s ease-in-out infinite;
  }

  .wave-pulse-2 {
    animation: wavePulse 2s ease-in-out infinite 0.5s;
  }

  @media (prefers-reduced-motion: reduce) {
    .radar-sweep,
    .pulse-glow,
    .chakra-ring-spin,
    .cooldown-spin,
    .reactor-pulse,
    .wave-pulse-1,
    .wave-pulse-2 {
      animation: none !important;
    }
  }
</style>
