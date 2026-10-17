<script>
  import { authState } from '#lib/state/authState.svelte.js';
  import PasswordChangeModal from '../../components/PasswordChangeModal.svelte';
  import PageHero from '../../components/PageHero.svelte';
  import { toast } from '#lib/state/toast.svelte.ts';

  let currentPassword = $state('');
  let newPassword = $state('');
  let confirmPassword = $state('');
  let showPasswords = $state(false);
  let isSubmitting = $state(false);
  let statusMessage = $state('');
  let isError = $state(false);

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
      statusMessage = 'Password updated successfully! Future logins will require this credential.';
      isError = false;
      toast.success('Password updated successfully! Future logins will require this credential.');
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
</script>

<div class="space-y-6 w-full">
  {#snippet heroActions()}
    <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-[5px] text-xs font-semibold border {authState.isBootstrap ? 'bg-status-warning-soft text-status-warning border-status-warning-soft' : 'bg-status-success-soft text-status-success border-status-success-soft'}">
      <span class="w-2 h-2 rounded-full {authState.isBootstrap ? 'bg-status-warning' : 'bg-status-success'}"></span>
      {authState.isBootstrap ? 'Bootstrap Credential Active' : 'Hardened Password Active'}
    </span>
  {/snippet}

  <!-- Hero Section: themed translucent surface with high-contrast typography -->
  <PageHero
    title="Security & Settings"
    badgeText="Salted scrypt Authentication"
    description="Manage your Konoha Console access credentials, sessions, and security posture."
    actions={heroActions}
  />

  <!-- Password Change Card (3D Glass Metric Card) -->
  <div
    class="metric-card-3d rounded-[5px] p-6 sm:p-8 border space-y-6"
    style="border-color: color-mix(in srgb, var(--theme-grad-1) 28%, var(--color-border));"
  >
    <div class="flex items-start gap-4">
      <div class="w-12 h-12 rounded-[5px] flex items-center justify-center shrink-0 border-status-info-soft bg-status-info-soft text-status-info">
        <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      </div>

      <div class="space-y-1">
        <h2 class="text-base font-bold" style="color: var(--color-text);">
          Update Access Passphrase
        </h2>
        <p class="text-xs leading-relaxed" style="color: var(--color-text-muted);">
          Konoha requires salted scrypt authentication for all local and remote dashboard access. When updating your password, verify that it meets the minimum security length of 8 characters.
        </p>
      </div>
    </div>

    {#if statusMessage}
      <div role={isError ? 'alert' : 'status'} class="p-3 rounded-[5px] text-xs font-semibold border animate-in fade-in {isError ? 'badge-status badge-status-danger' : 'badge-status badge-status-success'}">
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
          class="w-full px-3.5 py-2.5 rounded-[5px] text-xs font-mono border login-field-effect input-theme"
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
          class="w-full px-3.5 py-2.5 rounded-[5px] text-xs font-mono border login-field-effect input-theme"
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
          class="w-full px-3.5 py-2.5 rounded-[5px] text-xs font-mono border login-field-effect input-theme"
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
          class="px-6 py-2.5 rounded-[5px] text-xs font-bold text-white transition-all duration-200 cursor-pointer shadow-lg disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-110 active:scale-[0.98]"
          style="background: var(--theme-4gradient, linear-gradient(135deg, #0284c7, #06b6d4));"
        >
          {#if isSubmitting}
            Updating Password...
          {:else}
            Save New Password
          {/if}
        </button>
      </div>
    </form>
  </div>
</div>
