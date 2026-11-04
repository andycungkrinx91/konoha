<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';

  let catalog = $state(null);
  let failed = $state(false);

  onMount(async () => {
    try {
      const res = await api.get('/api/v1/tools');
      if (res && Array.isArray(res.tools)) {
        catalog = res;
      } else {
        failed = true;
      }
    } catch (_) {
      failed = true;
    }
  });
</script>

{#if catalog}
  <div class="px-3 py-2 rounded-xl" style="background: var(--color-primary-glow);">
    <p class="text-[11px] font-mono font-bold mb-1" style="color: var(--color-primary);">
      {catalog.count} canonical tools — read live from the tool router
    </p>
    <p class="text-[11px] font-mono leading-relaxed" style="color: var(--color-primary);">{catalog.tools.join(', ')}</p>
    {#if catalog.deprecated.length > 0}
      <p class="text-[11px] font-mono leading-relaxed mt-2 opacity-80" style="color: var(--color-text-muted);">
        Deprecated aliases still routed for existing configs: {catalog.deprecated.join(', ')}
      </p>
    {/if}
  </div>
{:else if failed}
  <p class="text-[11px] font-mono leading-relaxed px-3 py-2 rounded-xl" style="color: var(--color-text-muted); background: var(--color-primary-glow);">
    Tool catalog unavailable — <code class="font-mono">/api/v1/tools</code> did not answer.
  </p>
{/if}
