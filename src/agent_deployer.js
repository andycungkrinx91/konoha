'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const cursorManager = require('./cursor_manager');
const antigravityManager = require('./antigravity_manager');
const mcpClientsManager = require('./mcp_clients_manager');
const { SEMBLE_PACKAGE } = require('./semble_manager');
const {
  SERVER_PATH, GEMINI_MD_PATH, AGENTS_MD_PATH,
  USER_AGENTS_YAML_PATH,
  FINGERPRINT_PATH, DB_PATH, FILE_TOOLS_LAUNCHER_JS,
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

function getCliVersion() {
  const candidatePkgPaths = [
    path.join(__dirname, '..', 'package.json'),
    path.join(HOME, '.konoha', 'package.json')
  ];
  for (const p of candidatePkgPaths) {
    if (fs.existsSync(p)) {
      try {
        const v = JSON.parse(fs.readFileSync(p, 'utf8')).version;
        if (v) return v;
      } catch (_) { /* intentional fallback */ }
    }
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

function regenerateAndDeploy(silentOrOptions = false) {
  const silent = typeof silentOrOptions === 'boolean' ? silentOrOptions : (silentOrOptions.silent || false);
  const pythonCmd = typeof silentOrOptions === 'object' ? (silentOrOptions.pythonCmd || 'python3') : 'python3';
  const serverPath = typeof silentOrOptions === 'object' ? (silentOrOptions.serverPath || SERVER_PATH) : SERVER_PATH;
  const uvxCmd = typeof silentOrOptions === 'object' ? (silentOrOptions.uvxCmd || 'uvx') : 'uvx';
  const projectRoot = typeof silentOrOptions === 'object' ? (silentOrOptions.projectRoot || null) : null;
  const deployProject = typeof silentOrOptions === 'object' ? (silentOrOptions.deployProject || false) : false;
  const force = typeof silentOrOptions === 'object' ? (silentOrOptions.force || false) : false;

  let fingerprint = null;
  try {
    const st = fs.statSync(USER_AGENTS_YAML_PATH);
    const cliVer = getCliVersion();
    fingerprint = `${cliVer}:${st.mtimeMs}:${st.size}`;
  } catch { /* intentional best-effort fallback */ }
  if (!force && fingerprint && !deployProject) {
    let stored = null;
    try { stored = fs.readFileSync(FINGERPRINT_PATH, 'utf8').trim(); } catch { /* intentional best-effort fallback */ }
    if (stored === fingerprint) return;
  }

  const agents = loadAgents(force);
  if (agents.length === 0) return;

  const geminiContent = generateGeminiMd(agents);
  const agentsContent = generateAgentsMd(agents);

  try {
    fs.mkdirSync(path.dirname(GEMINI_MD_PATH), { recursive: true });
    const finalGemini = injectManagedConfig(GEMINI_MD_PATH, geminiContent, 'KONOHA');
    fs.writeFileSync(GEMINI_MD_PATH, finalGemini, 'utf8');
  } catch (_) { /* intentional best-effort fallback */ }

  try {
    fs.mkdirSync(path.dirname(AGENTS_MD_PATH), { recursive: true });
    const finalAgents = injectManagedConfig(AGENTS_MD_PATH, agentsContent, 'KONOHA');
    fs.writeFileSync(AGENTS_MD_PATH, finalAgents, 'utf8');
  } catch (_) { /* intentional best-effort fallback */ }

  try {
    cursorManager.ensureCursorSetup({
      pythonCmd,
      serverPath,
      uvxCmd,
      agents,
      projectRoot,
      deployProject,
      silent: true,
      allowHooks: true,
      ruleContent: null
    });
  } catch (_) { /* intentional best-effort fallback */ }

  try {
    antigravityManager.ensureAntigravityMcpSchemas(agents);
  } catch (_) { /* intentional best-effort fallback */ }

  try {
    const obsoleteDirs = [
      path.join(__dirname, '..', '.agents', 'agents'),
      path.join(__dirname, '..', '.cursor', 'agents'),
      path.join(os.homedir(), '.gemini', 'config', 'agents'),
      path.join(os.homedir(), '.gemini', 'antigravity-cli', 'agents'),
      path.join(os.homedir(), '.gemini', 'antigravity-ide', 'agents'),
      path.join(os.homedir(), '.cursor', 'agents')
    ];
    for (const d of obsoleteDirs) {
      if (fs.existsSync(d)) {
        fs.rmSync(d, { recursive: true, force: true });
      }
    }
  } catch (_) { /* intentional best-effort fallback */ }

  try {
    mcpClientsManager.ensureClaudeCodeSetup({
      pythonCmd,
      serverPath,
      uvxCmd,
      silent: true,
      ruleContent: generateClaudeCodeMd(agents),
      agents,
      projectRoot,
      deployProject
    });
  } catch (_) { /* intentional best-effort fallback */ }

  try {
    const opencodeManager = require('./opencode_manager');
    opencodeManager.ensureOpenCodeSetup({
      pythonCmd,
      serverPath,
      uvxCmd,
      agents,
      projectRoot,
      deployProject,
      silent: true
    });
  } catch (_) { /* intentional best-effort fallback */ }

  try {
    const codexManager = require('./codex_manager');
    codexManager.ensureCodexSetup({
      pythonCmd,
      serverPath,
      uvxCmd,
      agents,
      projectRoot,
      deployProject,
      silent: true
    });
  } catch (_) { /* intentional best-effort fallback */ }

  try {
    mcpClientsManager.ensureCommandCodeSetup({
      pythonCmd,
      serverPath,
      uvxCmd,
      agents,
      projectRoot,
      deployProject,
      silent: true
    });
  } catch (_) { /* intentional best-effort fallback */ }

  try {
    const piManager = require('./pi_manager');
    if (piManager.isPiInstalled()) {
      piManager.ensurePiSetup({
        pythonCmd,
        serverPath,
        uvxCmd,
        silent: true
      });
    }
  } catch (_) { /* intentional best-effort fallback */ }

  try {
    const ompManager = require('./omp_manager');
    if (ompManager.isOmpInstalled()) {
      ompManager.ensureOmpSetup({
        pythonCmd,
        serverPath,
        uvxCmd,
        silent: true
      });
    }
  } catch (_) { /* intentional best-effort fallback */ }

  try {
    const skillManager = require('./skill_manager');
    skillManager.syncAllClientSkills({
      projectRoot,
      silent: true
    });
  } catch (_) { /* intentional best-effort fallback */ }

  if (fingerprint) {
    try {
      fs.mkdirSync(path.dirname(FINGERPRINT_PATH), { recursive: true });
      fs.writeFileSync(FINGERPRINT_PATH, fingerprint);
    } catch { /* intentional best-effort fallback */ }
  }

  if (!silent) {
    const claudeInstalled = mcpClientsManager.isClaudeCodeInstalled();
    const lines = [
      `  - ${cursorManager.CURSOR_AGENTS_GLOBAL}`,
      `  - ${antigravityManager.ANTIGRAVITY_AGENTS_GLOBAL}`,
    ];
    if (claudeInstalled) {
      const claudeHome = require('os').homedir();
      lines.push(`  - ${require('path').join(claudeHome, '.claude.yaml')} (Claude Code)`);
    }
    process.stderr.write(`✓ Generated and deployed configs to:\n${lines.join('\n')}\n`);
  }
}

function deployProjectWorkspace(projectRoot, options = {}) {
  const silent = options.silent !== false;
  const force = options.force || false;
  const targetPath = path.resolve(projectRoot || process.cwd());
  const konohaRepoRoot = path.resolve(__dirname, '..');
  if (!fs.existsSync(targetPath)) {
    try {
      fs.mkdirSync(targetPath, { recursive: true });
    } catch (_) {
      return { ok: false, error: 'Target path could not be created' };
    }
  }

  const agents = loadAgents(force);
  if (!agents || agents.length === 0) return { ok: false, error: 'No agents loaded' };

  const deployedFiles = [];

  try {
    const agentsPath = path.join(targetPath, 'AGENTS.md');
    const agentsContent = generateAgentsMd(agents);
    const finalAgents = injectManagedConfig(agentsPath, agentsContent, 'KONOHA');
    fs.writeFileSync(agentsPath, finalAgents, 'utf8');
    deployedFiles.push(agentsPath);
  } catch (_) { /* intentional best-effort fallback */ }

  try {
    const geminiPath = path.join(targetPath, 'GEMINI.md');
    const geminiContent = generateGeminiMd(agents);
    const finalGemini = injectManagedConfig(geminiPath, geminiContent, 'KONOHA');
    fs.writeFileSync(geminiPath, finalGemini, 'utf8');
    deployedFiles.push(geminiPath);
  } catch (_) { /* intentional best-effort fallback */ }

  try {
    const claudePath = path.join(targetPath, 'CLAUDE.md');
    const claudeContent = generateClaudeCodeMd(agents);
    const finalClaude = injectManagedConfig(claudePath, claudeContent, 'KONOHA');
    fs.writeFileSync(claudePath, finalClaude, 'utf8');
    deployedFiles.push(claudePath);
  } catch (_) { /* intentional best-effort fallback */ }

  try {
    const cursorRulesPath = path.join(targetPath, '.cursorrules');
    const cursorRuleContent = cursorManager.generateCursorRule(agents);
    fs.writeFileSync(cursorRulesPath, cursorRuleContent, 'utf8');
    deployedFiles.push(cursorRulesPath);

    const mdcDir = path.join(targetPath, '.cursor', 'rules');
    fs.mkdirSync(mdcDir, { recursive: true });
    const mdcPath = path.join(mdcDir, 'konoha.mdc');
    fs.writeFileSync(mdcPath, cursorRuleContent, 'utf8');
    deployedFiles.push(mdcPath);
  } catch (_) { /* intentional best-effort fallback */ }

  try {
    const ompDir = path.join(targetPath, '.omp', 'agent');
    fs.mkdirSync(ompDir, { recursive: true });
    const ompAgentsPath = path.join(ompDir, 'AGENTS.md');
    const ompAgentsContent = generateAgentsMd(agents);
    const finalOmp = injectManagedConfig(ompAgentsPath, ompAgentsContent, 'KONOHA');
    fs.writeFileSync(ompAgentsPath, finalOmp, 'utf8');
    deployedFiles.push(ompAgentsPath);

    const ompRootPath = path.join(targetPath, '.omp', 'AGENTS.md');
    fs.writeFileSync(ompRootPath, finalOmp, 'utf8');
  } catch (_) { /* intentional best-effort fallback */ }

  try {
    const codexDir = path.join(targetPath, '.codex');
    const codexRulesDir = path.join(codexDir, 'rules');
    fs.mkdirSync(codexRulesDir, { recursive: true });
    const codexAgentsPath = path.join(codexDir, 'AGENTS.md');
    const codexAgentsContent = generateAgentsMd(agents);
    const finalCodex = injectManagedConfig(codexAgentsPath, codexAgentsContent, 'KONOHA');
    fs.writeFileSync(codexAgentsPath, finalCodex, 'utf8');
    deployedFiles.push(codexAgentsPath);

    const codexRtkPath = path.join(codexRulesDir, 'rtk.md');
    const rtkContent = `# RTK Command Execution Policy\n\nALWAYS prefix all shell and terminal command executions with \`rtk\` to filter verbose terminal output and optimize token consumption.\n`;
    fs.writeFileSync(codexRtkPath, rtkContent, 'utf8');
    deployedFiles.push(codexRtkPath);
  } catch (_) { /* intentional best-effort fallback */ }

  try {
    cursorManager.registerCursorProjectMcp(targetPath, 'python3', SERVER_PATH, 'uvx', true);
    deployedFiles.push(path.join(targetPath, '.cursor', 'mcp.json'));

    const geminiCliDir = path.join(targetPath, '.gemini', 'antigravity-cli');
    fs.mkdirSync(geminiCliDir, { recursive: true });
    const mcpServers = cursorManager.buildMcpServers('python3', SERVER_PATH, 'uvx');
    if (mcpServers.konoha && Array.isArray(mcpServers.konoha.args)) {
      const isKonohaSrcRepo = fs.existsSync(path.join(targetPath, 'src', 'file_tools_mcp.js'));
      mcpServers.konoha.args = mcpServers.konoha.args.map((arg) => {
        if (typeof arg === 'string') {
          if (arg.includes('konoha_golden_seed')) {
            return isKonohaSrcRepo ? 'src/file_tools_mcp.js' : '${userHome}/.konoha/file_tools_launcher.js';
          }
          if (isKonohaSrcRepo && (arg.includes('/.konoha/') || arg.includes('\\.konoha\\'))) {
            return 'src/file_tools_mcp.js';
          }
        }
        return arg;
      });
      if (isKonohaSrcRepo) {
        mcpServers.konoha.command = 'node';
      }
    }
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
    const ompConfig = {
      $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
      mcpServers: {
        konoha: {
          command: process.execPath || 'node',
          args: [launcherScript],
          type: 'stdio'
        },
        semble: {
          command: 'uvx',
          args: ['--from', SEMBLE_PACKAGE, 'semble', '--content', 'all'],
          type: 'stdio'
        },
        aislop: {
          command: 'npx',
          args: ['-y', '--prefer-offline', '-p', 'aislop', 'aislop-mcp'],
          type: 'stdio'
        }
      }
    };
    fs.writeFileSync(path.join(ompAgentDir, 'mcp.json'), JSON.stringify(ompConfig, null, 2) + '\n', 'utf8');
    fs.writeFileSync(path.join(targetPath, '.omp', 'mcp.json'), JSON.stringify(ompConfig, null, 2) + '\n', 'utf8');
    deployedFiles.push(path.join(ompAgentDir, 'mcp.json'));
  } catch (_) { /* intentional best-effort fallback */ }

  try {
    const skillManager = require('./skill_manager');
    skillManager.syncAllClientSkills({
      projectRoot: targetPath,
      silent: true
    });
  } catch (_) { /* intentional best-effort fallback */ }

  try {
    const personaMemory = require('./persona_memory');
    const summary = options.summary || options.title || '';
    personaMemory.saveOrUpdateProject(targetPath, summary, null, DB_PATH);
  } catch (_) { /* intentional best-effort fallback */ }

  const isTargetKonohaRepo = (() => {
    if (targetPath === konohaRepoRoot) return true;
    try {
      const pkgPath = path.join(targetPath, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg && pkg.name === 'konoha-mcp' && fs.existsSync(path.join(targetPath, 'bin', 'cli.js')) && fs.existsSync(path.join(targetPath, 'scripts', 'lint.js'))) {
          return true;
        }
      }
    } catch (_) { /* intentional best-effort fallback */ }
    return false;
  })();

  if (!isTargetKonohaRepo) {
    const ignoreBlock = [
      '## Start Konoha config+skill',
      '.agents',
      '.claude*',
      '.commandcode*',
      '.cursor*',
      '.cursorrules*',
      '.gemini*',
      '.omp*',
      'AGENTS.md',
      'CLAUDE.md',
      'GEMINI.md',
      '## End Konoha config+skill'
    ].join('\n');

    for (const ignoreFile of ['.gitignore', '.dockerignore']) {
      try {
        const ignorePath = path.join(targetPath, ignoreFile);
        let existing = '';
        if (fs.existsSync(ignorePath)) {
          existing = fs.readFileSync(ignorePath, 'utf8');
        }
        if (!existing.includes('## Start Konoha config+skill')) {
          const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n\n' : (existing.length > 0 ? '\n' : '');
          fs.writeFileSync(ignorePath, existing + separator + ignoreBlock + '\n', 'utf8');
          deployedFiles.push(ignorePath);
        }
      } catch (_) { /* intentional best-effort fallback */ }
    }
  }

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
