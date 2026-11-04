<script>
  let { open = false, learning = $bindable(), agentOptions = [], onclose, onsave } = $props();
</script>

{#if open}
  <div class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[var(--theme-overlay)] 40 backdrop-blur-md animate-in fade-in duration-200">
    <div
      class="rise-3d relative w-full max-w-lg overflow-hidden rounded-3xl border theme-border theme-bg-surface p-6 shadow-2xl backdrop-blur-xl"
      style="box-shadow: var(--shadow-3d);"
    >
      <div class="flex items-center justify-between pb-4 border-b theme-border">
        <div>
          <h3 class="text-lg font-black theme-text">Add Project-Scoped Learning</h3>
          <p class="text-xs font-semibold theme-text-muted">Record an episodic rule or constraint specifically for this workspace.</p>
        </div>
        <button
          type="button"
          onclick={onclose}
          aria-label="Close modal"
          title="Close modal"
          class="p-1 rounded-xl theme-text-muted theme-text-secondary hover-bg-subtle transition-all cursor-pointer"
        >
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div class="space-y-4 pt-4">
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label for="learning-agent-select" class="block text-xs font-bold theme-text mb-1">Target Agent</label>
            <select
              id="learning-agent-select"
              bind:value={learning.agentName}
              class="w-full px-3 py-2 rounded-[3px] text-xs font-semibold theme-text border theme-border-strong-b theme-bg-surface login-field-effect input-theme"
            >
              {#each agentOptions as ag}
                <option value={ag.id}>{ag.name}</option>
              {/each}
            </select>
          </div>

          <div>
            <label for="learning-type-select" class="block text-xs font-bold theme-text mb-1">Memory Type</label>
            <select
              id="learning-type-select"
              bind:value={learning.memoryType}
              class="w-full px-3 py-2 rounded-[3px] text-xs font-semibold theme-text border theme-border-strong-b theme-bg-surface login-field-effect input-theme"
            >
              <option value="rule">Rule (Strict Mandate)</option>
              <option value="episodic">Episodic (Learning / Incident)</option>
              <option value="fact">Fact (Knowledge)</option>
              <option value="preference">Preference (Style)</option>
            </select>
          </div>
        </div>

        <div>
          <label for="learning-content-input" class="block text-xs font-bold theme-text mb-1">Learning Content</label>
          <textarea
            id="learning-content-input"
            bind:value={learning.content}
            rows="4"
            placeholder="e.g. Always use port 1404; Pure light mode is first-class default; use Tailwind v4 grid tokens..."
            class="w-full px-3 py-2 rounded-[3px] text-xs font-semibold theme-text border theme-border-strong-b theme-bg-surface login-field-effect input-theme"
          ></textarea>
        </div>
      </div>

      <div class="flex items-center justify-end gap-3 pt-4 border-t theme-border mt-4">
        <button
          type="button"
          onclick={onclose}
          class="btn-3d btn-3d-secondary px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="button"
          onclick={onsave}
          class="btn-3d btn-3d-primary px-5 py-2 rounded-xl text-xs font-bold text-white transition-all shadow-md cursor-pointer"
        >
          Save Learning
        </button>
      </div>
    </div>
  </div>
{/if}
