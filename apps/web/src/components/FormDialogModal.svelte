<script>
  import { dialogManager } from "#lib/state/dialog.svelte.ts";
  import { useScrollLock } from "#lib/scrollLock.svelte.js";

  let dialogEl = $state(null);
  let firstInputEl = $state(null);
  let formValues = $state({});
  let fieldErrors = $state({});
  let passwordVisible = $state({});
  let isDirty = $state(false);
  function autofocusFirst(node, isFirst) {
    if (isFirst) {
      firstInputEl = node;
    }
  }

  const current = $derived(dialogManager.current);
  const isForm = $derived(current?.type === "form");
  const options = $derived(isForm ? current.options : null);
  const isLoading = $derived(dialogManager.isLoading);
  const generalError = $derived(dialogManager.errorMessage);

  useScrollLock(() => isForm);

  // Initialize form state when a new form dialog opens
  $effect(() => {
    if (isForm && options) {
      const initial = {};
      const errors = {};
      const pVisible = {};

      for (const f of options.fields || []) {
        initial[f.name] = f.defaultValue !== undefined
          ? f.defaultValue
          : (f.type === "checkbox" ? false : "");
        errors[f.name] = null;
        if (f.type === "password") pVisible[f.name] = false;
      }

      formValues = initial;
      fieldErrors = errors;
      passwordVisible = pVisible;
      isDirty = false;
      dialogManager.errorMessage = null;
    } else if (!isForm) {
      formValues = {};
      fieldErrors = {};
      passwordVisible = {};
      isDirty = false;
    }
  });

  $effect(() => {
    if (isForm && dialogEl && !dialogEl.open) {
      dialogEl.showModal();
      setTimeout(() => {
        if (firstInputEl && typeof firstInputEl.focus === "function") {
          firstInputEl.focus();
        }
      }, 50);
    } else if (!isForm && dialogEl && dialogEl.open) {
      dialogEl.close();
    }
  });

  function validateField(field, value) {
    const val = value !== undefined ? value : formValues[field.name];

    if (field.required) {
      if (field.type === "checkbox") {
        if (!val) return `${field.label || field.name} is required`;
      } else if (val === null || val === undefined || String(val).trim() === "") {
        return `${field.label || field.name} is required`;
      }
    }

    if (typeof field.validate === "function") {
      const customErr = field.validate(val, formValues);
      if (customErr) return customErr;
    }

    if (field.type === "email" && val) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(String(val))) {
        return "Please enter a valid email address";
      }
    }

    if (field.type === "url" && val) {
      try {
        new URL(String(val));
      } catch (_) {
        return "Please enter a valid URL (including https:// or http://)";
      }
    }

    return null;
  }

  function handleBlur(field) {
    const err = validateField(field, formValues[field.name]);
    fieldErrors[field.name] = err;
  }

  function handleInputChange(fieldName) {
    isDirty = true;
    dialogManager.errorMessage = null;
    if (fieldErrors[fieldName]) {
      fieldErrors[fieldName] = null;
    }
  }

  function togglePassword(fieldName) {
    passwordVisible[fieldName] = !passwordVisible[fieldName];
  }

  async function handleSubmit(e) {
    if (e) e.preventDefault();
    if (isLoading || !options) return;

    // Validate all fields
    let hasError = false;
    let firstErrorField = null;
    const newErrors = {};

    for (const f of options.fields || []) {
      const err = validateField(f, formValues[f.name]);
      if (err) {
        newErrors[f.name] = err;
        hasError = true;
        if (!firstErrorField) firstErrorField = f.name;
      } else {
        newErrors[f.name] = null;
      }
    }

    fieldErrors = newErrors;

    if (hasError) {
      if (firstErrorField && dialogEl) {
        const el = dialogEl.querySelector(`[name="${firstErrorField}"]`);
        if (el && typeof el.focus === "function") {
          el.focus();
        }
      }
      return;
    }

    // Execute submission
    dialogManager.isLoading = true;
    dialogManager.errorMessage = null;

    try {
      if (typeof options.onSubmit === "function") {
        await options.onSubmit({ ...formValues });
      }
      const valuesToReturn = { ...formValues };
      // Clear secrets from memory before returning
      for (const f of options.fields || []) {
        if (f.type === "password") {
          formValues[f.name] = "";
        }
      }
      await dialogManager.resolveCurrent(valuesToReturn);
    } catch (err) {
      dialogManager.errorMessage = err.message || "Failed to submit form";
    } finally {
      dialogManager.isLoading = false;
    }
  }

  function handleCancel() {
    if (isLoading) return;

    if (isDirty) {
      const confirmDiscard = window.confirm("You have unsaved changes. Discard and close?");
      if (!confirmDiscard) return;
    }

    // Wipe password fields
    for (const f of options?.fields || []) {
      if (f.type === "password") {
        formValues[f.name] = "";
      }
    }

    dialogManager.cancelCurrent();
  }

  function handleBackdropClick(e) {
    if (isLoading) return;
    if (e.target === dialogEl) {
      handleCancel();
    }
  }

  function handleKeydown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      handleCancel();
    }
  }
</script>

{#if isForm && options}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <dialog
    bind:this={dialogEl}
    onclick={handleBackdropClick}
    onkeydown={handleKeydown}
    oncancel={(e) => { e.preventDefault(); handleCancel(); }}
    class="fixed inset-0 m-auto z-[110] p-0 bg-transparent border-0 max-w-xl w-[calc(100vw-2rem)] backdrop:bg-black/60 backdrop:backdrop-blur-sm"
    aria-labelledby="form-dialog-title"
    aria-describedby="form-dialog-desc"
  >
    <div
      class="relative overflow-hidden rounded-[5px] border shadow-2xl flex flex-col max-h-[88vh] transition-all duration-200"
      style="
        background-color: var(--theme-surface-glass, rgba(15, 22, 36, 0.96));
        border-color: var(--theme-modal-border, color-mix(in srgb, var(--theme-grad-1) 35%, var(--color-border)));
        box-shadow: 0 20px 48px -8px rgba(0, 0, 0, 0.6), 0 8px 16px -4px rgba(0, 0, 0, 0.3);
      "
    >
      <!-- Top 4-Gradient Theme Accent Bar -->
      <div
        class="h-1.5 w-full shrink-0"
        style="background: linear-gradient(90deg, var(--theme-grad-1, #38bdf8), var(--theme-grad-2, #818cf8), var(--theme-grad-3, #c084fc), var(--theme-grad-4, #f472b6));"
      ></div>

      <!-- Header Section -->
      <div class="px-6 pt-5 pb-3 border-b theme-border shrink-0 relative flex items-start justify-between">
        <div>
          <h3 id="form-dialog-title" class="text-xl font-extrabold theme-text tracking-tight break-words [overflow-wrap:anywhere]">
            {options.title}
          </h3>
          {#if options.message}
            <p id="form-dialog-desc" class="text-xs sm:text-sm font-medium theme-text-secondary mt-1 break-words [overflow-wrap:anywhere]">
              {options.message}
            </p>
          {/if}
        </div>

        <button
          type="button"
          onclick={handleCancel}
          disabled={isLoading}
          class="shrink-0 -mr-2 -mt-1 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-[5px] theme-text-muted hover:theme-text transition-colors cursor-pointer disabled:opacity-50"
          aria-label="Cancel and close dialog"
        >
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Form Body with Internal Scroll -->
      <form onsubmit={handleSubmit} class="flex-1 overflow-y-auto p-6 space-y-4.5 scrollbar-thin">
        {#if generalError}
          <div
            class="p-3.5 rounded-[5px] text-xs font-semibold flex items-center gap-2.5 border"
            style="
              background-color: color-mix(in srgb, var(--theme-danger, #ef4444) 12%, transparent);
              border-color: color-mix(in srgb, var(--theme-danger, #ef4444) 35%, transparent);
              color: var(--theme-danger, #ef4444);
            "
            role="alert"
          >
            <svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span class="break-words [overflow-wrap:anywhere]">{generalError}</span>
          </div>
        {/if}

        {#each options.fields || [] as field, idx (field.name)}
          <div class="space-y-1.5">
            <div class="flex items-center justify-between">
              <label
                for="field-{field.name}"
                class="block text-xs font-bold uppercase tracking-wider theme-text"
              >
                {field.label || field.name}
                {#if field.required}
                  <span class="text-[var(--theme-danger)]" aria-hidden="true">*</span>
                {/if}
              </label>
              {#if field.helperText}
                <span class="text-[11px] theme-text-muted">{field.helperText}</span>
              {/if}
            </div>

            {#if field.type === "textarea"}
              <textarea
                id="field-{field.name}"
                name={field.name}
                rows="3"
                disabled={isLoading}
                use:autofocusFirst={idx === 0}
                bind:value={formValues[field.name]}
                oninput={() => handleInputChange(field.name)}
                onblur={() => handleBlur(field)}
                placeholder={field.placeholder || ""}
                aria-invalid={fieldErrors[field.name] ? "true" : "false"}
                aria-describedby={fieldErrors[field.name] ? `err-${field.name}` : undefined}
                class="w-full px-3.5 py-2.5 text-xs sm:text-sm login-field-effect rounded-[5px]"
              ></textarea>
            {:else if field.type === "select"}
              <select
                id="field-{field.name}"
                name={field.name}
                disabled={isLoading}
                use:autofocusFirst={idx === 0}
                bind:value={formValues[field.name]}
                onchange={() => handleInputChange(field.name)}
                onblur={() => handleBlur(field)}
                aria-invalid={fieldErrors[field.name] ? "true" : "false"}
                aria-describedby={fieldErrors[field.name] ? `err-${field.name}` : undefined}
                class="w-full px-3.5 py-2.5 text-xs sm:text-sm login-field-effect rounded-[5px]"
              >
                {#if !field.required}
                  <option value="">-- None --</option>
                {/if}
                {#each field.options || [] as opt}
                  <option value={opt.value}>{opt.label}</option>
                {/each}
              </select>
            {:else if field.type === "checkbox"}
              <label class="flex items-center gap-3 cursor-pointer py-1">
                <input
                  id="field-{field.name}"
                  name={field.name}
                  type="checkbox"
                  disabled={isLoading}
                  use:autofocusFirst={idx === 0}
                  bind:checked={formValues[field.name]}
                  onchange={() => handleInputChange(field.name)}
                  aria-invalid={fieldErrors[field.name] ? "true" : "false"}
                  class="w-4 h-4 rounded text-[var(--theme-focus)] focus:ring-[var(--theme-focus)] border theme-border"
                />
                <span class="text-xs sm:text-sm font-medium theme-text select-none">
                  {field.placeholder || field.label}
                </span>
              </label>
            {:else if field.type === "password"}
              <div class="relative">
                <input
                  id="field-{field.name}"
                  name={field.name}
                  type={passwordVisible[field.name] ? "text" : "password"}
                  disabled={isLoading}
                  use:autofocusFirst={idx === 0}
                  bind:value={formValues[field.name]}
                  oninput={() => handleInputChange(field.name)}
                  onblur={() => handleBlur(field)}
                  placeholder={field.placeholder || ""}
                  autocomplete={field.autocomplete || "off"}
                  aria-invalid={fieldErrors[field.name] ? "true" : "false"}
                  aria-describedby={fieldErrors[field.name] ? `err-${field.name}` : undefined}
                  class="w-full px-3.5 py-2.5 pr-11 text-xs sm:text-sm login-field-effect rounded-[5px]"
                />
                <button
                  type="button"
                  tabindex="-1"
                  onclick={() => togglePassword(field.name)}
                  class="absolute right-0 top-0 bottom-0 px-3 flex items-center justify-center theme-text-muted hover:theme-text transition-colors cursor-pointer"
                  aria-label={passwordVisible[field.name] ? "Hide password" : "Show password"}
                >
                  {#if passwordVisible[field.name]}
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                    </svg>
                  {:else}
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  {/if}
                </button>
              </div>
            {:else}
              <input
                id="field-{field.name}"
                name={field.name}
                type={field.type || "text"}
                disabled={isLoading}
                use:autofocusFirst={idx === 0}
                bind:value={formValues[field.name]}
                oninput={() => handleInputChange(field.name)}
                onblur={() => handleBlur(field)}
                placeholder={field.placeholder || ""}
                autocomplete={field.autocomplete || "off"}
                aria-invalid={fieldErrors[field.name] ? "true" : "false"}
                aria-describedby={fieldErrors[field.name] ? `err-${field.name}` : undefined}
                class="w-full px-3.5 py-2.5 text-xs sm:text-sm login-field-effect rounded-[5px]"
              />
            {/if}

            {#if fieldErrors[field.name]}
              <div
                id="err-{field.name}"
                class="flex items-center gap-1.5 text-xs font-semibold text-[var(--theme-danger,#ef4444)] mt-1 animate-in fade-in duration-150"
                role="alert"
              >
                <svg class="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span class="break-words [overflow-wrap:anywhere]">{fieldErrors[field.name]}</span>
              </div>
            {/if}
          </div>
        {/each}

        <!-- Sticky Footer Buttons -->
        <div class="pt-4 border-t theme-border flex flex-col sm:flex-row items-center justify-end gap-3 sticky bottom-0 bg-[var(--theme-surface-glass)]">
          <button
            type="button"
            onclick={handleCancel}
            disabled={isLoading}
            class="w-full sm:w-auto px-5 py-2.5 rounded-[5px] text-sm font-semibold theme-text-secondary hover:theme-text hover-bg-subtle border theme-border transition-all duration-150 cursor-pointer disabled:opacity-50"
          >
            {options.cancelText || "Cancel"}
          </button>

          <button
            type="submit"
            disabled={isLoading}
            class="w-full sm:w-auto px-6 py-2.5 rounded-[5px] text-sm font-bold text-white transition-all duration-150 cursor-pointer shadow-lg hover:shadow-xl flex items-center justify-center gap-2 disabled:opacity-50"
            style="
              background: linear-gradient(135deg, var(--theme-grad-1, #38bdf8), var(--theme-grad-2, #818cf8));
              border: 1px solid color-mix(in srgb, white 20%, transparent);
            "
          >
            {#if isLoading}
              <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span>Submitting...</span>
            {:else}
              <span>{options.submitText || "Submit"}</span>
            {/if}
          </button>
        </div>
      </form>
    </div>
  </dialog>
{/if}
