'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { SEMBLE_PACKAGE, AISLOP_PACKAGE } = require('../semble_manager');
const deployUtils = require('../deploy_utils');
const {
  fileExists,
  fileExistsCached,
  ensureDir,
  isCommandAvailable,
  getRtkCommand
} = require('../platform_utils');
const {
  SERVER_PATH, FILE_TOOLS_MCP_PATH,
  CLAUDE_JSON, CLAUDE_SETTINGS, COMMANDCODE_JSON, HOME
} = require('../../bin/lib/paths');

const KONOHA_MCP_NAMES = ['konoha', 'semble', 'aislop'];

function isClaudeCodeInstalled() {
  return (
    isCommandAvailable('claude') ||
    fileExistsCached(path.join(HOME, '.claude')) ||
    fileExistsCached(CLAUDE_JSON)
  );
}

function isCommandCodeInstalled() {
  return (
    isCommandAvailable('commandcode') ||
    fileExistsCached(path.join(HOME, '.commandcode')) ||
    fileExistsCached(COMMANDCODE_JSON)
  );
}

function validateAgentName(name, targetDir) {
  if (typeof name !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(name)) return false;
  const target = path.resolve(targetDir, `${name}.md`);
  const parent = path.resolve(targetDir);
  return target.startsWith(parent + path.sep);
}

function resolveRtkRuleTemplate() {
  const candidates = [
    path.join(__dirname, '..', 'templates', 'rules', 'rtk.md'),
    path.join(__dirname, '..', 'templates', 'rules', 'rtk-rules.md'),
    path.join(__dirname, '..', '..', 'src', 'templates', 'rules', 'rtk.md'),
    path.join(HOME, '.claude', 'rules', 'rtk.md'),
    path.join(HOME, '.agents', 'rules', 'rtk-rules.md')
  ];
  return candidates.find((p) => fileExists(p)) || null;
}

function initRtkHook(silent = true) {
  const rtkCmd = getRtkCommand();
  if (!rtkCmd) {
    return { ok: false, reason: 'rtk-not-installed' };
  }
  try {
    const res = spawnSync(rtkCmd, ['init', '-g', '--agent', 'claude', '--auto-patch', '--trust-filters'], {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: silent ? 'ignore' : 'inherit',
      shell: process.platform === 'win32'
    });
    if (res.status === 0) {
      if (!silent) process.stderr.write('  ✓ RTK hook initialized globally for Claude Code\n');
      return { ok: true };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'rtk-init-failed', error: e.message };
  }
}

function resolveAislopMcpConfig() {
  const isWin = process.platform === 'win32';
  try {
    const whichCmd = isWin ? 'where' : 'which';
    const whichRes = spawnSync(whichCmd, ['aislop-mcp'], { encoding: 'utf-8', shell: isWin, timeout: 3000 });
    if (whichRes.status === 0 && whichRes.stdout.trim()) {
      const binPath = whichRes.stdout.trim().split('\n')[0].trim();
      if (binPath && fileExists(binPath)) {
        return {
          type: 'stdio',
          command: binPath,
          args: [],
          autoApprove: ['aislop_scan', 'aislop_fix', 'aislop_why', 'aislop_baseline'],
          auto_approve: true
        };
      }
    }
  } catch { /* intentional best-effort fallback */ }
  return {
    type: 'stdio',
    command: isWin ? 'npx.cmd' : 'npx',
    args: ['-y', '--prefer-offline', '-p', AISLOP_PACKAGE, 'aislop-mcp'],
    autoApprove: ['aislop_scan', 'aislop_fix', 'aislop_why', 'aislop_baseline'],
    auto_approve: true
  };
}

function buildStdioMcpServers(options = {}) {
  const {
    uvxCmd = 'uvx',
    client = 'cursor'
  } = options;

  const isWin = process.platform === 'win32';
  const resolvedUvx = uvxCmd || (isWin ? 'uvx.cmd' : 'uvx');

  const servers = {
    semble: {
      type: 'stdio',
      command: resolvedUvx,
      args: ['--from', SEMBLE_PACKAGE, 'semble', '--content', 'all'],
      autoApprove: ['search', 'find_related'],
      auto_approve: true
    },
    aislop: resolveAislopMcpConfig()
  };
  if (fileExists(FILE_TOOLS_MCP_PATH)) {
    const entry = deployUtils.buildKonohaFilesMcpEntry(client);
    if (entry) {
      entry.autoApprove = deployUtils.KONOHA_CANONICAL_TOOLS
        ? [...deployUtils.KONOHA_CANONICAL_TOOLS]
        : [];
      entry.auto_approve = true;
      servers['konoha'] = entry;
    }
  }

  return servers;
}

function mergeJsonFile(filePath, mutator, silent = true) {
  const { parseYaml, stringifyYaml } = require('../agent_manager');
  if (!fileExists(filePath)) {
    const isJson = filePath.endsWith('.json');
    const config = {};
    const updated = mutator(config);
    if (updated) {
      ensureDir(path.dirname(filePath));
      fs.writeFileSync(filePath, isJson ? JSON.stringify(config, null, 2) + '\n' : stringifyYaml(config) + '\n');
      if (!silent) {
        process.stderr.write(`✓ Created ${filePath}\n`);
      }
    }
    return updated;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const isJson = filePath.endsWith('.json');
    const config = isJson ? JSON.parse(content) : parseYaml(content);
    const updated = mutator(config);
    if (updated) {
      ensureDir(path.dirname(filePath));
      fs.writeFileSync(filePath, isJson ? JSON.stringify(config, null, 2) + '\n' : stringifyYaml(config) + '\n');
      if (!silent) {
        process.stderr.write(`✓ Updated ${filePath}\n`);
      }
    }
    return updated;
  } catch (error) {
    if (!silent) {
      console.warn(`Failed to update ${filePath}: ${error.message}`);
    }
    return false;
  }
}

function mergeMcpServersBlock(target, incoming) {
  if (!target || typeof target !== 'object' || Array.isArray(target)) return;
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return;
  for (const [name, def] of Object.entries(incoming)) {
    target[name] = def;
  }
}

function backupFile(filePath, silent = true) {
  const backPath = filePath + '.back';
  if (fileExists(filePath) && !fileExists(backPath)) {
    fs.copyFileSync(filePath, backPath);
    if (!silent) process.stderr.write(`  ✓ Backed up ${path.basename(filePath)} → ${path.basename(backPath)}\n`);
  }
}

function buildClientToolGrants(prefix) {
  const tools = deployUtils.KONOHA_CANONICAL_TOOLS || [];
  const sep = prefix === 'mcp__' ? '__' : ':';
  const konohaGrants = tools.map(t => `${prefix}konoha${sep}${t}`);
  const sembleGrants = ['search', 'find_related'].map(t => `${prefix}semble${sep}${t}`);
  const aislopGrants = ['aislop_scan', 'aislop_fix', 'aislop_why', 'aislop_baseline'].map(t => `${prefix}aislop${sep}${t}`);
  return [...konohaGrants, ...sembleGrants, ...aislopGrants];
}

function buildBareToolGrants() {
  const tools = deployUtils.KONOHA_CANONICAL_TOOLS || [];
  return [...tools, 'search', 'find_related', 'aislop_scan', 'aislop_fix', 'aislop_why', 'aislop_baseline'];
}

function readMcpHealth(config, key = 'mcpServers') {
  const block = config[key] || config.mcp || {};
  return {
    konoha: !!block['konoha'],
    semble: !!block.semble,
    aislop: !!block.aislop,
    skillsDb: !!block['konoha']
  };
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

module.exports = {
  KONOHA_MCP_NAMES,
  SERVER_PATH,
  FILE_TOOLS_MCP_PATH,
  CLAUDE_JSON,
  CLAUDE_SETTINGS,
  COMMANDCODE_JSON,
  HOME,
  isClaudeCodeInstalled,
  isCommandCodeInstalled,
  validateAgentName,
  resolveRtkRuleTemplate,
  initRtkHook,
  resolveAislopMcpConfig,
  buildStdioMcpServers,
  mergeJsonFile,
  mergeMcpServersBlock,
  backupFile,
  buildClientToolGrants,
  buildBareToolGrants,
  readMcpHealth,
  removeKonohaFromMcpBlock
};
