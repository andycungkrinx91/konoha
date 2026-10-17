<script>
  import { authState } from '#lib/state/authState.svelte.js';
  import { useScrollLock } from '#lib/scrollLock.svelte.js';

  const MIN_PASSWORD_LENGTH = 8;

  let currentPassword = $state('');
  let newPassword = $state('');
  let confirmPassword = $state('');
  let showPasswords = $state(false);
  let isSubmitting = $state(false);
  let errorMessage = $state('');
  let successMessage = $state('');
  let currentInputEl = $state(null);

  useScrollLock(() => authState.showPasswordChangeModal);

  // Focus the current-password field whenever the dialog opens.
  $effect(() => {
    if (authState.showPasswordChangeModal && currentInputEl && !isSubmitting) {
      currentInputEl.focus();
    }
  });

  async function handleSubmit(e) {
    e.preventDefault();
    if (isSubmitting) return;
    errorMessage = '';
    successMessage = '';

    if (!currentPassword) {
      errorMessage = 'Enter your current password.';
      return;
    }

    if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
      errorMessage = `New password must be at least ${MIN_PASSWORD_LENGTH} characters long.`;
      return;
    }

    if (newPassword !== confirmPassword) {
      errorMessage = 'New password and confirmation do not match.';
      return;
    }

    isSubmitting = true;
    try {
      await authState.changePassword(currentPassword, newPassword);
      currentPassword = '';
      newPassword = '';
      confirmPassword = '';
      successMessage = 'Password updated. Dashboard access granted.';
    } catch (err) {
      // The server keeps the bootstrap flag on failure, so the dialog stays open.
      errorMessage = err.message || 'Failed to update password.';
    } finally {
      isSubmitting = false;
    }
  }

  function handleKeydown(e) {
    if (e.key !== 'Escape') return;
    if (authState.showPasswordChangeModal && !authState.requiresPasswordChange) {
      authState.closePasswordChangeModal();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if authState.showPasswordChangeModal}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-[110] flex items-center justify-center p-4 animate-in fade-in duration-200"
    style="background-color: var(--theme-overlay);"
    onclick={(e) => {
      if (e.target === e.currentTarget && !authState.requiresPasswordChange) {
        authState.closePasswordChangeModal();
      }
    }}
  >
    <div
      class="modal-card modal-3d relative w-full max-w-md rounded-[6px] p-6 sm:p-8 border shadow-2xl transition-all duration-300 transform scale-100 overflow-hidden glass-frost-strong"
      style="border-color: var(--theme-modal-border, var(--color-border)); box-shadow: var(--theme-modal-shadow, var(--shadow-3d-hover)); background-color: var(--color-surface); color: var(--color-text);"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="password-change-title"
      aria-describedby="password-change-description"
    >
      {#if !authState.requiresPasswordChange}
        <button
          type="button"
          onclick={() => authState.closePasswordChangeModal()}
          class="absolute top-4 right-4 p-1.5 rounded-[5px] border transition-colors hover:brightness-110 cursor-pointer z-10 theme-bg-surface theme-border theme-text-muted"
          aria-label="Close dialog"
        >
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      {/if}

      <div class="flex justify-center mb-4">
        <div class="w-14 h-14 rounded-[6px] flex items-center justify-center shadow-lg border badge-status badge-status-warning animate-pulse-rasengan">
          <svg class="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
      </div>

      <div class="text-center space-y-2 mb-5">
        <h3 id="password-change-title" class="text-lg font-extrabold tracking-tight theme-text">
          {authState.requiresPasswordChange ? 'Mandatory Password Change' : 'Update Access Password'}
        </h3>
        <p id="password-change-description" class="text-xs leading-relaxed theme-text-secondary">
          {authState.requiresPasswordChange
            ? 'The initial bootstrap password (konohagakure) is currently active. For security hardening, you must set a private password before normal dashboard access is granted.'
            : 'Enter your current password and your new secure password below.'}
        </p>
      </div>

      {#if errorMessage}
        <div role="alert" class="p-3 mb-4 rounded-[5px] border text-xs font-semibold text-center animate-in fade-in badge-status badge-status-danger">
          {errorMessage}
        </div>
      {/if}

      {#if successMessage}
        <div role="status" class="p-3 mb-4 rounded-[5px] border text-xs font-semibold text-center animate-in fade-in badge-status badge-status-success">
          {successMessage}
        </div>
      {/if}

      <form onsubmit={handleSubmit} class="space-y-4" novalidate>
        <div>
          <label for="current-password" class="block text-xs font-bold uppercase tracking-wider mb-1 theme-text-secondary">
            Current Password
          </label>
          <input
            id="current-password"
            bind:this={currentInputEl}
            type={showPasswords ? 'text' : 'password'}
            bind:value={currentPassword}
            placeholder="Enter current password"
            class="w-full px-3.5 py-2.5 rounded-[5px] text-xs font-mono border input-theme theme-bg-surface theme-border theme-text"
            autocomplete="current-password"
            disabled={isSubmitting}
          />
        </div>

        <div>
          <label for="new-password" class="block text-xs font-bold uppercase tracking-wider mb-1 theme-text-secondary">
            New Password (Min 8 Characters)
          </label>
          <input
            id="new-password"
            type={showPasswords ? 'text' : 'password'}
            bind:value={newPassword}
            placeholder="Enter new strong password"
            required
            minlength={MIN_PASSWORD_LENGTH}
            class="w-full px-3.5 py-2.5 rounded-[5px] text-xs font-mono border input-theme theme-bg-surface theme-border theme-text"
            autocomplete="new-password"
            disabled={isSubmitting}
          />
        </div>

        <div>
          <label for="confirm-password" class="block text-xs font-bold uppercase tracking-wider mb-1 theme-text-secondary">
            Confirm New Password
          </label>
          <input
            id="confirm-password"
            type={showPasswords ? 'text' : 'password'}
            bind:value={confirmPassword}
            placeholder="Re-enter new password"
            required
            minlength={MIN_PASSWORD_LENGTH}
            class="w-full px-3.5 py-2.5 rounded-[5px] text-xs font-mono border input-theme theme-bg-surface theme-border theme-text"
            autocomplete="new-password"
            disabled={isSubmitting}
          />
        </div>

        <div class="flex items-center justify-between text-xs pt-1">
          <label class="flex items-center gap-2 cursor-pointer select-none theme-text-secondary">
            <input
              type="checkbox"
              bind:checked={showPasswords}
              class="rounded cursor-pointer accent-[var(--color-primary)]"
            />
            Show password characters
          </label>
        </div>

        <div class="pt-2">
          <button
            type="submit"
            disabled={isSubmitting || Boolean(successMessage)}
            class="w-full py-2.5 rounded-[5px] text-xs font-bold text-white transition-all duration-200 cursor-pointer shadow-lg disabled:opacity-60 disabled:cursor-not-allowed hover:brightness-110 active:scale-[0.98]"
            style="background: var(--theme-4gradient, linear-gradient(135deg, #0284c7, #06b6d4));"
          >
            {#if isSubmitting}
              <span class="inline-flex items-center gap-2">
                <svg class="animate-spin w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" aria-hidden="true">
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
