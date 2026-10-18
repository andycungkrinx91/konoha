<script>
  import { authState } from '#lib/state/authState.svelte.js';
  import PasswordChangeModal from '../../components/PasswordChangeModal.svelte';
  import PageHero from '../../components/PageHero.svelte';
  import { toast } from '#lib/state/toast.svelte.ts';
  import { confirm } from '#lib/state/dialog.svelte.ts';

  let currentPassword = $state('');
  let newPassword = $state('');
  let confirmPassword = $state('');
  let showPasswords = $state(false);
  let isSubmitting = $state(false);
  let statusMessage = $state('');
  let isError = $state(false);

  // Reset password state
  let resetCurrentPassword = $state('');
  let isResetting = $state(false);
  let resetStatusMessage = $state('');
  let isResetError = $state(false);

  async function handleSubmit(e) {
    e.preventDefault();
    statusMessage = '';
    isError = false;

    if (!newPassword || newPassword.length < 8) {
      statusMessage = 'New password must be at least 8 characters long.';
      isError = true;
      return;
    }

    if (!currentPassword) {
      statusMessage = 'Enter your current password.';
      isError = true;
      return;
    }

    if (newPassword !== confirmPassword) {
      statusMessage = 'New password and confirmation do not match.';
      isError = true;
      toast.warning('New password and confirmation do not match.');
      return;
    }

    isSubmitting = true;
    try {
      await authState.changePassword(currentPassword, newPassword);
      toast.success('Password updated successfully! Logging out to verify new credentials...');
      currentPassword = '';
      newPassword = '';
      confirmPassword = '';
    } catch (err) {
      statusMessage = err.message || 'Failed to update password.';
      isError = true;
      toast.error('Failed to update password: ' + (err.message || 'Error'));
    } finally {
      isSubmitting = false;
    }
  }

  async function handleResetPassword(e) {
    e.preventDefault();
    resetStatusMessage = '';
    isResetError = false;

    if (!resetCurrentPassword) {
      resetStatusMessage = 'Enter your current password to authorize reset.';
      isResetError = true;
      return;
    }

    const confirmed = await confirm({
      title: 'Reset Password to Default?',
      message: 'Are you sure you want to reset your password back to default (konohagakure)? All active sessions will be terminated immediately.',
      confirmText: 'Reset Password',
      variant: 'danger'
    });
    if (!confirmed) return;

    isResetting = true;
    try {
      await authState.resetPassword(resetCurrentPassword);
      toast.success('Password reset to default (konohagakure). Logging out to login page...');
      resetCurrentPassword = '';
    } catch (err) {
      resetStatusMessage = err.message || 'Failed to reset password.';
      isResetError = true;
      toast.error('Failed to reset password: ' + (err.message || 'Error'));
    } finally {
      isResetting = false;
    }
  }
</script>

<div class="space-y-6 w-full">
  {#snippet heroActions()}
    <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-[3px] text-xs font-semibold border {authState.isBootstrap ? 'bg-status-warning-soft text-status-warning border-status-warning-soft' : 'bg-status-success-soft text-status-success border-status-success-soft'}">
      <span class="w-2 h-2 rounded-full {authState.isBootstrap ? 'bg-status-warning' : 'bg-status-success'}"></span>
      {authState.isBootstrap ? 'Bootstrap Credential Active' : 'Hardened Argon2 Password Active'}
    </span>
  {/snippet}

  <!-- Hero Section: themed translucent surface with high-contrast typography -->
  <PageHero
    title="Security & Settings"
    badgeText="Argon2id Encrypted Authentication"
    description="Manage your Konoha Console access credentials, sessions, and security posture with Argon2id encryption."
    actions={heroActions}
  />

  <!-- Password Change Card (3D Glass Metric Card) -->
  <div
    class="metric-card-3d rounded-[5px] p-6 sm:p-8 border space-y-6"
    style="border-color: color-mix(in srgb, var(--theme-grad-1) 28%, var(--color-border));"
  >
    <div class="flex items-start gap-4">
      <div class="w-12 h-12 rounded-[3px] flex items-center justify-center shrink-0 border-status-info-soft bg-status-info-soft text-status-info">
        <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      </div>

      <div class="space-y-1">
        <h2 class="text-base font-bold" style="color: var(--color-text);">
          Update Access Passphrase (Argon2id)
        </h2>
        <p class="text-xs leading-relaxed" style="color: var(--color-text-muted);">
          Konoha enforces Argon2id password encryption for maximum resilience against offline cracking attacks. Updating your password invalidates all existing sessions and returns you to the login screen.
        </p>
      </div>
    </div>

    {#if statusMessage}
      <div role={isError ? 'alert' : 'status'} class="p-3 rounded-[3px] text-xs font-semibold border animate-in fade-in {isError ? 'badge-status badge-status-danger' : 'badge-status badge-status-success'}">
        {statusMessage}
      </div>
    {/if}

    <form onsubmit={handleSubmit} class="space-y-4 max-w-lg">
      <div>
        <label for="settings-current-password" class="block text-xs font-bold uppercase tracking-wider mb-1" style="color: var(--color-text-muted);">
          Current Password
        </label>
        <input
          id="settings-current-password"
          type={showPasswords ? "text" : "password"}
          bind:value={currentPassword}
          placeholder="Enter current password"
          class="w-full px-3.5 py-2.5 rounded-[3px] text-xs font-mono border login-field-effect input-theme"
          style="background-color: var(--color-surface); color: var(--color-text);"
          autocomplete="current-password"
        />
      </div>

      <div>
        <label for="settings-new-password" class="block text-xs font-bold uppercase tracking-wider mb-1" style="color: var(--color-text-muted);">
          New Secure Password (Min 8 Characters)
        </label>
        <input
          id="settings-new-password"
          type={showPasswords ? "text" : "password"}
          bind:value={newPassword}
          placeholder="Enter new password"
          required
          class="w-full px-3.5 py-2.5 rounded-[3px] text-xs font-mono border login-field-effect input-theme"
          style="background-color: var(--color-surface); color: var(--color-text);"
          autocomplete="new-password"
        />
      </div>

      <div>
        <label for="settings-confirm-password" class="block text-xs font-bold uppercase tracking-wider mb-1" style="color: var(--color-text-muted);">
          Confirm New Password
        </label>
        <input
          id="settings-confirm-password"
          type={showPasswords ? "text" : "password"}
          bind:value={confirmPassword}
          placeholder="Re-enter new password"
          required
          class="w-full px-3.5 py-2.5 rounded-[3px] text-xs font-mono border login-field-effect input-theme"
          style="background-color: var(--color-surface); color: var(--color-text);"
          autocomplete="new-password"
        />
      </div>

      <div class="flex items-center justify-between text-xs pt-1">
        <label class="flex items-center gap-2 cursor-pointer select-none" style="color: var(--color-text-muted);">
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
          disabled={isSubmitting}
          class="px-6 py-2.5 rounded-[3px] text-xs font-bold text-white transition-all duration-200 cursor-pointer shadow-lg disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-110 active:scale-[0.98]"
          style="background: var(--theme-4gradient, linear-gradient(135deg, #0284c7, #06b6d4));"
        >
          {#if isSubmitting}
            Updating Password...
          {:else}
            Save New Password (Argon2id)
          {/if}
        </button>
      </div>
    </form>
  </div>

  <!-- Reset Password Card (Feedback 4) -->
  <div
    class="metric-card-3d rounded-[5px] p-6 sm:p-8 border space-y-6"
    style="border-color: color-mix(in srgb, var(--theme-danger, #ef4444) 30%, var(--color-border));"
  >
    <div class="flex items-start gap-4">
      <div class="w-12 h-12 rounded-[3px] flex items-center justify-center shrink-0 border-status-danger-soft bg-status-danger-soft text-status-danger">
        <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      </div>

      <div class="space-y-1">
        <h2 class="text-base font-bold text-status-danger">
          Reset Password to Default
        </h2>
        <p class="text-xs leading-relaxed" style="color: var(--color-text-muted);">
          Authorized users can reset the gateway credential back to the default bootstrap password (<code>konohagakure</code>). This requires your current active password. Once reset, all active sessions terminate immediately and you will be returned to the login screen.
        </p>
      </div>
    </div>

    {#if resetStatusMessage}
      <div role={isResetError ? 'alert' : 'status'} class="p-3 rounded-[3px] text-xs font-semibold border animate-in fade-in {isResetError ? 'badge-status badge-status-danger' : 'badge-status badge-status-success'}">
        {resetStatusMessage}
      </div>
    {/if}

    <form onsubmit={handleResetPassword} class="space-y-4 max-w-lg">
      <div>
        <label for="settings-reset-current-password" class="block text-xs font-bold uppercase tracking-wider mb-1" style="color: var(--color-text-muted);">
          Authorize with Current Password
        </label>
        <input
          id="settings-reset-current-password"
          type={showPasswords ? "text" : "password"}
          bind:value={resetCurrentPassword}
          placeholder="Enter current password to verify authority"
          required
          class="w-full px-3.5 py-2.5 rounded-[3px] text-xs font-mono border login-field-effect input-theme"
          style="background-color: var(--color-surface); color: var(--color-text);"
          autocomplete="current-password"
        />
      </div>

      <div class="pt-2">
        <button
          type="submit"
          disabled={isResetting}
          class="px-6 py-2.5 rounded-[3px] text-xs font-bold text-white transition-all duration-200 cursor-pointer shadow-lg disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-110 active:scale-[0.98] bg-status-danger hover:bg-status-danger"
        >
          {#if isResetting}
            Resetting Credential...
          {:else}
            Reset to Default Password (konohagakure)
          {/if}
        </button>
      </div>
    </form>
  </div>
</div>
