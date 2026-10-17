<script>
  import { authState } from '#lib/state/authState.svelte.js';
  import PasswordChangeModal from '../../components/PasswordChangeModal.svelte';

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

    if (newPassword === 'konohagakure') {
      statusMessage = 'Cannot reuse the default bootstrap password.';
      isError = true;
      return;
    }

    if (newPassword !== confirmPassword) {
      statusMessage = 'New password and confirmation do not match.';
      isError = true;
      return;
    }

    isSubmitting = true;
    try {
      await authState.changePassword(currentPassword, newPassword);
      statusMessage = 'Password updated successfully! Future logins will require this credential.';
      isError = false;
      currentPassword = '';
      newPassword = '';
      confirmPassword = '';
    } catch (err) {
      statusMessage = err.message || 'Failed to update password.';
      isError = true;
    } finally {
      isSubmitting = false;
    }
  }
</script>

<div class="space-y-6 max-w-4xl mx-auto">
  <!-- Header -->
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b" style="border-color: var(--color-border);">
    <div>
      <h1 class="text-xl sm:text-2xl font-black tracking-tight" style="color: var(--color-text);">
        Security & Settings
      </h1>
      <p class="text-xs sm:text-sm mt-0.5" style="color: var(--color-text-muted);">
        Manage your Konoha Console access credentials, sessions, and security posture.
      </p>
    </div>

    <div class="flex items-center gap-2">
      <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-[5px] text-xs font-semibold {authState.isBootstrap ? 'bg-amber-500/15 text-amber-600 border border-amber-500/30' : 'bg-emerald-500/15 text-emerald-600 border border-emerald-500/30'}">
        <span class="w-2 h-2 rounded-full {authState.isBootstrap ? 'bg-amber-500' : 'bg-emerald-500'}"></span>
        {authState.isBootstrap ? 'Bootstrap Credential Active' : 'Hardened Password Active'}
      </span>
    </div>
  </div>

  <!-- Password Change Card -->
  <div
    class="glass-frost rounded-[6px] p-6 sm:p-8 border shadow-lg space-y-6"
    style="background-color: var(--color-card-bg); border-color: var(--color-card-border);"
  >
    <div class="flex items-start gap-4">
      <div class="w-12 h-12 rounded-[5px] flex items-center justify-center shrink-0 border border-sky-400/40 bg-sky-500/10 text-sky-500">
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
      <div class="p-3 rounded-[5px] text-xs font-semibold border {isError ? 'border-rose-500/30 bg-rose-500/10 text-rose-600' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600'} animate-in fade-in">
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
          placeholder="Default: konohagakure"
          class="w-full px-3.5 py-2.5 rounded-[5px] text-xs font-mono border focus:outline-none transition-colors"
          style="background-color: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
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
          class="w-full px-3.5 py-2.5 rounded-[5px] text-xs font-mono border focus:outline-none transition-colors"
          style="background-color: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
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
          class="w-full px-3.5 py-2.5 rounded-[5px] text-xs font-mono border focus:outline-none transition-colors"
          style="background-color: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
          autocomplete="new-password"
        />
      </div>

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
