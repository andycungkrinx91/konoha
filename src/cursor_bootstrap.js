#!/usr/bin/env node
/**
 * Cursor sessionStart hook — silently ensures Konoha MCP is registered and skills are synchronized.
 * Self-contained (no package-relative requires) so it works from ~/.konoha/.
 * Exits 0 always (fail-open).
 */
const fs = require('fs');
const path = require('path');
const { SEMBLE_PACKAGE, AISLOP_PACKAGE } = require('./semble_manager');
const os = require('os');
const { spawnSync } = require('child_process');

const HOME = os.homedir();
// Self-contained: derive paths from HOME rather than importing bin/lib/paths.
const KONOHA_DIR = path.join(HOME, '.konoha');
const CURSOR_DIR = path.join(HOME, '.cursor');
const CURSOR_MCP = path.join(CURSOR_DIR, 'mcp.json');
const SERVER_PATH = path.join(KONOHA_DIR, 'server.js');
const FILE_TOOLS_MCP_PATH = path.join(KONOHA_DIR, 'file_tools_mcp.js');
const CURSOR_RULE = path.join(CURSOR_DIR, 'rules', 'konoha.mdc');
const CURSOR_RTK_RULE = path.join(CURSOR_DIR, 'rules', 'rtk.mdc');
const CONTRACT_MARKER = 'KONOHA-CONTRACT-START';
const contractPath = path.join(KONOHA_DIR, 'agent_contract.js');
const agentContract = fileExists(contractPath) ? require(contractPath) : null;
const CONTRACT_VERSION = agentContract?.CONTRACT_VERSION || '2.2.14';

function fileExists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

function ensureDir(d) {
  if (!fileExists(d)) fs.mkdirSync(d, { recursive: true });
}

function checkPython() {
  for (const cmd of ['python3', 'python']) {
    try {
      const r = spawnSync(cmd, ['--version'], { encoding: 'utf-8', timeout: 5000, windowsHide: true });
      if (r.status === 0) return cmd;
    } catch { /* intentional best-effort fallback: failure here must never crash the runtime */ }
  }
  return 'python3';
}

function getUvx() {
  const isWin = process.platform === 'win32';
  try {
    spawnSync('uvx', ['--version'], { stdio: 'ignore', timeout: 5000, shell: isWin, windowsHide: true });
    return 'uvx';
  } catch { /* intentional best-effort fallback: failure here must never crash the runtime */ }
  // Windows installs put uvx.exe in %USERPROFILE%\.local\bin
  const localName = isWin ? 'uvx.exe' : 'uvx';
  const local = path.join(HOME, '.local', 'bin', localName);
  return fileExists(local) ? local : 'uvx';
}

function isUvxUsable() {
  try {
    const uvx = getUvx();
    const r = spawnSync(uvx, ['--version'], { stdio: 'ignore', timeout: 5000, shell: process.platform === 'win32', windowsHide: true });
    return r.status === 0;
  } catch { /* intentional best-effort fallback: failure here must never crash the runtime */ }
  return false;
}

function buildKonohaFilesMcpEntry() {
  const launcherJs = path.join(HOME, '.konoha', 'file_tools_launcher.js');
  const mcpJs = path.join(HOME, '.konoha', 'file_tools_mcp.js');
  if (!fs.existsSync(mcpJs)) return null;
  const target = fs.existsSync(launcherJs) ? launcherJs : mcpJs;
  return {
    type: 'stdio',
    // Absolute node path: GUI-launched Cursor may not inherit a shell PATH
    command: process.execPath || 'node',
    args: [target]
  };
}

function registerMcp() {
  ensureDir(CURSOR_DIR);
  let config = null;
  if (fileExists(CURSOR_MCP)) {
    try {
      config = JSON.parse(fs.readFileSync(CURSOR_MCP, 'utf-8'));
    } catch {
      return;
    }
    if (!config.mcpServers) config.mcpServers = {};
  } else {
    config = { mcpServers: {} };
  }
  let updated = false;
  // Clean legacy servers if present
  if (config.mcpServers['konoha']) {
    delete config.mcpServers['konoha'];
    updated = true;
  }
  if (config.mcpServers['konoha-files']) {
    delete config.mcpServers['konoha-files'];
    updated = true;
  }

  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const uvxUsable = isUvxUsable();
  const canonicalKonohaTools = [
    'read_file_head', 'read_file_range', 'file_info',
    ['token', 'efficient', 'grep'].join('_'), 'get_file_structure', 'find_files_clean',
    'website_ai_detector', 'docs_ai_detector', 'get_resolved_task_dir',
    'find_skill', 'list_skills', 'get_skill', 'optimize_report',
    'build_from_source', 'build_from_text',
    'sannin', 'kage', 'jonin', 'anbu', 'chunin', 'tokubetsu_jonin', 'genin',
    'report_from_agent', 'get_project_context', 'save_project_context',
    'query_project_memory', 'web_search', 'migrate_skills',
    'save_persona_memory', 'query_persona_memory', 'list_persona_memories',
    'delete_persona_memory', 'check_readiness', 'get_task_evidence',
    'get_slop_findings', 'qa_codify', 'qa_e2e_run'
  ];
  const servers = {
    ...(uvxUsable ? {
      semble: {
        type: 'stdio',
        command: getUvx(),
        args: ['--from', SEMBLE_PACKAGE, 'semble', '--content', 'all'],
        autoApprove: ['search', 'find_related'],
        auto_approve: true
      }
    } : {}),
    aislop: {
      type: 'stdio',
      command: npxCmd,
      args: ['-y', '-p', AISLOP_PACKAGE, 'aislop-mcp'],
      autoApprove: ['aislop_scan', 'aislop_fix', 'aislop_why', 'aislop_baseline'],
      auto_approve: true
    }
  };
  if (FILE_TOOLS_MCP_PATH && fileExists(FILE_TOOLS_MCP_PATH)) {
    const entry = buildKonohaFilesMcpEntry();
    if (entry) {
      entry.autoApprove = [...canonicalKonohaTools];
      entry.auto_approve = true;
      servers['konoha'] = entry;
      updated = true;
    }
  }
  for (const [name, entry] of Object.entries(servers)) {
    const existing = config.mcpServers[name];
    if (
      !existing ||
      existing.command !== entry.command ||
      JSON.stringify(existing.args || []) !== JSON.stringify(entry.args || [])
    ) {
      config.mcpServers[name] = entry;
      updated = true;
    }
  }

  if (updated || !fileExists(CURSOR_MCP)) {
    fs.writeFileSync(CURSOR_MCP, JSON.stringify(config, null, 2) + '\n');
  }
}

function _maintainGlobalCursorRule(agentContract) {
  const currentRule = fileExists(CURSOR_RULE) ? fs.readFileSync(CURSOR_RULE, 'utf8') : '';
  if (!currentRule.includes(CONTRACT_MARKER) || !currentRule.includes(CONTRACT_VERSION)) {
    if (agentContract) {
      const repaired = agentContract.buildManagedContract(currentRule, agentContract.buildMainAgentContract('cursor'));
      fs.writeFileSync(CURSOR_RULE, repaired);
    }
  }
}

function _scaffoldProjectCursorRule(cwd, agentContract) {
  if (!cwd || cwd === HOME || !fileExists(cwd) || cwd.startsWith(path.join(HOME, '.konoha'))) return;
  const projectRulesDir = path.join(cwd, '.cursor', 'rules');
  const projectRule = path.join(projectRulesDir, 'konoha.mdc');
  if (!fileExists(projectRule)) {
    ensureDir(projectRulesDir);
    if (agentContract) {
      const content = agentContract.buildManagedContract('', agentContract.buildMainAgentContract('cursor'));
      fs.writeFileSync(projectRule, content, 'utf8');
    } else if (fileExists(CURSOR_RULE)) {
      fs.copyFileSync(CURSOR_RULE, projectRule);
    }
    return;
  }
  const projectContent = fs.readFileSync(projectRule, 'utf8');
  if ((!projectContent.includes(CONTRACT_MARKER) || !projectContent.includes(CONTRACT_VERSION)) && agentContract) {
    const repaired = agentContract.buildManagedContract(projectContent, agentContract.buildMainAgentContract('cursor'));
    fs.writeFileSync(projectRule, repaired, 'utf8');
  }

  // Ensure companion workspace rules exist
  if (agentContract) {
    const geminiMd = path.join(cwd, 'GEMINI.md');
    if (!fileExists(geminiMd)) {
      fs.writeFileSync(geminiMd, agentContract.buildManagedContract('', agentContract.buildMainAgentContract('antigravity')), 'utf8');
    }
    const claudeMd = path.join(cwd, 'CLAUDE.md');
    if (!fileExists(claudeMd)) {
      fs.writeFileSync(claudeMd, agentContract.buildManagedContract('', agentContract.buildMainAgentContract('claude')), 'utf8');
    }
    const agentsMd = path.join(cwd, 'AGENTS.md');
    if (!fileExists(agentsMd)) {
      fs.writeFileSync(agentsMd, agentContract.buildManagedContract('', agentContract.buildMainAgentContract('antigravity')), 'utf8');
    }
  }
}

async function main() {
  try {
    await new Promise((resolve) => {
      let data = '';
      process.stdin.on('data', c => { data += c; });
      process.stdin.on('end', resolve);
      setTimeout(resolve, 50);
    });

    if (!fileExists(SERVER_PATH)) {
      process.exit(0);
    }

    const python = checkPython();
    registerMcp(python);
    ensureDir(path.dirname(CURSOR_RULE));
    const cwd = process.cwd();
    const contractPath = path.join(KONOHA_DIR, 'agent_contract.js');
    const agentContract = fileExists(contractPath) ? require(contractPath) : null;

    _maintainGlobalCursorRule(agentContract);
    _scaffoldProjectCursorRule(cwd, agentContract);

    const packagedRtk = path.join(KONOHA_DIR, 'rtk.mdc');
    if (fileExists(packagedRtk)) {
      const packaged = fs.readFileSync(packagedRtk);
      const installed = fileExists(CURSOR_RTK_RULE) ? fs.readFileSync(CURSOR_RTK_RULE) : null;
      if (!installed || !installed.equals(packaged)) fs.writeFileSync(CURSOR_RTK_RULE, packaged);
    }
  } catch {
    // fail-open
  }
  process.exit(0);
}

main();
