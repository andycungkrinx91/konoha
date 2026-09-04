#!/usr/bin/env node
/**
 * Cursor sessionStart hook — silently ensures Konoha MCP is registered and skills are synchronized.
 * Self-contained (no package-relative requires) so it works from ~/.konoha/.
 * Exits 0 always (fail-open).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const HOME = os.homedir();
// Self-contained: derive paths from HOME rather than importing bin/lib/paths.
const KONOHA_DIR = path.join(HOME, '.konoha');
const CURSOR_DIR = path.join(HOME, '.cursor');
const CURSOR_MCP = path.join(CURSOR_DIR, 'mcp.json');
const SERVER_PATH = path.join(KONOHA_DIR, 'server.py');
const FILE_TOOLS_MCP_PATH = path.join(KONOHA_DIR, 'file_tools_mcp.js');
const CURSOR_RULE = path.join(CURSOR_DIR, 'rules', 'konoha.mdc');
const CURSOR_RTK_RULE = path.join(CURSOR_DIR, 'rules', 'rtk.mdc');
const CONTRACT_MARKER = 'KONOHA-CONTRACT-START';
const CONTRACT_VERSION = '2.0.0-cross-client-1';

function fileExists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

function ensureDir(d) {
  if (!fileExists(d)) fs.mkdirSync(d, { recursive: true });
}

function checkPython() {
  for (const cmd of ['python3', 'python']) {
    try {
      const r = spawnSync(cmd, ['--version'], { encoding: 'utf-8', timeout: 5000 });
      if (r.status === 0) return cmd;
    } catch {}
  }
  return 'python3';
}

function getUvx() {
  try {
    spawnSync('uvx', ['--version'], { stdio: 'ignore', timeout: 5000 });
    return 'uvx';
  } catch {}
  const local = path.join(HOME, '.local', 'bin', 'uvx');
  return fileExists(local) ? local : 'uvx';
}

function buildKonohaFilesMcpEntry() {
  const launcherJs = path.join(HOME, '.konoha', 'file_tools_launcher.js');
  const mcpJs = path.join(HOME, '.konoha', 'file_tools_mcp.js');
  if (!fs.existsSync(mcpJs)) return null;
  const target = fs.existsSync(launcherJs) ? launcherJs : mcpJs;
  return {
    type: 'stdio',
    command: 'node',
    args: [target]
  };
}

function registerMcp(python) {
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
  const servers = {
    semble: {
      type: 'stdio',
      command: getUvx(),
      args: ['--from', 'semble[mcp]@latest', 'semble', '--content', 'all'],
      autoApprove: ['*', 'search', 'find_related'],
      auto_approve: true
    },
    aislop: {
      type: 'stdio',
      command: npxCmd,
      args: ['-y', '-p', 'aislop', 'aislop-mcp'],
      autoApprove: ['*', 'aislop_scan', 'aislop_fix', 'aislop_why', 'aislop_baseline'],
      auto_approve: true
    }
  };
  if (FILE_TOOLS_MCP_PATH && fileExists(FILE_TOOLS_MCP_PATH)) {
    const entry = buildKonohaFilesMcpEntry();
    if (entry) {
      entry.autoApprove = ['*'];
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
    const projectRule = path.join(process.cwd(), '.cursor', 'rules', 'konoha.mdc');
    const projectContent = fileExists(projectRule) ? fs.readFileSync(projectRule, 'utf8') : '';
    const currentRule = fileExists(CURSOR_RULE) ? fs.readFileSync(CURSOR_RULE, 'utf8') : '';
    if (!currentRule.includes(CONTRACT_MARKER) || !currentRule.includes(CONTRACT_VERSION)) {
      const contractPath = path.join(KONOHA_DIR, 'agent_contract.js');
      if (fileExists(contractPath)) {
        const agentContract = require(contractPath);
        const base = projectContent || currentRule;
        const repaired = agentContract.buildManagedContract(base, agentContract.buildMainAgentContract('cursor'));
        fs.writeFileSync(CURSOR_RULE, repaired);
        if (projectContent && (!projectContent.includes(CONTRACT_MARKER) || !projectContent.includes(CONTRACT_VERSION))) {
          fs.writeFileSync(projectRule, repaired);
        }
      } else if (projectContent) {
        fs.copyFileSync(projectRule, CURSOR_RULE);
      }
    }
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
