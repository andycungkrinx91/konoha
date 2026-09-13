/* eslint-disable no-undef */
// Svelte 5 Runes State for 3D SweetAlert Modal System

function createSweetAlertState() {
  let isOpen = $state(false);
  let title = $state("");
  let text = $state("");
  let icon = $state("info"); // "success" | "error" | "warning" | "info"
  let showCancel = $state(false);
  let confirmText = $state("OK");
  let cancelText = $state("Cancel");
  let resolvePromise = null;
  let autoDismissTimer = null;

  function clearAutoDismiss() {
    if (autoDismissTimer) {
      clearTimeout(autoDismissTimer);
      autoDismissTimer = null;
    }
  }

  function settlePendingResolve() {
    // A new modal replacing a pending one must settle the old promise (as
    // cancelled), otherwise the caller's `await` hangs forever.
    if (resolvePromise) {
      resolvePromise(false);
      resolvePromise = null;
    }
  }

  function fire({ title: t, text: msg, icon: ic = "info", confirmText: cText = "OK", timer = 0 }) {
    clearAutoDismiss();
    settlePendingResolve();
    title = t || "Notification";
    text = msg || "";
    icon = ic;
    showCancel = false;
    confirmText = cText;
    isOpen = true;
    const promise = new Promise((resolve) => {
      resolvePromise = resolve;
    });
    if (timer > 0) {
      autoDismissTimer = setTimeout(() => {
        if (resolvePromise) resolvePromise(true);
        resolvePromise = null;
        isOpen = false;
      }, timer);
    }
    return promise;
  }

  function confirm({ title: t, text: msg, icon: ic = "warning", confirmText: cText = "Confirm", cancelText: canText = "Cancel" }) {
    clearAutoDismiss();
    settlePendingResolve();
    title = t || "Are you sure?";
    text = msg || "";
    icon = ic;
    showCancel = true;
    confirmText = cText;
    cancelText = canText;
    isOpen = true;
    return new Promise((resolve) => {
      resolvePromise = resolve;
    });
  }

  function handleConfirm() {
    clearAutoDismiss();
    isOpen = false;
    if (resolvePromise) resolvePromise(true);
    resolvePromise = null;
  }

  function handleCancel() {
    clearAutoDismiss();
    isOpen = false;
    if (resolvePromise) resolvePromise(false);
    resolvePromise = null;
  }

  return {
    get isOpen() { return isOpen; },
    get title() { return title; },
    get text() { return text; },
    get icon() { return icon; },
    get showCancel() { return showCancel; },
    get confirmText() { return confirmText; },
    get cancelText() { return cancelText; },
    fire,
    confirm,
    handleConfirm,
    handleCancel
  };
}

export const sweetAlert = createSweetAlertState();
