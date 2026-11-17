'use strict';

/**
 * src/omp_manager.js — OMP Agent client integration for Konoha.
 *
 * Configures Konoha MCP servers, workflow contracts, and RTK rules for OMP.
 * OMP agent configuration lives globally under ~/.omp/agent/ (mcp.json, AGENTS.md).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  HOME,
  OMP_DIR,
  OMP_AGENT_DIR,
  OMP_MCP_CONFIG,
  OMP_AGENTS_MD,
  OMP_SKILLS,
  FILE_TOOLS_LAUNCHER_JS,
  SERVER_PATH
} = require('./config_access').loadBinLib('paths');

const {
  fileExists,
  ensureDir,
  isCommandAvailable,
  fileExistsCached
} = require('./platform_utils');

const { AISLOP_PACKAGE } = require('./uvx_runtime');
const { buildMainAgentContract, buildManagedContract, buildSubagentContract } = require('./agent_contract');
const { KONOHA_CANONICAL_TOOLS } = require('./deploy_utils');
const { assertNoWildcardGrants, SUBAGENT_SAFE_MCP_GRANTS } = require('./mcp_clients/common');
const {
  AGENT_OWNERSHIP_MARKER,
  isReadOnlyAgent,
  isRouterAgent,
  getRoleDescription,
  writeAgentFileSafe,
  writeManagedFileSafe
} = require('./agent_file_safety');
const { getDeployableAgents, getDeployableAgentNames } = require('./canonical_agents');
const { loadAgents } = require('./agent_storage');
const { GENIN_BLOCKED_TOOLS } = require('./mcp/genin_guard');

const KONOHA_SERVER_KEYS = ['konoha', 'aislop'];
const CONTRACT_START_MARKER = '<!-- KONOHA-CONTRACT-START -->';
const CONTRACT_END_MARKER = '<!-- KONOHA-CONTRACT-END -->';
const OMP_MANDATE_HEADING = '## Konoha Workflow Mandate (OMP) — MANDATORY';

function isOmpInstalled() {
  return (
    isCommandAvailable('omp') ||
    fileExistsCached(OMP_DIR) ||
    fileExistsCached(OMP_AGENT_DIR) ||
    fileExistsCached(OMP_MCP_CONFIG) ||
    fileExistsCached(OMP_AGENTS_MD)
  );
}

function getOmpConfigPath() {
  // Primary OMP MCP configuration is strictly ~/.omp/agent/mcp.json
  if (fileExists(OMP_MCP_CONFIG)) return OMP_MCP_CONFIG;
  return OMP_MCP_CONFIG;
}

function getOmpAgentsMdPath() {
  return OMP_AGENTS_MD;
}

function readJsonSafe(filePath) {
  try {
    if (!fileExists(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (_) {
    return null;
  }
}

function writeJsonAtomic(filePath, data) {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.tmp.${Date.now()}`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  fs.renameSync(tempPath, filePath);
}

const OMP_MCP_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';

function buildOmpWorkflowAddendum() {
  return `
## Konoha Workflow Mandate (OMP) — MANDATORY

- **OMP Auto-Enable & Auto-Use Mandate**: OMP uses the Konoha MCP tools (\`konoha.find_skill\`, \`konoha.get_skill\`, \`konoha.code_search\`) as its primary execution tools on every new or resumed session.
- **Advisor Preservation**: OMP's advisor review (\`reviewMode: agent-end\`) runs after every Konoha workflow, subagent delegation, and Kage gate. Never abort a turn early or bypass it.
- **Route through the village, never free-run**: for any non-trivial task, start from \`konoha.sannin\` (triage + \`get_resolved_task_dir\`), then explore with \`genin\`, plan with \`kage\`, execute with \`jonin\`/\`anbu\`/\`chunin\`, document with \`tokubetsu-jonin\`, review with \`kage\`. Do NOT decompose and execute multi-step engineering work yourself.
- **Step 0: Classify request — ALWAYS FIRST (Branch A vs Branch B)**:
  - Website build intent (build/create/scaffold/generate/make + website/web app/landing page/UI/frontend/site/e-commerce/storefront/portfolio/dashboard/app, or a named framework), or supplied design mockups → **BRANCH B**.
  - Everything else → **BRANCH A** (the multi-agent workflow above).
- **BRANCH B: Website Scaffolding Pipeline (SKIP standard pipeline)**: call \`konoha.build_from_text\` (or \`build_from_source\` for mockups) FIRST, pass the returned directives to \`konoha.jonin\` as structured tool constraints, and do not call Chunin, Genin, or Kage. Jonin delivers the complete working site with an inline \`README.md\`; delegate to \`tokubetsu-jonin\` only when documentation was explicitly requested.
  - **Project-Specific Design Mandate**: derive art direction, information architecture, navigation pattern, theme strategy, motion language, and component composition from a 9-field design brief authored from the request. No house template — no mandatory bottom dock, theme switcher, hero carousel, or commerce sections the request did not ask for. Apply the Anti-Template Gate before delivery, with editorial typography, negative space, justified hover/motion, and zero emoji in UI controls.
  - Framework scaffolding commands and the \`package.json\` scripts invariant (\`lint\`, \`build\`, \`start\`, plus \`check\` for SvelteKit) live in \`jonin-skill\`; load it before scaffolding.
- **Zero Errors & Zero Warnings**: do not claim completion until the framework's \`build\`, \`lint\`, and \`check\` commands pass cleanly with 0 errors and 0 warnings.
- **Skills via Konoha MCP first**: use \`konoha.find_skill\` / \`konoha.get_skill\` instead of the native \`/skill:\` mirrors; the project \`.agents/skills/\` entries are pre-seeded mirrors of the same skills, so prefer the Konoha MCP path.
- **Code search via \`code_search\`**: index the repository once with \`code_index\`, then use \`code_search\` / \`code_symbol\` / \`code_impact\` — never native grep/glob/find for codebase discovery.
- **Bounded file tools**: use \`konoha.read_file_head\`, \`read_file_range\`, \`file_info\`, \`get_file_structure\`, \`find_files_clean\`, \`token_efficient_grep\` instead of native read/grep when scanning the repository.
- **Workflow artifacts** (\`plan.md\`, \`findings.md\`, \`final_docs.md\`, \`kage_review.json\`) live in the task directory returned by \`konoha.get_resolved_task_dir\` — never in the workspace root.
- **Delivery gate**: never claim completion without validation evidence (\`0 errors and 0 warnings\`). Kage review (\`confidence >= 98\`, \`ai_slop_findings = 0\`, \`ai_slop_clean = true\`) is mandatory before final delivery.
- **Base personality: High Effort + Instruct Style**: strictly zero conversational filler (no "hmmmm", "let me", "wait - but"), lead with direct action, ADHD-friendly structured formatting, zero hallucination, and strictly no lies.
- **Safety guardrails**: NEVER run destructive commands (\`rm -rf\`, \`DROP\`, \`git reset\`) or view secrets (\`.env*\`).
- **Review token hygiene (NEVER BURN TOKENS)**: across every client, never run an unscoped full-repository scan (\`aislop_scan\` without a target path, or \`aislop scan\` without \`--changes\` or explicit file arguments). Report counts and rule IDs only; never dump raw scan output into context.
`;
}

function buildOmpManagedContract() {
  const base = buildMainAgentContract('omp');
  const idx = base.lastIndexOf(CONTRACT_END_MARKER);
  if (idx === -1) return `${base}\n${buildOmpWorkflowAddendum()}`;
  return `${base.slice(0, idx)}${buildOmpWorkflowAddendum()}\n${base.slice(idx)}`;
}

function buildOmpMcpServers(options = {}) {
  const isWin = process.platform === 'win32';
  let launcherPath = options.launcherPath;
  if (!launcherPath || !fileExists(launcherPath)) {
    launcherPath = fileExists(FILE_TOOLS_LAUNCHER_JS) ? FILE_TOOLS_LAUNCHER_JS : SERVER_PATH;
  }
  const npxCmd = isWin ? 'npx.cmd' : 'npx';

  const home = options.home || HOME;
  const localBin = path.join(home, '.local', 'bin');
  const cargoBin = path.join(home, '.cargo', 'bin');
  const nodeDir = process.execPath ? path.dirname(process.execPath) : '';
  const clientPathEnv = [nodeDir, localBin, cargoBin, process.env.PATH || ''].filter(Boolean).join(path.delimiter);

  return {
    konoha: {
      type: 'stdio',
      command: process.execPath || 'node',
      args: [launcherPath],
      env: {
        ACTIVE_CLIENT: 'omp',
        KONOHA_CLIENT: 'omp',
        KONOHA_SEMANTIC_SEARCH: '1',
        PATH: clientPathEnv
      },
      autoApprove: KONOHA_CANONICAL_TOOLS ? [...KONOHA_CANONICAL_TOOLS] : [],
      auto_approve: true
    },
    aislop: {
      type: 'stdio',
      command: npxCmd,
      args: [
        '-y',
        '-p',
        AISLOP_PACKAGE,
        'aislop-mcp'
      ],
      env: {
        PATH: clientPathEnv
      },
      autoApprove: ['aislop_scan', 'aislop_fix', 'aislop_why', 'aislop_baseline'],
      auto_approve: true
    }
  };
}

function _mirrorOmpMcpToLocalDirs(payload, options = {}) {
  try {
    const ompRoot = options.home ? path.join(options.home, '.omp') : OMP_DIR;
    const legacyPath = path.join(ompRoot, 'mcp.json');
    if (fileExists(legacyPath)) {
      writeJsonAtomic(legacyPath, payload);
    }
  } catch (_) { /* best-effort mirror to global ~/.omp/mcp.json only */ }
}

function _backupAndRecordOmpOwnership(configPath, servers, konohaHome, options = {}) {
  const backupMgr = require('./config_backup_manager');
  if (fileExists(configPath)) {
    backupMgr.ensureBackupBeforeModify(configPath, { client: 'omp', scope: 'global', konohaHome, ...options });
  }
  try {
    backupMgr.recordOwnership(configPath, {
      client: 'omp',
      scope: 'global',
      format: 'json',
      ownedKeys: Object.keys(servers).map(k => `mcpServers.${k}`)
    }, konohaHome || options);
  } catch (_) { /* best-effort */ }
}

function registerOmpMcp(options = {}) {
  const configPath = options.configPath || (options.home ? path.join(options.home, '.omp', 'agent', 'mcp.json') : getOmpConfigPath());
  const silent = options.silent !== false;

  try {
    const existing = readJsonSafe(configPath) || {};
    const existingServers = (existing.mcpServers && typeof existing.mcpServers === 'object') ? existing.mcpServers : {};

    const servers = buildOmpMcpServers(options);
    const mergedServers = Object.assign({}, existingServers, servers);

    // Preserve any existing top-level keys while ensuring $schema and mcpServers
    const payload = {
      ...existing,
      $schema: existing.$schema || OMP_MCP_SCHEMA,
      mcpServers: mergedServers
    };

    _backupAndRecordOmpOwnership(configPath, servers, options.konohaHome, options);

    writeJsonAtomic(configPath, payload);
    if (!silent) process.stderr.write(`✓ Registered Konoha MCP servers in OMP: ${configPath}\n`);

    _mirrorOmpMcpToLocalDirs(payload, options);

    return { ok: true, configPath };
  } catch (err) {
    if (err && /backup/i.test(err.message)) throw err;
    if (!silent) console.warn(`⚠ Could not register OMP MCP config: ${err.message}`);
    return { ok: false, reason: 'omp-mcp-registration-failed', error: err.message };
  }
}

function deployOmpContract(options = {}) {
  const targetFile = options.targetFile || (options.home ? path.join(options.home, '.omp', 'agent', 'AGENTS.md') : OMP_AGENTS_MD);
  const silent = options.silent !== false;

  try {
    ensureDir(path.dirname(targetFile));
    const existing = fileExists(targetFile) ? fs.readFileSync(targetFile, 'utf-8') : '';
    const managed = buildManagedContract(existing, buildOmpManagedContract());
    if (managed === existing) {
      return { ok: true, changed: false };
    }
    if (fileExists(targetFile)) {
      const backupMgr = require('./config_backup_manager');
      backupMgr.ensureBackupBeforeModify(targetFile, { client: 'omp', scope: 'global', ...options });
    }
    fs.writeFileSync(targetFile, managed, 'utf-8');
    if (!silent) process.stderr.write(`✓ Konoha contract deployed to OMP: ${targetFile}\n`);
    return { ok: true, changed: true };
  } catch (err) {
    if (err && /backup/i.test(err.message)) throw err;
    if (!silent) console.warn(`⚠ OMP contract deployment failed: ${err.message}`);
    return { ok: false, reason: 'omp-contract-deploy-failed', error: err.message };
  }
}

function deployOmpRtkRule(options = {}) {
  const silent = options.silent !== false;
  const targetDir = options.targetDir || (options.home ? path.join(options.home, '.omp', 'rules') : path.join(OMP_DIR, 'rules'));
  const targetFile = path.join(targetDir, 'rtk.md');

  try {
    const sourceRtk = path.join(__dirname, 'templates', 'rules', 'rtk.md');
    const content = fileExists(sourceRtk)
      ? fs.readFileSync(sourceRtk, 'utf8')
      : '# RTK Mandatory Rule\n\nALWAYS prefix command execution with `rtk`.\n';
    const writeRes = writeManagedFileSafe(targetFile, content, {
      silent,
      onBeforeOverwrite: (p) => {
        const backupMgr = require('./config_backup_manager');
        backupMgr.ensureBackupBeforeModify(p, { client: 'omp', scope: 'global', ...options });
      }
    });
    if (writeRes.status !== 'conflict' && !silent) process.stderr.write(`✓ RTK rule deployed to OMP: ${targetFile}\n`);
    return { ok: true, targetFile, status: writeRes.status };
  } catch (err) {
    if (err && /backup/i.test(err.message)) throw err;
    if (!silent) console.warn(`⚠ OMP RTK rule deployment failed: ${err.message}`);
    return { ok: false, reason: 'omp-rtk-deploy-failed', error: err.message };
  }
}

const OMP_READONLY_TOOLS = Object.freeze(['read', 'grep', 'find', 'ls', 'fetch', 'web_search']);
const OMP_WRITE_TOOLS = Object.freeze(['write', 'edit', 'bash']);

function buildOmpSubagentTools(agent) {
  const readOnly = isReadOnlyAgent(agent);
  const router = isRouterAgent(agent);
  const blocked = new Set(GENIN_BLOCKED_TOOLS);
  const builtins = readOnly
    ? [...OMP_READONLY_TOOLS]
    : [...OMP_READONLY_TOOLS, ...OMP_WRITE_TOOLS, ...(router ? ['task'] : [])];
  const konoha = (KONOHA_CANONICAL_TOOLS || [])
    .filter((t) => !readOnly || !blocked.has(t))
    .map((t) => `mcp__konoha__${t}`);
  const aislopSource = readOnly ? ['aislop_scan', 'aislop_why'] : SUBAGENT_SAFE_MCP_GRANTS.aislop;
  const aislop = aislopSource.map((t) => `mcp__aislop__${t}`);
  const tools = [...builtins, ...konoha, ...aislop];
  assertNoWildcardGrants(tools, `omp subagent ${agent?.name || 'unknown'} tools`);
  return tools;
}

function generateOmpSubagentMd(agent) {
  const rawDesc = getRoleDescription(agent);
  const description = `${rawDesc}. Use proactively when tasks match: ${agent.delegationKeywords || agent.purpose || agent.name}.`;
  const tools = buildOmpSubagentTools(agent);
  const readOnly = isReadOnlyAgent(agent);
  const router = isRouterAgent(agent);
  const body = String(agent.instructions || '').trim() || `Operate strictly as @${agent.name} (${rawDesc}).`;
  const lines = [
    '---',
    `name: ${agent.name}`,
    `description: "${description.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`,
    AGENT_OWNERSHIP_MARKER,
    `spawns: ${router ? '"*"' : 'none'}`,
    'tools:',
    ...tools.map((t) => `  - ${t}`),
    '---',
    '',
    body,
    '',
    ...(readOnly ? ['Strict read-only exploration mode: never modify files or execute mutating shell commands.'] : []),
    buildSubagentContract('omp'),
    ''
  ];
  return lines.join('\n');
}

function deployOmpAgents(options = {}) {
  const silent = options.silent !== false;
  const targetAgentDir = options.agentDir || (options.home ? path.join(options.home, '.omp', 'agent') : OMP_AGENT_DIR);
  const targetAgentsDir = options.agentsDir || path.join(targetAgentDir, 'agents');
  const rawAgents = Array.isArray(options.agents) && options.agents.length > 0 ? options.agents : loadAgents();
  const agents = getDeployableAgents(rawAgents);
  const official = new Set(getDeployableAgentNames());
  const deployed = [];
  const conflicts = [];

  for (const agent of agents) {
    if (!agent || !agent.name || !official.has(agent.name)) continue;
    const content = generateOmpSubagentMd(agent);
    const globalResult = writeAgentFileSafe(path.join(targetAgentsDir, `${agent.name}.md`), content, agent.name, { silent });
    deployed.push(globalResult.path);
    if (globalResult.status === 'conflict') conflicts.push(globalResult);

    if (options.projectRoot && (options.deployProject || options.appendProject)) {
      const projAgentPath = path.join(options.projectRoot, '.omp', 'agents', `${agent.name}.md`);
      const projResult = writeAgentFileSafe(projAgentPath, content, agent.name, { silent });
      deployed.push(projResult.path);
      if (projResult.status === 'conflict') conflicts.push(projResult);
    }
  }

  return { ok: true, targetDir: targetAgentsDir, deployed, conflicts };
}

function ensureOmpSetup(options = {}) {
  const silent = options.silent !== false;
  const targetAgentDir = options.home ? path.join(options.home, '.omp', 'agent') : OMP_AGENT_DIR;
  ensureDir(targetAgentDir);

  const backupMgr = require('./config_backup_manager');
  const ompRoot = options.home ? path.join(options.home, '.omp') : OMP_DIR;
  for (const sCandidate of [
    path.join(targetAgentDir, 'settings.json'),
    path.join(targetAgentDir, 'config.yml'),
    path.join(ompRoot, 'settings.json'),
    path.join(ompRoot, 'config.yml')
  ]) {
    if (fileExists(sCandidate)) {
      backupMgr.ensureBackupBeforeModify(sCandidate, { client: 'omp', scope: 'global', ...options });
    }
  }

  const mcpResult = registerOmpMcp({ ...options, silent });
  const contractResult = deployOmpContract({ ...options, silent });
  const rtkResult = deployOmpRtkRule({ ...options, silent });
  const agentsResult = deployOmpAgents({ ...options, targetAgentDir, silent });

  // Auto-detecting the project from cwd is right for the real CLI and wrong for
  // any sandboxed caller: a test or CI run with a temporary HOME wrote its own
  // throwaway launcher path into the developer's `.omp/mcp.json`, after which every
  // OMP session in that repo failed to start Konoha and lost all its tools.
  // `os.userInfo()` reads the account database, so an overridden `process.env.HOME`
  // cannot make a sandbox look like the real home. The effective home is resolved
  // the same way `bin/lib/paths.js` resolves it, because a suite typically overrides
  // the environment variable rather than passing `home`.
  const realHome = (() => {
    try { return os.userInfo().homedir || HOME; } catch (_) { return HOME; }
  })();
  const effectiveHome = options.home || process.env.HOME || process.env.USERPROFILE || realHome;
  const sandboxed = Boolean(effectiveHome) && path.resolve(effectiveHome) !== path.resolve(realHome);
  const projectRoot = options.projectRoot
    || (!sandboxed && fileExists(path.join(process.cwd(), '.omp', 'mcp.json')) ? process.cwd() : null);
  const projMcp = projectRoot ? path.join(projectRoot, '.omp', 'mcp.json') : null;
  if (projMcp && (options.appendProject || options.deployProject || fileExists(projMcp))) {
    registerOmpMcp({ ...options, configPath: projMcp, silent });
  }

  return {
    ok: mcpResult.ok && contractResult.ok,
    mcp: mcpResult,
    contract: contractResult,
    rtk: rtkResult,
    agents: agentsResult
  };
}

function removeOmpConfig(silent = true) {
  const configPath = getOmpConfigPath();
  if (!fileExists(configPath)) return true;

  try {
    const config = readJsonSafe(configPath);
    if (!config || !config.mcpServers) return true;

    for (const key of KONOHA_SERVER_KEYS) {
      delete config.mcpServers[key];
    }

    writeJsonAtomic(configPath, config);
    if (!silent) process.stderr.write(`✓ Removed Konoha MCP servers from OMP: ${configPath}\n`);
    return true;
  } catch (err) {
    if (!silent) console.warn(`⚠ Could not remove OMP MCP config: ${err.message}`);
    return false;
  }
}

function removeOmpContract(silent = true) {
  if (!fileExists(OMP_AGENTS_MD)) return true;

  try {
    const content = fs.readFileSync(OMP_AGENTS_MD, 'utf-8');
    const startIdx = content.indexOf(CONTRACT_START_MARKER);
    const endIdx = content.indexOf(CONTRACT_END_MARKER);
    if (startIdx === -1 || endIdx === -1) return true;

    const before = content.slice(0, startIdx);
    const after = content.slice(endIdx + CONTRACT_END_MARKER.length);
    const cleaned = (before + after).replace(/^\n+/, '').replace(/\n{3,}/g, '\n\n');

    if (cleaned.trim()) {
      fs.writeFileSync(OMP_AGENTS_MD, cleaned, 'utf-8');
    } else {
      fs.unlinkSync(OMP_AGENTS_MD);
    }
    if (!silent) process.stderr.write(`✓ Konoha contract removed from OMP global context\n`);
    return true;
  } catch (err) {
    if (!silent) console.warn(`⚠ Could not remove OMP contract: ${err.message}`);
    return false;
  }
}

function getOmpStatus() {
  const installed = isOmpInstalled();
  const configPath = getOmpConfigPath();
  let mcpKonoha = false;
  let mcpAislop = false;
  let contractDeployed = false;
  let rtkRuleDeployed = false;
  let advisorConfigured = true;
  const advisorConfig = {
    enabled: true,
    startedFromBeginning: true,
    reviewScope: 'all_agents',
    reviewMode: 'realtime-idle',
    directSteer: true,
    evictStaleResults: true,
    syncBacklog: 'off',
    continueSeverity: 'nit',
    reviewInterval: 5,
    maxTurnTokens: 1000
  };

  if (fileExists(configPath)) {
    const config = readJsonSafe(configPath);
    if (config && config.mcpServers) {
      mcpKonoha = !!config.mcpServers['konoha'];
      mcpAislop = !!config.mcpServers['aislop'];
    }
  }

  if (fileExists(OMP_AGENTS_MD)) {
    try {
      const text = fs.readFileSync(OMP_AGENTS_MD, 'utf-8');
      contractDeployed = text.includes(CONTRACT_START_MARKER) && text.includes(OMP_MANDATE_HEADING);
    } catch (_err) {
      /* ignore unreadable file */
    }
  }

  const rtkRuleFile = path.join(OMP_DIR, 'rules', 'rtk.md');
  rtkRuleDeployed = fileExists(rtkRuleFile) || contractDeployed;

  return {
    installed,
    configured: mcpKonoha,
    configExists: fileExists(configPath),
    mcpKonoha,
    mcpAislop,
    contractDeployed,
    rtkRuleDeployed,
    advisorConfigured,
    advisorConfig,
    configPath
  };
}

module.exports = {
  OMP_DIR,
  OMP_AGENT_DIR,
  OMP_MCP_CONFIG,
  OMP_AGENTS_MD,
  OMP_SKILLS,
  isOmpInstalled,
  getOmpConfigPath,
  getOmpAgentsMdPath,
  buildOmpWorkflowAddendum,
  buildOmpManagedContract,
  buildOmpMcpServers,
  registerOmpMcp,
  deployOmpContract,
  deployOmpRtkRule,
  buildOmpSubagentTools,
  generateOmpSubagentMd,
  deployOmpAgents,
  ensureOmpSetup,
  removeOmpConfig,
  removeOmpContract,
  getOmpStatus
};
