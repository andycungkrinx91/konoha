<script>
  let {
    newSkill = $bindable(),
    agentsList = [],
    isSubmitting = false,
    open = false,
    onclose,
    onsubmit
  } = $props();
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--theme-overlay)] 40 backdrop-blur-sm animate-in fade-in duration-150"
    onclick={onclose}
  >
    <div
      class="modal-card modal-3d w-full max-w-2xl p-6 rounded-3xl border shadow-2xl space-y-4 animate-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto glass-frost-strong"
      style="border-color: var(--theme-modal-border, color-mix(in srgb, var(--theme-grad-1) 38%, var(--color-border))); color: var(--color-text); box-shadow: var(--theme-modal-shadow, var(--shadow-3d));"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="flex items-center justify-between pb-3 border-b" style="border-color: var(--color-border);">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-xl flex items-center justify-center border shadow-sm" style="background: var(--theme-4gradient); border-color: transparent; color: #ffffff;">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
          </div>
          <div>
            <h3 class="text-base font-bold" style="color: var(--color-text);">Create New Ninja Skill</h3>
            <p class="text-xs" style="color: var(--color-text-muted);">Define rules, instructions, and SOPs for subagents</p>
          </div>
        </div>
        <button
          type="button"
          onclick={onclose}
          class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border transition-colors hover:scale-105 cursor-pointer"
          style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text-muted);"
          aria-label="Close create skill modal"
        >
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Form Inputs -->
      <div class="space-y-3.5">
        <div>
          <label for="skill-name" class="block text-xs font-bold mb-1" style="color: var(--color-text);">Skill Name (slug)</label>
          <input
            id="skill-name"
            type="text"
            bind:value={newSkill.name}
            placeholder="e.g. docker-compose-scaffolding, redis-caching-skill"
            class="w-full px-3.5 py-2.5 rounded-[3px] border text-xs login-field-effect input-theme font-mono"
            style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
          />
        </div>

        <div>
          <label for="skill-desc" class="block text-xs font-bold mb-1" style="color: var(--color-text);">Description (short summary)</label>
          <input
            id="skill-desc"
            type="text"
            bind:value={newSkill.description}
            placeholder="Standard Operating Procedures for scaffolding docker-compose clusters..."
            class="w-full px-3.5 py-2.5 rounded-[3px] border text-xs login-field-effect input-theme font-medium"
            style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
          />
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label for="skill-tags" class="block text-xs font-bold mb-1" style="color: var(--color-text);">Tags (comma-separated)</label>
            <input
              id="skill-tags"
              type="text"
              bind:value={newSkill.tags}
              placeholder="docker, devops, compose, backend"
              class="w-full px-3.5 py-2.5 rounded-[3px] border text-xs login-field-effect input-theme"
              style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
            />
          </div>

          <div>
            <label for="skill-embed" class="block text-xs font-bold mb-1" style="color: var(--color-text);">Embed in Agent (optional)</label>
            <select
              id="skill-embed"
              bind:value={newSkill.embed_agent}
              class="w-full px-3.5 py-2.5 rounded-[3px] border text-xs font-semibold login-field-effect focus:outline-none"
              style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
            >
              <option value="">None (Global standalone skill)</option>
              {#each agentsList as ag}
                <option value={ag.id}>{ag.name}</option>
              {/each}
            </select>
          </div>
        </div>

        <div>
          <label for="skill-content" class="block text-xs font-bold mb-1" style="color: var(--color-text);">Instruction Manual / SOP Content (Markdown)</label>
          <textarea
            id="skill-content"
            rows="8"
            bind:value={newSkill.content}
            class="w-full p-3.5 rounded-[3px] border text-xs font-mono login-field-effect input-theme leading-relaxed"
            style="background: var(--color-surface-hover); border-color: var(--color-border); color: var(--color-text);"
          ></textarea>
        </div>
      </div>

      <!-- Footer Buttons -->
      <div class="flex items-center justify-end gap-3 pt-3 border-t" style="border-color: var(--color-border);">
        <button
          type="button"
          onclick={onclose}
          class="btn-3d btn-3d-secondary px-4 py-2.5 rounded-xl border text-xs font-semibold cursor-pointer"
        >
          Cancel
        </button>

        <button
          type="button"
          disabled={isSubmitting || !newSkill.name.trim()}
          onclick={onsubmit}
          class="btn-3d btn-3d-primary px-5 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 cursor-pointer text-white shadow-md disabled:opacity-50"
        >
          {#if isSubmitting}
            <span class="animate-spin w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full"></span>
            <span>Creating...</span>
          {:else}
            <span>Save & Index Skill</span>
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}
