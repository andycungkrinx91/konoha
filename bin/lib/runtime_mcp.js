'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const {
  HOME,
  SKILLS_DB_DIR,
  MCP_CONFIG_PATH,
  FILE_TOOLS_MCP_PATH,
  SETTINGS_PATH
} = require('./paths');
const { fileExists, ensureDir, checkPython } = require('./prompt');
const { info, warn, success } = require('./format');
const { installUv, getUvCommand } = require('./extension');
const deployUtils = require('../../src/deploy_utils');
const antigravityManager = require('../../src/antigravity_manager');
const { SEMBLE_PACKAGE, AISLOP_PACKAGE } = require('../../src/semble_manager');

function ensureCoreDirectories() {
  const dirs = [
    path.join(HOME, '.gemini'),
    path.join(HOME, '.agents'),
    SKILLS_DB_DIR,
    path.join(HOME, '.gemini', 'antigravity-cli'),
    path.join(HOME, '.gemini', 'config')
  ];
  dirs.forEach(d => {
    if (!fileExists(d)) {
      ensureDir(d);
    }
  });
}

function cleanSingleTempDir(d, activeScript, activeCwd) {
  const dLower = d.toLowerCase();
  if (activeScript.startsWith(dLower) || activeCwd.startsWith(dLower)) return;
  if (fileExists(d)) {
    try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 3 }); } catch { /* best-effort */ }
  }
}

function getTempDirs(isWin) {
  if (isWin) {
    const tempDirs = [];
    if (process.env.LOCALAPPDATA) {
      tempDirs.push(
        path.join(process.env.LOCALAPPDATA, 'pnpm', 'store', 'v3', 'tmp'),
        path.join(process.env.LOCALAPPDATA, 'pnpm', 'store', 'v10', 'tmp'),
        path.join(process.env.LOCALAPPDATA, 'pnpm', 'store', 'v11', 'tmp'),
        path.join(process.env.LOCALAPPDATA, 'pnpm-cache')
      );
    }
    if (process.env.TEMP) {
      tempDirs.push(path.join(process.env.TEMP, 'pnpm'), path.join(process.env.TEMP, 'npm-cache'));
    }
    return tempDirs;
  }
  return [
    path.join(os.homedir(), '.cache', 'pnpm'),
    path.join(os.homedir(), '.local', 'share', 'pnpm', 'store', 'v3', 'tmp'),
    path.join(os.homedir(), '.local', 'share', 'pnpm', 'store', 'v10', 'tmp'),
    path.join(os.homedir(), '.local', 'share', 'pnpm', 'store', 'v11', 'tmp'),
    path.join(os.homedir(), 'Library', 'Caches', 'pnpm'),
    path.join(os.homedir(), 'Library', 'pnpm', 'store', 'v11', 'tmp')
  ];
}

function purgePackageCaches({ _ = false } = {}) {
  const isWin = process.platform === 'win32';
  const { env: childEnv } = deployUtils.resolveCompatibleNodeEnv(process.env);
  const spawnOpts = { stdio: 'ignore', timeout: 15000, env: childEnv, windowsHide: true };
  if (isWin) spawnOpts.shell = true;

  try {
    const pnpmCmd = isWin ? 'pnpm.cmd' : 'pnpm';
    spawnSync(pnpmCmd, ['store', 'prune'], spawnOpts);
  } catch { /* best-effort */ }

  try {
    const npmCmd = isWin ? 'npm.cmd' : 'npm';
    spawnSync(npmCmd, ['cache', 'clean', '--force'], spawnOpts);
  } catch { /* best-effort */ }

  try {
    const yarnCmd = isWin ? 'yarn.cmd' : 'yarn';
    spawnSync(yarnCmd, ['cache', 'clean', '--all'], spawnOpts);
  } catch { /* best-effort */ }

  try {
    const tempDirs = getTempDirs(isWin);
    const activeScript = (process.argv[1] || '').toLowerCase();
    const activeCwd = process.cwd().toLowerCase();
    for (const d of tempDirs) {
      cleanSingleTempDir(d, activeScript, activeCwd);
    }
  } catch { /* best-effort */ }
}

function registerMcp(_python, silent = false, allowAutoApprove = true) {
  ensureDir(path.dirname(MCP_CONFIG_PATH));

  const backupPath = MCP_CONFIG_PATH + '.back';
  if (fileExists(MCP_CONFIG_PATH) && !fileExists(backupPath)) {
    fs.copyFileSync(MCP_CONFIG_PATH, backupPath);
    if (!silent) info(`Backed up existing config → ${path.basename(backupPath)}`);
  }

  let config = { mcpServers: {} };
  if (fileExists(MCP_CONFIG_PATH)) {
    try {
      config = JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, 'utf-8'));
      if (!config.mcpServers) config.mcpServers = {};
    } catch {
      if (!silent) warn(`Invalid JSON in ${MCP_CONFIG_PATH}, starting fresh.`);
      config = { mcpServers: {} };
    }
  } else {
    if (!silent) info('Creating new MCP config...');
  }

  let uvCmd = getUvCommand();
  if (!uvCmd) {
    if (installUv(silent)) {
      uvCmd = getUvCommand() || 'uv';
    } else {
      uvCmd = 'uv';
    }
  }

  let uvxCmd = 'uvx';
  if (uvCmd !== 'uv') {
    const companionUvx = path.join(path.dirname(uvCmd), process.platform === 'win32' ? 'uvx.exe' : 'uvx');
    if (fileExists(companionUvx)) {
      uvxCmd = companionUvx;
    }
  }

  const sembleConfig = {
    command: uvxCmd,
    args: ['--from', SEMBLE_PACKAGE, 'semble', '--content', 'all']
  };
  if (allowAutoApprove) {
    sembleConfig.autoApprove = ['search', 'find_related'];
  }

  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const aislopConfig = {
    command: npxCmd,
    args: ['-y', '-p', AISLOP_PACKAGE, 'aislop-mcp']
  };
  if (allowAutoApprove) {
    aislopConfig.autoApprove = ['aislop_scan', 'aislop_fix', 'aislop_why', 'aislop_baseline'];
  }

  const konohaConfig = deployUtils.buildKonohaFilesMcpEntry('execPath');
  if (konohaConfig && allowAutoApprove) {
    konohaConfig.autoApprove = deployUtils.KONOHA_CANONICAL_TOOLS
      ? [...deployUtils.KONOHA_CANONICAL_TOOLS]
      : [];
  }

  config.mcpServers['semble'] = sembleConfig;
  config.mcpServers['aislop'] = aislopConfig;
  if (konohaConfig) config.mcpServers['konoha'] = konohaConfig;
  delete config.mcpServers['skills-db'];
  delete config.mcpServers['konoha-files'];

  if (!silent) {
    success(`Registered 'semble', 'konoha', and 'aislop' MCP servers.`);
  }

  fs.writeFileSync(MCP_CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
  if (!silent) {
    success(`Merged Konoha servers into: ${MCP_CONFIG_PATH}`);
  }

  if (allowAutoApprove) {
    registerPermissions(silent);
  }
}

function registerPermissions(silent = false) {
  antigravityManager.ensureAntigravityPermissions(silent);
}

function unregisterSettingsFile(settingsPath, requiredGrants, silent) {
  if (!fileExists(settingsPath)) return;
  let settings = {};
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  } catch {
    return;
  }

  const allowArr = Array.isArray(settings.permissions?.allow) ? settings.permissions.allow : [];
  if (allowArr.length === 0) return;

  const initialLength = allowArr.length;
  const filtered = allowArr.filter(grant => !requiredGrants.includes(grant));

  if (filtered.length !== initialLength) {
    settings.permissions.allow = filtered;
    try {
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
      if (!silent) success(`Removed command permissions from: ${settingsPath}`);
    } catch (e) {
      if (!silent) warn(`Could not update settings.json: ${e.message}`);
    }
  }
}

function unregisterPermissions(silent = false) {
  const settingsPaths = [
    SETTINGS_PATH,
    path.join(HOME, '.gemini', 'settings.json')
  ];

  const requiredGrants = [
    'command(node bin/cli.js)',
    'command(konoha)',
    'command(node "' + path.join(SKILLS_DB_DIR, 'prompt_hook.js') + '")',
    'mcp(semble/search)',
    'mcp(semble/find_related)',
    'mcp(semble/*)',
    'mcp(konoha-files/read_file_head)',
    'mcp(konoha-files/read_file_range)',
    'mcp(konoha-files/file_info)',
    'mcp(konoha-files/token_efficient_grep)',
    'mcp(konoha-files/get_file_structure)',
    'mcp(konoha-files/find_files_clean)',
    'mcp(konoha-files/*)',
    'mcp(konoha/find_skill)',
    'mcp(konoha/list_skills)',
    'mcp(konoha/get_skill)',
    'mcp(konoha/optimize_report)',
    'mcp(konoha/*)',
    'mcp(konoha/read_file_head)',
    'mcp(konoha/read_file_range)',
    'mcp(konoha/file_info)',
    'mcp(konoha/token_efficient_grep)',
    'mcp(konoha/get_file_structure)',
    'mcp(konoha/find_files_clean)',
    'mcp(konoha/find_skill)',
    'mcp(konoha/list_skills)',
    'mcp(konoha/get_skill)',
    'mcp(konoha/optimize_report)',
    'mcp(konoha/build_from_source)',
    'mcp(konoha/build_from_text)',
    'mcp(konoha/*)'
  ];

  for (const settingsPath of settingsPaths) {
    unregisterSettingsFile(settingsPath, requiredGrants, silent);
  }
}

function readHooksConfig(configPath) {
  if (!fileExists(configPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (_) {
    try {
      fs.copyFileSync(configPath, configPath + '.corrupt-' + Date.now());
      warn(`Existing hooks.json was invalid JSON — backed up to ${configPath}.corrupt-*`);
    } catch (_) { /* best-effort */ }
    return {};
  }
}

function quotePath(p) {
  if (typeof p !== 'string') return '""';
  const trimmed = p.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed;
  return `"${trimmed}"`;
}

function applyPromptAndSanitizeHooks(config) {
  const promptHookPath = path.join(SKILLS_DB_DIR, 'prompt_hook.js');
  const subagentHookPath = path.join(SKILLS_DB_DIR, 'antigravity_subagent_hook.js');
  const sanitizeHookPath = path.join(SKILLS_DB_DIR, 'antigravity_tool_sanitize_hook.js');

  const execPath = process.execPath;
  delete config['konoha-subagent-hook'];
  config['konoha-prompt-hook'] = {
    PreInvocation: [
      { type: 'command', command: `${quotePath(execPath)} ${quotePath(subagentHookPath)}` },
      { type: 'command', command: `${quotePath(execPath)} ${quotePath(promptHookPath)}` },
    ],
  };
  config['konoha-tool-sanitize'] = {
    PreToolUse: [
      {
        matcher: 'define_subagent|invoke_subagent',
        hooks: [{ type: 'command', command: `${quotePath(execPath)} ${quotePath(sanitizeHookPath)}`, timeout: 10 }],
      },
    ],
  };
}

function registerHooks(silent = false, allowHooks) {
  const HOOKS_CONFIG_PATH = path.join(HOME, '.gemini', 'config', 'hooks.json');
  ensureDir(path.dirname(HOOKS_CONFIG_PATH));

  const config = readHooksConfig(HOOKS_CONFIG_PATH);
  const hookExists = config['konoha-prompt-hook'] !== undefined;
  const sanitizeExists = config['konoha-tool-sanitize'] !== undefined;
  const legacySubagentHook = config['konoha-subagent-hook'] !== undefined;
  let shouldWrite = false;

  if (allowHooks === true || (allowHooks === undefined && hookExists)) {
    applyPromptAndSanitizeHooks(config);
    shouldWrite = true;
  } else if (allowHooks === false) {
    if (hookExists) { delete config['konoha-prompt-hook']; shouldWrite = true; }
    if (sanitizeExists) { delete config['konoha-tool-sanitize']; shouldWrite = true; }
    if (legacySubagentHook) { delete config['konoha-subagent-hook']; shouldWrite = true; }
  }

  if (!shouldWrite) return;
  try {
    fs.writeFileSync(HOOKS_CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
    if (!silent) {
      success(allowHooks === false ? `Removed prompt hook from: ${HOOKS_CONFIG_PATH}` : `Registered prompt hook in: ${HOOKS_CONFIG_PATH}`);
    }
  } catch (e) {
    if (!silent) warn(`Could not update hooks.json: ${e.message}`);
  }
}

function parseToolsFromSmokeStdout(stdout) {
  const lines = (stdout || '').trim().split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(lines[i]);
      if (Array.isArray(parsed.result?.tools)) return parsed.result.tools;
    } catch (_) { /* ignore */ }
  }
  return null;
}

function smokeTestKonohaFilesMcp(useLauncher = false) {
  if (!fileExists(FILE_TOOLS_MCP_PATH)) {
    return { ok: false, error: 'file_tools_mcp.js missing' };
  }

  const cleanEnv = Object.assign({}, process.env);
  for (const k of Object.keys(cleanEnv)) {
    if (k.toUpperCase() === 'KONOHA_DAEMON') delete cleanEnv[k];
  }

  const input = [
    JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'konoha-smoke', version: '2.2.1' } }
    }),
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    ''
  ].join('\n');

  let run;
  if (useLauncher) {
    const entry = deployUtils.buildKonohaFilesMcpEntry('execPath');
    if (entry) {
      run = spawnSync(entry.command, entry.args, {
        input, encoding: 'utf-8', timeout: 15000, env: cleanEnv, shell: process.platform === 'win32'
      });
    }
  }
  if (!run || run.status !== 0) {
    run = spawnSync(process.execPath, [FILE_TOOLS_MCP_PATH], {
      input, encoding: 'utf-8', timeout: 15000, env: cleanEnv
    });
  }

  if (run.status !== 0) {
    return { ok: false, error: (run.stderr || '').trim() || `exit code ${run.status}` };
  }

  const tools = parseToolsFromSmokeStdout(run.stdout);
  if (!Array.isArray(tools) || tools.length < 4) {
    return { ok: false, error: `tools/list returned ${tools ? tools.length : 0} tools` };
  }
  return { ok: true, toolCount: tools.length };
}

function installFileTools(silent = true) {
  const python = checkPython();
  const ok = deployUtils.installFileTools(silent, python);
  if (!silent && ok) {
    success(`File tools installed: ${FILE_TOOLS_MCP_PATH}`);
  }
  return ok;
}

module.exports = {
  ensureCoreDirectories,
  purgePackageCaches,
  registerMcp,
  registerPermissions,
  unregisterPermissions,
  registerHooks,
  smokeTestKonohaFilesMcp,
  installFileTools
};
