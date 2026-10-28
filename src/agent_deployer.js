'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const cursorManager = require('./cursor_manager');
const antigravityManager = require('./antigravity_manager');
const mcpClientsManager = require('./mcp_clients_manager');
const deployUtils = require('./deploy_utils');
const { SEMBLE_PACKAGE } = require('./semble_manager');
const {
  SERVER_PATH, DB_PATH, FILE_TOOLS_LAUNCHER_JS,
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

function injectManagedConfig(filePath, newManagedContent, marker = 'KONOHA') {
  const startMarker = `<!-- ${marker}-START -->`;
  const endMarker = `<!-- ${marker}-END -->`;
  const wrapped = `${startMarker}\n${newManagedContent.trim()}\n${endMarker}\n`;

  let existing = '';
  if (fs.existsSync(filePath)) {
    try {
      existing = fs.readFileSync(filePath, 'utf8');
    } catch {
      existing = '';
    }
  }

  const trimmed = existing.trim();
  if (!trimmed) {
    return wrapped;
  }

  const startIndex = existing.indexOf(startMarker);
  const endIndex = existing.indexOf(endMarker);
  if (startIndex !== -1 && endIndex !== -1 && endIndex >= startIndex) {
    const before = existing.slice(0, startIndex).trim();
    const after = existing.slice(endIndex + endMarker.length).trim();
    const isBeforeKonoha = before.startsWith('# Global Agent Instructions') ||
      before.startsWith('# Antigravity') ||
      before.startsWith('# AGENTS.md') ||
      before.startsWith('# Claude Code') ||
      before.startsWith('# Gemini');
    const parts = [];
    if (before && !isBeforeKonoha) parts.push(before);
    parts.push(`${startMarker}\n${newManagedContent.trim()}\n${endMarker}`);
    if (after) parts.push(after);
    return parts.join('\n\n') + '\n';
  }

  const isKonohaFile = trimmed.startsWith('# Global Agent Instructions') ||
    trimmed.startsWith('# Antigravity') ||
    trimmed.startsWith('# AGENTS.md') ||
    trimmed.startsWith('# Claude Code') ||
    trimmed.startsWith('# Gemini');

  if (isKonohaFile) {
    return wrapped;
  }

  return `${trimmed}\n\n${wrapped}`;
}

function cleanObsoleteAgentDirs(home = null) {
  const effectiveHome = home || process.env.HOME || process.env.USERPROFILE || os.homedir();
  const obsoleteDirs = [
    path.join(__dirname, '..', '.agents', 'agents'),
    path.join(__dirname, '..', '.cursor', 'agents'),
    path.join(effectiveHome, '.gemini', 'config', 'agents'),
    path.join(effectiveHome, '.gemini', 'antigravity-cli', 'agents'),
    path.join(effectiveHome, '.gemini', 'antigravity-ide', 'agents'),
    path.join(effectiveHome, '.cursor', 'agents')
  ];
  for (const d of obsoleteDirs) {
    if (!fs.existsSync(d)) continue;
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch (_) { /* intentional best-effort fallback */ }
  }
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
    const piManager = require('./pi_manager');
    if (options.force || piManager.isPiInstalled()) {
      piManager.ensurePiSetup({ pythonCmd, serverPath, uvxCmd, silent: true, home: effectiveHome });
    }
  } catch (_) { /* intentional best-effort fallback */ }

  try {
    const ompManager = require('./omp_manager');
    if (options.force || ompManager.isOmpInstalled()) {
      ompManager.ensureOmpSetup({ pythonCmd, serverPath, uvxCmd, silent: true, home: effectiveHome });
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
    fingerprint = `${getCliVersion()}:${st.mtimeMs}:${st.size}`;
  } catch { /* intentional best-effort fallback */ }

  if (!force && fingerprint && !deployProject) {
    let stored = null;
    try { stored = fs.readFileSync(fingerprintPath, 'utf8').trim(); } catch { /* intentional fallback */ }
    if (stored === fingerprint) return;
  }

  const agents = loadAgents(force);
  if (agents.length === 0) return;

  try {
    fs.mkdirSync(path.dirname(geminiMdPath), { recursive: true });
    fs.writeFileSync(geminiMdPath, injectManagedConfig(geminiMdPath, generateGeminiMd(agents), 'KONOHA'), 'utf8');
  } catch (_) { /* intentional fallback */ }

  try {
    fs.mkdirSync(path.dirname(agentsMdPath), { recursive: true });
    fs.writeFileSync(agentsMdPath, injectManagedConfig(agentsMdPath, generateAgentsMd(agents), 'KONOHA'), 'utf8');
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

  try {
    const skillManager = require('./skill_manager');
    skillManager.syncAllClientSkills({ projectRoot, silent: true });
  } catch (_) { /* intentional fallback */ }

  if (fingerprint) {
    try {
      fs.mkdirSync(path.dirname(fingerprintPath), { recursive: true });
      fs.writeFileSync(fingerprintPath, fingerprint);
    } catch { /* intentional fallback */ }
  }

  if (!silent) {
    const claudeInstalled = mcpClientsManager.isClaudeCodeInstalled();
    const cursorGlobal = path.join(effectiveHome, '.cursor', 'agents');
    const antigravityGlobal = path.join(effectiveHome, '.gemini', 'antigravity-cli', 'agents');
    const lines = [`  - ${cursorGlobal}`, `  - ${antigravityGlobal}`];
    if (claudeInstalled) {
      lines.push(`  - ${path.join(effectiveHome, '.claude.yaml')} (Claude Code)`);
    }
    process.stderr.write(`✓ Generated and deployed configs to:\n${lines.join('\n')}\n`);
  }
}

function deployProjectDocs(targetPath, agents, deployedFiles, isKonohaRepo = false) {
  const docs = [
    { file: 'AGENTS.md', content: generateAgentsMd(agents) },
    { file: 'GEMINI.md', content: generateGeminiMd(agents) },
    { file: 'CLAUDE.md', content: generateClaudeCodeMd(agents) }
  ];
  for (const doc of docs) {
    try {
      const p = path.join(targetPath, doc.file);
      fs.writeFileSync(p, injectManagedConfig(p, doc.content, 'KONOHA'), 'utf8');
      deployedFiles.push(p);
    } catch (_) { /* intentional fallback */ }
  }

  if (isKonohaRepo) return;

  try {
    const ruleContent = cursorManager.generateCursorRule(agents);
    const crPath = path.join(targetPath, '.cursorrules');
    fs.writeFileSync(crPath, ruleContent, 'utf8');
    deployedFiles.push(crPath);

    const mdcDir = path.join(targetPath, '.cursor', 'rules');
    fs.mkdirSync(mdcDir, { recursive: true });
    const mdcPath = path.join(mdcDir, 'konoha.mdc');
    fs.writeFileSync(mdcPath, ruleContent, 'utf8');
    deployedFiles.push(mdcPath);
  } catch (_) { /* intentional fallback */ }

  try {
    const ompAgentsContent = generateAgentsMd(agents);
    const ompDir = path.join(targetPath, '.omp', 'agent');
    fs.mkdirSync(ompDir, { recursive: true });
    const ompAgentsPath = path.join(ompDir, 'AGENTS.md');
    fs.writeFileSync(ompAgentsPath, injectManagedConfig(ompAgentsPath, ompAgentsContent, 'KONOHA'), 'utf8');
    deployedFiles.push(ompAgentsPath);
    const ompRootPath = path.join(targetPath, '.omp', 'AGENTS.md');
    fs.writeFileSync(ompRootPath, injectManagedConfig(ompRootPath, ompAgentsContent, 'KONOHA'), 'utf8');
  } catch (_) { /* intentional fallback */ }

  try {
    const codexRulesDir = path.join(targetPath, '.codex', 'rules');
    fs.mkdirSync(codexRulesDir, { recursive: true });
    const codexAgentsPath = path.join(targetPath, '.codex', 'AGENTS.md');
    fs.writeFileSync(codexAgentsPath, injectManagedConfig(codexAgentsPath, generateAgentsMd(agents), 'KONOHA'), 'utf8');
    deployedFiles.push(codexAgentsPath);

    const codexRtkPath = path.join(codexRulesDir, 'rtk.md');
    fs.writeFileSync(codexRtkPath, '# RTK Command Execution Policy\n\nALWAYS prefix all shell and terminal command executions with `rtk` to filter verbose terminal output and optimize token consumption.\n', 'utf8');
    deployedFiles.push(codexRtkPath);
  } catch (_) { /* intentional fallback */ }
}

function formatKonohaArg(arg, isKonohaSrc) {
  if (typeof arg !== 'string') return arg;
  if (arg.includes('konoha_golden_seed')) {
    return isKonohaSrc ? 'src/file_tools_mcp.js' : '${userHome}/.konoha/file_tools_launcher.js';
  }
  if (isKonohaSrc && (arg.includes('/.konoha/') || arg.includes('\\.konoha\\'))) {
    return 'src/file_tools_mcp.js';
  }
  return arg;
}

function buildProjectMcpServers(targetPath) {
  const mcpServers = cursorManager.buildMcpServers('python3', SERVER_PATH, 'uvx');
  const isKonohaSrc = fs.existsSync(path.join(targetPath, 'src', 'file_tools_mcp.js'));
  if (!mcpServers.konoha || !Array.isArray(mcpServers.konoha.args)) {
    return mcpServers;
  }
  mcpServers.konoha.args = mcpServers.konoha.args.map(arg => formatKonohaArg(arg, isKonohaSrc));
  if (isKonohaSrc) {
    mcpServers.konoha.command = 'node';
  }
  return mcpServers;
}

function deployProjectClientConfigs(targetPath, deployedFiles) {
  try {
    cursorManager.registerCursorProjectMcp(targetPath, 'python3', SERVER_PATH, 'uvx', true);
    deployedFiles.push(path.join(targetPath, '.cursor', 'mcp.json'));

    const mcpServers = buildProjectMcpServers(targetPath);
    const geminiCliDir = path.join(targetPath, '.gemini', 'antigravity-cli');
    fs.mkdirSync(geminiCliDir, { recursive: true });
    const geminiSettings = { mcpServers };
    fs.writeFileSync(path.join(geminiCliDir, 'settings.json'), JSON.stringify(geminiSettings, null, 2) + '\n', 'utf8');
    fs.writeFileSync(path.join(targetPath, '.gemini', 'settings.json'), JSON.stringify(geminiSettings, null, 2) + '\n', 'utf8');
    deployedFiles.push(path.join(geminiCliDir, 'settings.json'));

    const claudeDir = path.join(targetPath, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify({ mcpServers }, null, 2) + '\n', 'utf8');
    fs.writeFileSync(path.join(targetPath, '.claude.json'), JSON.stringify({ mcpServers }, null, 2) + '\n', 'utf8');
    deployedFiles.push(path.join(claudeDir, 'settings.json'));

    const ccDir = path.join(targetPath, '.commandcode');
    fs.mkdirSync(ccDir, { recursive: true });
    fs.writeFileSync(path.join(ccDir, 'mcp.json'), JSON.stringify({ mcpServers }, null, 2) + '\n', 'utf8');
    deployedFiles.push(path.join(ccDir, 'mcp.json'));

    const ompAgentDir = path.join(targetPath, '.omp', 'agent');
    fs.mkdirSync(ompAgentDir, { recursive: true });
    const launcherScript = fs.existsSync(FILE_TOOLS_LAUNCHER_JS) ? FILE_TOOLS_LAUNCHER_JS : SERVER_PATH;
    const isWin = process.platform === 'win32';
    const ompConfig = {
      $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
      mcpServers: {
        konoha: {
          command: process.execPath || 'node',
          args: [launcherScript],
          type: 'stdio',
          autoApprove: [...deployUtils.KONOHA_CANONICAL_TOOLS],
          auto_approve: true
        },
        semble: {
          command: isWin ? 'uvx.cmd' : 'uvx',
          args: ['--from', SEMBLE_PACKAGE, 'semble', '--content', 'all'],
          type: 'stdio',
          autoApprove: ['search', 'find_related'],
          auto_approve: true
        },
        aislop: {
          command: isWin ? 'npx.cmd' : 'npx',
          args: ['-y', '--prefer-offline', '-p', 'aislop', 'aislop-mcp'],
          type: 'stdio',
          autoApprove: ['aislop_scan', 'aislop_fix', 'aislop_why', 'aislop_baseline'],
          auto_approve: true
        }
      }
    };
    fs.writeFileSync(path.join(ompAgentDir, 'mcp.json'), JSON.stringify(ompConfig, null, 2) + '\n', 'utf8');
    fs.writeFileSync(path.join(targetPath, '.omp', 'mcp.json'), JSON.stringify(ompConfig, null, 2) + '\n', 'utf8');
    deployedFiles.push(path.join(ompAgentDir, 'mcp.json'));
  } catch (_) { /* intentional fallback */ }
}

function deployAislopTemplate(targetPath, deployedFiles) {
  try {
    const aislopDir = path.join(targetPath, '.aislop');
    const templateAislop = path.join(__dirname, 'templates', '.aislop', 'config.yml');
    const targetAislop = path.join(aislopDir, 'config.yml');
    if (!fs.existsSync(targetAislop) && fs.existsSync(templateAislop)) {
      fs.mkdirSync(aislopDir, { recursive: true });
      fs.copyFileSync(templateAislop, targetAislop);
      deployedFiles.push(targetAislop);
    }
    const templateIgnore = path.join(__dirname, 'templates', '.aislopignore');
    const targetIgnore = path.join(targetPath, '.aislopignore');
    if (!fs.existsSync(targetIgnore) && fs.existsSync(templateIgnore)) {
      fs.copyFileSync(templateIgnore, targetIgnore);
      deployedFiles.push(targetIgnore);
    }
  } catch (_) { /* intentional fallback */ }
}

function ensureTargetDirectory(targetPath) {
  if (fs.existsSync(targetPath)) return true;
  try {
    fs.mkdirSync(targetPath, { recursive: true });
    return true;
  } catch (_) {
    return false;
  }
}

function deployProjectWorkspace(projectRoot, options = {}) {
  const silent = options.silent !== false;
  const force = options.force || false;
  const targetPath = path.resolve(projectRoot || process.cwd());
  try {
    deployUtils.pruneWorkspacePollution(targetPath, options);
  } catch (_) { /* best-effort */ }
  if (!ensureTargetDirectory(targetPath)) {
    return { ok: false, error: 'Target path could not be created' };
  }

  const agents = loadAgents(force);
  if (!agents || agents.length === 0) return { ok: false, error: 'No agents loaded' };

  const konohaRepoRoot = path.resolve(__dirname, '..');
  const isTargetKonohaRepo = targetPath === konohaRepoRoot ||
    (fs.existsSync(path.join(targetPath, 'bin', 'cli.js')) && fs.existsSync(path.join(targetPath, 'src', 'agent_deployer.js')));

  const deployedFiles = [];
  deployAislopTemplate(targetPath, deployedFiles);
  deployProjectDocs(targetPath, agents, deployedFiles, isTargetKonohaRepo);
  if (!isTargetKonohaRepo) {
    deployProjectClientConfigs(targetPath, deployedFiles);
    try {
      deployUtils.syncSoulAcrossClients({ home: options.home, silent: true });
    } catch (_) { /* intentional fallback */ }
    try {
      const skillManager = require('./skill_manager');
      skillManager.syncAllClientSkills({ projectRoot: targetPath, silent: true });
    } catch (_) { /* intentional fallback */ }
  }

  try {
    const personaMemory = require('./persona_memory');
    const summary = options.summary || options.title || '';
    personaMemory.saveOrUpdateProject(targetPath, summary, null, DB_PATH);
  } catch (_) { /* intentional fallback */ }

  if (!silent) {
    process.stderr.write(`✓ Injected Konoha skills, rules, and configs with mandatory runtime contract into ${targetPath}\n`);
  }

  return { ok: true, projectPath: targetPath, deployedFiles };
}

module.exports = {
  buildDefineSubagentGuide,
  buildLightweightMarkdownContent,
  generateGeminiMd,
  generateClaudeCodeMd,
  generateAgentsMd,
  getCliVersion,
  injectManagedConfig,
  regenerateAndDeploy,
  deployProjectWorkspace
};
