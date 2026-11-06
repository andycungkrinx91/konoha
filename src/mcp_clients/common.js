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
      windowsHide: true
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
    const whichCmd = isWin ? 'where.exe' : 'which';
    const whichRes = spawnSync(whichCmd, ['aislop-mcp'], { encoding: 'utf-8', timeout: 3000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
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
  const resolvedUvx = uvxCmd || (isWin ? 'uvx.exe' : 'uvx');

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
  // buildKonohaFilesMcpEntry falls back to the repo copy when the deployed
  // runtime is absent (standalone setup before `konoha init`), so the konoha
  // entry is never silently dropped. Real init installs file_tools first.
  {
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

/**
 * Grants tools to subagents with parity to the parent runtime. Tool grants decide
 * which tools may be invoked; prohibited actions are enforced by the contract.
 */

const MAIN_AGENT_BUILTIN_TOOLS = Object.freeze([
  'Read',
  'Write',
  'Edit',
  'Grep',
  'Glob',
  'Bash',
  'WebSearch',
  'TodoRead',
  'TodoWrite',
  'Task'
]);

const SUBAGENT_SAFE_MCP_GRANTS = Object.freeze({
  semble: ['search', 'find_related'],
  aislop: ['aislop_scan', 'aislop_fix', 'aislop_why', 'aislop_baseline']
});

function getKonohaMappedTools(client) {
  if (client === 'claude') {
    // adaptInstructionsForClaudeCode rewrites native Read/Write/Edit/Bash.
    return ['Read', 'Write', 'Edit', 'Bash'];
  }
  if (client === 'gemini') {
    // Gemini CLI consumes Antigravity-style tool names.
    return ['run_command', 'write_to_file', 'replace_file_content', 'view_file'];
  }
  return [];
}

/**
 * The single source of truth for "which tools does an agent get".
 * The main agent and every subagent definition are both derived from it, so
 * parity holds by construction rather than by two hand-maintained lists.
 */
function buildSubagentToolGrants(client = 'generic') {
  const konoha = (deployUtils.KONOHA_CANONICAL_TOOLS || []).map(t => `mcp__konoha__${t}`);
  const semble = SUBAGENT_SAFE_MCP_GRANTS.semble.map(t => `mcp__semble__${t}`);
  const aislop = SUBAGENT_SAFE_MCP_GRANTS.aislop.map(t => `mcp__aislop__${t}`);
  const native = getKonohaMappedTools(client);
  return [
    ...konoha,
    ...semble,
    ...aislop,
    ...MAIN_AGENT_BUILTIN_TOOLS,
    ...native.filter(t => !MAIN_AGENT_BUILTIN_TOOLS.includes(t))
  ];
}

function isWildcardGrant(grant) {
  if (typeof grant !== 'string') return true;
  const g = grant.trim();
  if (g === '' || g === '*') return true;
  // `mcp__konoha__*` style prefixes, `*`, `Bash(*)`, `command(*)`, `mcp(*)`
  return g.endsWith('*') || g.includes('(*)') || /^[A-Za-z_]+\s*\(\s*\*\s*\)$/.test(g);
}

/** Throws if any grant would widen approval to a wildcard. */
function assertNoWildcardGrants(grants, label = 'grants') {
  const offenders = (grants || []).filter(isWildcardGrant);
  if (offenders.length > 0) {
    throw new Error(`${label} contains wildcard approval grant(s): ${offenders.join(', ')}`);
  }
  return true;
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
  MAIN_AGENT_BUILTIN_TOOLS,
  SUBAGENT_SAFE_MCP_GRANTS,
  getKonohaMappedTools,
  buildSubagentToolGrants,
  isWildcardGrant,
  assertNoWildcardGrants,
  readMcpHealth,
  removeKonohaFromMcpBlock
};
