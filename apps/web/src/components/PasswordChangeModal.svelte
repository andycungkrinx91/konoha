<script>
  import { authState } from '#lib/state/authState.svelte.js';
  import { sweetAlert } from '#lib/sweetAlert.svelte.js';
  import { useScrollLock } from '#lib/scrollLock.svelte.js';

  let currentPassword = $state('');
  let newPassword = $state('');
  let confirmPassword = $state('');
  let showPasswords = $state(false);
  let isSubmitting = $state(false);
  let errorMessage = $state('');
  let successMessage = $state('');

  useScrollLock(() => authState.showPasswordChangeModal);

  async function handleSubmit(e) {
    e.preventDefault();
    errorMessage = '';
    successMessage = '';

    if (!newPassword || newPassword.length < 8) {
      errorMessage = 'New password must be at least 8 characters long.';
      return;
    }

    if (newPassword === 'konohagakure') {
      errorMessage = 'Cannot reuse the default bootstrap password.';
      return;
    }

    if (newPassword !== confirmPassword) {
      errorMessage = 'New password and confirmation do not match.';
      return;
    }

    isSubmitting = true;
    try {
      await authState.changePassword(currentPassword || 'konohagakure', newPassword);
      successMessage = 'Password updated successfully! Welcome to Konoha.';
      setTimeout(() => {
        currentPassword = '';
        newPassword = '';
        confirmPassword = '';
        errorMessage = '';
        successMessage = '';
      }, 1200);
    } catch (err) {
      errorMessage = err.message || 'Failed to update password.';
    } finally {
      isSubmitting = false;
    }
  }

  function handleKeydown(e) {
    if (e.key === 'Escape' && !authState.requiresPasswordChange) {
      authState.closePasswordChangeModal();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if authState.showPasswordChangeModal}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md animate-in fade-in duration-200"
    onclick={(e) => {
      if (e.target === e.currentTarget && !authState.requiresPasswordChange) {
        authState.closePasswordChangeModal();
      }
    }}
  >
    <!-- Modal Card with 3D Theme Accent -->
    <div
      class="modal-card modal-3d relative w-full max-w-md rounded-[6px] p-6 sm:p-8 border shadow-2xl transition-all duration-300 transform scale-100 overflow-hidden glass-frost-strong"
      style="border-color: var(--theme-modal-border, color-mix(in srgb, var(--theme-grad-1) 38%, var(--color-border))); box-shadow: var(--theme-modal-shadow, var(--shadow-3d-hover)); background-color: var(--color-surface); color: var(--color-text);"
      role="alertdialog"
      aria-modal="true"
    >
      {#if !authState.requiresPasswordChange}
        <button
          type="button"
          onclick={() => authState.closePasswordChangeModal()}
          class="absolute top-4 right-4 p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer z-10"
          aria-label="Close dialog"
        >
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      {/if}

      <!-- Icon Header -->
      <div class="flex justify-center mb-4">
        <div class="w-14 h-14 rounded-[6px] flex items-center justify-center shadow-lg border border-amber-300/60 bg-amber-500/10 text-amber-500 animate-pulse-rasengan">
          <svg class="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
      </div>

      <!-- Title & Warning -->
      <div class="text-center space-y-2 mb-5">
        <h3 class="text-lg font-extrabold tracking-tight" style="color: var(--color-text);">
          {authState.requiresPasswordChange ? 'Mandatory Password Change' : 'Update Access Password'}
        </h3>
        <p class="text-xs leading-relaxed" style="color: var(--color-text-muted);">
          {authState.requiresPasswordChange
            ? 'The initial bootstrap password (konohagakure) is currently active. For security hardening, you must set a private password before normal dashboard access is granted.'
            : 'Enter your current password and your new secure password below.'}
        </p>
      </div>

      {#if errorMessage}
        <div class="p-3 mb-4 rounded-[4px] border border-rose-500/30 bg-rose-500/10 text-rose-600 text-xs font-semibold text-center animate-in fade-in">
          {errorMessage}
        </div>
      {/if}

      {#if successMessage}
        <div class="p-3 mb-4 rounded-[4px] border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 text-xs font-semibold text-center animate-in fade-in">
          {successMessage}
        </div>
      {/if}

      <!-- Form -->
      <form onsubmit={handleSubmit} class="space-y-4">
        <div>
          <label for="current-password" class="block text-xs font-bold uppercase tracking-wider mb-1" style="color: var(--color-text-muted);">
            Current Password
          </label>
          <input
            id="current-password"
            type={showPasswords ? "text" : "password"}
            bind:value={currentPassword}
            placeholder="Default: konohagakure"
            class="w-full px-3.5 py-2.5 rounded-[5px] text-xs font-mono border focus:outline-none transition-colors"
            style="background-color: var(--color-card-bg); border-color: var(--color-border); color: var(--color-text);"
            autocomplete="current-password"
          />
        </div>

        <div>
          <label for="new-password" class="block text-xs font-bold uppercase tracking-wider mb-1" style="color: var(--color-text-muted);">
            New Password (Min 8 Characters)
          </label>
          <input
            id="new-password"
            type={showPasswords ? "text" : "password"}
            bind:value={newPassword}
            placeholder="Enter new strong password"
            required
            class="w-full px-3.5 py-2.5 rounded-[5px] text-xs font-mono border focus:outline-none transition-colors"
            style="background-color: var(--color-card-bg); border-color: var(--color-border); color: var(--color-text);"
            autocomplete="new-password"
          />
        </div>

        <div>
          <label for="confirm-password" class="block text-xs font-bold uppercase tracking-wider mb-1" style="color: var(--color-text-muted);">
            Confirm New Password
          </label>
          <input
            id="confirm-password"
            type={showPasswords ? "text" : "password"}
            bind:value={confirmPassword}
            placeholder="Re-enter new password"
            required
            class="w-full px-3.5 py-2.5 rounded-[5px] text-xs font-mono border focus:outline-none transition-colors"
            style="background-color: var(--color-card-bg); border-color: var(--color-border); color: var(--color-text);"
            autocomplete="new-password"
          />
        </div>

        <!-- Show/Hide Toggle -->
        <div class="flex items-center justify-between text-xs pt-1">
          <label class="flex items-center gap-2 cursor-pointer select-none" style="color: var(--color-text-muted);">
            <input
              type="checkbox"
              bind:checked={showPasswords}
              class="rounded text-sky-600 focus:ring-0 cursor-pointer"
            />
            Show password characters
          </label>
        </div>

        <!-- Submit Button -->
        <div class="pt-2">
          <button
            type="submit"
            disabled={isSubmitting}
            class="w-full py-2.5 rounded-[5px] text-xs font-bold text-white transition-all duration-200 cursor-pointer shadow-lg disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-110 active:scale-[0.98]"
            style="background: var(--theme-4gradient, linear-gradient(135deg, #0284c7, #06b6d4));"
          >
            {#if isSubmitting}
              <span class="inline-flex items-center gap-2">
                <svg class="animate-spin w-4 h-4 text-white" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
                </svg>
                Saving Password...
              </span>
            {:else}
              Update & Continue to Dashboard
            {/if}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}
