<script>
  import { dialogManager } from "#lib/state/dialog.svelte.ts";
  import { useScrollLock } from "#lib/scrollLock.svelte.js";

  let dialogEl = $state(null);

  const current = $derived(dialogManager.current);
  const isConfirm = $derived(current?.type === "confirm");
  const options = $derived(isConfirm ? current.options : null);
  const isLoading = $derived(dialogManager.isLoading);

  useScrollLock(() => isConfirm);

  $effect(() => {
    if (isConfirm && dialogEl && !dialogEl.open) {
      dialogEl.showModal();
    } else if (!isConfirm && dialogEl && dialogEl.open) {
      dialogEl.close();
    }
  });

  async function handleConfirmClick() {
    if (isLoading || !options) return;

    if (typeof options.onConfirm === "function") {
      dialogManager.isLoading = true;
      dialogManager.errorMessage = null;
      try {
        await options.onConfirm();
        await dialogManager.resolveCurrent(true);
      } catch (err) {
        dialogManager.errorMessage = err.message || "Action failed";
      } finally {
        dialogManager.isLoading = false;
      }
    } else {
      await dialogManager.resolveCurrent(true);
    }
  }

  function handleCancelClick() {
    if (isLoading) return;
    dialogManager.cancelCurrent();
  }

  function handleBackdropClick(e) {
    if (isLoading) return;
    if (e.target === dialogEl) {
      dialogManager.cancelCurrent();
    }
  }

  function handleKeydown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      handleCancelClick();
    }
  }
</script>

{#if isConfirm && options}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <dialog
    bind:this={dialogEl}
    onclick={handleBackdropClick}
    onkeydown={handleKeydown}
    oncancel={(e) => { e.preventDefault(); handleCancelClick(); }}
    class="fixed inset-0 m-auto z-[110] p-0 bg-transparent border-0 max-w-lg w-[calc(100vw-2rem)] backdrop:bg-black/60 backdrop:backdrop-blur-sm"
    aria-labelledby="confirm-title"
    aria-describedby="confirm-message"
    role="alertdialog"
  >
    <div
      class="relative overflow-hidden rounded-[5px] border shadow-2xl transition-all duration-200"
      style="
        background-color: var(--theme-surface-glass, rgba(15, 22, 36, 0.96));
        border-color: var(--theme-modal-border, color-mix(in srgb, var(--theme-grad-1) 35%, var(--color-border)));
        box-shadow: 0 20px 48px -8px rgba(0, 0, 0, 0.6), 0 8px 16px -4px rgba(0, 0, 0, 0.3);
      "
    >
      <!-- Top 4-Gradient Theme Accent Bar -->
      <div
        class="h-1.5 w-full"
        style="background: linear-gradient(90deg, var(--theme-grad-1, #38bdf8), var(--theme-grad-2, #818cf8), var(--theme-grad-3, #c084fc), var(--theme-grad-4, #f472b6));"
      ></div>

      <!-- Close Button -->
      <button
        type="button"
        onclick={handleCancelClick}
        disabled={isLoading}
        class="absolute top-4 right-4 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-[5px] theme-text-muted hover:theme-text transition-colors cursor-pointer disabled:opacity-50"
        aria-label="Cancel dialog"
      >
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      <div class="p-6 sm:p-8">
        <!-- Animated 3D Icon Header -->
        <div class="flex justify-center mb-5">
          {#if options.variant === "danger"}
            <div
              class="w-14 h-14 rounded-[5px] flex items-center justify-center border confirm-icon-glow"
              style="
                background-color: color-mix(in srgb, var(--theme-danger, #ef4444) 15%, transparent);
                border-color: color-mix(in srgb, var(--theme-danger, #ef4444) 40%, transparent);
                color: var(--theme-danger, #ef4444);
                --glow-color: var(--theme-danger, #ef4444);
              "
            >
              <svg class="w-8 h-8 confirm-svg-draw" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
          {:else if options.variant === "info"}
            <div
              class="w-14 h-14 rounded-[5px] flex items-center justify-center border confirm-icon-glow"
              style="
                background-color: color-mix(in srgb, var(--theme-info, #06b6d4) 15%, transparent);
                border-color: color-mix(in srgb, var(--theme-info, #06b6d4) 40%, transparent);
                color: var(--theme-info, #06b6d4);
                --glow-color: var(--theme-info, #06b6d4);
              "
            >
              <svg class="w-8 h-8 confirm-svg-draw" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          {:else}
            <!-- Warning default -->
            <div
              class="w-14 h-14 rounded-[5px] flex items-center justify-center border confirm-icon-glow"
              style="
                background-color: color-mix(in srgb, var(--theme-warning, #f59e0b) 15%, transparent);
                border-color: color-mix(in srgb, var(--theme-warning, #f59e0b) 40%, transparent);
                color: var(--theme-warning, #f59e0b);
                --glow-color: var(--theme-warning, #f59e0b);
              "
            >
              <svg class="w-8 h-8 confirm-svg-draw" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          {/if}
        </div>

        <!-- Typography Content -->
        <div class="text-center space-y-2.5 mb-6">
          <h3 id="confirm-title" class="text-xl font-extrabold theme-text tracking-tight break-words [overflow-wrap:anywhere]">
            {options.title}
          </h3>
          {#if options.message}
            <p id="confirm-message" class="text-sm font-medium theme-text-secondary leading-relaxed break-words [overflow-wrap:anywhere]">
              {options.message}
            </p>
          {/if}
        </div>

        <!-- Error Feedback if onConfirm threw -->
        {#if dialogManager.errorMessage}
          <div
            class="mb-5 p-3 rounded-[5px] text-xs font-semibold flex items-center gap-2 border"
            style="
              background-color: color-mix(in srgb, var(--theme-danger, #ef4444) 12%, transparent);
              border-color: color-mix(in srgb, var(--theme-danger, #ef4444) 35%, transparent);
              color: var(--theme-danger, #ef4444);
            "
            role="alert"
          >
            <svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>{dialogManager.errorMessage}</span>
          </div>
        {/if}

        <!-- Actions -->
        <div class="flex flex-col sm:flex-row items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onclick={handleCancelClick}
            disabled={isLoading}
            class="w-full sm:w-auto px-5 py-2.5 rounded-[5px] text-sm font-semibold theme-text-secondary hover:theme-text hover-bg-subtle border theme-border transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {options.cancelText || "Cancel"}
          </button>

          <button
            type="button"
            onclick={handleConfirmClick}
            disabled={isLoading}
            class="w-full sm:w-auto px-6 py-2.5 rounded-[5px] text-sm font-bold text-white transition-all duration-150 cursor-pointer shadow-lg hover:shadow-xl flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            style="
              background: {options.variant === 'danger'
                ? 'linear-gradient(135deg, var(--theme-danger, #ef4444), color-mix(in srgb, var(--theme-danger, #ef4444) 75%, black))'
                : 'linear-gradient(135deg, var(--theme-grad-1, #38bdf8), var(--theme-grad-2, #818cf8))'};
              border: 1px solid color-mix(in srgb, white 20%, transparent);
            "
          >
            {#if isLoading}
              <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span>Processing...</span>
            {:else}
              <span>{options.confirmText || "Confirm"}</span>
            {/if}
          </button>
        </div>
      </div>
    </div>
  </dialog>
{/if}

<style>
  @keyframes confirmPulse {
    0%, 100% {
      box-shadow: 0 0 0 0 transparent;
    }
    50% {
      box-shadow: 0 0 12px 2px var(--glow-color, rgba(239, 68, 68, 0.35));
    }
  }

  .confirm-icon-glow {
    animation: confirmPulse 4s ease-in-out infinite;
  }

  @keyframes confirmStroke {
    from {
      stroke-dashoffset: 60;
    }
    to {
      stroke-dashoffset: 0;
    }
  }

  .confirm-svg-draw path {
    stroke-dasharray: 60;
    stroke-dashoffset: 0;
    animation: confirmStroke 0.4s ease-out forwards;
  }

  @media (prefers-reduced-motion: reduce) {
    .confirm-icon-glow {
      animation: none !important;
    }
    .confirm-svg-draw path {
      animation: none !important;
    }
  }
</style>
