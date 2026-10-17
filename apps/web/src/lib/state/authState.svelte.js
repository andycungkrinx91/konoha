// Svelte 5 Runes State for Konoha Authentication & Password Policy
import { getAuthStatus, login as apiLogin, changePassword as apiChangePassword, logout as apiLogout } from '#lib/api.js';

function createAuthState() {
  let isAuthenticated = $state(false);
  let isBootstrap = $state(false);
  let requiresPasswordChange = $state(false);
  let isChecking = $state(true);
  let showPasswordChangeModal = $state(false);

  async function checkAuth() {
    isChecking = true;
    try {
      const status = await getAuthStatus();
      isAuthenticated = Boolean(status.authenticated);
      isBootstrap = Boolean(status.is_bootstrap);
      requiresPasswordChange = Boolean(status.requires_password_change);

      if (isAuthenticated && requiresPasswordChange) {
        showPasswordChangeModal = true;
      }
    } catch (_) {
      isAuthenticated = false;
    } finally {
      isChecking = false;
    }
  }

  async function login(password) {
    const data = await apiLogin(password);
    isAuthenticated = true;
    isBootstrap = Boolean(data.is_bootstrap);
    requiresPasswordChange = Boolean(data.requires_password_change);

    if (requiresPasswordChange) {
      showPasswordChangeModal = true;
    }

    return data;
  }

  async function changePassword(currentPassword, newPassword) {
    const result = await apiChangePassword(currentPassword, newPassword);
    isBootstrap = false;
    requiresPasswordChange = false;
    showPasswordChangeModal = false;
    return result;
  }

  async function logout() {
    try {
      await apiLogout();
    } catch (_) {}
    isAuthenticated = false;
    isBootstrap = false;
    requiresPasswordChange = false;
    showPasswordChangeModal = false;
  }

  function openPasswordChangeModal() {
    showPasswordChangeModal = true;
  }

  function closePasswordChangeModal() {
    // Cannot close if password change is strictly mandatory
    if (!requiresPasswordChange) {
      showPasswordChangeModal = false;
    }
  }

  return {
    get isAuthenticated() { return isAuthenticated; },
    get isBootstrap() { return isBootstrap; },
    get requiresPasswordChange() { return requiresPasswordChange; },
    get isChecking() { return isChecking; },
    get showPasswordChangeModal() { return showPasswordChangeModal; },
    checkAuth,
    login,
    changePassword,
    logout,
    openPasswordChangeModal,
    closePasswordChangeModal
  };
}

export const authState = createAuthState();
