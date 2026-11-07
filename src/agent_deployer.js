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
} = require('../bin/lib/paths');
const {
  buildLightweightContract,
  buildManagedContract
} = require('./agent_contract');
const { loadAgents } = require('./agent_storage');

function buildDefineSubagentGuide(agents) {
  return `### Konoha MCP Tool-Based Delegation (CRITICAL)

All subagents are migrated to MCP tools served by the \`konoha\` MCP server. Rather than using custom subagent configuration structures or files, delegation is performed directly by calling the corresponding MCP tool.

The official delegation tools are: ${agents.map(a => `\`${a.name}\``).join(', ')}.


### Auto-Compaction Contract (Token Preservation across all clients)
Konoha automatically activates **High-Efficiency Auto-Compaction** after 2 MCP delegations (\`turn >= 2\`, reset after 30 min idle) across all coding tools (Antigravity IDE/CLI, Claude Code, CommandCode, OpenCode, Cursor, and Codex):
- **Memory Continuity**: Project tech stack (\`framework\`, \`styling\`, \`package_manager\`), architectural invariants, and verified episodic learnings are permanently remembered and prioritized in prompts. Advisory learnings are preserved with base importance.
- **Prompt Compaction**: Verbose instruction boilerplates and redundant diff explanations are compacted. The primary skill SOP preview (250 chars) is always included even on compact turns. Agent instructions are truncated to 1200 chars and constraints to 600 chars (never stripped entirely).
- **On-Demand Skills**: Full reference manuals are served on-demand via \`konoha.get_skill\` instead of being dumped into prompts.

### Delegation Protocol

To delegate a task:
1. **Direct Structured MCP Delegation (Mandatory & Token-Safe)**: Call the subagent MCP tool directly (for example, \`jonin\`, \`anbu\`, \`kage\`, or \`genin\`) with \`task\`, \`context\`, \`constraints\`, \`skills\`, \`taste_dials\`, and \`project_path\`. This executes inline with zero file-based IPC (never search for or write \`prompt.md\`, \`delegate.md\`, or \`result.md\`).
2. **Result Delivery**: Subagents return structured results directly to the orchestrator upon completion.

This guarantees consistent cross-client execution without relying on custom subagent configuration frameworks or files.`;
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

function injectManagedConfig(filePath, newManagedContent, marker = 'KONOHA', options = {}) {
  const startMarker = `<!-- ${marker}-START -->`;
  const endMarker = `<!-- ${marker}-END -->`;
  const wrapped = `${startMarker}\n${newManagedContent.trim()}\n${endMarker}\n`;

  let existing = '';
  if (filePath && fs.existsSync(filePath)) {
    try {
      const backupMgr = require('./config_backup_manager');
      backupMgr.backupConfigFile(filePath, {
        client: options.client || 'global',
        scope: options.scope || 'global',
        konohaHome: options.konohaHome
      });
    } catch (_) { /* backup best-effort when invoked in pure string tests */ }
    try {
      existing = fs.readFileSync(filePath, 'utf8');
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
  const { pythonCmd, serverPath, uvxCmd, agents, projectRoot, deployProject, home } = options;
  const effectiveHome = home || process.env.HOME || process.env.USERPROFILE || os.homedir();

  try {
    mcpClientsManager.ensureClaudeCodeSetup({
      pythonCmd, serverPath, uvxCmd, silent: true,
      ruleContent: generateClaudeCodeMd(agents), agents, projectRoot, deployProject, home: effectiveHome
    });
  } catch (_) { /* intentional best-effort fallback */ }

  try {
    const opencodeManager = require('./opencode_manager');
    opencodeManager.ensureOpenCodeSetup({
      pythonCmd, serverPath, uvxCmd, agents, projectRoot, deployProject, silent: true, home: effectiveHome
    });
  } catch (_) { /* intentional best-effort fallback */ }

  try {
    const codexManager = require('./codex_manager');
    codexManager.ensureCodexSetup({
      pythonCmd, serverPath, uvxCmd, agents, projectRoot, deployProject, silent: true, home: effectiveHome
    });
  } catch (_) { /* intentional best-effort fallback */ }

  try {
    mcpClientsManager.ensureCommandCodeSetup({
      pythonCmd, serverPath, uvxCmd, agents, projectRoot, deployProject, silent: true, home: effectiveHome
    });
  } catch (_) { /* intentional best-effort fallback */ }

  try {
    const piManager = require("./pi_manager");
    if (options.force || piManager.isPiInstalled()) {
      piManager.ensurePiSetup({ pythonCmd, serverPath, uvxCmd, silent: true, home: effectiveHome, force: options.force, skipDetection: options.force });
    }
  } catch (_) { /* intentional best-effort fallback */ }

  try {
    const ompManager = require("./omp_manager");
    if (options.force || ompManager.isOmpInstalled()) {
      ompManager.ensureOmpSetup({ pythonCmd, serverPath, uvxCmd, silent: true, home: effectiveHome, force: options.force });
    }
  } catch (_) { /* intentional best-effort fallback */ }
}

function regenerateAndDeploy(silentOrOptions = false) {
  const silent = typeof silentOrOptions === 'boolean' ? silentOrOptions : (silentOrOptions.silent || false);
  const pythonCmd = typeof silentOrOptions === 'object' ? (silentOrOptions.pythonCmd || 'python3') : 'python3';
  const serverPath = typeof silentOrOptions === 'object' ? (silentOrOptions.serverPath || SERVER_PATH) : SERVER_PATH;
  const uvxCmd = typeof silentOrOptions === 'object' ? (silentOrOptions.uvxCmd || 'uvx') : 'uvx';
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

  try {
    const backupMgr = require('./config_backup_manager');
    backupMgr.backupAllDetectedClients({
      home: effectiveHome,
      projectRoot: projectRoot || process.cwd(),
      includeProject: Boolean(deployProject)
    });
  } catch (_) { /* best-effort backup */ }

  try {
    fs.mkdirSync(path.dirname(geminiMdPath), { recursive: true });
    fs.writeFileSync(geminiMdPath, injectManagedConfig(geminiMdPath, generateGeminiMd(agents), 'KONOHA', { client: 'antigravity', scope: 'global' }), 'utf8');
  } catch (_) { /* intentional fallback */ }

  try {
    fs.mkdirSync(path.dirname(agentsMdPath), { recursive: true });
    fs.writeFileSync(agentsMdPath, injectManagedConfig(agentsMdPath, generateAgentsMd(agents), 'KONOHA', { client: 'global', scope: 'global' }), 'utf8');
  } catch (_) { /* intentional fallback */ }

  try {
    cursorManager.ensureCursorSetup({
      pythonCmd, serverPath, uvxCmd, agents, projectRoot, deployProject,
      silent: true, allowHooks: true, ruleContent: null, home: effectiveHome
    });
  } catch (_) { /* intentional fallback */ }

  try {
    antigravityManager.ensureAntigravityMcpSchemas(agents);
  } catch (_) { /* intentional fallback */ }

  cleanObsoleteAgentDirs(effectiveHome);
  deployGlobalClientConfigs({ pythonCmd, serverPath, uvxCmd, agents, projectRoot, deployProject, home: effectiveHome, force });

  try {
    deployUtils.syncSoulAcrossClients({ home: effectiveHome, silent });
  } catch (_) { /* intentional fallback */ }

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
  isProtectedUserPath,
  cleanObsoleteAgentDirs,
  regenerateAndDeploy,
  deployProjectWorkspace
};
