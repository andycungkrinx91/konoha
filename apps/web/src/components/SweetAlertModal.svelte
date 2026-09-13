<script>
  import { sweetAlert } from "#lib/sweetAlert.svelte.js";
  import { useScrollLock } from "#lib/scrollLock.svelte.js";

  useScrollLock(() => sweetAlert.isOpen);
</script>

{#if sweetAlert.isOpen}
  <div class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-md animate-in fade-in duration-200">
    <!-- 3D Perspective Modal Card -->
    <div
      class="relative w-full max-w-md rounded-3xl p-6 sm:p-8 border shadow-2xl transition-all duration-300 transform scale-100"
      style="background: var(--glass-card); border-color: var(--color-border); box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.18), inset 0 1px 0 rgba(255, 255, 255, 1);"
      role="alertdialog"
      aria-modal="true"
    >
      <!-- 3D Animated Icon Header -->
      <div class="flex justify-center mb-5">
        {#if sweetAlert.icon === "success"}
          <div class="w-16 h-16 rounded-2xl flex items-center justify-center shadow-xl border border-emerald-200 bg-emerald-50 text-emerald-600 transition-transform duration-300 hover:scale-105">
            <svg class="w-9 h-9" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" />
            </svg>
          </div>
        {:else if sweetAlert.icon === "error"}
          <div class="w-16 h-16 rounded-2xl flex items-center justify-center shadow-xl border border-rose-200 bg-rose-50 text-rose-600 transition-transform duration-300 hover:scale-105">
            <svg class="w-9 h-9" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
        {:else if sweetAlert.icon === "warning"}
          <div class="w-16 h-16 rounded-2xl flex items-center justify-center shadow-xl border border-amber-200 bg-amber-50 text-amber-600 transition-transform duration-300 hover:scale-105">
            <svg class="w-9 h-9" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
        {:else}
          <div class="w-16 h-16 rounded-2xl flex items-center justify-center shadow-xl border border-sky-200 bg-sky-50 text-sky-600 transition-transform duration-300 hover:scale-105">
            <svg class="w-9 h-9" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        {/if}
      </div>

      <!-- Content Area with High Contrast Typography -->
      <div class="text-center space-y-2 mb-6">
        <h3 class="text-xl font-extrabold text-slate-900 tracking-tight">
          {sweetAlert.title}
        </h3>
        {#if sweetAlert.text}
          <p class="text-sm font-medium text-slate-700 leading-relaxed max-w-sm mx-auto">
            {sweetAlert.text}
          </p>
        {/if}
      </div>

      <!-- 3D Actions with Tactile Depth -->
      <div class="flex items-center justify-center gap-3">
        {#if sweetAlert.showCancel}
          <button
            type="button"
            onclick={sweetAlert.handleCancel}
            class="btn-3d px-5 py-2.5 rounded-xl text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 transition-all cursor-pointer"
          >
            {sweetAlert.cancelText}
          </button>
        {/if}
        <button
          type="button"
          onclick={sweetAlert.handleConfirm}
          class="btn-3d px-6 py-2.5 rounded-xl text-xs font-bold text-white transition-all cursor-pointer shadow-lg"
          style="background-color: var(--color-primary, #7c3aed);"
        >
          {sweetAlert.confirmText}
        </button>
      </div>
    </div>
  </div>
{/if}
