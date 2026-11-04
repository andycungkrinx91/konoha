<script>
  let {
    newMemory = $bindable(),
    agents = [],
    open = false,
    onclose,
    onsubmit
  } = $props();
</script>

{#if open}
  <div
    role="presentation"
    class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--theme-overlay)] 40 backdrop-blur-md animate-in fade-in duration-150"
    onclick={(e) => { if (e.target === e.currentTarget) onclose(); }}
    onkeydown={(e) => { if (e.key === 'Escape') onclose(); }}
  >
    <div
      class="modal-card modal-3d relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-[3px] p-6 sm:p-8 border shadow-2xl space-y-6 glass-frost-strong animate-in zoom-in-95 duration-150"
      style="border-color: var(--theme-modal-border, color-mix(in srgb, var(--theme-grad-1) 38%, var(--color-border))); color: var(--color-text); box-shadow: var(--theme-modal-shadow, var(--shadow-3d));"
    >
      <div class="flex items-center justify-between pb-3 border-b" style="border-color: var(--color-border);">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-[3px] flex items-center justify-center font-bold text-xs text-white shadow-sm" style="background: var(--theme-4gradient);">
            <svg class="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
          </div>
          <h3 class="text-base font-bold" style="color: var(--color-text);">Add Persona Memory</h3>
        </div>
        <button
          type="button"
          onclick={onclose}
          class="w-7 h-7 rounded-[3px] flex items-center justify-center text-xs font-bold border transition-colors hover:scale-105 cursor-pointer"
          style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text-muted);"
          aria-label="Close"
        >
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div class="space-y-4">
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label for="agent-select" class="block text-xs font-bold theme-text mb-1">Target Agent</label>
            <select
              id="agent-select"
              bind:value={newMemory.agentName}
              class="w-full px-3 py-2 rounded-[3px] text-xs font-semibold theme-text border theme-border-strong-b theme-bg-surface login-field-effect input-theme"
            >
              {#each agents.filter(ag => ag.id) as ag}
                <option value={ag.id}>{ag.name}{ag.title ? ` (${ag.title})` : ""}</option>
              {/each}
            </select>
          </div>

          <div>
            <label for="memory-type-select" class="block text-xs font-bold theme-text mb-1">Memory Type</label>
            <select
              id="memory-type-select"
              bind:value={newMemory.memoryType}
              class="w-full px-3 py-2 rounded-[3px] text-xs font-semibold theme-text border theme-border-strong-b theme-bg-surface login-field-effect input-theme"
            >
              <option value="rule">Rule (Strict Mandate)</option>
              <option value="episodic">Episodic (Learning / Incident)</option>
              <option value="fact">Fact (System Knowledge)</option>
              <option value="preference">Preference (User Style)</option>
            </select>
          </div>
        </div>

        <div>
          <label for="memory-title-input" class="block text-xs font-bold theme-text mb-1">Title (Optional)</label>
          <input
            id="memory-title-input"
            type="text"
            bind:value={newMemory.title}
            placeholder="e.g. Always enforce Pure Light mode"
            class="w-full px-3 py-2 rounded-[3px] text-xs font-semibold theme-text border theme-border-strong-b theme-bg-surface login-field-effect input-theme"
          />
        </div>

        <div>
          <label for="memory-content-input" class="block text-xs font-bold theme-text mb-1">Memory Content</label>
          <textarea
            id="memory-content-input"
            bind:value={newMemory.content}
            rows="4"
            placeholder="Specific instruction, rule, pattern, or constraint to permanently remember..."
            class="w-full px-3 py-2 rounded-[3px] text-xs font-semibold theme-text border theme-border-strong-b theme-bg-surface login-field-effect input-theme"
          ></textarea>
        </div>

        <div>
          <label for="memory-tags-input" class="block text-xs font-bold theme-text mb-1">Tags (Comma-separated)</label>
          <input
            id="memory-tags-input"
            type="text"
            bind:value={newMemory.tags}
            placeholder="ui, theme, accessibility"
            class="w-full px-3 py-2 rounded-[3px] text-xs font-semibold theme-text border theme-border-strong-b theme-bg-surface login-field-effect input-theme"
          />
        </div>
      </div>

      <div class="flex items-center justify-end gap-3 pt-4 border-t theme-border">
        <button
          type="button"
          onclick={onclose}
          class="btn-3d btn-3d-secondary px-4 py-2 rounded-xl text-xs font-bold cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="button"
          onclick={onsubmit}
          class="btn-3d btn-3d-primary px-5 py-2 rounded-xl text-xs font-bold text-white shadow-md cursor-pointer"
        >
          Save Memory
        </button>
      </div>
    </div>
  </div>
{/if}
