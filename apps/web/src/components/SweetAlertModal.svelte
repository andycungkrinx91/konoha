<script>
  import { sweetAlert } from "#lib/sweetAlert.svelte.js";
  import { useScrollLock } from "#lib/scrollLock.svelte.js";

  useScrollLock(() => sweetAlert.isOpen);
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape' && sweetAlert.isOpen) sweetAlert.handleCancel(); }} />

{#if sweetAlert.isOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[var(--theme-overlay)] 40 backdrop-blur-md animate-in fade-in duration-200"
    onclick={(e) => { if (e.target === e.currentTarget) sweetAlert.handleCancel(); }}
  >
    <!-- 3D Perspective Modal Card with 4-Color Theme Gradient Accent & Border -->
    <div
      class="modal-card modal-3d relative w-full max-w-lg rounded-[5px] p-6 sm:p-8 border shadow-2xl transition-all duration-300 transform scale-100 overflow-hidden"
      style="border-color: var(--theme-modal-border, color-mix(in srgb, var(--theme-grad-1) 38%, var(--color-border))); box-shadow: var(--theme-modal-shadow, var(--shadow-3d-hover));"
      role="alertdialog"
      aria-modal="true"
    >
      <button
        type="button"
        onclick={sweetAlert.handleCancel}
        class="absolute top-3 right-3 p-1.5 rounded-full theme-text-muted hover:theme-text hover-bg-subtle transition-colors cursor-pointer z-10"
        aria-label="Close dialog"
      >
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      <!-- 3D Animated Icon Header -->
      <div class="flex justify-center mb-5">
        {#if sweetAlert.icon === "success"}
          <div class="w-16 h-16 rounded-[5px] flex items-center justify-center shadow-xl border badge-statussuccess-soft bg-status-success-soft text-[var(--theme-success)] transition-transform duration-300 hover:scale-105">
            <svg class="w-9 h-9" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" />
            </svg>
          </div>
        {:else if sweetAlert.icon === "error"}
          <div class="w-16 h-16 rounded-[5px] flex items-center justify-center shadow-xl border badge-statusdanger-soft bg-status-danger-soft text-[var(--theme-danger)] transition-transform duration-300 hover:scale-105">
            <svg class="w-9 h-9" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
        {:else if sweetAlert.icon === "warning"}
          <div class="w-16 h-16 rounded-[5px] flex items-center justify-center shadow-xl border badge-statuswarning-soft bg-status-warning-soft text-[var(--theme-warning)] transition-transform duration-300 hover:scale-105">
            <svg class="w-9 h-9" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
        {:else}
          <div class="w-16 h-16 rounded-[5px] flex items-center justify-center shadow-xl border badge-statusinfo-soft bg-status-info-soft text-[var(--theme-info)] transition-transform duration-300 hover:scale-105">
            <svg class="w-9 h-9" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        {/if}
      </div>

      <!-- Content Area with High Contrast Typography -->
      <div class="text-center space-y-3 mb-6 w-full max-w-full overflow-hidden px-1">
        <h3 class="text-xl font-extrabold theme-text tracking-tight break-words [overflow-wrap:anywhere]">
          {sweetAlert.title}
        </h3>
        {#if sweetAlert.text}
          <div class="text-sm font-medium theme-text-secondary leading-relaxed max-w-full mx-auto space-y-2.5">
            {#each sweetAlert.text.split('\n') as line}
              {#if line.trim().startsWith('/') || line.trim().startsWith('C:\\') || line.trim().startsWith('~')}
                <div class="font-mono text-xs p-2.5 rounded-[5px] bg-[var(--theme-overlay)] 5 theme-text border theme-border/80 break-all select-all text-left shadow-inner max-h-32 overflow-y-auto">
                  {line.trim()}
                </div>
              {:else if line.trim()}
                <p class="break-words [overflow-wrap:anywhere] whitespace-pre-line">
                  {line}
                </p>
              {/if}
            {/each}
          </div>
        {/if}
      </div>

      <!-- 3D Actions with Tactile Depth -->
      <div class="flex items-center justify-center gap-3">
        {#if sweetAlert.showCancel}
          <button
            type="button"
            onclick={sweetAlert.handleCancel}
            class="btn-3d btn-3d-secondary px-5 py-2.5 rounded-[5px] text-xs font-bold transition-all cursor-pointer"
          >
            {sweetAlert.cancelText}
          </button>
        {/if}
        <button
          type="button"
          onclick={sweetAlert.handleConfirm}
          class="btn-3d btn-3d-primary px-6 py-2.5 rounded-[5px] text-xs font-bold text-white transition-all cursor-pointer shadow-lg"
        >
          {sweetAlert.confirmText}
        </button>
      </div>
    </div>
  </div>
{/if}
