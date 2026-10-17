<script>
  import { api } from '../lib/api.js';
  import PageHero from './PageHero.svelte';

  let mode = $state('website'); // 'website' | 'document'
  let docInputMode = $state('path'); // 'path' | 'text'
  let target = $state('');
  let docText = $state('');
  let scanning = $state(false);
  let result = $state(null);
  let error = $state(null);

  const SEVERITY_STYLES = {
    high: 'badge-status badge-status-danger',
    medium: 'badge-status badge-status-warning',
    low: 'theme-bg-subtle theme-text-secondary theme-border'
  };

  function scoreColor(score) {
    if (score <= 20) return '#059669';
    if (score <= 40) return '#d97706';
    return '#dc2626';
  }

  async function runScan() {
    scanning = true;
    error = null;
    result = null;
    try {
      if (mode === 'document' && docInputMode === 'text') {
        const trimmedText = docText.trim();
        if (!trimmedText) { scanning = false; return; }
        const res = await api.post('/api/v1/detect-docs/text', { text: trimmedText });
        result = res;
      } else {
        const trimmed = target.trim();
        if (!trimmed) { scanning = false; return; }
        const endpoint = mode === 'document'
          ? `/api/v1/detect-docs?target=${encodeURIComponent(trimmed)}`
          : `/api/v1/detect-ai?target=${encodeURIComponent(trimmed)}`;
        const res = await api.get(endpoint);
        result = res;
      }
    } catch (err) {
      error = err?.message || String(err);
    } finally {
      scanning = false;
    }
  }
</script>

<div class="space-y-6 w-full">
  {#snippet heroDesc()}
    {#if mode === 'website'}
      Scan any website (directory or URL) for AI-generation fingerprints and score it 0–100.
      <span class="font-semibold text-[var(--theme-success)]">0–20 = Human-Built</span> per PLAN_HUMAN_BUILT.
    {:else}
      Scan documents (.docx, .pdf, .pptx, .xlsx, .md, .txt) for AI fingerprints, sliding-window burstiness, and metadata.
      <span class="font-semibold text-[var(--theme-success)]">Target: 0%–3% ZeroGPT Risk</span> for zero-AI human authenticity.
    {/if}
  {/snippet}

  {#snippet heroActions()}
    <!-- Mode toggle tabs with 3D Theme Gradient Styling -->
    <div class="flex items-center gap-1.5 p-1.5 rounded-[5px] border shrink-0" style="background-color: var(--color-surface); border-color: var(--color-border);">
      <button
        onclick={() => { mode = 'website'; result = null; error = null; }}
        class="btn-3d px-4 py-2 rounded-[5px] text-xs font-bold transition flex items-center gap-1.5 {mode === 'website' ? 'btn-3d-primary' : 'btn-3d-secondary'}"
      >
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
        </svg>
        <span>Website AI</span>
      </button>
      <button
        onclick={() => { mode = 'document'; result = null; error = null; }}
        class="btn-3d px-4 py-2 rounded-[5px] text-xs font-bold transition flex items-center gap-1.5 {mode === 'document' ? 'btn-3d-primary' : 'btn-3d-secondary'}"
      >
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <span>Document AI</span>
      </button>
    </div>
  {/snippet}

  <!-- Hero Section: themed translucent surface with high-contrast typography -->
  <PageHero
    title={mode === 'website' ? 'Website AI Detector' : 'Document AI Detector'}
    badgeText="Authenticity & Anti-Slop Audit"
    desc={heroDesc}
    actions={heroActions}
  />

  <!-- Scan form -->
  <div class="glass-card-3d p-6 rounded-[5px] border">
    {#if mode === 'document'}
      <!-- Document input mode toggle -->
      <div class="flex items-center gap-2 mb-3">
        <button
          onclick={() => { docInputMode = 'path'; }}
          class="btn-3d px-3 py-1.5 rounded-[5px] text-xs font-semibold transition {docInputMode === 'path' ? 'btn-3d-primary' : 'btn-3d-secondary'}"
        >
          File Path
        </button>
        <button
          onclick={() => { docInputMode = 'text'; }}
          class="btn-3d px-3 py-1.5 rounded-[5px] text-xs font-semibold transition {docInputMode === 'text' ? 'btn-3d-primary' : 'btn-3d-secondary'}"
        >
          Paste Text
        </button>
      </div>
    {/if}

    {#if mode === 'document' && docInputMode === 'text'}
      <label class="block text-sm font-semibold theme-text-secondary mb-2" for="detect-text">
        Paste Document Text
      </label>
      <textarea
        id="detect-text"
        bind:value={docText}
        placeholder="Paste your document text here for AI detection analysis..."
        rows="8"
        class="w-full px-4 py-3 rounded-[5px] border login-field-effect input-theme theme-bg-surface theme-border text-sm resize-y mb-3"
      ></textarea>
      <button
        onclick={runScan}
        disabled={scanning || !docText.trim()}
        class="btn-3d btn-3d-primary px-6 py-3 rounded-[5px] text-white font-bold text-sm disabled:opacity-40 transition shadow-md"
      >
        {scanning ? 'Scanning…' : 'Analyze Text'}
      </button>
    {:else}
      <label class="block text-sm font-semibold theme-text-secondary mb-2" for="detect-target">
        {mode === 'website' ? 'Website Target' : 'Document File Path'}
      </label>
      <div class="flex flex-col sm:flex-row gap-3">
        <input
          id="detect-target"
          type="text"
          bind:value={target}
          onkeydown={(e) => { if (e.key === 'Enter') runScan(); }}
          placeholder={mode === 'website' ? '/path/to/site or https://example.com' : '/path/to/document.docx or report.pdf'}
          class="flex-1 px-4 py-3 rounded-[5px] border login-field-effect input-theme theme-bg-surface theme-border text-sm"
        />
        <button
          onclick={runScan}
          disabled={scanning || !target.trim()}
          class="btn-3d btn-3d-primary px-6 py-3 rounded-[5px] text-white font-bold text-sm disabled:opacity-40 transition shadow-md"
        >
          {scanning ? 'Scanning…' : 'Run Scan'}
        </button>
      </div>
    {/if}
    <p class="text-xs theme-text-muted mt-2">
      {#if mode === 'website'}
        Checks generator meta tags, Lucide icons, shadcn/ui shapes, Vercel/Netlify signals, attribution comments, boilerplate text, and template asset names.
      {:else}
        Checks sliding-window paragraph burstiness, ZeroGPT AI triggers, generator tags (python-docx, docx-js), watermarks, and dark theme violations.
      {/if}
    </p>
  </div>

  {#if error}
    <div class="glass-card-3d p-6 rounded-3xl border badge-status-danger">
      <p class="text-[var(--theme-danger)] font-semibold text-sm">Scan failed</p>
      <p class="theme-text-secondary text-sm mt-1">{error}</p>
    </div>
  {/if}

  {#if result?.error}
    <div class="glass-card-3d p-6 rounded-3xl border badge-status-danger">
      <p class="text-[var(--theme-danger)] font-semibold text-sm">Scan failed</p>
      <p class="theme-text-secondary text-sm mt-1">{result.error}</p>
    </div>
  {/if}

  {#if result && !result.error}
    <!-- Score panel (3D AI Fingerprint Analysis) -->
    <div class="metric-card-3d p-6 lg:p-8 rounded-3xl border" style="border-color: color-mix(in srgb, var(--theme-grad-1) 30%, var(--color-border));">
      <div class="flex flex-col lg:flex-row lg:items-center gap-8">
        <div class="flex items-center gap-5">
          <div class="relative w-28 h-28 shrink-0">
            <svg viewBox="0 0 120 120" class="w-28 h-28 -rotate-90">
              <circle cx="60" cy="60" r="52" fill="none" stroke="color-mix(in srgb, var(--theme-grad-1) 12%, var(--color-border))" stroke-width="12" />
              <circle
                cx="60" cy="60" r="52" fill="none"
                stroke={scoreColor(result.score)}
                stroke-width="12" stroke-linecap="round"
                stroke-dasharray="{2 * Math.PI * 52}"
                stroke-dashoffset="{2 * Math.PI * 52 * (1 - result.score / 100)}"
                class="metric-gauge-3d"
              />
            </svg>
            <div class="absolute inset-2 flex flex-col items-center justify-center rounded-full gauge-center-3d">
              <span class="text-3xl font-black font-mono tabular-nums" style="color: {scoreColor(result.score)}">{result.score}</span>
              <span class="text-[10px] theme-text-muted font-semibold font-mono">/ 100</span>
            </div>
          </div>
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <p class="text-xl font-black theme-text">{result.label}</p>
              {#if result.zerogpt_risk_score !== undefined}
                <span class="px-2 py-0.5 rounded-md text-[11px] font-bold font-mono {result.zerogpt_risk_score <= 3.0 ? 'badge-status badge-status-success' : 'badge-status badge-status-danger'}">
                  ZeroGPT Risk: {result.zerogpt_risk_score}%
                </span>
              {/if}
            </div>
            <p class="text-sm font-semibold mt-1" style="color: {scoreColor(result.score)}">
              {result.verdict}
            </p>
            {#if result.mode || result.stats?.files_scanned !== undefined}
              <p class="text-xs theme-text-muted mt-2 break-all font-mono">{result.target} ({result.mode || 'directory'})</p>
              <p class="text-xs theme-text-muted font-mono">
                {result.stats?.files_scanned || 0} files · {((result.stats?.bytes_scanned || 0) / 1024).toFixed(1)} KB · {result.stats?.elapsed_ms || 0} ms
              </p>
            {:else}
              <p class="text-xs theme-text-muted mt-2 break-all font-mono">{result.target} ({result.format || 'document'})</p>
              <p class="text-xs theme-text-muted font-mono">
                {result.stats?.words || 0} words · {result.stats?.sentences || 0} sentences · {result.stats?.paragraphs || 0} paragraphs · Burstiness {result.stats?.burstiness ?? 'N/A'} · {result.stats?.elapsed_ms || 0} ms
              </p>
            {/if}
          </div>
        </div>
      </div>
    </div>

    <!-- Findings -->
    <div class="metric-card-3d p-6 rounded-3xl border" style="border-color: color-mix(in srgb, var(--theme-grad-2) 28%, var(--color-border));">
      <h2 class="text-lg font-bold theme-text mb-4">
        Findings {#if result.findings.length}({result.findings.length}){/if}
      </h2>
      {#if result.findings.length === 0}
        <div class="p-4 rounded-xl bg-status-success-soft border badge-status-success">
          <p class="text-status-success font-semibold text-sm">No AI fingerprints detected</p>
          <p class="text-[var(--theme-success)]/80 text-xs mt-1">
            {#if mode === 'website'}
              This site sits in the Human-Built band (score 0–20).
            {:else}
              This document satisfies the 100% human-authentic standard (ZeroGPT risk: 0.0%–3.0%).
            {/if}
          </p>
        </div>
      {:else}
        <div class="space-y-3">
          {#each result.findings as f (f.rule)}
            <div class="p-4 rounded-xl border theme-bg-muted theme-border">
              <div class="flex flex-wrap items-center gap-2">
                <span class="px-2 py-0.5 rounded-md border text-[11px] font-bold {SEVERITY_STYLES[f.severity] || SEVERITY_STYLES.low}">
                  {f.rule} · {f.severity}
                </span>
                <span class="text-sm font-semibold theme-text">{f.title}</span>
                <span class="text-xs theme-text-muted font-mono ml-auto">+{f.weight}</span>
              </div>
              <p class="text-xs theme-text-muted mt-2 font-mono break-all">{f.evidence}</p>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>
