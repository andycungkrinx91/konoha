// Svelte 5 Runes state management for Konoha Web UI with unified Toast integration
import { toast } from '#lib/state/toast.svelte.ts';

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
      if (type === 'success') {
        toast.success(text);
      } else if (type === 'error') {
        toast.error(text);
      } else if (type === 'warning') {
        toast.warning(text);
      } else {
        toast.info(text);
      }
    }
  };
}

export const uiState = createUiState();
