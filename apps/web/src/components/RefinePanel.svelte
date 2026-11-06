<script>
  /**
   * Refine (fork) panel: takes a user edit prompt and forks a brand-new asset from
   * `assetId` via POST /api/v1/3d/assets/:assetId/refine. The parent asset is read only,
   * so the new asset id is reported upward for selection instead of replacing the parent.
   */
  import { apiRequest } from '#lib/api.js';
  import { toast } from '#lib/state/toast.svelte.ts';

  let {
    assetId = null,
    onRefined = () => {}
  } = $props();

  const EXAMPLE_PROMPTS = [
    'make the hull plate gold',
    'make the antenna spire bigger',
    'turn the reactor core red glossy',
    'make the side fin matte black'
  ];

  let instruction = $state('');
  let isRefining = $state(false);
  let refineError = $state(null);
  let refinePlan = $state(null);
  let refineResult = $state(null);

  const canSubmit = $derived(Boolean(assetId) && instruction.trim().length > 0 && !isRefining);

  async function submitRefine() {
    if (!canSubmit) return;
    isRefining = true;
    refineError = null;
    refinePlan = null;
    refineResult = null;
    try {
      const payload = await apiRequest(`/api/v1/3d/assets/${encodeURIComponent(assetId)}/refine`, {
        method: 'POST',
        body: JSON.stringify({ instruction: instruction.trim() })
      });
      refinePlan = payload.refine_plan || null;
      toast.success(`Refine fork queued: ${payload.job_id}`);
      await pollRefineJob(payload.job_id);
    } catch (err) {
      refineError = err?.message || String(err);
      toast.error('Refine failed: ' + refineError);
    } finally {
      isRefining = false;
    }
  }

  /**
   * Follows the forked job through GET /api/v1/3d/jobs/:id. A job that ends in `failed`
   * surfaces its stored error_code so an inexpressible instruction is never a silent no-op.
   */
  async function pollRefineJob(jobId) {
    const deadline = Date.now() + 10 * 60 * 1000;
    for (;;) {
      let job = null;
      try {
        const data = await apiRequest(`/api/v1/3d/jobs/${encodeURIComponent(jobId)}`);
        job = data.job || null;
      } catch (_) {
        job = null;
      }
      if (job && job.status === 'completed') {
        refineResult = { jobId, status: 'completed' };
        const assetRes = await apiRequest('/api/v1/3d/assets?limit=1&offset=0');
        const newest = Array.isArray(assetRes.assets) && assetRes.assets.length ? assetRes.assets[0] : null;
        onRefined(newest, jobId);
        return;
      }
      if (job && job.status === 'failed') {
        refineError = job.error_message || 'Refine job failed';
        refinePlan = { ...(refinePlan || {}), error_code: job.error_code || null };
        toast.error(`Refine halted (${job.error_code || 'REFINE_FAILED'}): ${refineError}`);
        return;
      }
      if (Date.now() > deadline) {
        refineError = 'Refine job did not finish within 10 minutes';
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  function applyExample(text) {
    instruction = text;
  }
</script>

<div
  class="glass-card-3d p-5 rounded-[5px] border w-full flex flex-col gap-3"
  style="background-color: var(--color-surface); border-color: var(--color-border); box-shadow: var(--shadow-3d);"
>
  <div class="flex items-center justify-between pb-2 border-b" style="border-color: var(--color-border);">
    <h3 class="text-sm font-bold" style="color: var(--color-text);">Refine this asset</h3>
    <span class="text-[10px] font-mono" style="color: var(--color-text-muted);">
      fork (parent untouched)
    </span>
  </div>

  {#if !assetId}
    <p class="text-xs py-4 text-center" style="color: var(--color-text-muted);">
      Select an asset above to refine it.
    </p>
  {:else}
    <label class="text-[11px] font-bold" for="refine-instruction" style="color: var(--color-text);">
      Edit instruction
    </label>
    <textarea
      id="refine-instruction"
      bind:value={instruction}
      rows="3"
      maxlength="500"
      disabled={isRefining}
      placeholder="What should change? Name a part, then a style or size, e.g. “make the hull plate gold”."
      class="w-full rounded-[5px] border p-2 text-xs font-mono resize-y"
      style="background-color: var(--color-bg); border-color: var(--color-border); color: var(--color-text);"
    ></textarea>

    <div class="flex flex-wrap gap-1.5">
      {#each EXAMPLE_PROMPTS as example (example)}
        <button
          type="button"
          onclick={() => applyExample(example)}
          disabled={isRefining}
          class="px-2 py-1 rounded-[3px] text-[10px] font-mono border cursor-pointer"
          style="background-color: var(--color-bg); border-color: var(--color-border); color: var(--color-text-muted);"
        >
          {example}
        </button>
      {/each}
    </div>

    <div class="flex items-center gap-2">
      <button
        type="button"
        onclick={submitRefine}
        disabled={!canSubmit}
        class="btn-3d px-4 py-2 rounded-[5px] text-xs font-bold border cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        style="background-color: var(--color-bg); border-color: var(--color-border); color: var(--color-text);"
      >
        {isRefining ? 'Forking…' : 'Refine & fork'}
      </button>
      {#if refinePlan && Array.isArray(refinePlan.targets)}
        <span class="text-[10px] font-mono truncate" style="color: var(--color-text-muted);">
          targets: {refinePlan.targets.join(', ')}
        </span>
      {/if}
    </div>

    {#if refineResult && refineResult.status === 'completed'}
      <p class="text-[11px] font-mono" style="color: rgb(16,185,129);">
        Fork completed — job {refineResult.jobId}. Open it from Recent 3D Assets.
      </p>
    {/if}
    {#if refineError}
      <p class="text-[11px] font-mono" role="alert" style="color: rgb(239,68,68);">
        {refinePlan?.error_code ? `[${refinePlan.error_code}] ` : ''}{refineError}
      </p>
    {/if}
  {/if}
</div>
