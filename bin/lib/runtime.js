'use strict';

/**
 * bin/lib/runtime.js — Konoha Core Runtime, MCP Registration & Auto-Setup Lifecycle.
 *
 * Provides:
 * - installCliRuntime: Self-contained installation into ~/.konoha/
 * - reconcileGlobalCommand: PATH shim maintenance (Linux, macOS, Windows)
 * - syncTemplateSkills & copySkillsDirFast: Non-destructive skill synchronization
 * - ensureAutoSetup: Fast-path (2ms) and full reconciliation on startup/upgrade
 * - MCP, Permissions, and Hooks configuration (Antigravity, Cursor, Claude, etc.)
 * - SQLite schema verification & database contract assertions
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const {
  HOME,
  SKILLS_DB_DIR,
  MCP_CONFIG_PATH,
  DB_PATH,
  SERVER_PATH,
  MIGRATE_PATH,
  MIGRATION_TIMEOUT_MS,
  FILE_TOOLS_MCP_PATH,
  SETTINGS_PATH,
  DEFAULT_SKILLS_DIRS,
  SRC_DIR
} = require('./paths');
const { fileExists, ensureDir, copyFile, checkPython } = require('./prompt');
const { info, warn, success, getCliVersion } = require('./format');
const { installUv, getUvCommand, getUvxCommand } = require('./extension');
const deployUtils = require('../../src/deploy_utils');
const agentManager = require('../../src/agent_manager');
const skillManager = require('../../src/skill_manager');
const antigravityManager = require('../../src/antigravity_manager');
const { SEMBLE_PACKAGE, AISLOP_PACKAGE } = require('../../src/semble_manager');

let currentCwd = HOME;
try {
  currentCwd = process.cwd();
} catch (_) {
  if (process.env.PWD) {
    try {
      if (fs.existsSync(process.env.PWD)) currentCwd = process.env.PWD;
    } catch (_) { /* intentional best-effort fallback */ }
  }
}

function hasCompleteDatabaseSchema(_ = null) {
  if (!fileExists(DB_PATH)) return false;
  try {
    const Database = require('../../src/sqlite_driver');
    const db = new Database(DB_PATH, { readonly: true });
    const required = ["skills", "skills_fts", "tool_calls", "active_sessions", "agents", "bridges"];
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    db.close();
    const actual = new Set(rows.map(r => r.name));
    for (const req of required) {
      if (!actual.has(req)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function detectSkillsDirs() {
  const found = [];
  for (const dir of DEFAULT_SKILLS_DIRS) {
    if (fileExists(dir)) {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        const skillCount = entries.filter(e =>
          (e.isDirectory() && fileExists(path.join(dir, e.name, 'SKILL.md'))) ||
          (e.isFile() && e.name.endsWith('-skill.md'))
        ).length;
        if (skillCount > 0) {
          found.push({ path: dir, count: skillCount });
        }
      } catch { /* intentional best-effort fallback */ }
    }
  }
  return found;
}

function detectCustomSkills(skillsDir) {
  try {
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    const skills = [];
    for (const e of entries) {
      if (e.isDirectory() && fileExists(path.join(skillsDir, e.name, 'SKILL.md'))) {
        skills.push(e.name);
      } else if (e.isFile() && e.name.endsWith('-skill.md')) {
        skills.push(e.name);
      }
    }
    return skills;
  } catch {
    return [];
  }
}

function hasCanonicalGeninSkill(skillsDir) {
  return fileExists(path.join(skillsDir, 'genin-skill', 'SKILL.md'));
}

function verifySkillDatabaseContract(python = null, requiredSkill = 'genin-skill') {
  if (!fileExists(DB_PATH)) {
    return { ok: false, reason: 'skills database is unavailable' };
  }
  try {
    const Database = require('../../src/sqlite_driver');
    const db = new Database(DB_PATH, { readonly: true });
    const hasRequired = !!db.prepare("SELECT 1 FROM skills WHERE name = ?").get(requiredSkill);
    const legacy = db.prepare("SELECT name FROM skills WHERE name LIKE 'deep-code-explorer%' OR skill_name = 'deep-code-explorer'").all().map(r => r.name);
    db.close();
    if (!hasRequired) {
      return { ok: false, reason: `required skill ${requiredSkill} is not indexed` };
    }
    if (legacy.length > 0) {
      return { ok: false, reason: `legacy skill rows remain: ${legacy.join(', ')}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

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

function purgePackageCaches({ _ = false } = {}) {
  const isWin = process.platform === 'win32';
  const { env: childEnv } = deployUtils.resolveCompatibleNodeEnv(process.env);
  const spawnOpts = { stdio: 'ignore', timeout: 15000, env: childEnv, windowsHide: true };
  if (isWin) spawnOpts.shell = true;

  try {
    const pnpmCmd = isWin ? 'pnpm.cmd' : 'pnpm';
    spawnSync(pnpmCmd, ['store', 'prune'], spawnOpts);
  } catch { /* intentional best-effort fallback */ }

  try {
    const npmCmd = isWin ? 'npm.cmd' : 'npm';
    spawnSync(npmCmd, ['cache', 'clean', '--force'], spawnOpts);
  } catch { /* intentional best-effort fallback */ }

  try {
    const yarnCmd = isWin ? 'yarn.cmd' : 'yarn';
    spawnSync(yarnCmd, ['cache', 'clean', '--all'], spawnOpts);
  } catch { /* intentional best-effort fallback */ }

  try {
    const tempDirs = [];
    if (isWin) {
      if (process.env.LOCALAPPDATA) {
        tempDirs.push(path.join(process.env.LOCALAPPDATA, 'pnpm', 'store', 'v3', 'tmp'));
        tempDirs.push(path.join(process.env.LOCALAPPDATA, 'pnpm', 'store', 'v10', 'tmp'));
        tempDirs.push(path.join(process.env.LOCALAPPDATA, 'pnpm', 'store', 'v11', 'tmp'));
        tempDirs.push(path.join(process.env.LOCALAPPDATA, 'pnpm-cache'));
      }
      if (process.env.TEMP) {
        tempDirs.push(path.join(process.env.TEMP, 'pnpm'));
        tempDirs.push(path.join(process.env.TEMP, 'npm-cache'));
      }
    } else {
      tempDirs.push(path.join(os.homedir(), '.cache', 'pnpm'));
      tempDirs.push(path.join(os.homedir(), '.local', 'share', 'pnpm', 'store', 'v3', 'tmp'));
      tempDirs.push(path.join(os.homedir(), '.local', 'share', 'pnpm', 'store', 'v10', 'tmp'));
      tempDirs.push(path.join(os.homedir(), '.local', 'share', 'pnpm', 'store', 'v11', 'tmp'));
      tempDirs.push(path.join(os.homedir(), 'Library', 'Caches', 'pnpm'));
      tempDirs.push(path.join(os.homedir(), 'Library', 'pnpm', 'store', 'v11', 'tmp'));
    }
    const activeScript = (process.argv[1] || '').toLowerCase();
    const activeCwd = process.cwd().toLowerCase();
    for (const d of tempDirs) {
      const dLower = d.toLowerCase();
      if (activeScript.startsWith(dLower) || activeCwd.startsWith(dLower)) {
        continue;
      }
      if (fileExists(d)) {
        try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 3 }); } catch { /* intentional best-effort fallback */ }
      }
    }
  } catch { /* intentional best-effort fallback */ }
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

function unregisterPermissions(silent = false) {
  const settingsPaths = [
    SETTINGS_PATH,
    path.join(HOME, '.gemini', 'settings.json')
  ];

  for (const settingsPath of settingsPaths) {
    if (!fileExists(settingsPath)) continue;

    let settings = {};
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    } catch {
      continue;
    }

    const allowArr = settings.permissions && Array.isArray(settings.permissions.allow) ? settings.permissions.allow : [];
    if (allowArr.length > 0) {
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

      const initialLength = allowArr.length;
      const filtered = allowArr.filter(
        (grant) => !requiredGrants.includes(grant)
      );

      if (filtered.length !== initialLength) {
        settings.permissions.allow = filtered;
        try {
          fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
          if (!silent) {
            success(`Removed command permissions from: ${settingsPath}`);
          }
        } catch (e) {
          if (!silent) {
            warn(`Could not update settings.json: ${e.message}`);
          }
        }
      }
    }
  }
}

function registerHooks(silent = false, allowHooks) {
  const HOOKS_CONFIG_PATH = path.join(HOME, '.gemini', 'config', 'hooks.json');
  ensureDir(path.dirname(HOOKS_CONFIG_PATH));

  let config = {};
  if (fileExists(HOOKS_CONFIG_PATH)) {
    try {
      config = JSON.parse(fs.readFileSync(HOOKS_CONFIG_PATH, 'utf-8'));
    } catch (_) {
      try {
        fs.copyFileSync(HOOKS_CONFIG_PATH, HOOKS_CONFIG_PATH + '.corrupt-' + Date.now());
        warn(`Existing hooks.json was invalid JSON — backed up to ${HOOKS_CONFIG_PATH}.corrupt-*`);
      } catch (_) { /* intentional best-effort fallback */ }
      config = {};
    }
  }

  const promptHookPath = path.join(SKILLS_DB_DIR, 'prompt_hook.js');
  const subagentHookPath = path.join(SKILLS_DB_DIR, 'antigravity_subagent_hook.js');
  const sanitizeHookPath = path.join(SKILLS_DB_DIR, 'antigravity_tool_sanitize_hook.js');
  const hookExists = config['konoha-prompt-hook'] !== undefined;
  const sanitizeExists = config['konoha-tool-sanitize'] !== undefined;
  const legacySubagentHook = config['konoha-subagent-hook'] !== undefined;

  let shouldWrite = false;

  const applyPromptAndSanitizeHooks = () => {
    delete config['konoha-subagent-hook'];
    config['konoha-prompt-hook'] = {
      PreInvocation: [
        { type: 'command', command: `"${process.execPath}" "${subagentHookPath}"` },
        { type: 'command', command: `"${process.execPath}" "${promptHookPath}"` },
      ],
    };
    config['konoha-tool-sanitize'] = {
      PreToolUse: [
        {
          matcher: 'define_subagent|invoke_subagent',
          hooks: [{ type: 'command', command: `"${process.execPath}" "${sanitizeHookPath}"`, timeout: 10 }],
        },
      ],
    };
    shouldWrite = true;
  };

  if (allowHooks === true) {
    applyPromptAndSanitizeHooks();
  } else if (allowHooks === false) {
    if (hookExists) {
      delete config['konoha-prompt-hook'];
      shouldWrite = true;
    }
    if (sanitizeExists) {
      delete config['konoha-tool-sanitize'];
      shouldWrite = true;
    }
    if (legacySubagentHook) {
      delete config['konoha-subagent-hook'];
      shouldWrite = true;
    }
  } else if (allowHooks === undefined) {
    if (hookExists) {
      applyPromptAndSanitizeHooks();
    }
  }

  if (shouldWrite) {
    try {
      fs.writeFileSync(HOOKS_CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
      if (!silent) {
        if (allowHooks === false) {
          success(`Removed prompt hook from: ${HOOKS_CONFIG_PATH}`);
        } else {
          success(`Registered prompt hook in: ${HOOKS_CONFIG_PATH}`);
        }
      }
    } catch (e) {
      if (!silent) {
        warn(`Could not update hooks.json: ${e.message}`);
      }
    }
  }
}

function copyIfDifferent(src, dest) {
  if (!fileExists(dest)) {
    copyFile(src, dest);
    return true;
  }
  try {
    const srcContent = fs.readFileSync(src);
    const destContent = fs.readFileSync(dest);
    if (!srcContent.equals(destContent)) {
      copyFile(src, dest);
      return true;
    }
  } catch (_) {
    try { copyFile(src, dest); return true; } catch { /* intentional best-effort fallback */ }
  }
  return false;
}

function copyRecursive(src, dest) {
  const stats = fs.statSync(src);
  if (stats.isDirectory()) {
    ensureDir(dest);
    const entries = fs.readdirSync(src);
    for (const entry of entries) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    copyFile(src, dest);
  }
}

function copyRecursiveIfDifferent(src, dest) {
  let stats;
  try {
    stats = fs.statSync(src);
  } catch {
    return;
  }
  if (stats.isDirectory()) {
    ensureDir(dest);
    const entries = fs.readdirSync(src);
    for (const entry of entries) {
      copyRecursiveIfDifferent(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    copyIfDifferent(src, dest);
  }
}

function installCliRuntime() {
  const cliDest = path.join(SKILLS_DB_DIR, 'bin', 'cli.js');
  const skipNames = new Set(['.ruff_cache', '__pycache__', '.pytest_cache', '.DS_Store', 'node_modules', '.svelte-kit', 'build', 'dist']);
  const copyTree = (src, dest) => {
    ensureDir(dest);
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      if (skipNames.has(entry.name)) continue;
      const s = path.join(src, entry.name);
      const d = path.join(dest, entry.name);
      if (entry.isDirectory()) copyTree(s, d);
      else if (entry.isSymbolicLink()) {
        try {
          const target = fs.readlinkSync(s);
          if (fs.existsSync(d)) fs.unlinkSync(d);
          fs.symlinkSync(target, d);
        } catch (_) {
          copyFile(s, d);
        }
      } else if (entry.isFile()) copyFile(s, d);
    }
  };
  try {
    ensureDir(path.join(SKILLS_DB_DIR, 'bin'));
    const sourceCliPath = path.resolve(__dirname, '..', 'cli.js');
    if (fileExists(sourceCliPath)) {
      copyFile(sourceCliPath, cliDest);
    }

    const pkgSrc = path.resolve(__dirname, '..', '..', 'package.json');
    if (fileExists(pkgSrc)) {
      copyFile(pkgSrc, path.join(SKILLS_DB_DIR, 'package.json'));
    }

    const libSrc = path.resolve(__dirname);
    if (fileExists(libSrc)) {
      for (const entry of fs.readdirSync(libSrc, { withFileTypes: true })) {
        if (entry.isFile()) {
          ensureDir(path.join(SKILLS_DB_DIR, 'bin', 'lib'));
          copyFile(path.join(libSrc, entry.name), path.join(SKILLS_DB_DIR, 'bin', 'lib', entry.name));
        }
      }
    }

    const commandsSrc = path.resolve(__dirname, '..', 'commands');
    if (fileExists(commandsSrc)) {
      for (const entry of fs.readdirSync(commandsSrc, { withFileTypes: true })) {
        if (entry.isFile()) {
          ensureDir(path.join(SKILLS_DB_DIR, 'bin', 'commands'));
          copyFile(path.join(commandsSrc, entry.name), path.join(SKILLS_DB_DIR, 'bin', 'commands', entry.name));
        }
      }
    }

    if (fileExists(SRC_DIR)) {
      const destSrc = path.join(SKILLS_DB_DIR, 'src');
      if (path.resolve(SRC_DIR) !== path.resolve(destSrc)) {
        copyTree(SRC_DIR, destSrc);
      }
    }

    const skillsSrc = path.resolve(__dirname, '..', '..', '.agents', 'skills');
    const skillsDest = path.join(SKILLS_DB_DIR, '.agents', 'skills');
    if (fileExists(skillsSrc) && path.resolve(skillsSrc) !== path.resolve(skillsDest)) {
      copyTree(skillsSrc, skillsDest);
    }

    const assetsSrc = path.resolve(__dirname, '..', '..', 'assets');
    if (fileExists(assetsSrc)) {
      for (const entry of fs.readdirSync(assetsSrc, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.vsix')) {
          ensureDir(path.join(SKILLS_DB_DIR, 'assets'));
          copyFile(path.join(assetsSrc, entry.name), path.join(SKILLS_DB_DIR, 'assets', entry.name));
        } else if (entry.isDirectory() && entry.name === 'models') {
          const modelsSrc = path.join(assetsSrc, 'models');
          const modelsDest = path.join(SKILLS_DB_DIR, 'assets', 'models');
          if (path.resolve(modelsSrc) !== path.resolve(modelsDest)) {
            copyTree(modelsSrc, modelsDest);
          }
        }
      }
    }

    let webSrcDir = path.resolve(__dirname, '..', '..', 'apps', 'web');
    if (!fileExists(path.join(webSrcDir, 'package.json')) && fileExists(path.join(process.cwd(), 'apps', 'web', 'package.json'))) {
      webSrcDir = path.join(process.cwd(), 'apps', 'web');
    }
    const webDestDir = path.join(SKILLS_DB_DIR, 'apps', 'web');
    if (fileExists(path.join(webSrcDir, 'package.json')) && path.resolve(webSrcDir) !== path.resolve(webDestDir)) {
      copyTree(webSrcDir, webDestDir);
      info(`Web UI application installed to ${webDestDir}`);
    }

    const currentVersion = getCliVersion();
    let webBuildSrc = path.resolve(__dirname, '..', '..', 'apps', 'web', 'build');
    if (!fileExists(path.join(webBuildSrc, 'handler.js'))) {
      const candidates = [
        path.join(process.cwd(), 'apps', 'web', 'build'),
        path.join(process.cwd(), 'build'),
      ];
      for (const cand of candidates) {
        if (fileExists(path.join(cand, 'handler.js'))) {
          webBuildSrc = cand;
          break;
        }
      }
    }
    const webBuildDest = path.join(SKILLS_DB_DIR, 'apps', 'web', 'build');
    const destWebDir = path.join(SKILLS_DB_DIR, 'apps', 'web');
    const destWebPkg = path.join(destWebDir, 'package.json');
    let destVersion = null;
    try {
      if (fileExists(destWebPkg)) {
        destVersion = JSON.parse(fs.readFileSync(destWebPkg, 'utf8')).version;
      }
    } catch (_) { /* intentional best-effort fallback: unreadable package.json ignored */ }
    const isUiOutdated = !destVersion || destVersion !== currentVersion;

    if (fileExists(path.join(webBuildSrc, 'handler.js'))) {
      if (path.resolve(webBuildSrc) !== path.resolve(webBuildDest) || isUiOutdated) {
        fs.rmSync(webBuildDest, { recursive: true, force: true });
        ensureDir(webBuildDest);
        fs.cpSync(webBuildSrc, webBuildDest, { recursive: true });
        fs.writeFileSync(destWebPkg, JSON.stringify({ name: 'konoha-web', version: currentVersion, type: 'module', private: true }, null, 2) + '\n');
        fs.writeFileSync(path.join(webBuildDest, 'package.json'), '{\n  "type": "module"\n}\n');
        info(`Pre-built Web UI installed to ${webBuildDest} (v${currentVersion})`);
      }
    } else if (!fileExists(path.join(webBuildDest, 'handler.js')) || isUiOutdated) {
      const sourceDir = deployUtils.resolveWebUiDir({ preferSources: true });
      if (sourceDir && fileExists(path.join(sourceDir, 'src', 'routes'))) {
        try {
          const { execSync } = require('child_process');
          info(`Building Web UI v${currentVersion} during runtime initialization...`);
          try {
            execSync('pnpm run build', { cwd: sourceDir, stdio: 'ignore', timeout: 180000 });
          } catch (_) {
            execSync('npm run build', { cwd: sourceDir, stdio: 'ignore', timeout: 180000 });
          }
          const builtOutput = path.join(sourceDir, 'build');
          if (fileExists(path.join(builtOutput, 'handler.js')) && path.resolve(builtOutput) !== path.resolve(webBuildDest)) {
            fs.rmSync(webBuildDest, { recursive: true, force: true });
            ensureDir(webBuildDest);
            fs.cpSync(builtOutput, webBuildDest, { recursive: true });
            fs.writeFileSync(destWebPkg, JSON.stringify({ name: 'konoha-web', version: currentVersion, type: 'module', private: true }, null, 2) + '\n');
            fs.writeFileSync(path.join(webBuildDest, 'package.json'), '{\n  "type": "module"\n}\n');
            info(`Pre-built Web UI installed to ${webBuildDest} (v${currentVersion})`);
          }
        } catch (buildErr) {
          warn(`Could not build Web UI automatically: ${buildErr.message}`);
        }
      }
    }

    const depMarker = path.join(SKILLS_DB_DIR, 'node_modules', '@bufbuild', 'protobuf');
    if (!fileExists(depMarker)) {
      const isWin = process.platform === 'win32';
      const { env: childEnv } = deployUtils.resolveCompatibleNodeEnv(process.env);
      const pmCandidates = [
        { cmd: isWin ? 'pnpm.cmd' : 'pnpm', args: ['install', '--prod'] },
        { cmd: isWin ? 'npm.cmd' : 'npm', args: ['install', '--omit=dev', '--no-audit', '--no-fund'] }
      ];
      for (const pm of pmCandidates) {
        try {
          const res = spawnSync(pm.cmd, pm.args, {
            cwd: SKILLS_DB_DIR,
            encoding: 'utf-8',
            timeout: 300000,
            stdio: 'ignore',
            shell: isWin,
            env: childEnv
          });
          if (res.status === 0 && fileExists(depMarker)) break;
        } catch (_) { /* intentional best-effort fallback */ }
      }
    }
  } catch (_) {
    // Non-fatal
  }
  return cliDest;
}

function reconcileGlobalCommand() {
  const report = { updated: [], created: [], ok: [], failed: [], sourceCli: null };
  const isWin = process.platform === 'win32';
  const sourceCli = path.join(SKILLS_DB_DIR, 'bin', 'cli.js');
  report.sourceCli = sourceCli;
  if (!fileExists(sourceCli)) return report;

  const nodeCmd = process.execPath;
  const homeDir = HOME;

  const tmpRoot = path.resolve(os.tmpdir());
  if (
    process.env.KONOHA_TEST_SANDBOX === '1' ||
    path.resolve(SKILLS_DB_DIR).startsWith(tmpRoot) ||
    path.resolve(homeDir).startsWith(tmpRoot)
  ) {
    return report;
  }

  const candidateDirs = new Set();
  try {
    const npmCmd = isWin ? 'npm.cmd' : 'npm';
    const res = spawnSync(npmCmd, ['config', 'get', 'prefix'], { encoding: 'utf-8', timeout: 8000, shell: isWin, windowsHide: true });
    const prefix = ((res.stdout || '') + '').trim().split(/\r?\n/).filter(Boolean).pop();
    if (prefix && fs.existsSync(prefix)) {
      candidateDirs.add(isWin ? prefix : path.join(prefix, 'bin'));
    }
  } catch (_) { /* intentional best-effort fallback */ }
  if (isWin) {
    const localAppData = process.env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local');
    candidateDirs.add(path.join(localAppData, 'pnpm'));
  } else {
    candidateDirs.add(path.join(homeDir, '.local', 'share', 'pnpm'));
    candidateDirs.add(path.join(homeDir, 'Library', 'pnpm'));
    candidateDirs.add(path.join(homeDir, '.local', 'bin'));
  }
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    try {
      const hasShim = fs.existsSync(path.join(dir, isWin ? 'konoha.cmd' : 'konoha'));
      if (hasShim) candidateDirs.add(dir);
    } catch (_) { /* intentional best-effort fallback */ }
  }

  for (const dir of candidateDirs) {
    try {
      if (!fs.existsSync(dir)) continue;
      const dirMode = fs.statSync(dir).isDirectory() ? null : 'skip';
      if (dirMode === 'skip') continue;
    } catch (_) { continue; }

    const mainName = isWin ? 'konoha.cmd' : 'konoha';
    const shimNames = [mainName];
    if (isWin) {
      if (fs.existsSync(path.join(dir, 'konoha.ps1'))) shimNames.push('konoha.ps1');
      if (fs.existsSync(path.join(dir, 'konoha'))) shimNames.push('konoha');
    }

    for (const name of shimNames) {
      const shimPath = path.join(dir, name);
      const contents = {
        'konoha': `#!/bin/sh\nexec "${nodeCmd}" "${sourceCli}" "$@"\n`,
        'konoha.cmd': `@echo off\r\n"${nodeCmd}" "${sourceCli}" %*\r\n`,
        'konoha.ps1': `& "${nodeCmd}" "${sourceCli}" @args\n`
      };
      const mode = isWin ? undefined : 0o755;

      try {
        let st = null;
        try { st = fs.lstatSync(shimPath); } catch (_) { /* intentional best-effort fallback */ }
        if (!st) {
          fs.writeFileSync(shimPath, contents[name], { mode: mode || 0o666 });
          if (!isWin) { try { fs.chmodSync(shimPath, 0o755); } catch (_) { /* intentional best-effort fallback */ } }
          report.created.push(shimPath);
          continue;
        }
        if (st.isSymbolicLink()) {
          let resolved = null;
          try {
            const target = fs.readlinkSync(shimPath);
            resolved = path.resolve(path.dirname(shimPath), target);
          } catch (_) {
            resolved = null;
          }
          if (resolved === sourceCli) {
            report.ok.push(shimPath);
            continue;
          }
          fs.unlinkSync(shimPath);
          fs.writeFileSync(shimPath, contents[name]);
          if (!isWin) { try { fs.chmodSync(shimPath, 0o755); } catch (_) { /* intentional best-effort fallback */ } }
          report.updated.push(shimPath);
          continue;
        }
        const current = fs.readFileSync(shimPath, 'utf8');
        if (current === contents[name]) {
          report.ok.push(shimPath);
          continue;
        }
        fs.writeFileSync(shimPath, contents[name]);
        if (!isWin) { try { fs.chmodSync(shimPath, 0o755); } catch (_) { /* intentional best-effort fallback */ } }
        report.updated.push(shimPath);
      } catch (err) {
        report.failed.push({ path: shimPath, error: err.message });
      }
    }
  }

  return report;
}

function syncTemplateSkills() {
  const templateSkillsDir = path.join(SRC_DIR, 'templates', 'skills');
  const packageSkillsDir = path.resolve(__dirname, '..', '..', '.agents', 'skills');
  if (!fileExists(templateSkillsDir)) return;
  copyRecursiveIfDifferent(templateSkillsDir, packageSkillsDir);
}

function _treeFingerprint(root) {
  let maxMtime = 0;
  let count = 0;
  let totalSize = 0;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const p = path.join(dir, entry.name);
      try {
        const st = fs.statSync(p);
        if (st.isDirectory()) { stack.push(p); }
        else { count++; totalSize += st.size; if (st.mtimeMs > maxMtime) maxMtime = st.mtimeMs; }
      } catch { /* intentional best-effort fallback */ }
    }
  }
  return `${maxMtime.toFixed(0)}:${count}:${totalSize}`;
}

function copySkillsDirFast(srcRoot, destRoot) {
  if (!fileExists(srcRoot)) return;
  ensureDir(destRoot);
  const srcFp = _treeFingerprint(srcRoot);
  const fpMarker = destRoot + '.fingerprint';
  let destFp = null;
  try { destFp = fs.readFileSync(fpMarker, 'utf-8').trim(); } catch { /* intentional best-effort fallback */ }
  if (srcFp === destFp) return;

  const walk = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const s = path.join(dir, entry.name);
      const d = path.join(destRoot, path.relative(srcRoot, s));
      if (entry.isDirectory()) {
        ensureDir(d);
        walk(s);
      } else if (entry.isFile()) {
        try {
          const ss = fs.statSync(s);
          let needsCopy = true;
          try {
            const ds = fs.statSync(d);
            needsCopy = ss.mtimeMs > ds.mtimeMs || ss.size !== ds.size;
          } catch { /* intentional best-effort fallback */ }
          if (needsCopy) {
            fs.copyFileSync(s, d);
            try { fs.utimesSync(d, ss.atime, ss.mtime); } catch { /* intentional best-effort fallback */ }
          }
        } catch { /* intentional best-effort fallback */ }
      }
    }
  };
  walk(srcRoot);

  try { fs.writeFileSync(fpMarker, srcFp); } catch { /* intentional best-effort fallback */ }
}

function smokeTestKonohaFilesMcp(useLauncher = false) {
  if (!fileExists(FILE_TOOLS_MCP_PATH)) {
    return { ok: false, error: 'file_tools_mcp.js missing' };
  }

  const cleanEnv = Object.assign({}, process.env);
  for (const k of Object.keys(cleanEnv)) {
    if (k.toUpperCase() === 'KONOHA_DAEMON') {
      delete cleanEnv[k];
    }
  }

  const input = [
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'konoha-smoke', version: '2.2.1' } }
    }),
    JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {}
    }),
    ''
  ].join('\n');

  let run;
  if (useLauncher) {
    const entry = deployUtils.buildKonohaFilesMcpEntry('execPath');
    if (entry) {
      run = spawnSync(entry.command, entry.args, {
        input,
        encoding: 'utf-8',
        timeout: 15000,
        env: cleanEnv,
        shell: process.platform === 'win32'
      });
    }
  }
  if (!run || run.status !== 0) {
    run = spawnSync(process.execPath, [FILE_TOOLS_MCP_PATH], {
      input,
      encoding: 'utf-8',
      timeout: 15000,
      env: cleanEnv
    });
  }

  if (run.status !== 0) {
    return { ok: false, error: (run.stderr || '').trim() || `exit code ${run.status}` };
  }

  try {
    const lines = (run.stdout || '').trim().split('\n').filter(Boolean);
    let tools = null;
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(lines[i]);
        if (parsed.result && Array.isArray(parsed.result.tools)) {
          tools = parsed.result.tools;
          break;
        }
      } catch (_) { /* ignore parse errors on non-json lines */ }
    }
    if (!Array.isArray(tools) || tools.length < 4) {
      return { ok: false, error: `tools/list returned ${tools ? tools.length : 0} tools` };
    }
    return { ok: true, toolCount: tools.length };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function installFileTools(silent = true) {
  const python = checkPython();
  const ok = deployUtils.installFileTools(silent, python);
  if (!silent && ok) {
    success(`File tools installed: ${FILE_TOOLS_MCP_PATH}`);
  }
  return ok;
}

function ensureAutoSetup(force = false) {
  const AUTO_SETUP_STATE_PATH = path.join(SKILLS_DB_DIR, '.auto_setup_state.json');
  let prevVersion = null;
  try {
    if (fileExists(AUTO_SETUP_STATE_PATH)) {
      const state = JSON.parse(fs.readFileSync(AUTO_SETUP_STATE_PATH, 'utf8'));
      prevVersion = state && state.version ? state.version : null;
      const cliVer = getCliVersion();
      const agentsYamlPath = path.join(HOME, '.agents', 'agents.yaml');
      let agentsMtime = 0;
      try { agentsMtime = fs.statSync(agentsYamlPath).mtimeMs; } catch { /* intentional best-effort fallback */ }
      if (!force && fileExists(DB_PATH) && fileExists(SERVER_PATH) && fileExists(FILE_TOOLS_MCP_PATH) && fileExists(MCP_CONFIG_PATH)) {
        if (state.version === cliVer && state.agentsMtime === agentsMtime) {
          return;
        }
      }
    }
  } catch { /* intentional best-effort fallback */ }
  const versionChanged = prevVersion !== getCliVersion();

  ensureCoreDirectories();

  const filesToCopy = [
    'server.js', 'vector_search.js', 'db.js', 'migrate.js', 'canonical_skills.js',
    'file_tools_router.js', 'file_tools_launcher.js', 'tools_savings_logger.js',
    'persona_memory.js', 'circuit_breaker.js', 'search_policy.js',
    'platform_utils.js', 'deploy_utils.js', 'mcp_tool_manifest.json',
    'prompt_hook.js', 'antigravity_subagent_hook.js', 'antigravity_tool_sanitize_hook.js',
    'hook-base.js', 'guardrails.js', 'antigravity_manager.js', 'agent_contract.js', 'cursor_bootstrap.js'
  ];
  filesToCopy.forEach(f => {
    const src = path.join(SRC_DIR, f);
    const dest = path.join(SKILLS_DB_DIR, f);
    if (fileExists(src)) {
      copyIfDifferent(src, dest);
    }
  });

  const legacyPyFiles = ['server.py', 'vector_search.py', 'db.py', 'migrate.py', 'db_stats.py', 'db_savings.py', 'db_bridges.py', 'agent_stats.py', 'persona_memory.py', 'circuit_breaker.py'];
  legacyPyFiles.forEach(f => {
    const legacyPath = path.join(SKILLS_DB_DIR, f);
    if (fileExists(legacyPath)) {
      try { fs.unlinkSync(legacyPath); } catch { /* intentional best-effort fallback */ }
    }
  });

  installCliRuntime();

  try {
    const autoStartOptOut = String(process.env.KONOHA_UI_AUTOSTART || '').trim().toLowerCase();
    const daemonSelf = process.env.KONOHA_UI_DAEMON === 'true';
    const spawnGuard = process.env.KONOHA_UI_AUTOSTART_GUARD === '1';
    if (versionChanged && !daemonSelf && !spawnGuard && !(autoStartOptOut === '0' || autoStartOptOut === 'false' || autoStartOptOut === 'off' || autoStartOptOut === 'no')) {
      const uiPidFile = path.join(SKILLS_DB_DIR, 'ui.pid');
      let daemonPid = 0;
      if (fileExists(uiPidFile)) {
        try { daemonPid = parseInt(fs.readFileSync(uiPidFile, 'utf8').trim(), 10) || 0; } catch (_) { /* best-effort */ }
      }
      let daemonRunning = false;
      if (daemonPid > 0 && daemonPid !== process.pid) {
        try { process.kill(daemonPid, 0); daemonRunning = true; } catch (_) { /* not running */ }
      }
      const { spawn } = require('child_process');
      const cliEntry = path.join(SKILLS_DB_DIR, 'bin', 'cli.js');
      const uiArgs = [cliEntry, 'ui', daemonRunning ? 'restart' : 'start', '--no-open'];
      const uiChild = spawn(process.execPath || 'node', uiArgs, {
        detached: true,
        stdio: 'ignore',
        env: Object.assign({}, process.env, { KONOHA_UI_AUTOSTART_GUARD: '1' })
      });
      uiChild.on('error', () => {});
      uiChild.unref();
    }
  } catch { /* intentional best-effort fallback */ }
  installFileTools(true);
  const pkgSrc = path.resolve(__dirname, '..', '..', 'package.json');
  const pkgDest = path.join(SKILLS_DB_DIR, 'package.json');
  if (fileExists(pkgSrc)) {
    copyIfDifferent(pkgSrc, pkgDest);
  }

  syncTemplateSkills();
  const pkgSkillsDir = path.resolve(__dirname, '..', '..', '.agents', 'skills');
  const globalSkillsDir = path.join(HOME, '.agents', 'skills');
  copySkillsDirFast(pkgSkillsDir, globalSkillsDir);
  skillManager.syncAllClientSkills({ projectRoot: currentCwd, silent: true });

  const python = checkPython() || 'python3';
  installUv(true);
  registerMcp(python, true);
  registerHooks(true, true);

  const agentsYamlPath = path.join(HOME, '.agents', 'agents.yaml');
  if (!fileExists(agentsYamlPath)) {
    try {
      agentManager.loadAgents(false, true);
    } catch (_) { /* intentional best-effort fallback */ }
  }

  {
    const originalLog = console.log;
    console.log = () => {};
    let uvxCmd = 'uvx';
    try {
      uvxCmd = getUvxCommand();
    } catch (_) {
      void 0;
    }
    try {
      agentManager.regenerateAndDeploy({
        pythonCmd: python,
        serverPath: SERVER_PATH,
        uvxCmd,
        projectRoot: currentCwd,
        deployProject: false,
        force: force || versionChanged,
        silent: true
      });
    } catch (_) {
      void 0;
    }
    finally {
      console.log = originalLog;
    }
  }

  try {
    antigravityManager.deployAntigravityRtkRule(true);
  } catch (_) {
    void 0;
  }

  if (!fileExists(DB_PATH) || versionChanged) {
    if (!hasCanonicalGeninSkill(pkgSkillsDir)) {
      throw new Error(`Packaged canonical skill missing: ${path.join(pkgSkillsDir, 'genin-skill', 'SKILL.md')}`);
    }
    process.env.KONOHA_SEMANTIC_SEARCH = process.env.KONOHA_SEMANTIC_SEARCH || '1';
    const extraArgs = (process.env.KONOHA_SEMANTIC_SEARCH === '0' || process.env.KONOHA_SEMANTIC_SEARCH === 'false') ? ['--skip-embeddings'] : [];
    if (fileExists(pkgSkillsDir)) {
      const skills = detectCustomSkills(pkgSkillsDir);
      if (skills.length > 0) {
        try {
          const bootstrapArgs = [MIGRATE_PATH, '--skills-dir', pkgSkillsDir, '--skills', ...skills, '--require-skill', 'genin-skill'];
          let run = spawnSync(process.execPath, [...bootstrapArgs, ...extraArgs], {
            encoding: 'utf-8', cwd: SKILLS_DB_DIR, timeout: MIGRATION_TIMEOUT_MS
          });
          if (run.status !== 0) {
            run = spawnSync(process.execPath, [...bootstrapArgs, '--skills-only', '--skip-embeddings'], {
              encoding: 'utf-8', cwd: SKILLS_DB_DIR, timeout: 120000
            });
          }
        } catch (_) {
          try {
            spawnSync(process.execPath, [MIGRATE_PATH, '--require-skill', 'genin-skill', ...extraArgs], {
              encoding: 'utf-8', cwd: SKILLS_DB_DIR, timeout: MIGRATION_TIMEOUT_MS
            });
          } catch (_) { /* intentional best-effort fallback */ }
        }
      }
    } else {
      try {
        spawnSync(process.execPath, [MIGRATE_PATH, '--require-skill', 'genin-skill', ...extraArgs], {
          encoding: 'utf-8', cwd: SKILLS_DB_DIR, timeout: MIGRATION_TIMEOUT_MS
        });
      } catch (_) { /* intentional best-effort fallback */ }
    }
  }

  try {
    let agentsMtime = 0;
    try { agentsMtime = fs.statSync(agentsYamlPath).mtimeMs; } catch { /* intentional best-effort fallback */ }
    fs.writeFileSync(AUTO_SETUP_STATE_PATH, JSON.stringify({
      version: getCliVersion(),
      agentsMtime,
      timestamp: Date.now()
    }), 'utf8');
  } catch { /* intentional best-effort fallback */ }
}

function updateGeminiMd(silent = false) {
  agentManager.regenerateAndDeploy(silent);
}

function moveUnusedSkills(skillsDirs, agents) {
  const activeSkills = new Set();
  for (const agent of agents) {
    if (agent.skills && Array.isArray(agent.skills)) {
      for (const s of agent.skills) {
        const parent = s.split('/')[0];
        const cleanParent = parent.endsWith('.md') ? parent.slice(0, -3) : parent;
        activeSkills.add(cleanParent.toLowerCase());
      }
    }
  }

  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const yyyymmdd = `${yyyy}${mm}${dd}`;

  for (const dirObj of skillsDirs) {
    const skillsDir = dirObj.path;
    if (!fileExists(skillsDir)) continue;

    const absSkillsDir = path.resolve(skillsDir);
    const projectAgentsSkills = path.resolve(currentCwd, '.agents', 'skills');
    const projectAgentSkills = path.resolve(currentCwd, '.agent', 'skills');
    if ((absSkillsDir === projectAgentsSkills || absSkillsDir === projectAgentSkills) && currentCwd !== HOME) {
      info(`Skipping pruning for project-level skills directory: ${skillsDir}`);
      continue;
    }

    let entries = [];
    try {
      entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    } catch (_) {
      continue;
    }

    const backupSkillsDir = path.join(HOME, '.agents.backup', 'skills');

    for (const entry of entries) {
      const skillName = entry.name;
      let isSkill = false;

      if (entry.isDirectory() && fileExists(path.join(skillsDir, skillName, 'SKILL.md'))) {
        isSkill = true;
      } else if (entry.isFile() && skillName.endsWith('-skill.md')) {
        isSkill = true;
      }

      if (!isSkill) continue;

      const cleanName = skillName.endsWith('.md') ? skillName.slice(0, -3) : skillName;

      const templateSkillsDir = path.join(SRC_DIR, 'templates', 'skills');
      const isCanonical = fs.existsSync(path.join(templateSkillsDir, skillName)) ||
                          fs.existsSync(path.join(templateSkillsDir, cleanName)) ||
                          fs.existsSync(path.join(templateSkillsDir, `${cleanName}-skill.md`));
      if (isCanonical) {
        continue;
      }

      if (!activeSkills.has(cleanName.toLowerCase())) {
        const srcPath = path.join(skillsDir, skillName);
        const destPath = path.join(backupSkillsDir, `${cleanName}-${yyyymmdd}${entry.isFile() ? '.md' : ''}`);

        info(`🧹 Found unused/unembedded skill "${skillName}". Moving to backup...`);
        try {
          fs.mkdirSync(backupSkillsDir, { recursive: true });
          if (fs.existsSync(destPath)) {
            fs.rmSync(destPath, { recursive: true, force: true });
          }
          fs.renameSync(srcPath, destPath);
          success(`✓ Moved: ${skillName} ➔ ${destPath}`);
        } catch (err) {
          warn(`⚠️ Failed to move ${skillName}: ${err.message}`);
        }
      }
    }
  }
}

module.exports = {
  hasCompleteDatabaseSchema,
  detectSkillsDirs,
  detectCustomSkills,
  hasCanonicalGeninSkill,
  verifySkillDatabaseContract,
  ensureCoreDirectories,
  purgePackageCaches,
  registerMcp,
  registerPermissions,
  unregisterPermissions,
  registerHooks,
  copyIfDifferent,
  copyRecursive,
  copyRecursiveIfDifferent,
  installCliRuntime,
  reconcileGlobalCommand,
  syncTemplateSkills,
  copySkillsDirFast,
  smokeTestKonohaFilesMcp,
  installFileTools,
  ensureAutoSetup,
  updateGeminiMd,
  moveUnusedSkills,
};
