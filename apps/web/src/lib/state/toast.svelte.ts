/**
 * apps/web/src/lib/state/toast.svelte.ts
 *
 * Modern Svelte 5 Runes Toast Notification Store.
 * Supports success, error, warning, info, and interactive progress/loading toasts
 * with queueing, deduplication, auto-dismiss with visual progress, hover/focus pause,
 * and theme-integrated styling.
 */

export type ToastVariant = 'success' | 'error' | 'warning' | 'info' | 'loading';

export interface ToastAction {
  label: string;
  onClick: (toast: ToastItem) => void;
  primary?: boolean;
}

export interface ToastOptions {
  title?: string;
  duration?: number; // Duration in ms; 0 or Infinity for persistent (loading)
  action?: ToastAction;
  dismissible?: boolean;
  progress?: number; // 0 to 100 for loading/progress toasts
}

export interface ToastItem {
  id: string;
  variant: ToastVariant;
  message: string;
  title?: string;
  duration: number;
  remaining: number;
  progress?: number;
  action?: ToastAction;
  dismissible: boolean;
  createdAt: number;
  isPaused: boolean;
}

export interface LoadingToastController {
  id: string;
  update: (options: { message?: string; title?: string; progress?: number }) => void;
  success: (message?: string, options?: ToastOptions) => void;
  error: (message?: string, options?: ToastOptions) => void;
  warning: (message?: string, options?: ToastOptions) => void;
  info: (message?: string, options?: ToastOptions) => void;
  dismiss: () => void;
}

const MAX_VISIBLE_TOASTS = 5;
const DEFAULT_DURATION = 4500;
const DEDUPE_WINDOW_MS = 1500;

class ToastManager {
  private _toasts = $state<ToastItem[]>([]);
  private _queue = $state<ToastItem[]>([]);
  private _timers = new Map<string, { intervalId?: any; lastTick?: number }>();
  private _recentHashes = new Map<string, number>();
  private _nextId = 1;

  constructor() {
    // SSR guard
  }

  get toasts(): ToastItem[] {
    return this._toasts;
  }

  get visibleCount(): number {
    return this._toasts.length;
  }

  get queueCount(): number {
    return this._queue.length;
  }

  private _isDuplicate(message: string, variant: ToastVariant, title?: string): boolean {
    const now = Date.now();
    const key = `${variant}:${title || ''}:${message}`;
    const lastSeen = this._recentHashes.get(key);
    if (lastSeen && now - lastSeen < DEDUPE_WINDOW_MS) {
      return true;
    }
    this._recentHashes.set(key, now);

    // Prune stale hashes
    for (const [k, timestamp] of this._recentHashes.entries()) {
      if (now - timestamp > 5000) {
        this._recentHashes.delete(k);
      }
    }
    return false;
  }

  private _createToast(variant: ToastVariant, message: string, options: ToastOptions = {}): ToastItem {
    const id = `toast-${this._nextId++}-${Math.random().toString(36).slice(2, 6)}`;
    const duration = variant === 'loading'
      ? (options.duration && options.duration > 0 ? options.duration : 0)
      : (typeof options.duration === 'number' ? options.duration : DEFAULT_DURATION);

    return {
      id,
      variant,
      message,
      title: options.title,
      duration,
      remaining: duration,
      progress: options.progress,
      action: options.action,
      dismissible: options.dismissible !== false,
      createdAt: Date.now(),
      isPaused: false
    };
  }

  private _scheduleAutoDismiss(item: ToastItem) {
    if (item.duration <= 0 || item.duration === Infinity) return;

    this._clearTimer(item.id);

    const stepMs = 50;
    const timer = {
      lastTick: Date.now(),
      intervalId: setInterval(() => {
        const target = this._toasts.find(t => t.id === item.id);
        if (!target) {
          this._clearTimer(item.id);
          return;
        }

        if (target.isPaused) {
          timer.lastTick = Date.now();
          return;
        }

        const now = Date.now();
        const delta = now - (timer.lastTick || now);
        timer.lastTick = now;

        target.remaining = Math.max(0, target.remaining - delta);

        if (target.remaining <= 0) {
          this._clearTimer(item.id);
          this.dismiss(item.id);
        }
      }, stepMs)
    };

    this._timers.set(item.id, timer);
  }

  private _clearTimer(id: string) {
    const timer = this._timers.get(id);
    if (timer?.intervalId) {
      clearInterval(timer.intervalId);
    }
    this._timers.delete(id);
  }

  private _processQueue() {
    while (this._toasts.length < MAX_VISIBLE_TOASTS && this._queue.length > 0) {
      const next = this._queue.shift()!;
      this._toasts = [...this._toasts, next];
      this._scheduleAutoDismiss(next);
    }
  }

  private _addToast(variant: ToastVariant, message: string, options: ToastOptions = {}): string {
    const cleanMessage = String(message || '').trim();
    if (!cleanMessage) return '';

    if (this._isDuplicate(cleanMessage, variant, options.title)) {
      return '';
    }

    const item = this._createToast(variant, cleanMessage, options);

    if (this._toasts.length < MAX_VISIBLE_TOASTS) {
      this._toasts = [...this._toasts, item];
      this._scheduleAutoDismiss(item);
    } else {
      this._queue = [...this._queue, item];
    }

    return item.id;
  }

  success(message: string, options?: ToastOptions): string {
    return this._addToast('success', message, options);
  }

  error(message: string, options?: ToastOptions): string {
    return this._addToast('error', message, options);
  }

  warning(message: string, options?: ToastOptions): string {
    return this._addToast('warning', message, options);
  }

  info(message: string, options?: ToastOptions): string {
    return this._addToast('info', message, options);
  }

  loading(message: string, options?: ToastOptions): LoadingToastController {
    const id = this._addToast('loading', message, { duration: 0, ...options });

    const controller: LoadingToastController = {
      id,
      update: (opts) => {
        const target = this._toasts.find(t => t.id === id);
        if (target) {
          if (opts.message !== undefined) target.message = opts.message;
          if (opts.title !== undefined) target.title = opts.title;
          if (opts.progress !== undefined) target.progress = opts.progress;
        }
      },
      success: (msg, opts) => {
        this._convert(id, 'success', msg, opts);
      },
      error: (msg, opts) => {
        this._convert(id, 'error', msg, opts);
      },
      warning: (msg, opts) => {
        this._convert(id, 'warning', msg, opts);
      },
      info: (msg, opts) => {
        this._convert(id, 'info', msg, opts);
      },
      dismiss: () => {
        this.dismiss(id);
      }
    };

    return controller;
  }

  private _convert(id: string, variant: ToastVariant, message?: string, options: ToastOptions = {}) {
    const target = this._toasts.find(t => t.id === id);
    if (!target) return;

    this._clearTimer(id);

    target.variant = variant;
    if (message) target.message = message;
    if (options.title !== undefined) target.title = options.title;
    if (options.action !== undefined) target.action = options.action;
    target.progress = undefined;

    const duration = typeof options.duration === 'number' ? options.duration : DEFAULT_DURATION;
    target.duration = duration;
    target.remaining = duration;

    this._scheduleAutoDismiss(target);
  }

  dismiss(id: string) {
    this._clearTimer(id);
    this._toasts = this._toasts.filter(t => t.id !== id);
    this._queue = this._queue.filter(t => t.id !== id);
    this._processQueue();
  }

  clear() {
    for (const id of this._timers.keys()) {
      this._clearTimer(id);
    }
    this._toasts = [];
    this._queue = [];
  }

  pause(id: string) {
    const target = this._toasts.find(t => t.id === id);
    if (target) {
      target.isPaused = true;
    }
  }

  resume(id: string) {
    const target = this._toasts.find(t => t.id === id);
    if (target) {
      target.isPaused = false;
      const timer = this._timers.get(id);
      if (timer) {
        timer.lastTick = Date.now();
      }
    }
  }
}

export const toast = new ToastManager();
