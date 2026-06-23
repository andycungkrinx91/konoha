/**
 * Claude Code & OpenCode MCP auto-setup — global config only (no project files).
 * Only configures when the respective CLI is detected on the device.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const deployUtils = require('./deploy_utils');

const HOME = os.homedir();
const SKILLS_DB_DIR = path.join(HOME, '.gemini', 'skills-db');
const SERVER_PATH = path.join(SKILLS_DB_DIR, 'server.py');
const FILE_TOOLS_MCP_PATH = path.join(SKILLS_DB_DIR, 'file_tools_mcp.js');

const CLAUDE_JSON = path.join(HOME, '.claude.json');
const OPENCODE_GLOBAL = path.join(HOME, '.config', 'opencode', 'opencode.json');

const KONOHA_MCP_NAMES = ['skills-db', 'semble', 'konoha-files'];

function fileExists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function ensureDir(d) {
  if (!fileExists(d)) {
    fs.mkdirSync(d, { recursive: true });
  }
}

function isCommandAvailable(cmd) {
  try {
    const probe = process.platform === 'win32' ? 'where' : 'which';
    const found = spawnSync(probe, [cmd], { encoding: 'utf-8', timeout: 5000 });
    if (found.status === 0 && (found.stdout || '').trim()) {
      return true;
    }
  } catch {}
  try {
    const version = spawnSync(cmd, ['--version'], {
      encoding: 'utf-8',
      timeout: 5000,
      shell: process.platform === 'win32'
    });
    return version.status === 0;
  } catch {
    return false;
  }
}

function isClaudeCodeInstalled() {
  return (
    isCommandAvailable('claude') ||
    fileExists(path.join(HOME, '.claude')) ||
    fileExists(CLAUDE_JSON)
  );
}

function isOpenCodeInstalled() {
  return (
    isCommandAvailable('opencode') ||
    fileExists(path.join(HOME, '.config', 'opencode'))
  );
}

function buildStdioMcpServers(options = {}) {
  const {
    pythonCmd = 'python3',
    serverPath = SERVER_PATH,
    uvxCmd = 'uvx',
    nodeCmd = process.execPath || 'node'
  } = options;

  const servers = {
    'skills-db': {
      type: 'stdio',
      command: pythonCmd,
      args: [serverPath]
    },
    semble: {
      type: 'stdio',
      command: uvxCmd,
      args: ['--from', 'semble[mcp]@latest', 'semble', '--content', 'all']
    }
  };

  if (fileExists(FILE_TOOLS_MCP_PATH)) {
    const entry = deployUtils.buildKonohaFilesMcpEntry('cursor');
    if (entry) {
      servers['konoha-files'] = entry;
    }
  }

  return servers;
}

function buildOpenCodeMcpEntries(options = {}) {
  const servers = buildStdioMcpServers(options);
  const mcp = {};
  for (const [name, entry] of Object.entries(servers)) {
    mcp[name] = {
      type: 'local',
      command: [entry.command, ...(entry.args || [])],
      enabled: true
    };
  }
  return mcp;
}

function mergeJsonFile(filePath, mutator, silent = true) {
  if (!fileExists(filePath)) {
    const config = {};
    const updated = mutator(config);
    if (updated) {
      ensureDir(path.dirname(filePath));
      fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n');
      if (!silent) {
        console.log(`✓ Created ${filePath}`);
      }
    }
    return updated;
  }

  try {
    const config = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const updated = mutator(config);
    if (updated) {
      fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n');
      if (!silent) {
        console.log(`✓ Updated ${filePath}`);
      }
    }
    return updated;
  } catch {
    if (!silent) {
      console.warn(`Skipped ${filePath}: invalid JSON (not overwritten)`);
    }
    return false;
  }
}

function mergeMcpServersBlock(existing, servers) {
  if (!existing) existing = {};
  let updated = false;
  for (const [name, entry] of Object.entries(servers)) {
    const prev = existing[name];
    if (
      !prev ||
      prev.command !== entry.command ||
      JSON.stringify(prev.args || []) !== JSON.stringify(entry.args || [])
    ) {
      existing[name] = entry;
      updated = true;
    }
  }
  return updated;
}

function mergeOpenCodeMcpBlock(existing, entries) {
  if (!existing) existing = {};
  let updated = false;
  for (const [name, entry] of Object.entries(entries)) {
    const prev = existing[name];
    const prevCmd = JSON.stringify(prev?.command || []);
    const nextCmd = JSON.stringify(entry.command || []);
    if (!prev || prev.type !== entry.type || prevCmd !== nextCmd || prev.enabled !== entry.enabled) {
      existing[name] = entry;
      updated = true;
    }
  }
  return updated;
}

function registerClaudeCodeGlobalMcp(pythonCmd, serverPath, uvxCmd, silent = true) {
  if (!fileExists(serverPath)) return false;
  const servers = buildStdioMcpServers({ pythonCmd, serverPath, uvxCmd });
  return mergeJsonFile(
    CLAUDE_JSON,
    (config) => {
      if (!config.mcpServers) config.mcpServers = {};
      return mergeMcpServersBlock(config.mcpServers, servers);
    },
    silent
  );
}

function registerOpenCodeGlobalMcp(pythonCmd, serverPath, uvxCmd, silent = true) {
  if (!fileExists(serverPath)) return false;
  const entries = buildOpenCodeMcpEntries({ pythonCmd, serverPath, uvxCmd });
  return mergeJsonFile(
    OPENCODE_GLOBAL,
    (config) => {
      if (!config.$schema) {
        config.$schema = 'https://opencode.ai/config.json';
      }
      if (!config.mcp) config.mcp = {};
      return mergeOpenCodeMcpBlock(config.mcp, entries);
    },
    silent
  );
}

function ensureClaudeCodeSetup(options = {}) {
  const {
    pythonCmd = 'python3',
    serverPath = SERVER_PATH,
    uvxCmd = 'uvx',
    silent = true
  } = options;

  if (!isClaudeCodeInstalled()) {
    return { ok: false, reason: 'claude CLI not detected' };
  }

  deployUtils.installFileTools(silent);

  if (!fileExists(serverPath)) {
    return { ok: false, reason: 'skills-db server not installed' };
  }

  registerClaudeCodeGlobalMcp(pythonCmd, serverPath, uvxCmd, silent);
  return { ok: true };
}

function ensureOpenCodeSetup(options = {}) {
  const {
    pythonCmd = 'python3',
    serverPath = SERVER_PATH,
    uvxCmd = 'uvx',
    silent = true
  } = options;

  if (!isOpenCodeInstalled()) {
    return { ok: false, reason: 'opencode CLI not detected' };
  }

  deployUtils.installFileTools(silent);

  if (!fileExists(serverPath)) {
    return { ok: false, reason: 'skills-db server not installed' };
  }

  registerOpenCodeGlobalMcp(pythonCmd, serverPath, uvxCmd, silent);
  return { ok: true };
}

function readMcpHealth(config, key = 'mcpServers') {
  const block = config[key] || config.mcp || {};
  return {
    skillsDb: !!block['skills-db'],
    semble: !!block.semble,
    konohaFiles: !!block['konoha-files']
  };
}

function getClaudeCodeStatus() {
  const status = {
    installed: isClaudeCodeInstalled(),
    globalConfig: fileExists(CLAUDE_JSON),
    mcpSkillsDb: false,
    mcpSemble: false,
    mcpKonohaFiles: false
  };

  if (status.globalConfig) {
    try {
      const config = JSON.parse(fs.readFileSync(CLAUDE_JSON, 'utf-8'));
      const health = readMcpHealth(config, 'mcpServers');
      status.mcpSkillsDb = health.skillsDb;
      status.mcpSemble = health.semble;
      status.mcpKonohaFiles = health.konohaFiles;
    } catch {}
  }

  return status;
}

function getOpenCodeStatus() {
  const status = {
    installed: isOpenCodeInstalled(),
    globalConfig: fileExists(OPENCODE_GLOBAL),
    mcpSkillsDb: false,
    mcpSemble: false,
    mcpKonohaFiles: false
  };

  if (status.globalConfig) {
    try {
      const config = JSON.parse(fs.readFileSync(OPENCODE_GLOBAL, 'utf-8'));
      const health = readMcpHealth(config, 'mcp');
      status.mcpSkillsDb = health.skillsDb;
      status.mcpSemble = health.semble;
      status.mcpKonohaFiles = health.konohaFiles;
    } catch {}
  }

  return status;
}

function removeKonohaFromMcpBlock(block) {
  if (!block) return false;
  let updated = false;
  for (const name of KONOHA_MCP_NAMES) {
    if (block[name]) {
      delete block[name];
      updated = true;
    }
  }
  return updated;
}

function removeClaudeCodeConfig(silent = true) {
  if (fileExists(CLAUDE_JSON)) {
    try {
      mergeJsonFile(
        CLAUDE_JSON,
        (config) => removeKonohaFromMcpBlock(config.mcpServers),
        silent
      );
    } catch {}
  }
}

function removeOpenCodeConfig(silent = true) {
  if (fileExists(OPENCODE_GLOBAL)) {
    try {
      mergeJsonFile(
        OPENCODE_GLOBAL,
        (config) => removeKonohaFromMcpBlock(config.mcp),
        silent
      );
    } catch {}
  }
}

module.exports = {
  CLAUDE_JSON,
  OPENCODE_GLOBAL,
  KONOHA_MCP_NAMES,
  isClaudeCodeInstalled,
  isOpenCodeInstalled,
  buildStdioMcpServers,
  buildOpenCodeMcpEntries,
  registerClaudeCodeGlobalMcp,
  registerOpenCodeGlobalMcp,
  ensureClaudeCodeSetup,
  ensureOpenCodeSetup,
  getClaudeCodeStatus,
  getOpenCodeStatus,
  removeClaudeCodeConfig,
  removeOpenCodeConfig
};
