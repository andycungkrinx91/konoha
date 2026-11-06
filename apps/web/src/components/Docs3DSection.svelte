<script>
  const INPUT_MODES = [
    {
      name: 'Text-to-3D',
      detail: 'A prompt is parsed into a scene spec, then built procedurally with Three.js and Manifold CSG into watertight geometry.'
    },
    {
      name: 'Image-to-3D',
      detail: 'A reference image is uploaded first, its dimensions and palette drive a vision scene spec, and the same geometry pipeline runs from that spec.'
    }
  ];

  const PIPELINE = [
    'Input parse (prompt or reference image) → scene spec',
    'Procedural Three.js / Manifold construction',
    'Agentic Blender refinement passes with per-stage narrative',
    '11-row scoreSpec validation (manifold, PBR ranges, topology)',
    '5-condition staging promotion → GLB delivered to the asset store'
  ];

  const ROUTES = [
    { method: 'POST', path: '/api/v1/3d/generate', desc: 'Start a generation job. Image mode passes image_path from a prior upload; optional Blender refinement.' },
    { method: 'POST', path: '/api/v1/3d/upload-image', desc: 'Upload a reference image (PNG, JPEG, WebP — 12 MB cap, magic-byte validated).' },
    { method: 'GET', path: '/api/v1/3d/generate/:jobId/stream', desc: 'Server-sent events for stage progress, narratives, and stage timings.' },
    { method: 'GET', path: '/api/v1/3d/jobs', desc: 'Generation jobs with status, compute mode, and mesh statistics.' },
    { method: 'GET', path: '/api/v1/3d/assets', desc: 'Generated assets with GLB, PNG preview, and export downloads.' },
    { method: 'POST', path: '/api/v1/3d/assets/:assetId/refine', desc: 'Fork a new asset from an existing one with an edit prompt; the parent asset stays read only.' },
    { method: 'GET', path: '/api/v1/3d/telemetry', desc: 'Token and cost telemetry per generation job.' },
    { method: 'GET', path: '/api/v1/3d/setup/status', desc: 'Blender, DCC-MCP host support, and model readiness.' }
  ];
</script>

<section id="3d" class="glass-card-3d p-6 lg:p-8 rounded-3xl border scroll-mt-6" style="border-color: var(--color-border);">
  <h3 class="text-xl font-black tracking-tight mb-3" style="color: var(--color-text);">Generative 3D Subsystem</h3>
  <p class="text-sm leading-relaxed mb-5" style="color: var(--color-text-muted);">
    The 3D maker accepts both text and image input, then drives the same deterministic geometry pipeline. Blender refinement is
    optional and falls back to CPU procedural construction when no Blender binary is available, so a job never fails because of
    missing host tooling.
  </p>

  <div class="grid gap-3 sm:grid-cols-2 mb-5">
    {#each INPUT_MODES as mode}
      <div class="rounded-2xl border p-4" style="border-color: var(--color-border);">
        <span class="text-sm font-black" style="color: var(--color-text);">{mode.name}</span>
        <p class="text-xs leading-relaxed mt-1" style="color: var(--color-text-muted);">{mode.detail}</p>
      </div>
    {/each}
  </div>

  <ol class="space-y-1.5 mb-5">
    {#each PIPELINE as stage, i}
      <li class="text-xs leading-relaxed flex gap-2" style="color: var(--color-text-muted);">
        <span class="font-mono font-bold" style="color: var(--color-primary);">{i + 1}.</span>
        <span>{stage}</span>
      </li>
    {/each}
  </ol>

  <div class="space-y-2">
    {#each ROUTES as r}
      <div class="flex flex-wrap items-baseline gap-2 text-[11px] font-mono px-3 py-2 rounded-xl" style="background: var(--color-primary-glow);">
        <span class="font-black" style="color: var(--color-primary);">{r.method}</span>
        <span style="color: var(--color-text);">{r.path}</span>
        <span class="text-[11px] font-sans leading-relaxed" style="color: var(--color-text-muted);">{r.desc}</span>
      </div>
    {/each}
  </div>

  <p class="text-xs leading-relaxed mt-4" style="color: var(--color-text-muted);">
    <code class="text-[11px] font-mono">konoha doctor</code> reports Blender binary, DCC-MCP host support, and output directory readiness
    alongside the rest of the environment diagnostics.
  </p>
</section>
