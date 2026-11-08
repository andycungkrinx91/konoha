// Svelte 5 Runes State for Konoha Authentication & Password Policy
import { getAuthStatus, login as apiLogin, changePassword as apiChangePassword, setupInitialPassword as apiSetupInitialPassword, resetPassword as apiResetPassword, logout as apiLogout } from '#lib/api.js';

function createAuthState() {
  let isAuthenticated = $state(false);
  let isBootstrap = $state(true);
  let needsInitialSetup = $state(true);
  let requiresPasswordChange = $state(false);
  let isChecking = $state(true);
  let showPasswordChangeModal = $state(false);

  function resetSession() {
    isAuthenticated = false;
    isBootstrap = false;
    needsInitialSetup = false;
    requiresPasswordChange = false;
    showPasswordChangeModal = false;
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('konoha:session-expired', () => {
      resetSession();
    });
  }

  async function checkAuth() {
    isChecking = true;
    try {
      const status = await getAuthStatus();
      isAuthenticated = Boolean(status.authenticated);
      isBootstrap = Boolean(status.is_bootstrap);
      needsInitialSetup = Boolean(status.needs_initial_setup ?? status.is_bootstrap);
      requiresPasswordChange = Boolean(status.requires_password_change);
      showPasswordChangeModal = isAuthenticated && requiresPasswordChange;
    } catch (_) {
      resetSession();
    } finally {
      isChecking = false;
    }
  }

  // Resolves with the server-confirmed result; `deferCommit` lets the caller
  // finish its animation timeline before committing state.
  async function login(password, deferCommit = false) {
    const data = await apiLogin(password);
    if (!deferCommit) {
      commitLogin(data);
    }
    return data;
  }

  function commitLogin(data) {
    if (!data || typeof data !== 'object') return;
    isAuthenticated = true;
    isBootstrap = Boolean(data.is_bootstrap);
    needsInitialSetup = Boolean(data.is_bootstrap);
    requiresPasswordChange = Boolean(data.requires_password_change);
    showPasswordChangeModal = requiresPasswordChange;
  }

  // Password changes invalidate all active sessions; local state resets to force clean login.
  async function changePassword(currentPassword, newPassword, confirmPassword) {
    const result = await apiChangePassword(currentPassword, newPassword, confirmPassword);
    if (result && result.ok) {
      resetSession();
      await checkAuth();
    }
    return result;
  }

  async function setupInitialPassword(newPassword, confirmPassword) {
    const result = await apiSetupInitialPassword(newPassword, confirmPassword);
    if (result && result.ok) {
      resetSession();
      await checkAuth();
    }
    return result;
  }

  async function resetPassword(currentPassword) {
    const result = await apiResetPassword(currentPassword);
    if (result && result.ok) {
      resetSession();
    }
    return result;
  }

  async function logout() {
    try {
      await apiLogout();
    } catch (_) {
      // Ignore transport errors — local session state is cleared regardless.
    }
    resetSession();
    isChecking = false;
    return { ok: true };
  }

  function openPasswordChangeModal() {
    if (isAuthenticated) {
      showPasswordChangeModal = true;
    }
  }

  function closePasswordChangeModal() {
    // Cannot close while a password change is strictly mandatory.
    if (!requiresPasswordChange) {
      showPasswordChangeModal = false;
    }
  }

  return {
    get isAuthenticated() { return isAuthenticated; },
    get isBootstrap() { return isBootstrap; },
    get needsInitialSetup() { return needsInitialSetup; },
    get requiresPasswordChange() { return requiresPasswordChange; },
    get isChecking() { return isChecking; },
    get showPasswordChangeModal() { return showPasswordChangeModal; },
    checkAuth,
    login,
    commitLogin,
    changePassword,
    setupInitialPassword,
    resetPassword,
    logout,
    resetSession,
    openPasswordChangeModal,
    closePasswordChangeModal
  };
}

export const authState = createAuthState();
