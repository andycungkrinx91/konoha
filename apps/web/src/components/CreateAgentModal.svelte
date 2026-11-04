<script>
  let {
    createName = $bindable(),
    createTitle = $bindable(),
    createPurpose = $bindable(),
    createDescription = $bindable(),
    createInstructions = $bindable(),
    createModel = $bindable(),
    createSubmitting = $bindable(),
    open = false,
    bridgeModels = [],
    onclose,
    onsubmit
  } = $props();
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    role="presentation"
    class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--theme-overlay)] 35 backdrop-blur-sm animate-in fade-in duration-150"
    onclick={(e) => { if (e.target === e.currentTarget) onclose(); }}
  >
    <div
      class="modal-card modal-3d w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 sm:p-8 rounded-[3px] border shadow-2xl space-y-5 animate-in zoom-in-95 duration-150 glass-frost-strong"
      style="border-color: var(--theme-modal-border, color-mix(in srgb, var(--theme-grad-1) 38%, var(--color-border))); color: var(--color-text); box-shadow: var(--theme-modal-shadow, var(--shadow-3d));"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="flex items-center justify-between pb-3 border-b" style="border-color: var(--color-border);">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-[3px] flex items-center justify-center font-bold text-xs text-white shadow-sm" style="background: var(--theme-4gradient);">
            <svg class="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <div>
            <h3 class="text-base font-bold" style="color: var(--color-text);">Create Custom Ninja Subagent</h3>
            <p class="text-xs" style="color: var(--color-text-muted);">Configure name, role, and custom instructions</p>
          </div>
        </div>
        <button
          type="button"
          onclick={onclose}
          class="w-7 h-7 rounded-[3px] flex items-center justify-center text-xs font-bold border transition-colors hover:scale-105 cursor-pointer"
          style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text-muted);"
          aria-label="Close modal"
        >
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div class="space-y-4 text-xs">
        <div>
          <label for="create-ninja-name" class="font-bold block mb-1" style="color: var(--color-text);">Name (ID) *</label>
          <input
            id="create-ninja-name"
            type="text"
            bind:value={createName}
            placeholder="e.g. shinobi-coder"
            class="w-full px-3 py-2 text-xs rounded-[3px] border login-field-effect focus:outline-hidden"
            style="background: var(--color-surface); color: var(--color-text);"
          />
          <p class="text-[11px] mt-1" style="color: var(--color-text-muted);">
            Unique identifier. Alphanumeric, underscores, or hyphens.
          </p>
        </div>

        <div>
          <label for="create-ninja-title" class="font-bold block mb-1" style="color: var(--color-text);">Title</label>
          <input
            id="create-ninja-title"
            type="text"
            bind:value={createTitle}
            placeholder="e.g. Visual Ninja Specialist"
            class="w-full px-3 py-2 text-xs rounded-[3px] border login-field-effect focus:outline-hidden"
            style="background: var(--color-surface); color: var(--color-text);"
          />
        </div>

        <div>
          <label for="create-ninja-purpose" class="font-bold block mb-1" style="color: var(--color-text);">Purpose</label>
          <input
            id="create-ninja-purpose"
            type="text"
            bind:value={createPurpose}
            placeholder="e.g. Specialized UI component generator"
            class="w-full px-3 py-2 text-xs rounded-[3px] border login-field-effect focus:outline-hidden"
            style="background: var(--color-surface); color: var(--color-text);"
          />
        </div>

        <div>
          <label for="create-ninja-desc" class="font-bold block mb-1" style="color: var(--color-text);">Description</label>
          <textarea
            id="create-ninja-desc"
            rows="2"
            bind:value={createDescription}
            placeholder="Brief explanation of when to dispatch this subagent..."
            class="w-full px-3 py-2 text-xs rounded-[3px] border focus:outline-hidden resize-y login-field-effect"
            style="background: var(--color-surface); color: var(--color-text);"
          ></textarea>
        </div>

        <div>
          <label for="create-ninja-inst" class="font-bold block mb-1" style="color: var(--color-text);">System Instructions</label>
          <textarea
            id="create-ninja-inst"
            rows="3"
            bind:value={createInstructions}
            placeholder="Prompt and standard operating procedures for this agent..."
            class="w-full px-3 py-2 text-xs font-mono rounded-[3px] border focus:outline-hidden resize-y login-field-effect"
            style="background: var(--color-surface); color: var(--color-text);"
          ></textarea>
        </div>

        <div>
          <label for="create-ninja-model" class="font-bold block mb-1" style="color: var(--color-text);">Model Assignment (Optional)</label>
          <div class="space-y-1.5">
            <select
              id="create-ninja-model"
              bind:value={createModel}
              class="w-full px-3 py-2 text-xs rounded-[3px] border focus:outline-hidden login-field-effect"
              style="background: var(--color-surface); color: var(--color-text);"
            >
              <option value="">⤺ Inherit (host client default)</option>
              {#if bridgeModels.length > 0}
                <optgroup label="Discovered Client / Bridge Models">
                  {#each bridgeModels as m}
                    <option value={m.id}>{m.model_name || m.id} {m.bridge ? `(${m.bridge})` : ''}</option>
                  {/each}
                </optgroup>
              {/if}
            </select>
            <input
              type="text"
              bind:value={createModel}
              placeholder="Or custom model string..."
              class="w-full px-3 py-1.5 text-xs font-mono rounded-[3px] border focus:outline-hidden login-field-effect"
              style="background: var(--color-surface); color: var(--color-text);"
            />
          </div>
        </div>
      </div>

      <div class="flex justify-end gap-2.5 pt-3 border-t" style="border-color: var(--color-border);">
        <button
          type="button"
          onclick={onclose}
          class="btn-3d btn-3d-secondary px-4 py-2 text-xs font-bold rounded-[3px] cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={createSubmitting}
          onclick={onsubmit}
          class="btn-3d btn-3d-primary px-5 py-2 text-xs font-bold rounded-[3px] text-white cursor-pointer shadow-md"
        >
          {createSubmitting ? "Creating..." : "Create Ninja"}
        </button>
      </div>
    </div>
  </div>
{/if}
