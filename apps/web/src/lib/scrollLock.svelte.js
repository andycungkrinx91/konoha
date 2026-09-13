/* eslint-disable no-undef */
// Shared body scroll-lock for modal overlays (Svelte 5 rune effect)
// Call during component init: useScrollLock(() => someModalOpenState);
// Accepts a getter so the $effect tracks reactive state instead of
// capturing the initial (always false) value.

export function useScrollLock(getIsActive) {
  $effect(() => {
    if (getIsActive() && typeof document !== 'undefined') {
      const previous = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = previous;
      };
    }
  });
}
