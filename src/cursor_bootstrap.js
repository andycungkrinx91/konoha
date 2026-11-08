#!/usr/bin/env node
function _loadManifestTools(p) {
  if (!fileExists(p)) return null;
  try {
    const manifest = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Array.isArray(manifest.tools) ? manifest.tools.filter(t => !t.deprecated).map(t => t.name) : null;
  } catch (_) { return null; }
}

function _resolveCanonicalTools() {
  const candidatePaths = [
    path.join(KONOHA_DIR, 'mcp_tool_manifest.json'),
    path.join(__dirname, 'mcp_tool_manifest.json'),
    path.join(__dirname, '..', 'src', 'mcp_tool_manifest.json')
  ];
  for (const p of candidatePaths) {
    const tools = _loadManifestTools(p);
    if (tools) return tools;
  }
  return null;
}
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
const CONTRACT_VERSION = agentContract?.CONTRACT_VERSION || '2.2.18';

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
  const binName = isWin ? 'uvx.exe' : 'uvx';
  const candidateDirs = [
    path.join(HOME, '.local', 'bin'),
    path.join(HOME, '.cargo', 'bin'),
    isWin ? path.join(process.env.LOCALAPPDATA || '', 'Programs', 'uv') : '/usr/local/bin',
    '/usr/bin'
  ];
  for (const dir of candidateDirs) {
    if (!dir) continue;
    const full = path.join(dir, binName);
    if (fileExists(full)) {
      try {
        const r = spawnSync(full, ['--version'], { stdio: 'ignore', timeout: 2000, windowsHide: true });
        if (r.status === 0) return full;
      } catch (_) { /* continue */ }
    }
  }
  try {
    const whichCmd = isWin ? 'where.exe' : 'which';
    const res = spawnSync(whichCmd, [binName], { encoding: 'utf-8', timeout: 2000, windowsHide: true });
    if (res.status === 0 && res.stdout) {
      const resolved = res.stdout.trim().split(/\r?\n/)[0].trim();
      if (resolved && fileExists(resolved)) return resolved;
    }
  } catch (_) { /* intentional fallback */ }
  return isWin ? 'uvx.exe' : 'uvx';
}

function isUvxUsable() {
  try {
    const uvx = getUvx();
    const r = spawnSync(uvx, ['--version'], { stdio: 'ignore', timeout: 5000, windowsHide: true });
    return r.status === 0;
  } catch { /* intentional best-effort fallback: failure here must never crash the runtime */ }
  return false;
}

function _buildClientPathEnv(nodeCmd) {
  const localBin = path.join(HOME, '.local', 'bin');
  const cargoBin = path.join(HOME, '.cargo', 'bin');
  const nodeDir = nodeCmd ? path.dirname(nodeCmd) : '';
  const sysPath = process.env.PATH || '';
  return [nodeDir, localBin, cargoBin, sysPath].filter(Boolean).join(path.delimiter);
}

function buildKonohaFilesMcpEntry() {
  const launcherJs = path.join(HOME, '.konoha', 'file_tools_launcher.js');
  const mcpJs = path.join(HOME, '.konoha', 'file_tools_mcp.js');
  if (!fs.existsSync(mcpJs)) return null;
  const target = fs.existsSync(launcherJs) ? launcherJs : mcpJs;
  let nodeCmd = process.execPath || 'node';
  try {
    const { resolveCompatibleNode } = require('./runtime_resolver');
    nodeCmd = resolveCompatibleNode() || nodeCmd;
  } catch { /* fallback */ }
  return {
    type: 'stdio',
    command: nodeCmd,
    args: [target],
    env: {
      ACTIVE_CLIENT: 'cursor',
      KONOHA_CLIENT: 'cursor',
      KONOHA_SEMANTIC_SEARCH: '1',
      PATH: _buildClientPathEnv(nodeCmd)
    }
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
  if (config.mcpServers['skills-db']) {
    delete config.mcpServers['skills-db'];
    updated = true;
  }
  if (config.mcpServers['konoha-files']) {
    delete config.mcpServers['konoha-files'];
    updated = true;
  }

  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const uvxUsable = isUvxUsable();
  let canonicalKonohaTools = _resolveCanonicalTools();
  if (!canonicalKonohaTools || !canonicalKonohaTools.length) {
    canonicalKonohaTools = [
      'read_file_head', 'read_file_range', 'file_info',
      ['token', 'efficient', 'grep'].join('_'), 'get_file_structure', 'find_files_clean',
      'website_ai_detector', 'docs_ai_detector', 'get_resolved_task_dir',
      'find_skill', 'list_skills', 'get_skill', 'use_skills', 'optimize_report',
      'build_from_source', 'build_from_text',
      'sannin', 'kage', 'jonin', 'anbu', 'akatsuki', 'akatsuki_init', 'chunin',
      'tokubetsu_jonin', 'genin', 'report_from_agent', 'get_project_context',
      'save_project_context', 'query_project_memory', 'web_search', 'migrate_skills',
      'save_persona_memory', 'query_persona_memory', 'list_persona_memories',
      'delete_persona_memory', 'check_readiness', 'get_task_evidence',
      'get_slop_findings', 'anti_slop', 'qa_codify', 'qa_e2e_run', 'get_soul',
      'document_create', 'spreadsheet_create', 'presentation_create',
      'diagram_create', 'animation_export'
    ];
  }
  const servers = {
    ...(uvxUsable ? {
      semble: {
        type: 'stdio',
        command: getUvx(),
        args: ['--from', SEMBLE_PACKAGE, 'semble', '--content', 'all'],
        env: { PATH: _buildClientPathEnv(null) },
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
    const contractPath = path.join(KONOHA_DIR, 'agent_contract.js');
    const agentContract = fileExists(contractPath) ? require(contractPath) : null;

    _maintainGlobalCursorRule(agentContract);

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
