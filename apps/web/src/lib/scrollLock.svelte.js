/* eslint-disable no-undef */
// Shared body scroll-lock for modal overlays (Svelte 5 rune effect)
// Call during component init: useScrollLock(someModalOpenState);

export function useScrollLock(isActive) {
  $effect(() => {
    if (isActive && typeof document !== 'undefined') {
      const previous = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = previous;
      };
    }
  });
}
