<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';

  let health = $state(null);
  let activeSection = $state('overview');

  const SECTIONS = [
    { id: 'overview', label: 'Overview' },
    { id: 'architecture', label: 'Architecture & Agents' },
    { id: 'mcp', label: 'MCP Servers & Tools' },
    { id: 'sdlc', label: 'SDLC Lifecycle' },
    { id: 'slop-gate', label: 'Anti-Slop Delivery Gate' },
    { id: 'api', label: 'Web API Reference' },
    { id: 'clients', label: 'Client Setup' },
    { id: 'cli', label: 'CLI Commands' }
  ];

  const AGENTS = [
    { name: 'Sannin', role: 'Task triage & orchestration router', detail: 'Entry point for non-trivial work. Resolves the task directory, routes the request through the village pipeline, and delivers the final report.' },
    { name: 'Genin', role: 'Read-only exploration', detail: 'Codebase exploration, symbol search, dependency mapping, and evidence-based findings. Never mutates files.' },
    { name: 'Kage', role: 'Architecture, security & review', detail: 'Deep code analysis, risk assessment, and the blocking Kage Reviewer Confidence Gate (≥97%) with the two-step Zero-AI-Slop scan.' },
    { name: 'Jonin', role: 'Premium UI development', detail: 'Frontend builds with the Taste-Skill Design Engine — typography dials, motion intensity, and strict design invariants.' },
    { name: 'Anbu', role: 'Backend & remediation', detail: 'Backend development, bug fixes, DevOps, and the slop-fix remediation specialist when the Delivery Gate reports findings.' },
    { name: 'Chunin', role: 'Research & evidence', detail: 'Web research, documentation lookup, and evidence synthesis with citations.' },
    { name: 'Tokubetsu-Jonin', role: 'Technical writing', detail: 'README creation, API specifications, runbooks, and final delivery documentation.' }
  ];

  const MCP_SERVERS = [
    { name: 'konoha', tools: 'find_skill, get_skill, list_skills, read_file_head, read_file_range, token_efficient_grep, get_file_structure, find_files_clean, sannin, kage, jonin, anbu, chunin, genin, tokubetsu_jonin, website_ai_detector', detail: 'Skill discovery, bounded file I/O, subagent dispatch, and the website AI-fingerprint detector for every client.' },
    { name: 'semble', tools: 'search, find_related', detail: 'Semantic codebase search. Always called with the absolute repository path — replaces grep/glob for code discovery.' },
    { name: 'aislop', tools: 'aislop_scan, aislop_fix, aislop_why, aislop_baseline', detail: 'Zero-AI-Slop scanning and remediation. Read-only agents get scan + why; write agents additionally get fix.' }
  ];

  const API_ENDPOINTS = [
    { method: 'GET', path: '/api/v1/health', desc: 'Server health, version, skills/agents counts' },
    { method: 'GET', path: '/api/v1/system/metrics', desc: 'System CPU/memory telemetry + Konoha feature metrics' },
    { method: 'GET', path: '/api/v1/detect-ai?target=', desc: 'Website AI-fingerprint detector (directory path or URL) — 0–100 score, 0–20 = Human-Built' },
    { method: 'GET', path: '/api/v1/detect-docs?file_path=', desc: 'Document AI-fingerprint detector (.docx, .pdf, .pptx, .xlsx, .md, .txt) — 0–3% ZeroGPT target' },
    { method: 'POST', path: '/api/v1/detect-docs/text', desc: 'Analyze pasted text for AI fingerprints (body: { text: string })' },
    { method: 'GET', path: '/api/v1/csrf', desc: 'Session CSRF token (mutating requests require X-Konoha-Web-Token)' },
    { method: 'GET', path: '/api/v1/bridges', desc: 'List configured bridges' },
    { method: 'GET', path: '/api/v1/bridges/status', desc: 'Runtime status of bridges & gateway' },
    { method: 'GET', path: '/api/v1/agents', desc: 'Agent roster & model assignments' },
    { method: 'GET', path: '/api/v1/skills', desc: 'Skill search (FTS5 / semantic vector mode)' },
    { method: 'POST', path: '/api/v1/skills/install', desc: 'Install a skill from the registry' },
    { method: 'GET', path: '/api/v1/sdlc/tasks', desc: 'List SDLC tasks (filter by status/project)' },
    { method: 'POST', path: '/api/v1/sdlc/check-readiness', desc: 'Definition-of-Readiness check for task text' },
    { method: 'GET', path: '/api/v1/sdlc/config', desc: 'Project SDLC config (dor_mode, review_mode)' },
    { method: 'GET', path: '/api/v1/savings', desc: 'Token savings report (Konoha + Semble combined)' },
    { method: 'GET', path: '/api/v1/semble', desc: 'Semble MCP status' },
    { method: 'POST', path: '/api/v1/semble/search', desc: 'Semantic code search proxy' },
    { method: 'GET', path: '/api/v1/search/status', desc: 'SearXNG search engine status' },
    { method: 'POST', path: '/api/v1/search', desc: 'Zero-API-key web search' },
    { method: 'GET', path: '/api/v1/doctor', desc: 'Environment health diagnostics' },
    { method: 'POST', path: '/api/v1/doctor/repair', desc: 'Auto-repair detected issues' },
    { method: 'GET', path: '/api/v1/persona', desc: 'Persona memories (project-scoped)' },
    { method: 'GET', path: '/api/v1/projects', desc: 'Known projects & current workspace' },
    { method: 'GET', path: '/api/v1/clients', desc: 'Cross-client MCP configuration status' },
    { method: 'GET', path: '/api/v1/events', desc: 'Server-sent events stream (live updates)' }
  ];

  const CLIENTS = [
    { name: 'Antigravity IDE / CLI', config: '~/.gemini/config/mcp_config.json' },
    { name: 'Cursor IDE', config: '~/.cursor/mcp.json' },
    { name: 'Claude Code', config: '~/.claude.json' },
    { name: 'OpenCode', config: '~/.config/opencode/opencode.json' },
    { name: 'Command Code', config: '~/.commandcode/mcp.json' },
    { name: 'Codex IDE / CLI', config: '~/.codex/config.toml' },
    { name: 'Pi (pi.dev)', config: '~/.pi/agent/mcp.json' }
  ];

  const PHASES = ['Route', 'Research', 'Explore', 'Plan', 'Execute', 'Review', 'Document', 'Synthesize'];

  onMount(async () => {
    try {
      health = await api.get('/api/v1/health');
    } catch (_) { /* Documentation is static; health badge is best-effort */ }
  });
</script>

<div class="space-y-6">
  <!-- Header -->
  <div class="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
    <div class="flex items-center gap-3">
      <div class="w-11 h-11 rounded-2xl flex items-center justify-center border shadow-lg" style="background: var(--color-primary-glow); border-color: var(--color-primary);">
        <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="color: var(--color-primary);">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
      </div>
      <div>
        <h2 class="text-2xl lg:text-3xl font-black tracking-tight" style="color: var(--color-text);">Documentation</h2>
        <p class="text-sm font-medium" style="color: var(--color-text-muted);">Konoha runtime manual — architecture, gates, APIs &amp; operations</p>
      </div>
    </div>
    {#if health}
      <div class="flex items-center gap-2">
        <span class="text-xs font-mono px-3 py-1.5 rounded-full border" style="color: var(--color-text-muted); border-color: var(--color-border);">v{health.version}</span>
        <span class="text-xs font-mono px-3 py-1.5 rounded-full border" style="color: var(--color-text-muted); border-color: var(--color-border);">{health.node}</span>
      </div>
    {/if}
  </div>

  <div class="grid grid-cols-1 lg:grid-cols-4 gap-6">
    <!-- Sticky TOC -->
    <aside class="hidden lg:block">
      <nav class="glass-card-3d p-4 rounded-2xl border sticky top-6 space-y-1" style="border-color: var(--color-border);">
        <p class="text-[10px] font-bold uppercase tracking-widest px-3 pb-2" style="color: var(--color-text-muted);">Contents</p>
        {#each SECTIONS as s}
          <a
            href="#{s.id}"
            class="block px-3 py-2 rounded-xl text-sm font-semibold transition-all"
            style="color: {activeSection === s.id ? 'var(--color-primary)' : 'var(--color-text-muted)'}; background: {activeSection === s.id ? 'var(--color-primary-glow)' : 'transparent'};"
            onclick={() => (activeSection = s.id)}
          >{s.label}</a>
        {/each}
      </nav>
    </aside>

    <!-- Content -->
    <div class="lg:col-span-3 space-y-6">
      <!-- Overview -->
      <section id="overview" class="glass-card-3d p-6 lg:p-8 rounded-3xl border scroll-mt-6" style="border-color: var(--color-border);">
        <h3 class="text-xl font-black tracking-tight mb-3" style="color: var(--color-text);">Overview</h3>
        <p class="text-sm leading-relaxed mb-4" style="color: var(--color-text-muted);">
          Konoha is a multi-client AI agent orchestrator ("Ninja Agent Village") that turns a single prompt into a governed
          engineering workflow: exploration, planning, execution, review, and documentation — each phase owned by a
          specialized agent, each delivery gated by mechanical quality checks.
        </p>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div class="rounded-2xl border p-4" style="border-color: var(--color-border);">
            <p class="text-2xl font-black" style="color: var(--color-primary);">8 Phases</p>
            <p class="text-xs mt-1" style="color: var(--color-text-muted);">Route → Research → Explore → Plan → Execute → Review → Document → Synthesize</p>
          </div>
          <div class="rounded-2xl border p-4" style="border-color: var(--color-border);">
            <p class="text-2xl font-black" style="color: var(--color-primary);">7 Agents</p>
            <p class="text-xs mt-1" style="color: var(--color-text-muted);">Specialized subagents with strict tool boundaries and skill SOPs</p>
          </div>
          <div class="rounded-2xl border p-4" style="border-color: var(--color-border);">
            <p class="text-2xl font-black" style="color: var(--color-primary);">7 Clients</p>
            <p class="text-xs mt-1" style="color: var(--color-text-muted);">Antigravity, Cursor, Claude Code, OpenCode, CommandCode, Codex, Pi</p>
          </div>
        </div>
        <div class="mt-5 flex flex-wrap gap-2">
          {#each PHASES as phase, i}
            <span class="text-xs font-mono font-bold px-3 py-1.5 rounded-full border" style="color: var(--color-primary); border-color: var(--color-primary); background: var(--color-primary-glow);">{i + 1}. {phase}</span>
          {/each}
        </div>
      </section>

      <!-- Architecture -->
      <section id="architecture" class="glass-card-3d p-6 lg:p-8 rounded-3xl border scroll-mt-6" style="border-color: var(--color-border);">
        <h3 class="text-xl font-black tracking-tight mb-3" style="color: var(--color-text);">Architecture &amp; Agents</h3>
        <p class="text-sm leading-relaxed mb-5" style="color: var(--color-text-muted);">
          The main agent is an orchestrator only — it never implements directly. Work is delegated through MCP subagent
          tools, with workflow artifacts (<code class="text-xs font-mono px-1.5 py-0.5 rounded" style="background: var(--color-primary-glow); color: var(--color-primary);">prompt.md</code>,
          <code class="text-xs font-mono px-1.5 py-0.5 rounded" style="background: var(--color-primary-glow); color: var(--color-primary);">plan.md</code>,
          <code class="text-xs font-mono px-1.5 py-0.5 rounded" style="background: var(--color-primary-glow); color: var(--color-primary);">result.md</code>)
          kept in an isolated task directory under <code class="text-xs font-mono">~/.konoha/tmp/</code> — never inside the project workspace.
        </p>
        <div class="space-y-3">
          {#each AGENTS as a}
            <div class="rounded-2xl border p-4 transition-all" style="border-color: var(--color-border);">
              <div class="flex flex-wrap items-center gap-2 mb-1">
                <span class="text-sm font-black" style="color: var(--color-text);">{a.name}</span>
                <span class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border" style="color: var(--color-primary); border-color: var(--color-primary); background: var(--color-primary-glow);">{a.role}</span>
              </div>
              <p class="text-xs leading-relaxed" style="color: var(--color-text-muted);">{a.detail}</p>
            </div>
          {/each}
        </div>
      </section>

      <!-- MCP -->
      <section id="mcp" class="glass-card-3d p-6 lg:p-8 rounded-3xl border scroll-mt-6" style="border-color: var(--color-border);">
        <h3 class="text-xl font-black tracking-tight mb-3" style="color: var(--color-text);">MCP Servers &amp; Tools</h3>
        <p class="text-sm leading-relaxed mb-5" style="color: var(--color-text-muted);">
          Every client is wired with three MCP servers. All file reads, code search, and skill lookups go through them —
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
              <p class="text-[11px] font-mono leading-relaxed px-3 py-2 rounded-xl" style="color: var(--color-primary); background: var(--color-primary-glow);">{m.tools}</p>
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
            and is bounded by a circuit breaker at 7 cycles. Only a clean pass advances to the Kage Confidence Gate (≥97%).
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
                    <span class="font-mono font-bold px-1.5 py-0.5 rounded text-[10px]" style="color: {ep.method === 'GET' ? '#059669' : '#2563eb'}; background: {ep.method === 'GET' ? 'rgba(5,150,105,0.1)' : 'rgba(37,99,235,0.1)'};">{ep.method}</span>
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
          Use the Clients screen to configure or remove MCP wiring per client. The runtime contract (Konoha + Semble + aislop,
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
          <div class="rounded-xl border px-4 py-3" style="border-color: var(--color-border);">
            <span class="font-bold" style="color: var(--color-primary);">konoha init</span>
            <span style="color: var(--color-text-muted);"> — full setup: MCP servers, migrate local skills, configure supported clients</span>
          </div>
          <div class="rounded-xl border px-4 py-3" style="border-color: var(--color-border);">
            <span class="font-bold" style="color: var(--color-primary);">konoha embed</span>
            <span style="color: var(--color-text-muted);"> — rebuild neural vector embeddings for all skills (IBM Granite + MS MARCO Reranker)</span>
          </div>
          <div class="rounded-xl border px-4 py-3" style="border-color: var(--color-border);">
            <span class="font-bold" style="color: var(--color-primary);">konoha migrate [--clean|--rebuild-embeddings|--skills-dir]</span>
            <span style="color: var(--color-text-muted);"> — re-index custom skills into SQLite FTS5 database</span>
          </div>
          <div class="rounded-xl border px-4 py-3" style="border-color: var(--color-border);">
            <span class="font-bold" style="color: var(--color-primary);">konoha test</span>
            <span style="color: var(--color-text-muted);"> — perform verification tests on the MCP server & tools</span>
          </div>
          <div class="rounded-xl border px-4 py-3" style="border-color: var(--color-border);">
            <span class="font-bold" style="color: var(--color-primary);">konoha status</span>
            <span style="color: var(--color-text-muted);"> — check installation health, database size, and loaded skills</span>
          </div>
          <div class="rounded-xl border px-4 py-3" style="border-color: var(--color-border);">
            <span class="font-bold" style="color: var(--color-primary);">konoha web / konoha ui &lt;start|stop|restart|status&gt;</span>
            <span style="color: var(--color-text-muted);"> — start/manage the local Web Configuration UI (port 1404)</span>
          </div>
          <div class="rounded-xl border px-4 py-3" style="border-color: var(--color-border);">
            <span class="font-bold" style="color: var(--color-primary);">konoha task &lt;list|show|slop&gt;</span>
            <span style="color: var(--color-text-muted);"> — inspect SDLC tasks and persisted slop results</span>
          </div>
          <div class="rounded-xl border px-4 py-3" style="border-color: var(--color-border);">
            <span class="font-bold" style="color: var(--color-primary);">konoha skill &lt;list|search|add|remove&gt;</span>
            <span style="color: var(--color-text-muted);"> — manage skills from the public registry (skills.sh)</span>
          </div>
          <div class="rounded-xl border px-4 py-3" style="border-color: var(--color-border);">
            <span class="font-bold" style="color: var(--color-primary);">konoha doctor [--repair]</span>
            <span style="color: var(--color-text-muted);"> — environment diagnostics and auto-repair</span>
          </div>
        </div>
      </section>
    </div>
  </div>
</div>
