<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import PageHero from './PageHero.svelte';
  import DocsDriftBanner from './DocsDriftBanner.svelte';
  import Docs3DSection from './Docs3DSection.svelte';
  import McpToolsList from './McpToolsList.svelte';

    let health = $state(null);
  let liveAgents = $state([]);
  let liveDocs = $state([]);
  let selectedDoc = $state(null);
  let docQuery = $state('');
  let isSearching = $state(false);
  let liveSkillsCount = $state(null);
  let activeSection = $state('overview');

  const SECTIONS = [
    { id: 'overview', label: 'Overview' },
    { id: 'fts-docs', label: 'SQLite FTS5 Docs' },
    { id: 'architecture', label: 'Architecture & Agents' },
    { id: 'mcp', label: 'MCP Servers & Tools' },
    { id: 'sdlc', label: 'SDLC Lifecycle' },
    { id: 'slop-gate', label: 'Anti-Slop Delivery Gate' },
    { id: '3d', label: 'Generative 3D' },
    { id: 'remote', label: 'Remote Access & Telegram' },
    { id: 'crypto', label: 'Crypto Vault & Security' },
    { id: 'redteam', label: 'Cybersecurity & Red Teaming' },
    { id: 'api', label: 'Web API Reference' },
    { id: 'clients', label: 'Client Setup' },
    { id: 'cli', label: 'CLI Commands' }
  ];

  const CANONICAL_AGENTS = [
    { name: 'Sannin', role: 'Task triage & router', detail: 'Entry point for non-trivial work. Resolves task directory and orchestrates village pipeline.' },
    { name: 'Genin', role: 'Read-only exploration', detail: 'Codebase exploration, symbol search, dependency mapping, and evidence-backed findings. Never mutates files.' },
    { name: 'Kage', role: 'Architecture & review gate', detail: 'Deep architecture analysis, risk assessment, and blocking Kage Confidence Gate (≥98%) with two-step slop scan.' },
    { name: 'Jonin', role: 'Premium UI development', detail: 'Frontend builds with Taste-Skill Design Engine, typography dials, motion intensity, and layout invariants.' },
    { name: 'Anbu', role: 'Backend & remediation', detail: 'Backend services, bug fixes, DevOps, and slop-fix remediation when Delivery Gate reports findings.' },
    { name: 'Chunin', role: 'Research & evidence', detail: 'Web research, ecosystem documentation lookup, and factual evidence synthesis with citations.' },
    { name: 'Tokubetsu-Jonin', role: 'Technical writing & scribe', detail: 'Publication-grade documentation, API specifications, runbooks, and final handover reports.' },
    { name: 'Akatsuki', role: 'Red-team & blue-team', detail: 'Offensive penetration testing in sandboxes, defensive security auditing, and vulnerability review gates.' },
    { name: 'Yamanaka', role: 'Generative 3D & spatial', detail: 'Text-to-3D and image-to-3D synthesis, Three.js/Manifold geometry construction, agentic Blender refinement, and spatial asset delivery.' }
  ];

  const MCP_SERVERS = [
    {
      name: 'konoha',
      live: true,
      tools: 'read_file_head, read_file_range, file_info, token_efficient_grep, get_file_structure, find_files_clean, website_ai_detector, docs_ai_detector, get_resolved_task_dir, find_skill, find_skills, list_skills, get_skill, use_skills, optimize_report, build_with_image_design, build_from_source, build_from_text, sannin, kage, jonin, anbu, akatsuki, akatsuki_init, chunin, tokubetsu_jonin, genin, report_from_agent, get_project_context, save_project_context, query_project_memory, web_search, migrate_skills, save_persona_memory, query_persona_memory, list_persona_memories, delete_persona_memory, check_readiness, get_task_evidence, get_slop_findings, anti_slop, qa_codify, qa_e2e_run, get_soul, document_create, spreadsheet_create, presentation_create, diagram_create, animation_export',
      detail: 'Canonical skill discovery, bounded file I/O, 8-ninja subagent dispatch, AI-fingerprint detectors, and native document engines across all 8 clients.'
    },
    {
      name: 'native code intelligence',
      tools: 'code_index, code_search, code_symbol, code_context, code_impact, code_related, code_status, code_remove',
      detail: 'In-process hybrid Tree-sitter WASM AST + SQLite FTS5 + IBM Granite 97M embeddings + MiniLM L-6 reranker. No external server, no Python runtime.'
    },
    {
      name: 'aislop',
      tools: 'aislop_scan, aislop_fix, aislop_why, aislop_baseline',
      detail: 'Zero-AI-Slop code hygiene scanning and remediation. Read-only roles (genin, kage) receive scan + why; write roles (jonin, anbu) receive fix.'
    }
  ];

  const API_ENDPOINTS = [
    { method: 'POST', path: '/api/v1/auth/login', desc: 'Authenticate administrative session and receive secure HTTP-only cookie' },
    { method: 'GET', path: '/api/v1/auth/status', desc: 'Authentication status and bootstrap credentials state' },
    { method: 'POST', path: '/api/v1/auth/change-password', desc: 'Update administrative password (Argon2id hashing)' },
    { method: 'POST', path: '/api/v1/auth/logout', desc: 'Revoke active administrative session' },
    { method: 'GET', path: '/api/v1/csrf', desc: 'Session CSRF token (mutating requests require X-Konoha-Web-Token)' },
    { method: 'GET', path: '/api/v1/health', desc: 'Server health, version, database metrics, skills and agents counts' },
    { method: 'GET', path: '/api/v1/system/metrics', desc: 'System CPU/memory telemetry, GPU vendor/name/VRAM/utilization (or no_data when no probe answers), and Konoha feature metrics' },
    { method: 'GET', path: '/api/v1/detect-ai?target=', desc: 'Website AI-fingerprint detector (directory path or URL) — 0–100 score, 0–20 = Human-Built' },
    { method: 'GET', path: '/api/v1/detect-docs?file_path=', desc: 'Document AI-fingerprint detector (.docx, .pdf, .pptx, .xlsx, .md, .txt) — 0–3% ZeroGPT target' },
    { method: 'POST', path: '/api/v1/detect-docs/text', desc: 'Analyze pasted text for AI fingerprints (body: { text: string })' },
    { method: 'GET', path: '/api/v1/bridges', desc: 'List configured LLM provider bridges' },
    { method: 'GET', path: '/api/v1/bridges/status', desc: 'Runtime status of bridges & OpenAI proxy gateway (port 19999)' },
    { method: 'GET', path: '/api/v1/agents', desc: 'Agent roster & model assignments (queried live from SQLite database)' },
    { method: 'GET', path: '/api/v1/skills', desc: 'Skill search (FTS5 / semantic vector mode, queried live from SQLite database)' },
    { method: 'POST', path: '/api/v1/skills/install', desc: 'Install a skill from the registry or local path' },
    { method: 'POST', path: '/api/v1/skills/reindex', desc: 'Re-index skills into SQLite FTS5 database' },
    { method: 'POST', path: '/api/v1/skills/reembed', desc: 'Rebuild neural embeddings (IBM Granite)' },
    { method: 'GET', path: '/api/v1/vectors/stats', desc: 'Vector index statistics and dimension telemetry' },
    { method: 'GET', path: '/api/v1/sdlc/tasks', desc: 'List SDLC tasks (filter by status/project)' },
    { method: 'POST', path: '/api/v1/sdlc/check-readiness', desc: 'Definition-of-Readiness check for task text' },
    { method: 'POST', path: '/api/v1/sdlc/tasks/reconcile', desc: 'Reconcile tasks against active filesystem and Git state' },
    { method: 'GET', path: '/api/v1/sdlc/config', desc: 'Project SDLC config (dor_mode, review_mode)' },
    { method: 'GET', path: '/api/v1/savings', desc: 'Token savings report (Konoha FTS5 tool calls)' },
    { method: 'GET', path: '/api/v1/telegram/config', desc: 'Telegram bot settings (AES-256 encrypted at rest, masked)' },
    { method: 'POST', path: '/api/v1/telegram/config', desc: 'Update Telegram bot token, chat ID, mode & secret' },
    { method: 'POST', path: '/api/v1/telegram/test', desc: 'Send test notification message to configured Telegram chat' },
    { method: 'POST', path: '/api/v1/telegram/enable', desc: 'Start active Telegram long-polling bot daemon' },
    { method: 'POST', path: '/api/v1/telegram/disable', desc: 'Stop active Telegram long-polling bot daemon' },
    { method: 'GET', path: '/api/v1/queue/prompts', desc: 'List prompt queue jobs with agent assignments & state' },
    { method: 'POST', path: '/api/v1/queue/prompts', desc: 'Enqueue a remote prompt from Telegram or Web UI' },
    { method: 'GET', path: '/api/v1/webhooks', desc: 'List registered outbound notification webhooks' },
    { method: 'POST', path: '/api/v1/webhooks', desc: 'Create a new outbound webhook notification target' },
    { method: 'GET', path: '/api/v1/code/status', desc: 'Code intelligence index status per indexed root and semantic runtime readiness' },
    { method: 'POST', path: '/api/v1/code/search', desc: 'Hybrid AST + FTS5 + Granite 97M + MiniLM L-6 code search over the local index' },
    { method: 'POST', path: '/api/v1/code/related', desc: 'Structural graph + semantic discovery of files related to an anchor file or symbol' },
    { method: 'GET', path: '/api/v1/search/status', desc: 'SearXNG search engine status' },
    { method: 'POST', path: '/api/v1/search', desc: 'Zero-API-key web search' },
    { method: 'GET', path: '/api/v1/doctor', desc: 'Environment health diagnostics' },
    { method: 'POST', path: '/api/v1/doctor/repair', desc: 'Auto-repair detected issues' },
    { method: 'GET', path: '/api/v1/soul', desc: 'Agent soul archetype and behavioral memory' },
    { method: 'GET', path: '/api/v1/persona', desc: 'Persona memories (project-scoped)' },
    { method: 'GET', path: '/api/v1/projects', desc: 'Known projects & current workspace' },
    { method: 'GET', path: '/api/v1/clients', desc: 'Cross-client MCP configuration status' },
    { method: 'POST', path: '/api/v1/clients/:id/setup', desc: 'Inject Konoha MCP configuration into target coding client' },
    { method: 'POST', path: '/api/v1/clients/:id/remove', desc: 'Remove Konoha MCP configuration from target coding client' },
    { method: 'GET', path: '/api/v1/tools', desc: 'Canonical MCP tool catalog read from the tool router, with deprecated aliases still routed' },
    { method: 'GET', path: '/api/v1/docs/drift', desc: 'Documentation drift report: per-file modification times compared to the release cut' },
    { method: 'POST', path: '/api/v1/3d/generate', desc: 'Start a 3D generation job (prompt, or image_path from a prior upload, with optional Blender refinement)' },
    { method: 'POST', path: '/api/v1/3d/upload-image', desc: 'Upload a reference image for image-to-3D (PNG/JPEG/WebP, 12 MB cap, magic-byte validated)' },
    { method: 'GET', path: '/api/v1/3d/jobs', desc: '3D generation jobs with status, compute mode, and mesh statistics' },
    { method: 'GET', path: '/api/v1/3d/assets', desc: 'Generated 3D assets with GLB and export downloads' },
    { method: 'GET', path: '/api/v1/3d/telemetry', desc: '3D token and cost telemetry per job' },
    { method: 'GET', path: '/api/v1/events', desc: 'Server-sent events stream (live updates)' }
  ];

  const CLIENTS = [
    { name: 'Antigravity IDE / CLI', config: '~/.gemini/config/mcp_config.json' },
    { name: 'Cursor IDE / CLI', config: '~/.cursor/mcp.json' },
    { name: 'Claude Code CLI', config: '~/.claude.json' },
    { name: 'OpenCode IDE', config: '~/.config/opencode/opencode.json' },
    { name: 'Command Code CLI', config: '~/.commandcode/mcp.json' },
    { name: 'Codex IDE / CLI', config: '~/.codex/config.toml' },
    { name: 'Pi (pi.dev)', config: '~/.pi/agent/mcp.json' },
    { name: 'OMP Agent', config: '~/.omp/agent/mcp.json' }
  ];

  const PHASES = ['Route', 'Research', 'Explore', 'Plan', 'Execute', 'Review', 'Document', 'Handover'];

  onMount(async () => {
    try {
      health = await api.get('/api/v1/health');
      if (health && typeof health.skills_count === 'number') {
        liveSkillsCount = health.skills_count;
      }
    } catch (_) {}

    try {
      const agentsRes = await api.get('/api/v1/agents');
      if (Array.isArray(agentsRes) && agentsRes.length > 0) {
        liveAgents = agentsRes;
      }
    } catch (_) {}

    try {
      const docsRes = await api.get('/api/v1/skills?type=documentation&limit=100');
      if (Array.isArray(docsRes) && docsRes.length > 0) {
        liveDocs = docsRes;
      }
    } catch (_) {}
  });

  async function searchDocs(q) {
    docQuery = q;
    if (!q.trim()) {
      try {
        const docsRes = await api.get('/api/v1/skills?type=documentation&limit=100');
        if (Array.isArray(docsRes)) liveDocs = docsRes;
      } catch (_) {}
      return;
    }
    isSearching = true;
    try {
      const res = await api.get(`/api/v1/skills?q=${encodeURIComponent(q)}&type=documentation&limit=50`);
      if (Array.isArray(res)) liveDocs = res;
    } catch (_) {
    } finally {
      isSearching = false;
    }
  }

  async function viewDoc(doc) {
    try {
      const full = await api.get(`/api/v1/skills/${encodeURIComponent(doc.name)}`);
      selectedDoc = full;
    } catch (_) {
      selectedDoc = doc;
    }
  }
</script>

<div class="space-y-4 lg:h-[calc(100vh-7.5rem)] lg:flex lg:flex-col">
  {#snippet heroBadgeIcon()}
    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
    </svg>
  {/snippet}

  <PageHero
    title="Documentation"
    subtitle="Full architectural reference, MCP tools specification, SDLC lifecycle, and REST API contract."
    badgeText={health?.version ? `v${String(health.version).replace(/^v+/, '')}` : 'version unavailable'}
    badgeIcon={heroBadgeIcon}
    showGauges={false}
  />

  <DocsDriftBanner />

  <!-- Mobile quick-jump pills -->
  <nav aria-label="Mobile document sections" class="lg:hidden flex gap-2 overflow-x-auto pb-1 no-scrollbar">
    {#each SECTIONS as s}
      <a
        href="#{s.id}"
        class="doc-pill-link text-xs font-semibold px-3 py-1.5 rounded-full shrink-0 transition-all {activeSection === s.id ? 'active' : ''}"
        onclick={() => (activeSection = s.id)}
      >
        {s.label}
      </a>
    {/each}
  </nav>

  <!-- Content layout -->
  <div class="lg:flex lg:gap-6 lg:flex-1 lg:min-h-0">
    <!-- Sticky sidebar (desktop) -->
    <aside class="hidden lg:flex lg:flex-col lg:w-56 shrink-0 lg:overflow-y-auto pr-2">
      <nav class="space-y-1">
        {#each SECTIONS as s}
          <a
            href="#{s.id}"
            class="doc-nav-link flex items-center justify-between text-xs font-semibold px-3 py-2 rounded-xl transition-all {activeSection === s.id ? 'active' : ''}"
            onclick={() => (activeSection = s.id)}
          >
            <span>{s.label}</span>
            <span class="w-1.5 h-1.5 rounded-full transition-opacity {activeSection === s.id ? 'opacity-100 bg-current' : 'opacity-0'}"></span>
          </a>
        {/each}
      </nav>

      <div class="mt-auto pt-6 border-t" style="border-color: var(--color-border);">
        <div class="rounded-2xl p-3 border" style="border-color: var(--color-border); background: var(--color-surface);">
          <div class="flex items-center gap-2 mb-1">
            <span class="w-2 h-2 rounded-full {health?.status === 'healthy' ? 'bg-status-success animate-pulse' : 'bg-status-warning'}"></span>
            <span class="text-[11px] font-mono font-bold" style="color: var(--color-text);">Konoha Engine</span>
          </div>
          <p class="text-[10px]" style="color: var(--color-text-muted);">
            v{health?.version ? String(health.version).replace(/^v+/, '') : 'unknown'} · Node {health?.node || 'unknown'}
          </p>
          {#if health?.db_size}
            <p class="text-[10px] mt-0.5" style="color: var(--color-text-muted);">
              DB: {(health.db_size / 1024 / 1024).toFixed(1)} MB · {liveSkillsCount ?? health?.skills_count ?? '...'} skills
            </p>
          {/if}
        </div>
      </div>
    </aside>

    <!-- Scrollable main documentation canvas -->
    <div class="lg:flex-1 lg:overflow-y-auto space-y-6 pb-12 pr-1">
      <!-- Overview -->
      <section id="overview" class="glass-card-3d p-6 lg:p-8 rounded-3xl border scroll-mt-6" style="border-color: var(--color-border);">
        <h3 class="text-xl font-black tracking-tight mb-3" style="color: var(--color-text);">Overview</h3>
        <p class="text-sm leading-relaxed mb-4" style="color: var(--color-text-muted);">
          Konoha is a multi-client AI agent orchestrator ("Konoha MCP Orchestrator") that turns a single prompt into a governed
          engineering workflow: exploration, planning, execution, review, and documentation — each phase owned by a
          specialized agent, each delivery gated by mechanical quality checks.
        </p>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div class="rounded-2xl border p-4" style="border-color: var(--color-border);">
            <p class="text-2xl font-black" style="color: var(--color-primary);">8 Phases</p>
            <p class="text-xs mt-1" style="color: var(--color-text-muted);">Route → Research → Explore → Plan → Execute → Review → Document → Handover</p>
          </div>
          <div class="rounded-2xl border p-4" style="border-color: var(--color-border);">
            <p class="text-2xl font-black" style="color: var(--color-primary);">{liveAgents.length || 8} Agents</p>
            <p class="text-xs mt-1" style="color: var(--color-text-muted);">Specialized subagents with strict tool boundaries and skill SOPs</p>
          </div>
          <div class="rounded-2xl border p-4" style="border-color: var(--color-border);">
            <p class="text-2xl font-black" style="color: var(--color-primary);">8 Clients</p>
            <p class="text-xs mt-1" style="color: var(--color-text-muted);">Antigravity, Cursor, Claude Code, OpenCode, CommandCode, Codex, Pi, OMP</p>
          </div>
        </div>
        <div class="mt-5 flex flex-wrap gap-2">
          {#each PHASES as phase, i}
            <span class="text-xs font-mono font-bold px-3 py-1.5 rounded-full border" style="color: var(--color-primary); border-color: var(--color-primary); background: var(--color-primary-glow);">{i + 1}. {phase}</span>
          {/each}
        </div>
      </section>

      <!-- SQLite FTS5 Documentation Browser -->
      <section id="fts-docs" class="glass-card-3d p-6 lg:p-8 rounded-3xl border scroll-mt-6" style="border-color: var(--color-border);">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h3 class="text-xl font-black tracking-tight" style="color: var(--color-text);">SQLite FTS5 Documentation</h3>
            <p class="text-xs mt-0.5" style="color: var(--color-text-muted);">
              Authoritative repository documentation seeded into SQLite FTS5 index and neural vector embeddings.
            </p>
          </div>
          <span class="text-[10px] font-mono px-2.5 py-1 rounded-full border font-bold" style="color: var(--color-primary); border-color: var(--color-primary); background: var(--color-primary-glow);">
            {liveDocs.length} Documents Indexed
          </span>
        </div>

        <div class="mb-4">
          <input
            type="text"
            class="w-full text-xs px-4 py-2.5 rounded-xl border font-mono transition-all"
            style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
            placeholder="Search documentation via SQLite FTS5 + Neural Vector RAG (e.g. architecture, security, mcp)..."
            value={docQuery}
            oninput={(e) => searchDocs(e.target.value)}
          />
        </div>

        {#if selectedDoc}
          <div class="rounded-2xl border p-4 mb-4 transition-all" style="background: var(--color-surface); border-color: var(--color-primary);">
            <div class="flex items-center justify-between mb-2 pb-2 border-b" style="border-color: var(--color-border);">
              <div class="flex items-center gap-2">
                <span class="text-xs font-mono font-bold" style="color: var(--color-primary);">{selectedDoc.name}</span>
                <span class="text-[10px] font-mono opacity-75">({(selectedDoc.byte_size || 0).toLocaleString()} bytes · {selectedDoc.line_count || 0} lines)</span>
              </div>
              <button
                type="button"
                class="text-xs font-bold px-2 py-0.5 rounded border hover:opacity-80"
                style="border-color: var(--color-border); color: var(--color-text-muted);"
                onclick={() => (selectedDoc = null)}
              >
                Close
              </button>
            </div>
            <pre class="text-[11px] font-mono whitespace-pre-wrap max-h-96 overflow-y-auto leading-relaxed p-3 rounded-xl" style="background: var(--color-bg); color: var(--color-text);">{selectedDoc.content || 'Loading content...'}</pre>
          </div>
        {/if}

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-80 overflow-y-auto pr-1">
          {#if liveDocs.length === 0}
            <div class="col-span-full text-center py-6 text-xs" style="color: var(--color-text-muted);">
              {isSearching ? 'Searching SQLite FTS5...' : 'No documentation matches found.'}
            </div>
          {:else}
            {#each liveDocs as doc}
              <div class="rounded-2xl border p-3 flex flex-col justify-between hover:border-[var(--color-primary)] transition-all" style="border-color: var(--color-border);">
                <div>
                  <div class="flex items-center justify-between mb-1">
                    <span class="text-xs font-bold font-mono truncate" style="color: var(--color-text);">{doc.skill_name || doc.name.replace(/^doc:/, '')}</span>
                    <span class="text-[9px] font-mono px-1.5 py-0.5 rounded border" style="color: var(--color-primary); border-color: var(--color-primary); background: var(--color-primary-glow);">FTS5 + Vector</span>
                  </div>
                  <p class="text-[10px] line-clamp-1 mb-2 font-mono" style="color: var(--color-text-muted);">{doc.tags || 'documentation'}</p>
                </div>
                <div class="flex items-center justify-between pt-2 border-t text-[10px]" style="border-color: var(--color-border); color: var(--color-text-muted);">
                  <span>{((doc.byte_size || 0) / 1024).toFixed(1)} KB</span>
                  <button
                    type="button"
                    class="font-mono font-bold px-2 py-1 rounded text-[10px] border transition-all"
                    style="color: var(--color-primary); border-color: var(--color-primary); background: var(--color-primary-glow);"
                    onclick={() => viewDoc(doc)}
                  >
                    View Document →
                  </button>
                </div>
              </div>
            {/each}
          {/if}
        </div>
      </section>

      <!-- Architecture -->
      <section id="architecture" class="glass-card-3d p-6 lg:p-8 rounded-3xl border scroll-mt-6" style="border-color: var(--color-border);">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-xl font-black tracking-tight" style="color: var(--color-text);">Architecture &amp; Agents</h3>
          {#if liveAgents.length > 0}
            <span class="text-[10px] font-mono px-2 py-0.5 rounded-full border" style="color: var(--color-primary); border-color: var(--color-primary); background: var(--color-primary-glow);">Live from SQLite DB</span>
          {/if}
        </div>
        <p class="text-sm leading-relaxed mb-5" style="color: var(--color-text-muted);">
          The main agent is an orchestrator only — it never implements directly. Work is delegated through MCP subagent
          tools with structured task arguments, with workflow artifacts (<code class="text-xs font-mono px-1.5 py-0.5 rounded" style="background: var(--color-primary-glow); color: var(--color-primary);">status.json</code>,
          <code class="text-xs font-mono px-1.5 py-0.5 rounded" style="background: var(--color-primary-glow); color: var(--color-primary);">plan.md</code>,
          <code class="text-xs font-mono px-1.5 py-0.5 rounded" style="background: var(--color-primary-glow); color: var(--color-primary);">final_report.md</code>)
          kept in an isolated task directory under <code class="text-xs font-mono">~/.konoha/tmp/</code> — never inside the project workspace. Communication across subagents is handled via structured tool arguments (<code class="text-xs font-mono">task</code>, <code class="text-xs font-mono">context</code>, <code class="text-xs font-mono">constraints</code>, <code class="text-xs font-mono">skills</code>).
        </p>
        <div class="space-y-3">
          {#if liveAgents.length > 0}
            {#each liveAgents as a}
              <div class="rounded-2xl border p-4 transition-all" style="border-color: var(--color-border);">
                <div class="flex flex-wrap items-center gap-2 mb-1">
                  <span class="text-sm font-black capitalize" style="color: var(--color-text);">{a.name}</span>
                  <span class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border" style="color: var(--color-primary); border-color: var(--color-primary); background: var(--color-primary-glow);">{a.role || 'Specialist'}</span>
                  {#if a.model}
                    <span class="text-[10px] font-mono px-2 py-0.5 rounded-full border opacity-75" style="border-color: var(--color-border);">{a.model}</span>
                  {/if}
                </div>
                <p class="text-xs leading-relaxed" style="color: var(--color-text-muted);">{a.description || a.detail || 'Specialized ninja agent.'}</p>
              </div>
            {/each}
          {:else}
            {#each CANONICAL_AGENTS as a}
              <div class="rounded-2xl border p-4 transition-all" style="border-color: var(--color-border);">
                <div class="flex flex-wrap items-center gap-2 mb-1">
                  <span class="text-sm font-black" style="color: var(--color-text);">{a.name}</span>
                  <span class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border" style="color: var(--color-primary); border-color: var(--color-primary); background: var(--color-primary-glow);">{a.role}</span>
                </div>
                <p class="text-xs leading-relaxed" style="color: var(--color-text-muted);">{a.detail}</p>
              </div>
            {/each}
          {/if}
        </div>
      </section>

      <!-- MCP -->
      <section id="mcp" class="glass-card-3d p-6 lg:p-8 rounded-3xl border scroll-mt-6" style="border-color: var(--color-border);">
        <h3 class="text-xl font-black tracking-tight mb-3" style="color: var(--color-text);">MCP Servers &amp; Tools</h3>
        <p class="text-sm leading-relaxed mb-5" style="color: var(--color-text-muted);">
          Every client is wired with two stdio MCP servers, plus code intelligence that runs inside the `konoha`
          server over its own SQLite index. All file reads, code search, and skill lookups go through them —
          native shell tools are bypassed for bounded, token-efficient operations.
        </p>
        <div class="space-y-3">
          {#each MCP_SERVERS as m}
            <div class="rounded-2xl border p-4" style="border-color: var(--color-border);">
              <div class="flex items-center gap-2 mb-1.5">
                <span class="w-2 h-2 rounded-full" style="background: var(--color-primary);"></span>
                <span class="text-sm font-black font-mono" style="color: var(--color-text);">{m.name}</span>
              </div>
              <p class="text-xs leading-relaxed mb-2" style="color: var(--color-text-muted);">{m.detail}</p>
              {#if m.live}
                <McpToolsList />
              {:else}
                <p class="text-[11px] font-mono leading-relaxed px-3 py-2 rounded-xl" style="color: var(--color-primary); background: var(--color-primary-glow);">{m.tools}</p>
              {/if}
            </div>
          {/each}
        </div>
      </section>

      <!-- SDLC -->
      <section id="sdlc" class="glass-card-3d p-6 lg:p-8 rounded-3xl border scroll-mt-6" style="border-color: var(--color-border);">
        <h3 class="text-xl font-black tracking-tight mb-3" style="color: var(--color-text);">SDLC Lifecycle</h3>
        <p class="text-sm leading-relaxed mb-4" style="color: var(--color-text-muted);">
          Tasks are persisted in SQLite (<code class="text-xs font-mono px-1.5 py-0.5 rounded" style="background: var(--color-primary-glow); color: var(--color-primary);">sdlc_tasks</code>)
          with evidence recording and a Definition-of-Readiness (DoR) check. In <strong>enforced</strong> mode, a task that
          lacks acceptance criteria or testability is blocked before dispatch. Review independence is detected per task
          (implementer ≠ reviewer), and slop results are persisted with cycle counts.
        </p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div class="rounded-2xl border p-4" style="border-color: var(--color-border);">
            <p class="text-xs font-bold uppercase tracking-wider mb-2" style="color: var(--color-text-muted);">DoR Modes</p>
            <p class="text-xs leading-relaxed" style="color: var(--color-text-muted);">
              <span class="font-mono font-bold" style="color: var(--color-primary);">advisory</span> — readiness is reported but does not block ·
              <span class="font-mono font-bold" style="color: var(--color-primary);">enforced</span> — unready tasks are blocked with a remediation hint
            </p>
          </div>
          <div class="rounded-2xl border p-4" style="border-color: var(--color-border);">
            <p class="text-xs font-bold uppercase tracking-wider mb-2" style="color: var(--color-text-muted);">Evidence</p>
            <p class="text-xs leading-relaxed" style="color: var(--color-text-muted);">
              Every subagent report records validation evidence (commands, exit codes, line counts). Claims without
              verifiable output are rejected by the review gate.
            </p>
          </div>
        </div>
      </section>

      <!-- Slop Gate -->
      <section id="slop-gate" class="glass-card-3d p-6 lg:p-8 rounded-3xl border scroll-mt-6" style="border-color: var(--color-border);">
        <h3 class="text-xl font-black tracking-tight mb-3" style="color: var(--color-text);">Anti-Slop Delivery Gate</h3>
        <p class="text-sm leading-relaxed mb-4" style="color: var(--color-text-muted);">
          Before any delivery, Kage runs a two-step hard gate. Both steps must report zero findings; the mechanical
          synthesis gate then requires a perfect 100/100 scan before results may be delivered.
        </p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <div class="rounded-2xl border p-4" style="border-color: var(--color-border);">
            <p class="text-xs font-black mb-1" style="color: var(--color-primary);">Step 1 — aislop_scan</p>
            <p class="text-xs leading-relaxed" style="color: var(--color-text-muted);">Scoped scan on changed files only (never unscoped full-repo). Any diagnostic above zero severity blocks the review.</p>
          </div>
          <div class="rounded-2xl border p-4" style="border-color: var(--color-border);">
            <p class="text-xs font-black mb-1" style="color: var(--color-primary);">Step 2 — anti-slop rules</p>
            <p class="text-xs leading-relaxed" style="color: var(--color-text-muted);">The vendored anti-slop skill review (code, UI, copywriting, human, layout filters) loaded via konoha.get_skill.</p>
          </div>
        </div>
        <div class="rounded-2xl border p-4" style="border-color: var(--color-border);">
          <p class="text-xs font-black mb-2" style="color: var(--color-text);">On FAIL — Kage → Anbu/Jonin remediation loop</p>
          <p class="text-xs leading-relaxed" style="color: var(--color-text-muted);">
            Findings are converted into a concrete fix task (each finding maps to one actionable item with rule IDs),
            delegated to <strong>anbu</strong> (or <strong>jonin</strong> for UI findings). The loop re-scans from scratch after every fix
            and is bounded by a circuit breaker at 7 cycles. Only a clean pass advances to the Kage Confidence Gate (≥98%).
          </p>
        </div>
      </section>

      <Docs3DSection />

      <!-- Remote Access & Telegram -->
      <section id="remote" class="glass-card-3d p-6 lg:p-8 rounded-3xl border scroll-mt-6" style="border-color: var(--color-border);">
        <h3 class="text-xl font-black tracking-tight mb-3" style="color: var(--color-text);">Remote Access &amp; Telegram</h3>
        <p class="text-sm leading-relaxed mb-4" style="color: var(--color-text-muted);">
          Konoha provides out-of-band remote operations via a bidirectional Telegram bot interface with persistent SQLite queuing.
        </p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <div class="rounded-2xl border p-4" style="border-color: var(--color-border);">
            <p class="text-xs font-black mb-1" style="color: var(--color-primary);">1-Way Alerts (Audit &amp; Gate Notifications)</p>
            <p class="text-xs leading-relaxed" style="color: var(--color-text-muted);">
              When running locally on laptop/CLI, every completed task that passes the Kage Final Confidence Gate automatically
              delivers structured verdict summaries, verification scores, and token telemetry directly to Telegram.
            </p>
          </div>
          <div class="rounded-2xl border p-4" style="border-color: var(--color-border);">
            <p class="text-xs font-black mb-1" style="color: var(--color-primary);">2-Way Interactive Bot &amp; Prompt Queue</p>
            <p class="text-xs leading-relaxed" style="color: var(--color-text-muted);">
              Send prompts or commands directly to the Telegram bot (<code class="text-xs font-mono">/prompt &lt;task&gt;</code>, <code class="text-xs font-mono">/status</code>, <code class="text-xs font-mono">/agents</code>).
              Prompts are safely enqueued in SQLite (<code class="text-xs font-mono">prompt_queue</code>) and executed by the background worker, streaming progress and deliverables back to your mobile chat.
            </p>
          </div>
        </div>
      </section>

      <!-- Crypto Vault & Security -->
      <section id="crypto" class="glass-card-3d p-6 lg:p-8 rounded-3xl border scroll-mt-6" style="border-color: var(--color-border);">
        <h3 class="text-xl font-black tracking-tight mb-3" style="color: var(--color-text);">Crypto Vault &amp; Secret Sanitization</h3>
        <p class="text-sm leading-relaxed mb-4" style="color: var(--color-text-muted);">
          Production-grade secret management ensures zero plaintext API tokens, bot keys, or credentials exist in databases, logs, or network wire.
        </p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <div class="rounded-2xl border p-4" style="border-color: var(--color-border);">
            <p class="text-xs font-black mb-1" style="color: var(--color-primary);">AES-256-GCM AEAD Encryption</p>
            <p class="text-xs leading-relaxed" style="color: var(--color-text-muted);">
              All sensitive values in <code class="text-xs font-mono">telegram_config</code>
              are encrypted at rest using AES-256-GCM with 96-bit unique IVs and 128-bit authentication tags (GMAC) preventing tampering.
            </p>
          </div>
          <div class="rounded-2xl border p-4" style="border-color: var(--color-border);">
            <p class="text-xs font-black mb-1" style="color: var(--color-primary);">PBKDF2 Key Derivation</p>
            <p class="text-xs leading-relaxed" style="color: var(--color-text-muted);">
              Encryption keys are derived via PBKDF2 (100,000 SHA-256 iterations) with persistent machine salt and user environmental entropy.
            </p>
          </div>
        </div>
        <div class="rounded-2xl border p-4" style="border-color: var(--color-border);">
          <p class="text-xs font-black mb-1" style="color: var(--color-text);">Strict Redaction Invariant</p>
          <p class="text-xs leading-relaxed" style="color: var(--color-text-muted);">
            All REST API responses, CLI outputs, and log transcripts automatically mask token values (<code class="text-xs font-mono">12345***:***abcd</code>)
            to prevent credential leaks during pair programming or screen shares.
          </p>
        </div>
      </section>

      <!-- Cybersecurity & Red Teaming -->
      <section id="redteam" class="glass-card-3d p-6 lg:p-8 rounded-3xl border scroll-mt-6" style="border-color: var(--color-border);">
        <h3 class="text-xl font-black tracking-tight mb-3" style="color: var(--color-text);">Cybersecurity &amp; Red Teaming</h3>
        <p class="text-sm leading-relaxed mb-4" style="color: var(--color-text-muted);">
          Konoha equips the <strong>Akatsuki</strong> security specialist subagent with full offensive security, penetration testing, and MITRE ATT&amp;CK red-teaming tradecraft.
        </p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <div class="rounded-2xl border p-4" style="border-color: var(--color-border);">
            <p class="text-xs font-black mb-1" style="color: var(--color-primary);">817 Anthropic Cybersecurity Skills</p>
            <p class="text-xs leading-relaxed" style="color: var(--color-text-muted);">
              Indexed into SQLite and vector search: Active Directory assessment, DPAPI extraction, privilege escalation, credential dumping,
              network pivoting, reverse engineering, and defensive hardening.
            </p>
          </div>
          <div class="rounded-2xl border p-4" style="border-color: var(--color-border);">
            <p class="text-xs font-black mb-1" style="color: var(--color-primary);">Development / Local Scope Invariant</p>
            <p class="text-xs leading-relaxed" style="color: var(--color-text-muted);">
              Penetration testing and vulnerability scanning are authorized in local dev environments (<code class="text-xs font-mono">localhost</code>, <code class="text-xs font-mono">127.0.0.1</code>, containers).
              External production targets require explicit user authorization.
            </p>
          </div>
        </div>
        <div class="rounded-2xl border p-4" style="border-color: var(--color-border);">
          <p class="text-xs font-black mb-1" style="color: var(--color-text);">Socket Supply Chain Security Gate</p>
          <p class="text-xs leading-relaxed" style="color: var(--color-text-muted);">
            Integrated Socket CLI scanning (<code class="text-xs font-mono">socket ci</code>) enforces zero High or Medium severity supply chain vulnerabilities before delivery.
          </p>
        </div>
      </section>

      <!-- API -->
      <section id="api" class="glass-card-3d p-6 lg:p-8 rounded-3xl border scroll-mt-6" style="border-color: var(--color-border);">
        <h3 class="text-xl font-black tracking-tight mb-3" style="color: var(--color-text);">Web API Reference</h3>
        <p class="text-sm leading-relaxed mb-4" style="color: var(--color-text-muted);">
          Same-origin REST API served by the Konoha web server. Mutating requests require the
          <code class="text-xs font-mono px-1.5 py-0.5 rounded" style="background: var(--color-primary-glow); color: var(--color-primary);">X-Konoha-Web-Token</code>
          header, obtained from the CSRF cookie via <code class="text-xs font-mono">GET /api/v1/csrf</code>.
        </p>
        <div class="rounded-2xl border overflow-hidden" style="border-color: var(--color-border);">
          <table class="w-full text-xs">
            <thead>
              <tr style="background: var(--color-primary-glow);">
                <th class="text-left font-black uppercase tracking-wider px-4 py-2.5" style="color: var(--color-primary);">Method</th>
                <th class="text-left font-black uppercase tracking-wider px-4 py-2.5" style="color: var(--color-primary);">Endpoint</th>
                <th class="text-left font-black uppercase tracking-wider px-4 py-2.5 hidden sm:table-cell" style="color: var(--color-primary);">Description</th>
              </tr>
            </thead>
            <tbody>
              {#each API_ENDPOINTS as ep}
                <tr class="border-t" style="border-color: var(--color-border);">
                  <td class="px-4 py-2">
                    <span class="font-mono font-bold px-2 py-0.5 rounded text-[10px] uppercase border" style="color: {ep.method === 'GET' ? 'var(--color-primary)' : 'var(--color-accent)'}; background: {ep.method === 'GET' ? 'var(--color-primary-glow)' : 'color-mix(in srgb, var(--color-accent) 15%, transparent)'}; border-color: {ep.method === 'GET' ? 'var(--color-primary)' : 'var(--color-accent)'};">{ep.method}</span>
                  </td>
                  <td class="px-4 py-2 font-mono font-semibold" style="color: var(--color-text);">{ep.path}</td>
                  <td class="px-4 py-2 hidden sm:table-cell" style="color: var(--color-text-muted);">{ep.desc}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>

      <!-- Clients -->
      <section id="clients" class="glass-card-3d p-6 lg:p-8 rounded-3xl border scroll-mt-6" style="border-color: var(--color-border);">
        <h3 class="text-xl font-black tracking-tight mb-3" style="color: var(--color-text);">Client Setup</h3>
        <p class="text-sm leading-relaxed mb-4" style="color: var(--color-text-muted);">
          Use the Clients screen to configure or remove MCP wiring per client. The runtime contract (Konoha + aislop,
          RTK shell filtering, guardrails) is injected into every client's agent instructions.
        </p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {#each CLIENTS as c}
            <div class="rounded-2xl border p-4" style="border-color: var(--color-border);">
              <p class="text-sm font-bold mb-1" style="color: var(--color-text);">{c.name}</p>
              <p class="text-[11px] font-mono break-all" style="color: var(--color-text-muted);">{c.config}</p>
            </div>
          {/each}
        </div>
      </section>

      <!-- CLI -->
      <section id="cli" class="glass-card-3d p-6 lg:p-8 rounded-3xl border scroll-mt-6" style="border-color: var(--color-border);">
        <h3 class="text-xl font-black tracking-tight mb-3" style="color: var(--color-text);">CLI Commands</h3>
        <div class="space-y-2 font-mono text-xs">
          <div class="rounded-xl border px-4 py-3" style="border-color: var(--color-border);"> <span class="font-bold" style="color: var(--color-primary);">konoha init</span> <span style="color: var(--color-text-muted);"> — full setup: MCP servers, migrate local skills, configure supported clients</span> </div>
          <div class="rounded-xl border px-4 py-3" style="border-color: var(--color-border);"> <span class="font-bold" style="color: var(--color-primary);">konoha embed</span> <span style="color: var(--color-text-muted);"> — rebuild neural vector embeddings for all skills (IBM Granite + MS MARCO Reranker)</span> </div>
          <div class="rounded-xl border px-4 py-3" style="border-color: var(--color-border);"> <span class="font-bold" style="color: var(--color-primary);">konoha migrate [--clean|--rebuild-embeddings|--skills-dir]</span> <span style="color: var(--color-text-muted);"> — re-index custom skills into SQLite FTS5 database</span> </div>
          <div class="rounded-xl border px-4 py-3" style="border-color: var(--color-border);"> <span class="font-bold" style="color: var(--color-primary);">konoha test</span> <span style="color: var(--color-text-muted);"> — perform verification tests on the MCP server & tools</span> </div>
          <div class="rounded-xl border px-4 py-3" style="border-color: var(--color-border);"> <span class="font-bold" style="color: var(--color-primary);">konoha status</span> <span style="color: var(--color-text-muted);"> — check installation health, database size, and loaded skills</span> </div>
          <div class="rounded-xl border px-4 py-3" style="border-color: var(--color-border);"> <span class="font-bold" style="color: var(--color-primary);">konoha ui &lt;start|build&gt;</span> <span style="color: var(--color-text-muted);"> — serve the local Web Configuration UI in the foreground (port 1404), or build its bundle</span> </div>
          <div class="rounded-xl border px-4 py-3" style="border-color: var(--color-border);"> <span class="font-bold" style="color: var(--color-primary);">konoha task &lt;list|show|slop&gt;</span> <span style="color: var(--color-text-muted);"> — inspect SDLC tasks and persisted slop results</span> </div>
          <div class="rounded-xl border px-4 py-3" style="border-color: var(--color-border);"> <span class="font-bold" style="color: var(--color-primary);">konoha skill &lt;list|search|add|remove&gt;</span> <span style="color: var(--color-text-muted);"> — manage skills from the public registry (skills.sh)</span> </div>
          <div class="rounded-xl border px-4 py-3" style="border-color: var(--color-border);"> <span class="font-bold" style="color: var(--color-primary);">konoha doctor [--repair]</span> <span style="color: var(--color-text-muted);"> — environment diagnostics and auto-repair</span> </div>
          <div class="rounded-xl border px-4 py-3" style="border-color: var(--color-border);"> <span class="font-bold" style="color: var(--color-primary);">konoha telegram &lt;status|start|stop|test|config&gt;</span> <span style="color: var(--color-text-muted);"> — manage Telegram bot integration, polling, and alert delivery</span> </div>
          <div class="rounded-xl border px-4 py-3" style="border-color: var(--color-border);"> <span class="font-bold" style="color: var(--color-primary);">konoha queue &lt;status|list|clear|retry&gt;</span> <span style="color: var(--color-text-muted);"> — manage remote inbound prompt queue and offline worker jobs</span> </div>
          <div class="rounded-xl border px-4 py-3" style="border-color: var(--color-border);"> <span class="font-bold" style="color: var(--color-primary);">konoha agent &lt;list|check&gt;</span> <span style="color: var(--color-text-muted);"> — list active ninja subagents and verify model provider bindings</span> </div>
          <div class="rounded-xl border px-4 py-3" style="border-color: var(--color-border);"> <span class="font-bold" style="color: var(--color-primary);">konoha data &lt;backup|rebuild-fts|prune&gt;</span> <span style="color: var(--color-text-muted);"> — manage SQLite online backups, rebuild search indexes, and prune telemetry</span> </div>
        </div>
      </section>
    </div>
  </div>
</div>

<style>
  .doc-nav-link {
    color: var(--color-text-muted);
    background: transparent;
    transition: all 0.15s ease-in-out;
  }
  .doc-nav-link:hover:not(.active) {
    background: var(--theme-sidemenu-hover);
    color: var(--color-primary);
  }
  .doc-nav-link.active {
    background: var(--theme-sidemenu-active);
    color: #ffffff;
    font-weight: 800;
    box-shadow: 0 4px 14px -2px color-mix(in srgb, var(--theme-grad-1) 35%, transparent);
  }
  .doc-nav-link:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }
  .doc-pill-link {
    color: var(--color-text-muted);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
  }
  .doc-pill-link:hover:not(.active) {
    background: var(--theme-sidemenu-hover);
    color: var(--color-primary);
    border-color: var(--color-primary);
  }
  .doc-pill-link.active {
    background: var(--theme-sidemenu-active);
    color: #ffffff;
    font-weight: 800;
    border-color: transparent;
  }
  .doc-pill-link:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }
  .no-scrollbar::-webkit-scrollbar {
    display: none;
  }
  .no-scrollbar {
    -ms-overflow-style: none;
    scrollbar-width: none;
  }
</style>