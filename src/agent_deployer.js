'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const cursorManager = require('./cursor_manager');
const antigravityManager = require('./antigravity_manager');
const mcpClientsManager = require('./mcp_clients_manager');
const deployUtils = require('./deploy_utils');
const {
  SERVER_PATH,
  HOME
} = require('./config_access').loadBinLib('paths');
const {
  buildLightweightContract,
  buildManagedContract
} = require('./agent_contract');
const { loadAgents } = require('./agent_storage');

function buildDefineSubagentGuide(agents) {
  return `### Konoha Hybrid Subagent Architecture (MCP Delegation + Native Harness Spawning)

Subagents operate in two coordinated layers across the \`konoha\` MCP server and each client harness:
1. **MCP Delegation & Context Layer**: Calling \`konoha.<agent>\` (${agents.map(a => `\`${a.name}\``).join(', ')}) compiles the delegation envelope (bound skills, soul archetype, codebase intelligence/memory) and returns a harness-native **Spawn Directive**.
2. **Native Subagent Execution Layer**: Client harnesses that natively support subagents read Konoha's deployed agent profiles (\`.claude/agents/*.md\`, \`.cursor/agents/*.md\`, \`~/.codex/agents/*.toml\`, \`~/.config/opencode/agents/*.md\`, \`.commandcode/agents/*.md\`, \`~/.omp/agent/agents/*.md\`, or Antigravity \`define_subagent\`/\`invoke_subagent\`) and spawn isolated child workers using their native tool (\`Agent\`, \`Task\`, \`task\`, \`spawn_agent\`, \`invoke_subagent\`) or \`konoha run-agent\`. Harnesses without native spawning (e.g. bare \`pi\` without extensions) fail closed with \`UNSUPPORTED_NATIVE_SPAWN\`.


### Auto-Compaction & Live Checklist Sync Contract (All 8 Harnesses)
Konoha enforces a **Dynamic Per-Agent Input Token Quota** (default \`100,000\` tokens via \`agent_input_token_quota\` / \`KONOHA_AGENT_INPUT_TOKEN_QUOTA\`) and **Realtime Checklist Sync** across all 8 coding harnesses (Antigravity IDE/CLI, Claude Code, CommandCode, OpenCode, Cursor, OMP, Codex, and Pi):
- **Quota-Triggered LangGraph Checkpoint & Auto-Continue**: Instead of truncating after 2 turns, when an agent reaches its configured input token quota (\`agent_input_token_quota\`), Konoha saves a per-agent checkpoint (\`agent\`, \`task\`, \`todo\`, \`work\`, \`progress\`, \`latest_condition\`) directly in LangGraph SQLite state (\`lg_checkpoints\` / \`KonohaWorkflowState.agentSnapshots\`), compacts active context using Head+Middle+Tail preservation, resets the agent's token baseline, and automatically continues from \`## LATEST CONDITION CHECKPOINT (Auto-Continue)\`.
- **Realtime Client Checklist Sync**: Every delegation and agent report returns \`client_todo_directive\` (with harness-specific \`native_payload\`), \`walkthrough_steps\`, and syncs \`TODO.md\` + \`sdlc_tasks\` so active task lists update in real time.
- **Memory Continuity & Advisor Guard**: Project invariants and verified learnings are retained across compactions; \`@advisor\` sits idle from turn 0 (\`<= 8,192\` tokens/turn) to catch drift without Lost-in-the-Middle drops.
- **On-Demand Skills**: Full reference manuals are served on-demand via \`konoha.get_skill\` instead of being dumped into prompts.

### Delegation Protocol

To delegate a task:
1. **Direct Structured MCP Delegation (Mandatory & Token-Safe)**: Call the subagent MCP tool directly (for example, \`jonin\`, \`anbu\`, \`kage\`, or \`genin\`) with structured arguments (\`task\`, \`context\`, \`constraints\`, \`skills\`, \`taste_dials\`, and \`project_path\`) to compile the delegation envelope and harness spawn directive. Session state and transcripts flow through canonical JSON/JSONL streams and \`konoha.report_from_agent\` rather than legacy markdown IPC files.
2. **Isolated Child Spawning & Result Delivery**: Spawn the child agent via the returned native harness call or \`konoha run-agent\` so the subagent executes with scoped permissions (strictly read-only for \`genin\`) and reports back to the parent orchestrator.`;
}

function buildLightweightMarkdownContent(agents, clientTitle, clientKey) {
  const roster = (agents || []).map(a => {
    const title = a.name === 'anbu'
      ? 'Backend, DevOps & Bug Fixing'
      : (a.name === 'akatsuki' ? 'Red-Team & Blue-Team Security' : (a.title || 'Specialist'));
    return `- **@${a.name}**: ${title}`;
  }).join('\n');

  const contractText = buildLightweightContract({ client: clientKey });

  const body = `# ${clientTitle}

## Team Roster
${roster}

## Safety Guardrails
NEVER run destructive commands (\`rm -rf\`, \`DROP\`, \`git reset\`) or view secrets (\`.env*\`).\n\n`;

  return buildManagedContract(body, contractText);
}

function generateGeminiMd(agents) {
  return buildLightweightMarkdownContent(agents, 'Global Agent Instructions', 'antigravity');
}

function generateClaudeCodeMd(agents) {
  return buildLightweightMarkdownContent(agents, 'Claude Code — Global Agent Instructions', 'claude');
}

function generateAgentsMd(agents) {
  return buildLightweightMarkdownContent(agents, 'AGENTS.md — Multi-Agent Team Configuration', 'antigravity');
}

function readPkgVersion(p) {
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')).version || null;
  } catch (_) {
    return null;
  }
}

function getCliVersion() {
  const candidatePkgPaths = [
    path.join(__dirname, '..', 'package.json'),
    path.join(HOME, '.konoha', 'package.json')
  ];
  for (const p of candidatePkgPaths) {
    const v = readPkgVersion(p);
    if (v) return v;
  }
  return '0.0.0';
}

function stripLegacyKonohaPreamble(rawText) {
  if (!rawText || typeof rawText !== 'string') return '';
  let text = rawText;

  // Strip legacy Konoha repository-maintenance preamble (# Custom Agent Rules for Konoha ... ### Rule 3 — PLAN.md First)
  if (
    text.includes('# Custom Agent Rules for Konoha') &&
    text.includes('### Rule 3 — PLAN.md First, Never Commit Plans')
  ) {
    const startMarkerIdx = text.indexOf('<!-- KONOHA-START -->');
    if (startMarkerIdx !== -1) {
      const before = text.slice(0, startMarkerIdx);
      const customIdx = before.indexOf('# Custom Agent Rules for Konoha');
      if (customIdx !== -1) {
        const userPrefix = before.slice(0, customIdx).trim();
        text = (userPrefix ? `${userPrefix}\n\n` : '') + text.slice(startMarkerIdx);
      }
    }
  }

  // Strip unclosed legacy v1/v2.0 Konoha GEMINI.md dump ending with <!-- KONOHA-CONTRACT-END --> without <!-- KONOHA-START -->
  if (
    !text.includes('<!-- KONOHA-START -->') &&
    text.includes('<!-- KONOHA-CONTRACT-END -->') &&
    text.includes('You are equipped with two MCP servers: **`konoha`** and **`semble`**')
  ) {
    const endContractIdx = text.indexOf('<!-- KONOHA-CONTRACT-END -->');
    const headerIdx = text.indexOf('# Global Agent Instructions');
    if (headerIdx !== -1 && endContractIdx > headerIdx) {
      const before = text.slice(0, headerIdx).trim();
      const after = text.slice(endContractIdx + '<!-- KONOHA-CONTRACT-END -->'.length).trim();
      text = [before, after].filter(Boolean).join('\n\n');
    }
  }

  return text;
}

function injectManagedConfig(filePath, newManagedContent, marker = 'KONOHA', options = {}) {
  const startMarker = `<!-- ${marker}-START -->`;
  const endMarker = `<!-- ${marker}-END -->`;
  const wrapped = `${startMarker}\n${newManagedContent.trim()}\n${endMarker}\n`;

  let existing = '';
  if (filePath && fs.existsSync(filePath)) {
    const backupMgr = require('./config_backup_manager');
    backupMgr.ensureBackupBeforeModify(filePath, {
      client: options.client || 'antigravity',
      scope: options.scope || 'global',
      ...options
    });
    try {
      existing = stripLegacyKonohaPreamble(fs.readFileSync(filePath, 'utf8'));
    } catch {
      existing = '';
    }
  }

  let result;
  const trimmed = existing.trim();
  if (!trimmed) {
    result = wrapped;
  } else {
    const startIndex = existing.indexOf(startMarker);
    const endIndex = existing.indexOf(endMarker);
    if (startIndex !== -1 && endIndex !== -1 && endIndex >= startIndex) {
      const before = existing.slice(0, startIndex).trim();
      const after = existing.slice(endIndex + endMarker.length).trim();
      const parts = [];
      if (before) parts.push(before);
      parts.push(`${startMarker}\n${newManagedContent.trim()}\n${endMarker}`);
      if (after) parts.push(after);
      result = parts.join('\n\n') + '\n';
    } else {
      result = `${trimmed}\n\n${wrapped}`;
    }
  }

  if (filePath) {
    try {
      const backupMgr = require('./config_backup_manager');
      backupMgr.recordOwnership(filePath, {
        client: options.client || 'global',
        scope: options.scope || 'global',
        format: 'text',
        ownedSections: [startMarker]
      }, options.konohaHome);
    } catch (_) { /* best-effort */ }
  }

  return result;
}

function isProtectedUserPath(targetPath) {
  if (!targetPath || typeof targetPath !== 'string') return false;
  const normalized = path.resolve(targetPath).replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  for (const seg of segments) {
    const lower = seg.toLowerCase();
    if (lower === 'agents' || lower === 'conversations' || lower === 'brain') {
      return true;
    }
  }
  return false;
}

function cleanObsoleteAgentDirs(_home = null) {
  // Ownership boundary invariant: Konoha NEVER deletes `agents/` or `conversations/`
  // directories across any client or workspace.
  return { skipped: true, reason: 'protected_user_directories' };
}

function deployGlobalClientConfigs(options) {
  const { pythonCmd, serverPath, agents, projectRoot, deployProject, home } = options;
  const effectiveHome = home || process.env.HOME || process.env.USERPROFILE || os.homedir();

  try {
    mcpClientsManager.ensureClaudeCodeSetup({
      pythonCmd, serverPath, silent: true,
      ruleContent: generateClaudeCodeMd(agents), agents, projectRoot, deployProject, home: effectiveHome
    });
  } catch (_) { /* intentional best-effort fallback */ }

  try {
    const opencodeManager = require('./opencode_manager');
    opencodeManager.ensureOpenCodeSetup({
      pythonCmd, serverPath, agents, projectRoot, deployProject, silent: true, home: effectiveHome
    });
  } catch (_) { /* intentional best-effort fallback */ }

  try {
    const codexManager = require('./codex_manager');
    codexManager.ensureCodexSetup({
      pythonCmd, serverPath, agents, projectRoot, deployProject, silent: true, home: effectiveHome
    });
  } catch (_) { /* intentional best-effort fallback */ }

  try {
    mcpClientsManager.ensureCommandCodeSetup({
      pythonCmd, serverPath, agents, projectRoot, deployProject, silent: true, home: effectiveHome
    });
  } catch (_) { /* intentional best-effort fallback */ }

  try {
    const piManager = require("./pi_manager");
    if (options.force || piManager.isPiInstalled()) {
      piManager.ensurePiSetup({ pythonCmd, serverPath, silent: true, home: effectiveHome, force: options.force, skipDetection: options.force });
    }
  } catch (_) { /* intentional best-effort fallback */ }

  try {
    const ompManager = require("./omp_manager");
    if (options.force || ompManager.isOmpInstalled()) {
      ompManager.ensureOmpSetup({ pythonCmd, serverPath, silent: true, home: effectiveHome, force: options.force });
    }
  } catch (_) { /* intentional best-effort fallback */ }
}

function regenerateAndDeploy(silentOrOptions = false) {
  const silent = typeof silentOrOptions === 'boolean' ? silentOrOptions : (silentOrOptions.silent || false);
  const pythonCmd = typeof silentOrOptions === 'object' ? (silentOrOptions.pythonCmd || 'python3') : 'python3';
  const serverPath = typeof silentOrOptions === 'object' ? (silentOrOptions.serverPath || SERVER_PATH) : SERVER_PATH;
  const projectRoot = typeof silentOrOptions === 'object' ? (silentOrOptions.projectRoot || null) : null;
  const deployProject = typeof silentOrOptions === 'object' ? (silentOrOptions.deployProject || false) : false;
  const force = typeof silentOrOptions === 'object' ? (silentOrOptions.force || false) : false;
  const effectiveHome = (typeof silentOrOptions === 'object' && silentOrOptions.home) || process.env.HOME || process.env.USERPROFILE || os.homedir();

  const userAgentsYamlPath = path.join(effectiveHome, '.agents', 'agents.yaml');
  const fingerprintPath = path.join(effectiveHome, '.konoha', '.deploy-fingerprint');
  const geminiMdPath = path.join(effectiveHome, '.gemini', 'GEMINI.md');
  const agentsMdPath = path.join(effectiveHome, '.agents', 'AGENTS.md');

  let fingerprint = null;
  try {
    const st = fs.statSync(userAgentsYamlPath);
    const cliVer = getCliVersion();
    fingerprint = `${cliVer}:${st.mtimeMs}:${st.size}`;
  } catch { /* intentional best-effort fallback */ }

  if (!force && fingerprint && !deployProject) {
    let stored = null;
    try { stored = fs.readFileSync(fingerprintPath, 'utf8').trim(); } catch { /* intentional fallback */ }
    if (stored === fingerprint) return;
  }

  const agents = loadAgents(force);
  if (agents.length === 0) return;

  const backupMgr = require('./config_backup_manager');
  backupMgr.backupAllDetectedClients({
    home: effectiveHome,
    projectRoot: projectRoot || process.cwd(),
    includeProject: Boolean(deployProject)
  });

  try {
    fs.mkdirSync(path.dirname(geminiMdPath), { recursive: true });
    fs.writeFileSync(geminiMdPath, injectManagedConfig(geminiMdPath, generateGeminiMd(agents), 'KONOHA', { client: 'antigravity', scope: 'global', home: effectiveHome }), 'utf8');
  } catch (err) {
    if (err && /backup/i.test(err.message)) throw err;
  }

  try {
    const geminiConfigMdPath = path.join(effectiveHome, '.gemini', 'config', 'GEMINI.md');
    const geminiConfigAgentsMdPath = path.join(effectiveHome, '.gemini', 'config', 'AGENTS.md');
    if (fs.existsSync(geminiConfigMdPath)) {
      fs.writeFileSync(geminiConfigMdPath, injectManagedConfig(geminiConfigMdPath, generateGeminiMd(agents), 'KONOHA', { client: 'antigravity', scope: 'global', home: effectiveHome }), 'utf8');
    }
    if (fs.existsSync(geminiConfigAgentsMdPath)) {
      fs.writeFileSync(geminiConfigAgentsMdPath, injectManagedConfig(geminiConfigAgentsMdPath, generateAgentsMd(agents), 'KONOHA', { client: 'antigravity', scope: 'global', home: effectiveHome }), 'utf8');
    }
  } catch (err) {
    if (err && /backup/i.test(err.message)) throw err;
  }

  try {
    fs.mkdirSync(path.dirname(agentsMdPath), { recursive: true });
    fs.writeFileSync(agentsMdPath, injectManagedConfig(agentsMdPath, generateAgentsMd(agents), 'KONOHA', { client: 'antigravity', scope: 'global', home: effectiveHome }), 'utf8');
  } catch (_) { /* intentional fallback */ }

  try {
    cursorManager.ensureCursorSetup({
      pythonCmd, serverPath, agents, projectRoot, deployProject,
      silent: true, allowHooks: true, ruleContent: null, home: effectiveHome
    });
  } catch (_) { /* intentional fallback */ }

  try {
    antigravityManager.ensureAntigravityMcpSchemas(agents);
  } catch (_) { /* intentional fallback */ }

  cleanObsoleteAgentDirs(effectiveHome);
  deployGlobalClientConfigs({ pythonCmd, serverPath, agents, projectRoot, deployProject, home: effectiveHome, force });

  try {
    deployUtils.syncSoulAcrossClients({ home: effectiveHome, silent });
  } catch (_) { /* intentional fallback */ }

  try {
    const { ensureProjectKonohaGuardPlugin } = require('./project_konoha_mcp_guardrail');
    ensureProjectKonohaGuardPlugin(projectRoot || process.cwd());
  } catch (_) { /* strict Konoha-repo-only guard helper */ }

  if (fingerprint) {
    try {
      fs.mkdirSync(path.dirname(fingerprintPath), { recursive: true });
      fs.writeFileSync(fingerprintPath, fingerprint);
    } catch { /* intentional fallback */ }
  }

}

function deployProjectWorkspace(_projectRoot, _options = {}) {
  return { ok: true, skipped: true, reason: 'global_only_config' };
}

module.exports = {
  buildDefineSubagentGuide,
  buildLightweightMarkdownContent,
  generateGeminiMd,
  generateClaudeCodeMd,
  generateAgentsMd,
  getCliVersion,
  injectManagedConfig,
  stripLegacyKonohaPreamble,
  isProtectedUserPath,
  cleanObsoleteAgentDirs,
  regenerateAndDeploy,
  deployProjectWorkspace
};
