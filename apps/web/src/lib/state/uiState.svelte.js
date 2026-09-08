/* eslint-disable no-undef */
// Svelte 5 Runes state management for Konoha Web UI

export function createUiState() {
  let activeScreen = $state('bridges');
  let notifications = $state([]);
  let isConnected = $state(false);

  return {
    get activeScreen() { return activeScreen; },
    set activeScreen(screen) { activeScreen = screen; },
    get notifications() { return notifications; },
    get isConnected() { return isConnected; },
    set isConnected(val) { isConnected = val; },
    addNotification(text, type = 'info') {
      const id = Date.now();
      notifications = [...notifications, { id, text, type }];
      setTimeout(() => {
        notifications = notifications.filter(n => n.id !== id);
      }, 4000);
    }
  };
}

export const uiState = createUiState();
