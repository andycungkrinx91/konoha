<script>
  import { api } from '../lib/api.js';

  let mode = $state('website'); // 'website' | 'document'
  let docInputMode = $state('path'); // 'path' | 'text'
  let target = $state('');
  let docText = $state('');
  let scanning = $state(false);
  let result = $state(null);
  let error = $state(null);

  const SEVERITY_STYLES = {
    high: 'bg-red-100 text-red-700 border-red-200',
    medium: 'bg-amber-100 text-amber-700 border-amber-200',
    low: 'bg-slate-100 text-slate-600 border-slate-200'
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

<div class="space-y-6">
  <!-- Header -->
  <div class="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
    <div>
      <h1 class="text-2xl lg:text-3xl font-black text-slate-900 tracking-tight">
        {mode === 'website' ? 'Website AI Detector' : 'Document AI Detector'}
      </h1>
      <p class="text-slate-500 mt-1 text-sm lg:text-base">
        {#if mode === 'website'}
          Scan any website (directory or URL) for AI-generation fingerprints and score it 0–100.
          <span class="font-semibold text-emerald-600">0–20 = Human-Built</span> per PLAN_HUMAN_BUILT.
        {:else}
          Scan documents (.docx, .pdf, .pptx, .xlsx, .md, .txt) for AI fingerprints, sliding-window burstiness, and metadata.
          <span class="font-semibold text-emerald-600">Target: 0%–3% ZeroGPT Risk</span> for zero-AI human authenticity.
        {/if}
      </p>
    </div>

    <!-- Mode toggle tabs -->
    <div class="flex items-center gap-1.5 p-1.5 bg-slate-100/80 rounded-2xl border border-slate-200 shrink-0">
      <button
        onclick={() => { mode = 'website'; result = null; error = null; }}
        class="px-4 py-2 rounded-xl text-xs font-bold transition {mode === 'website' ? 'bg-white text-slate-900 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-900'}"
      >
        🌐 Website AI
      </button>
      <button
        onclick={() => { mode = 'document'; result = null; error = null; }}
        class="px-4 py-2 rounded-xl text-xs font-bold transition {mode === 'document' ? 'bg-white text-slate-900 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-900'}"
      >
        📄 Document AI
      </button>
    </div>
  </div>

  <!-- Scan form -->
  <div class="glass-card-3d p-6 rounded-3xl border">
    {#if mode === 'document'}
      <!-- Document input mode toggle -->
      <div class="flex items-center gap-2 mb-3">
        <button
          onclick={() => { docInputMode = 'path'; }}
          class="px-3 py-1.5 rounded-lg text-xs font-semibold transition {docInputMode === 'path' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}"
        >
          File Path
        </button>
        <button
          onclick={() => { docInputMode = 'text'; }}
          class="px-3 py-1.5 rounded-lg text-xs font-semibold transition {docInputMode === 'text' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}"
        >
          Paste Text
        </button>
      </div>
    {/if}

    {#if mode === 'document' && docInputMode === 'text'}
      <label class="block text-sm font-semibold text-slate-700 mb-2" for="detect-text">
        Paste Document Text
      </label>
      <textarea
        id="detect-text"
        bind:value={docText}
        placeholder="Paste your document text here for AI detection analysis..."
        rows="8"
        class="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white/80 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] text-sm resize-y mb-3"
      ></textarea>
      <button
        onclick={runScan}
        disabled={scanning || !docText.trim()}
        class="px-6 py-3 rounded-xl bg-[var(--color-primary)] text-white font-bold text-sm disabled:opacity-40 hover:opacity-90 transition"
      >
        {scanning ? 'Scanning…' : 'Analyze Text'}
      </button>
    {:else}
      <label class="block text-sm font-semibold text-slate-700 mb-2" for="detect-target">
        {mode === 'website' ? 'Website Target' : 'Document File Path'}
      </label>
      <div class="flex flex-col sm:flex-row gap-3">
        <input
          id="detect-target"
          type="text"
          bind:value={target}
          onkeydown={(e) => { if (e.key === 'Enter') runScan(); }}
          placeholder={mode === 'website' ? '/path/to/site or https://example.com' : '/path/to/document.docx or report.pdf'}
          class="flex-1 px-4 py-3 rounded-xl border border-slate-200 bg-white/80 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] text-sm"
        />
        <button
          onclick={runScan}
          disabled={scanning || !target.trim()}
          class="px-6 py-3 rounded-xl bg-[var(--color-primary)] text-white font-bold text-sm disabled:opacity-40 hover:opacity-90 transition"
        >
          {scanning ? 'Scanning…' : 'Run Scan'}
        </button>
      </div>
    {/if}
    <p class="text-xs text-slate-400 mt-2">
      {#if mode === 'website'}
        Checks generator meta tags, Lucide icons, shadcn/ui shapes, Vercel/Netlify signals, attribution comments, boilerplate text, and template asset names.
      {:else}
        Checks sliding-window paragraph burstiness, ZeroGPT AI triggers, generator tags (python-docx, docx-js), watermarks, and dark theme violations.
      {/if}
    </p>
  </div>

  {#if error}
    <div class="glass-card-3d p-6 rounded-3xl border border-red-200">
      <p class="text-red-600 font-semibold text-sm">Scan failed</p>
      <p class="text-slate-600 text-sm mt-1">{error}</p>
    </div>
  {/if}

  {#if result?.error}
    <div class="glass-card-3d p-6 rounded-3xl border border-red-200">
      <p class="text-red-600 font-semibold text-sm">Scan failed</p>
      <p class="text-slate-600 text-sm mt-1">{result.error}</p>
    </div>
  {/if}

  {#if result && !result.error}
    <!-- Score panel -->
    <div class="glass-card-3d p-6 lg:p-8 rounded-3xl border">
      <div class="flex flex-col lg:flex-row lg:items-center gap-8">
        <div class="flex items-center gap-5">
          <div class="relative w-28 h-28 shrink-0">
            <svg viewBox="0 0 120 120" class="w-28 h-28 -rotate-90">
              <circle cx="60" cy="60" r="52" fill="none" stroke="#e2e8f0" stroke-width="12" />
              <circle
                cx="60" cy="60" r="52" fill="none"
                stroke={scoreColor(result.score)}
                stroke-width="12" stroke-linecap="round"
                stroke-dasharray="{2 * Math.PI * 52}"
                stroke-dashoffset="{2 * Math.PI * 52 * (1 - result.score / 100)}"
              />
            </svg>
            <div class="absolute inset-0 flex flex-col items-center justify-center">
              <span class="text-3xl font-black" style="color: {scoreColor(result.score)}">{result.score}</span>
              <span class="text-[10px] text-slate-400 font-semibold">/ 100</span>
            </div>
          </div>
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <p class="text-xl font-black text-slate-900">{result.label}</p>
              {#if result.zerogpt_risk_score !== undefined}
                <span class="px-2 py-0.5 rounded-md text-[11px] font-bold {result.zerogpt_risk_score <= 3.0 ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' : 'bg-red-100 text-red-800 border border-red-200'}">
                  ZeroGPT Risk: {result.zerogpt_risk_score}%
                </span>
              {/if}
            </div>
            <p class="text-sm font-semibold mt-1" style="color: {scoreColor(result.score)}">
              {result.verdict}
            </p>
            {#if result.mode || result.stats?.files_scanned !== undefined}
              <p class="text-xs text-slate-400 mt-2 break-all">{result.target} ({result.mode || 'directory'})</p>
              <p class="text-xs text-slate-400">
                {result.stats?.files_scanned || 0} files · {((result.stats?.bytes_scanned || 0) / 1024).toFixed(1)} KB · {result.stats?.elapsed_ms || 0} ms
              </p>
            {:else}
              <p class="text-xs text-slate-400 mt-2 break-all">{result.target} ({result.format || 'document'})</p>
              <p class="text-xs text-slate-400">
                {result.stats?.words || 0} words · {result.stats?.sentences || 0} sentences · {result.stats?.paragraphs || 0} paragraphs · Burstiness {result.stats?.burstiness ?? 'N/A'} · {result.stats?.elapsed_ms || 0} ms
              </p>
            {/if}
          </div>
        </div>
      </div>
    </div>

    <!-- Findings -->
    <div class="glass-card-3d p-6 rounded-3xl border">
      <h2 class="text-lg font-bold text-slate-900 mb-4">
        Findings {#if result.findings.length}({result.findings.length}){/if}
      </h2>
      {#if result.findings.length === 0}
        <div class="p-4 rounded-xl bg-emerald-50 border border-emerald-200">
          <p class="text-emerald-700 font-semibold text-sm">No AI fingerprints detected</p>
          <p class="text-emerald-600/80 text-xs mt-1">
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
            <div class="p-4 rounded-xl border bg-white/60">
              <div class="flex flex-wrap items-center gap-2">
                <span class="px-2 py-0.5 rounded-md border text-[11px] font-bold {SEVERITY_STYLES[f.severity] || SEVERITY_STYLES.low}">
                  {f.rule} · {f.severity}
                </span>
                <span class="text-sm font-semibold text-slate-800">{f.title}</span>
                <span class="text-xs text-slate-400 font-mono ml-auto">+{f.weight}</span>
              </div>
              <p class="text-xs text-slate-500 mt-2 font-mono break-all">{f.evidence}</p>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>
