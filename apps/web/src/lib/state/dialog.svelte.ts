/**
 * apps/web/src/lib/state/dialog.svelte.ts
 *
 * Modern Svelte 5 Runes Dialog Store.
 * Powers native HTML5 <dialog> Confirm, Single-Input Prompt, and Multi-Field Form Dialogs.
 * Ensures sequential queuing (never stacks two modals), promise-based async resolution,
 * loading states, focus trapping, dirty-state protection, and secrets safety.
 */

export type DialogVariant = 'danger' | 'warning' | 'info';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: DialogVariant;
  onConfirm?: () => Promise<void> | void;
}

export interface FormFieldConfig {
  name: string;
  label: string;
  type?: 'text' | 'password' | 'number' | 'url' | 'email' | 'textarea' | 'select' | 'checkbox' | 'radio' | 'file';
  placeholder?: string;
  helperText?: string;
  defaultValue?: any;
  required?: boolean;
  options?: Array<{ label: string; value: string }>; // For select or radio
  validate?: (value: any, allValues: Record<string, any>) => string | null | undefined;
  autocomplete?: string;
}

export interface FormDialogOptions {
  title: string;
  message?: string;
  fields: FormFieldConfig[];
  submitText?: string;
  cancelText?: string;
  variant?: DialogVariant;
  onSubmit?: (values: Record<string, any>) => Promise<void> | void;
}

export interface PromptOptions {
  title: string;
  message?: string;
  placeholder?: string;
  defaultValue?: string;
  inputType?: 'text' | 'password' | 'number' | 'email' | 'url';
  required?: boolean;
  submitText?: string;
  cancelText?: string;
  validate?: (value: string) => string | null | undefined;
}

type DialogQueueItem =
  | {
      type: 'confirm';
      options: ConfirmOptions;
      resolve: (value: boolean) => void;
      triggerEl: HTMLElement | null;
    }
  | {
      type: 'form';
      options: FormDialogOptions;
      resolve: (values: Record<string, any> | null) => void;
      triggerEl: HTMLElement | null;
    };

class DialogManager {
  private _current = $state<DialogQueueItem | null>(null);
  private _queue: DialogQueueItem[] = [];
  private _isLoading = $state(false);
  private _errorMessage = $state<string | null>(null);

  get current(): DialogQueueItem | null {
    return this._current;
  }

  get isOpen(): boolean {
    return this._current !== null;
  }

  get isLoading(): boolean {
    return this._isLoading;
  }

  set isLoading(val: boolean) {
    this._isLoading = val;
  }

  get errorMessage(): string | null {
    return this._errorMessage;
  }

  set errorMessage(msg: string | null) {
    this._errorMessage = msg;
  }

  private _processNext() {
    if (this._current !== null) return;
    if (this._queue.length === 0) return;

    this._isLoading = false;
    this._errorMessage = null;
    this._current = this._queue.shift()!;
  }

  confirm(options: ConfirmOptions): Promise<boolean> {
    const triggerEl = typeof document !== 'undefined' ? (document.activeElement as HTMLElement) : null;

    return new Promise<boolean>((resolve) => {
      const item: DialogQueueItem = {
        type: 'confirm',
        options: {
          confirmText: options.variant === 'danger' ? 'Delete' : 'Confirm',
          cancelText: 'Cancel',
          variant: 'warning',
          ...options
        },
        resolve,
        triggerEl
      };

      this._queue.push(item);
      this._processNext();
    });
  }

  formDialog(options: FormDialogOptions): Promise<Record<string, any> | null> {
    const triggerEl = typeof document !== 'undefined' ? (document.activeElement as HTMLElement) : null;

    return new Promise<Record<string, any> | null>((resolve) => {
      const item: DialogQueueItem = {
        type: 'form',
        options: {
          submitText: 'Submit',
          cancelText: 'Cancel',
          variant: 'info',
          ...options
        },
        resolve,
        triggerEl
      };

      this._queue.push(item);
      this._processNext();
    });
  }

  prompt(options: PromptOptions): Promise<string | null> {
    const field: FormFieldConfig = {
      name: 'input',
      label: options.title,
      type: options.inputType || 'text',
      placeholder: options.placeholder,
      defaultValue: options.defaultValue || '',
      required: options.required,
      validate: options.validate ? (val) => options.validate!(String(val || '')) : undefined
    };

    return this.formDialog({
      title: options.title,
      message: options.message,
      fields: [field],
      submitText: options.submitText || 'OK',
      cancelText: options.cancelText || 'Cancel'
    }).then((res) => {
      if (!res) return null;
      return String(res.input !== undefined ? res.input : '');
    });
  }

  async resolveCurrent(result: any) {
    const item = this._current;
    if (!item) return;

    // Return focus to triggering element cleanly
    if (item.triggerEl && typeof item.triggerEl.focus === 'function') {
      try {
        item.triggerEl.focus();
      } catch (_) { /* ignore */ }
    }

    item.resolve(result);
    this._current = null;
    this._isLoading = false;
    this._errorMessage = null;

    // Small microtask before opening next queued dialog
    setTimeout(() => {
      this._processNext();
    }, 50);
  }

  cancelCurrent() {
    const item = this._current;
    if (!item) return;

    if (item.triggerEl && typeof item.triggerEl.focus === 'function') {
      try {
        item.triggerEl.focus();
      } catch (_) { /* ignore */ }
    }

    if (item.type === 'confirm') {
      item.resolve(false);
    } else {
      item.resolve(null);
    }

    this._current = null;
    this._isLoading = false;
    this._errorMessage = null;

    setTimeout(() => {
      this._processNext();
    }, 50);
  }
}

export const dialogManager = new DialogManager();

export const confirm = (options: ConfirmOptions) => dialogManager.confirm(options);
export const prompt = (options: PromptOptions) => dialogManager.prompt(options);
export const formDialog = (options: FormDialogOptions) => dialogManager.formDialog(options);
