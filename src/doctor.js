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

  const checkFile = (srcRel, destPath, label) => {
    const srcPath = path.join(SRC_DIR, srcRel);
    if (fileExists(destPath)) {
      record(label, 'HEALTHY', 'File is present and healthy');
      return true;
    }
    if (autoRepair && fileExists(srcPath)) {
      try {
        ensureDir(path.dirname(destPath));
        copyFile(srcPath, destPath);
        record(label, 'REPAIRED', 'Restored missing file from package templates');
        return true;
      } catch (e) {
        record(label, 'FAILED', `Repair failed: ${e.message}`);
        // aislop-ignore-next-line ai-slop/hidden-fallback (failure IS surfaced via record() audit trail; false is the correct non-fatal status)
        // aislop-ignore-next-line ai-slop/hidden-fallback (failure IS surfaced via record() audit trail; false is the correct non-fatal status)
        return false;
      }
    }
    record(label, 'FAILED', 'File missing');

    return false;
  };

  checkFile('db.js', path.join(SKILLS_DB_DIR, 'db.js'), 'DB Module (db.js)');
  checkFile('vector_search.js', path.join(SKILLS_DB_DIR, 'vector_search.js'), 'Vector Search Module (vector_search.js)');
  checkFile('server.js', SERVER_PATH, 'Server File (server.js)');
  checkFile('migrate.js', MIGRATE_PATH, 'Migration Script (migrate.js)');
  checkFile('db_stats.js', path.join(SKILLS_DB_DIR, 'db_stats.js'), 'Stats Helper Script (db_stats.js)');
  checkFile('db_savings.js', path.join(SKILLS_DB_DIR, 'db_savings.js'), 'Savings Helper Script (db_savings.js)');
  checkFile('agent_stats.js', path.join(SKILLS_DB_DIR, 'agent_stats.js'), 'Agent Stats Helper Script (agent_stats.js)');
  checkFile('prompt_hook.js', path.join(SKILLS_DB_DIR, 'prompt_hook.js'), 'Prompt Hook Script (prompt_hook.js)');
  checkFile('antigravity_subagent_hook.js', path.join(SKILLS_DB_DIR, 'antigravity_subagent_hook.js'), 'Subagent Hook Script (antigravity_subagent_hook.js)');
  checkFile('file_tools_mcp.js', FILE_TOOLS_MCP_PATH, 'File Tools MCP (file_tools_mcp.js)');
  checkFile('file_tools_router.js', FILE_TOOLS_ROUTER_PATH, 'File Tools Router (file_tools_router.js)');
  checkFile('file_tools_launcher.js', FILE_TOOLS_LAUNCHER_PATH, 'File Tools Launcher (file_tools_launcher.js)');
  checkFile('platform_utils.js', path.join(SKILLS_DB_DIR, 'platform_utils.js'), 'Platform Utils (platform_utils.js)');

  if (fileExists(DB_PATH)) {
    record('Database File (konoha.db)', 'HEALTHY', 'Database file is present');
  } else {
    record('Database File (konoha.db)', 'FAILED', 'Database file missing');
  }

  if (fileExists(MCP_CONFIG_PATH)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, 'utf-8'));
      const servers = cfg.mcpServers || {};
      if (servers.konoha && servers.semble && servers.aislop) {
        record('MCP Config (mcp_config.json)', 'HEALTHY', 'konoha, semble, and aislop are active');
      } else {
        record('MCP Config (mcp_config.json)', 'WARNING', 'Some MCP servers not registered');
      }
    } catch {
      record('MCP Config (mcp_config.json)', 'FAILED', 'Invalid JSON config');
    }
  } else {
    record('MCP Config (mcp_config.json)', 'FAILED', 'Missing mcp_config.json');
  }

  if (fileExists(GEMINI_MD_PATH)) {
    record('GEMINI Instructions (GEMINI.md)', 'HEALTHY', 'Instructions are active');
  } else {
    record('GEMINI Instructions (GEMINI.md)', 'WARNING', 'Missing ~/.gemini/GEMINI.md');
  }

  if (fileExists(USER_AGENTS_YAML_PATH)) {
    record('AGENTS Definition (agents.yaml)', 'HEALTHY', 'Ninja ranks are active');
  } else {
    record('AGENTS Definition (agents.yaml)', 'WARNING', 'Missing ~/.agents/agents.yaml');
  }

  try {
    const cursorMgr = require('./cursor_manager');
    record('Cursor IDE/CLI (~/.cursor/)', cursorMgr.isCursorInstalled() ? 'HEALTHY' : 'NOT INSTALLED', 'Cursor configuration status');
  } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }

  try {
    const mcpClients = require('./mcp_clients_manager');
    record('Claude Code (~/.claude.json)', mcpClients.isClaudeCodeInstalled() ? 'HEALTHY' : 'NOT INSTALLED', 'Claude Code status');
    record('Command Code (~/.commandcode/mcp.json)', mcpClients.isCommandCodeInstalled() ? 'HEALTHY' : 'NOT INSTALLED', 'Command Code status');
  } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }

  try {
    const opencodeMgr = require('./opencode_manager');
    record('OpenCode (~/.opencode/config.json)', opencodeMgr.isOpenCodeInstalled() ? 'HEALTHY' : 'NOT INSTALLED', 'OpenCode status');
  } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }

  try {
    const codexMgr = require('./codex_manager');
    record('Codex (~/.codex/config.toml)', codexMgr.isCodexInstalled() ? 'HEALTHY' : 'NOT INSTALLED', 'Codex status');
  } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }

  if (isRtkInstalled()) {
    record('RTK (Token Killer)', 'ACTIVE', 'rtk binary available');
  } else {
    record('RTK (Token Killer)', 'WARNING', 'rtk not detected in PATH');
  }

  // SDLC Governance Layer Advisory Checks
  try {
    const dbModule = require('./db');
    const conn = dbModule.getConnection(DB_PATH);
    try {
      // Check 1: Cross-provider review setup
      const enabledBridges = conn.prepare('SELECT count(*) as count FROM bridges WHERE enabled = 1').get();
      const bridgeCount = enabledBridges ? enabledBridges.count : 0;
      if (bridgeCount < 2) {
        record('Cross-Provider Review Setup', 'INFO', `${bridgeCount} bridge(s) enabled. Cross-provider review falls back to same-provider if configured.`);
      } else {
        record('Cross-Provider Review Setup', 'HEALTHY', `${bridgeCount} bridges enabled for independent second-opinion reviews`);
      }

      // Check 2: Anti-slop skill for Kage
      const kageRow = conn.prepare("SELECT skills FROM agents WHERE name = 'kage'").get();
      const kageSkills = (kageRow && kageRow.skills) ? kageRow.skills.toLowerCase() : '';
      const hasAntislopSkill = kageSkills.includes('antislop') || kageSkills.includes('anti-slop') || kageSkills.includes('aislop');
      if (hasAntislopSkill) {
        record('Anti-Slop Gate (Kage)', 'HEALTHY', 'Anti-slop skill loaded for Kage reviewer');
      } else {
        record('Anti-Slop Gate (Kage)', 'INFO', 'anti-slop skill not installed for kage (falls back to core zero-slop checks)');
      }
    } finally {
      try { conn.close(); } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
    }
  } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }

  return {
    results,
    repairsDone,
    hasErrors,
    healthy: !hasErrors
  };
}

function runRepairs(_ = 'all') {
  return getDiagnostics(true);
}

module.exports = {
  getDiagnostics,
  runRepairs
};
