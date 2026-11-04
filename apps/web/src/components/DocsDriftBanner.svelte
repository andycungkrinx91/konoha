<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';

  let drift = $state(null);
  let failed = $state(false);

  onMount(async () => {
    try {
      const res = await api.get('/api/v1/docs/drift');
      if (res && Array.isArray(res.docs)) {
        drift = res;
      } else {
        failed = true;
      }
    } catch (_) {
      failed = true;
    }
  });

  const pending = $derived(drift ? drift.docs.filter((d) => d.status === 'review_pending') : []);
  const cutLabel = $derived(drift && drift.cutAt ? new Date(drift.cutAt).toISOString().slice(0, 10) : null);
</script>

{#if drift && cutLabel}
  <div class="rounded-2xl border px-4 py-3 flex flex-wrap items-start gap-3" style="border-color: var(--color-border); background: var(--color-primary-glow);">
    <span class="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border" style="color: var(--color-primary); border-color: var(--color-primary);">
      Docs drift v{drift.version}
    </span>
    <div class="flex-1 min-w-[16rem] space-y-1">
      <p class="text-xs leading-relaxed" style="color: var(--color-text);">
        Measured by file modification time against the release cut (<code class="text-[11px] font-mono">package.json</code> last written {cutLabel}):
        <strong>{pending.length}</strong> of {drift.total} documents were last modified before that cut, <strong>{drift.counts.current}</strong> were modified since,
        and <strong>{drift.counts.historical}</strong> are archived records that are never reviewed for release.
      </p>
      {#if pending.length > 0}
        <details class="text-[11px] font-mono" style="color: var(--color-text-muted);">
          <summary class="cursor-pointer">Pending review ({pending.length})</summary>
          <ul class="mt-1 space-y-0.5">
            {#each pending as doc}
              <li>{doc.file} — {doc.reason}</li>
            {/each}
          </ul>
        </details>
      {/if}
    </div>
  </div>
{:else if drift}
  <div class="rounded-2xl border px-4 py-3" style="border-color: var(--color-border);">
    <p class="text-xs leading-relaxed" style="color: var(--color-text-muted);">
      {drift.counts.unknown} of {drift.total} documents have no measurable release cut time, so drift cannot be reported.
    </p>
  </div>
{:else if failed}
  <div class="rounded-2xl border px-4 py-3" style="border-color: var(--color-border);">
    <p class="text-xs leading-relaxed" style="color: var(--color-text-muted);">Drift report unavailable — <code class="text-[11px] font-mono">/api/v1/docs/drift</code> did not answer.</p>
  </div>
{/if}
