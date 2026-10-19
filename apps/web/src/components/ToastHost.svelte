<script>
  import { fly, fade } from "svelte/transition";
  import { flip } from "svelte/animate";
  import { toast } from "#lib/state/toast.svelte.ts";

  const toasts = $derived(toast.toasts);
</script>

<aside
  class="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-50 flex flex-col gap-3 pointer-events-none max-w-[calc(100vw-2rem)] sm:max-w-md w-full"
  style="z-index: 9999;"
  aria-label="Notifications"
>
  {#each toasts as item (item.id)}
    <div
      animate:flip={{ duration: 250 }}
      in:fly={{ y: 20, duration: 280 }}
      out:fade={{ duration: 180 }}
      class="pointer-events-auto relative overflow-hidden rounded-[3px] border shadow-2xl backdrop-blur-md transition-all duration-200"
      style="
        background-color: var(--theme-surface-glass);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border-color: var(--theme-modal-border);
        box-shadow: var(--theme-modal-shadow);
        color: var(--theme-text);
      "
      role={item.variant === "error" ? "alert" : "status"}
      aria-live={item.variant === "error" ? "assertive" : "polite"}
      onmouseenter={() => toast.pause(item.id)}
      onmouseleave={() => toast.resume(item.id)}
      onfocusin={() => toast.pause(item.id)}
      onfocusout={() => toast.resume(item.id)}
    >
      <!-- Top 4-Gradient Accent Bar -->
      <div
        class="h-1 w-full"
        style="background: var(--theme-4gradient-bar);"
      ></div>

      <div class="flex items-start gap-3.5 p-4">
        <!-- Animated Icon Container with Soft Ambient Looping Glow -->
        <div class="shrink-0 mt-0.5">
          {#if item.variant === "success"}
            <div
              class="w-8 h-8 rounded-[3px] flex items-center justify-center border toast-icon-glow"
              style="
                background-color: color-mix(in srgb, var(--theme-success, #22c55e) 15%, transparent);
                border-color: color-mix(in srgb, var(--theme-success, #22c55e) 40%, transparent);
                color: var(--theme-success, #22c55e);
                --glow-color: var(--theme-success, #22c55e);
              "
            >
              <svg class="w-5 h-5 toast-svg-draw" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" />
              </svg>
            </div>
          {:else if item.variant === "error"}
            <div
              class="w-8 h-8 rounded-[3px] flex items-center justify-center border toast-icon-glow"
              style="
                background-color: color-mix(in srgb, var(--theme-danger, #ef4444) 15%, transparent);
                border-color: color-mix(in srgb, var(--theme-danger, #ef4444) 40%, transparent);
                color: var(--theme-danger, #ef4444);
                --glow-color: var(--theme-danger, #ef4444);
              "
            >
              <svg class="w-5 h-5 toast-svg-draw" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
          {:else if item.variant === "warning"}
            <div
              class="w-8 h-8 rounded-[3px] flex items-center justify-center border toast-icon-glow"
              style="
                background-color: color-mix(in srgb, var(--theme-warning, #f59e0b) 15%, transparent);
                border-color: color-mix(in srgb, var(--theme-warning, #f59e0b) 40%, transparent);
                color: var(--theme-warning, #f59e0b);
                --glow-color: var(--theme-warning, #f59e0b);
              "
            >
              <svg class="w-5 h-5 toast-svg-draw" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
          {:else if item.variant === "loading"}
            <div
              class="w-8 h-8 rounded-[3px] flex items-center justify-center border toast-icon-glow"
              style="
                background-color: color-mix(in srgb, var(--theme-focus, #38bdf8) 15%, transparent);
                border-color: color-mix(in srgb, var(--theme-focus, #38bdf8) 40%, transparent);
                color: var(--theme-focus, #38bdf8);
                --glow-color: var(--theme-focus, #38bdf8);
              "
            >
              <svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </div>
          {:else}
            <div
              class="w-8 h-8 rounded-[3px] flex items-center justify-center border toast-icon-glow"
              style="
                background-color: color-mix(in srgb, var(--theme-info, #06b6d4) 15%, transparent);
                border-color: color-mix(in srgb, var(--theme-info, #06b6d4) 40%, transparent);
                color: var(--theme-info, #06b6d4);
                --glow-color: var(--theme-info, #06b6d4);
              "
            >
              <svg class="w-5 h-5 toast-svg-draw" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          {/if}
        </div>

        <!-- Content Area -->
        <div class="flex-1 min-w-0 pr-1">
          {#if item.title}
            <h4 class="text-sm font-bold leading-tight mb-1 tracking-tight truncate" style="color: var(--theme-text);">
              {item.title}
            </h4>
          {/if}
          <p class="text-xs sm:text-sm font-medium leading-snug break-words [overflow-wrap:anywhere]" style="color: var(--theme-text-secondary);">
            {item.message}
          </p>

          <!-- Interactive Progress Bar (if provided explicitly) -->
          {#if typeof item.progress === "number"}
            <div class="mt-2.5 w-full bg-[var(--theme-overlay)]/20 rounded-full h-1.5 overflow-hidden">
              <div
                class="h-full rounded-full transition-all duration-300"
                style="
                  width: {Math.min(100, Math.max(0, item.progress))}%;
                  background: var(--theme-4gradient-bar);
                "
              ></div>
            </div>
          {/if}

          <!-- Optional Action Button -->
          {#if item.action}
            <div class="mt-2.5">
              <button
                type="button"
                onclick={() => {
                  item.action?.onClick(item);
                  if (item.dismissible) toast.dismiss(item.id);
                }}
                class="px-3 py-1.5 rounded-[3px] text-xs font-bold transition-all duration-150 cursor-pointer border"
                style="
                  background: {item.action.primary
                    ? 'var(--theme-btn-3d-bg, var(--theme-4gradient))'
                    : 'transparent'};
                  color: {item.action.primary ? '#ffffff' : 'var(--theme-focus, var(--color-primary))'};
                  border-color: {item.action.primary ? 'transparent' : 'var(--theme-border)'};
                "
              >
                {item.action.label}
              </button>
            </div>
          {/if}
        </div>

        <!-- Close Button (Min 40px Touch Target) -->
        {#if item.dismissible}
          <button
            type="button"
            onclick={() => toast.dismiss(item.id)}
            class="shrink-0 -mr-1.5 -mt-1.5 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-[3px] transition-colors cursor-pointer"
            style="color: var(--theme-text-secondary);"
            aria-label="Dismiss notification"
          >
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        {/if}
      </div>

      <!-- Auto-Dismiss Shinking Progress Indicator -->
      {#if item.duration > 0 && item.duration !== Infinity}
        <div class="h-0.5 w-full bg-[var(--theme-overlay)]/10 overflow-hidden">
          <div
            class="h-full transition-all linear"
            style="
              width: {Math.max(0, (item.remaining / item.duration) * 100)}%;
              background: var(--theme-4gradient-bar);
            "
          ></div>
        </div>
      {/if}
    </div>
  {/each}
</aside>

<style>
  /* Ambient Looping Glow (3.8s Cycle) */
  @keyframes toastIconPulse {
    0%, 100% {
      box-shadow: 0 0 0 0 transparent;
    }
    50% {
      box-shadow: 0 0 10px 1px var(--glow-color, rgba(56, 189, 248, 0.3));
    }
  }

  .toast-icon-glow {
    animation: toastIconPulse 3.8s ease-in-out infinite;
  }

  /* SVG Entrance Stroke Dashoffset Drawing */
  @keyframes toastStrokeDraw {
    from {
      stroke-dashoffset: 40;
    }
    to {
      stroke-dashoffset: 0;
    }
  }

  .toast-svg-draw path {
    stroke-dasharray: 40;
    stroke-dashoffset: 0;
    animation: toastStrokeDraw 0.4s ease-out forwards;
  }

  @media (prefers-reduced-motion: reduce) {
    .toast-icon-glow {
      animation: none !important;
    }
    .toast-svg-draw path {
      animation: none !important;
    }
  }
</style>
