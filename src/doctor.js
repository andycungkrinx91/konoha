'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();
const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const paths = require('../bin/lib/paths');

const SKILLS_DB_DIR = paths.SKILLS_DB_DIR || path.join(HOME, '.konoha');
const DB_PATH = paths.DB_PATH || path.join(SKILLS_DB_DIR, 'konoha.db');
const SERVER_PATH = paths.SERVER_PATH || path.join(SKILLS_DB_DIR, 'server.js');
const MIGRATE_PATH = path.join(SKILLS_DB_DIR, 'migrate.js');
const FILE_TOOLS_MCP_PATH = path.join(SKILLS_DB_DIR, 'file_tools_mcp.js');
const FILE_TOOLS_ROUTER_PATH = path.join(SKILLS_DB_DIR, 'file_tools_router.js');
const FILE_TOOLS_LAUNCHER_PATH = path.join(SKILLS_DB_DIR, 'file_tools_launcher.js');
const GEMINI_MD_PATH = path.join(HOME, '.gemini', 'GEMINI.md');
const USER_AGENTS_YAML_PATH = path.join(HOME, '.agents', 'agents.yaml');
const MCP_CONFIG_PATH = path.join(HOME, '.gemini', 'config', 'mcp_config.json');

const {
  fileExists,
  ensureDir,
  copyFile,
  isRtkInstalled
} = require('./platform_utils');

function checkSingleFile(srcRel, destPath, label, record, autoRepair) {
  const srcPath = path.join(SRC_DIR, srcRel);
  if (fileExists(destPath)) {
    record(label, 'HEALTHY', 'File is present and healthy');
    return;
  }
  if (autoRepair && fileExists(srcPath)) {
    ensureDir(path.dirname(destPath));
    try {
      copyFile(srcPath, destPath);
      record(label, 'REPAIRED', 'Restored missing file from package templates');
      return;
    } catch (e) {
      process.stderr.write(`[doctor] Repair failed for ${label}: ${e.message}\n`);
      record(label, 'FAILED', `Repair failed: ${e.message}`);
      return;
    }
  }
  record(label, 'FAILED', 'File missing');
}

function checkCoreFiles(record, autoRepair) {
  const files = [
    ['db.js', path.join(SKILLS_DB_DIR, 'db.js'), 'DB Module (db.js)'],
    ['vector_search.js', path.join(SKILLS_DB_DIR, 'vector_search.js'), 'Vector Search Module (vector_search.js)'],
    ['server.js', SERVER_PATH, 'Server File (server.js)'],
    ['migrate.js', MIGRATE_PATH, 'Migration Script (migrate.js)'],
    ['db_stats.js', path.join(SKILLS_DB_DIR, 'db_stats.js'), 'Stats Helper Script (db_stats.js)'],
    ['db_savings.js', path.join(SKILLS_DB_DIR, 'db_savings.js'), 'Savings Helper Script (db_savings.js)'],
    ['agent_stats.js', path.join(SKILLS_DB_DIR, 'agent_stats.js'), 'Agent Stats Helper Script (agent_stats.js)'],
    ['prompt_hook.js', path.join(SKILLS_DB_DIR, 'prompt_hook.js'), 'Prompt Hook Script (prompt_hook.js)'],
    ['antigravity_subagent_hook.js', path.join(SKILLS_DB_DIR, 'antigravity_subagent_hook.js'), 'Subagent Hook Script (antigravity_subagent_hook.js)'],
    ['file_tools_mcp.js', FILE_TOOLS_MCP_PATH, 'File Tools MCP (file_tools_mcp.js)'],
    ['file_tools_router.js', FILE_TOOLS_ROUTER_PATH, 'File Tools Router (file_tools_router.js)'],
    ['file_tools_launcher.js', FILE_TOOLS_LAUNCHER_PATH, 'File Tools Launcher (file_tools_launcher.js)'],
    ['platform_utils.js', path.join(SKILLS_DB_DIR, 'platform_utils.js'), 'Platform Utils (platform_utils.js)']
  ];
  for (const [src, dest, label] of files) {
    checkSingleFile(src, dest, label, record, autoRepair);
  }
  record('Database File (konoha.db)', fileExists(DB_PATH) ? 'HEALTHY' : 'FAILED', fileExists(DB_PATH) ? 'Database file is present' : 'Database file missing');
}

function checkMcpConfigJson(record, autoRepair) {
  if (fileExists(MCP_CONFIG_PATH)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, 'utf-8'));
      const servers = cfg.mcpServers || {};
      if (servers.konoha && servers.semble && servers.aislop) {
        record('MCP Config (mcp_config.json)', 'HEALTHY', 'konoha, semble, and aislop are active');
      } else if (autoRepair) {
        require('./antigravity_manager').ensureAntigravitySetup({ silent: true });
        record('MCP Config (mcp_config.json)', 'REPAIRED', 'Registered konoha, semble, and aislop in config');
      } else {
        record('MCP Config (mcp_config.json)', 'WARNING', 'Some MCP servers not registered');
      }
    } catch {
      record('MCP Config (mcp_config.json)', 'FAILED', 'Invalid JSON config');
    }
  } else if (autoRepair) {
    try {
      require('./antigravity_manager').ensureAntigravitySetup({ silent: true });
      record('MCP Config (mcp_config.json)', 'REPAIRED', 'Registered konoha, semble, and aislop in config');
    } catch {
      record('MCP Config (mcp_config.json)', 'FAILED', 'Missing mcp_config.json');
    }
  } else {
    record('MCP Config (mcp_config.json)', 'FAILED', 'Missing mcp_config.json');
  }
}

function checkClientsIntegration(record) {
  record('GEMINI Instructions (GEMINI.md)', fileExists(GEMINI_MD_PATH) ? 'HEALTHY' : 'WARNING', fileExists(GEMINI_MD_PATH) ? 'Instructions are active' : 'Missing ~/.gemini/GEMINI.md');
  record('AGENTS Definition (agents.yaml)', fileExists(USER_AGENTS_YAML_PATH) ? 'HEALTHY' : 'WARNING', fileExists(USER_AGENTS_YAML_PATH) ? 'Ninja ranks are active' : 'Missing ~/.agents/agents.yaml');

  try {
    const cursorMgr = require('./cursor_manager');
    record('Cursor IDE/CLI (~/.cursor/)', cursorMgr.isCursorInstalled() ? 'HEALTHY' : 'NOT INSTALLED', 'Cursor configuration status');
  } catch { /* best-effort */ }

  try {
    const mcpClients = require('./mcp_clients_manager');
    record('Claude Code (~/.claude.json)', mcpClients.isClaudeCodeInstalled() ? 'HEALTHY' : 'NOT INSTALLED', 'Claude Code status');
    record('Command Code (~/.commandcode/mcp.json)', mcpClients.isCommandCodeInstalled() ? 'HEALTHY' : 'NOT INSTALLED', 'Command Code status');
  } catch { /* best-effort */ }

  try {
    const opencodeMgr = require('./opencode_manager');
    record('OpenCode (~/.opencode/config.json)', opencodeMgr.isOpenCodeInstalled() ? 'HEALTHY' : 'NOT INSTALLED', 'OpenCode status');
  } catch { /* best-effort */ }

  try {
    const codexMgr = require('./codex_manager');
    record('Codex (~/.codex/config.toml)', codexMgr.isCodexInstalled() ? 'HEALTHY' : 'NOT INSTALLED', 'Codex status');
  } catch { /* best-effort */ }

  try {
    const ompMgr = require('./omp_manager');
    record('OMP (~/.omp/agent/mcp.json)', ompMgr.isOmpInstalled() ? 'HEALTHY' : 'NOT INSTALLED', 'OMP status');
  } catch { /* best-effort */ }

  record('RTK (Token Killer)', isRtkInstalled() ? 'ACTIVE' : 'WARNING', isRtkInstalled() ? 'rtk binary available' : 'rtk not detected in PATH');
}

function repairKageAntislopSkill(record) {
  try {
    const agentMgr = require('./agent_manager');
    const agents = agentMgr.loadAgents(true, true);
    const kage = agents.find(a => a.name === 'kage');
    if (kage) {
      if (!Array.isArray(kage.skills)) kage.skills = [];
      if (!kage.skills.includes('antislop')) kage.skills.push('antislop');
      agentMgr.saveAgents(agents);
      const dbAgents = require('./db_agents');
      dbAgents.bulkImportAgents(agents, DB_PATH);
      record('Anti-Slop Gate (Kage)', 'REPAIRED', 'Restored and registered anti-slop skill for Kage reviewer');
      return true;
    }
  } catch { /* best-effort */ }
  return false;
}

function checkSdlcGovernance(record, autoRepair) {
  try {
    const dbModule = require('./db');
    const conn = dbModule.getConnection(DB_PATH);
    try {
      dbModule.setupSchema(conn);
      const enabledBridges = conn.prepare('SELECT count(*) as count FROM bridges WHERE enabled = 1').get();
      const bridgeCount = enabledBridges ? enabledBridges.count : 0;
      if (bridgeCount < 2) {
        record('Cross-Provider Review Setup', 'INFO', `${bridgeCount} bridge(s) enabled. Cross-provider review falls back to same-provider if configured.`);
      } else {
        record('Cross-Provider Review Setup', 'HEALTHY', `${bridgeCount} bridges enabled for independent second-opinion reviews`);
      }

      let hasAntislopInDb = false;
      try {
        const row = conn.prepare("SELECT 1 FROM skills WHERE name = 'antislop' OR name = 'kage-skill/antislop' OR name LIKE '%antislop%' LIMIT 1").get();
        hasAntislopInDb = Boolean(row);
      } catch { /* best-effort */ }

      let kageSkills = '';
      try {
        const kageRow = conn.prepare("SELECT skills FROM agents WHERE name = 'kage'").get();
        kageSkills = (kageRow && kageRow.skills) ? kageRow.skills.toLowerCase() : '';
      } catch { /* best-effort */ }

      let hasAntislopSkill = kageSkills.includes('antislop') || kageSkills.includes('anti-slop') || kageSkills.includes('aislop') || (kageSkills.includes('kage-skill') && hasAntislopInDb);
      if (!hasAntislopSkill && autoRepair) {
        hasAntislopSkill = repairKageAntislopSkill(record);
      }

      if (hasAntislopSkill) {
        record('Anti-Slop Gate (Kage)', 'HEALTHY', 'Anti-slop skill loaded for Kage reviewer');
      } else if (!autoRepair) {
        record('Anti-Slop Gate (Kage)', 'WARNING', 'anti-slop skill not installed for kage (falls back to core zero-slop checks)');
      }
    } finally {
      try { conn.close(); } catch (_) { /* best-effort */ }
    }
  } catch (_) { /* best-effort */ }
}

function getDiagnostics(autoRepair = false) {
  const results = [];
  let repairsDone = 0;
  let hasErrors = false;

  const record = (component, status, details) => {
    results.push({ component, status, details });
    if (status === 'FAILED') hasErrors = true;
    if (status === 'REPAIRED') repairsDone++;
  };

  const nodeVersion = process.version;
  const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0], 10);
  if (majorVersion < 18) {
    record('Node.js Environment', 'FAILED', `Node.js >= 18 is required, found ${nodeVersion}`);
  } else {
    record('Node.js Environment', 'ACTIVE', `${nodeVersion} (${process.execPath})`);
  }

  checkCoreFiles(record, autoRepair);
  checkMcpConfigJson(record, autoRepair);
  checkClientsIntegration(record);
  checkSdlcGovernance(record, autoRepair);

  return { results, repairsDone, hasErrors, healthy: !hasErrors };
}

function runRepairs(_ = 'all') {
  return getDiagnostics(true);
}

module.exports = {
  getDiagnostics,
  runRepairs
};
