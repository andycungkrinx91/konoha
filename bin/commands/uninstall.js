"use strict";

/**
 * bin/commands/uninstall.js — Safe Removal of Konoha MCP Server Configurations.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const { HOME, SKILLS_DB_DIR, MCP_CONFIG_PATH, GEMINI_MD_PATH, AGENTS_MD_PATH } = require("../lib/paths");
const { C, log, info, warn, success, header } = require("../lib/format");
const { fileExists } = require("../lib/prompt");
const { registerHooks, unregisterPermissions } = require("../lib/runtime");

const cursorManager = require("../../src/cursor_manager");
const mcpClientsManager = require("../../src/mcp_clients_manager");
const piManager = require("../../src/pi_manager");
const antigravityManager = require("../../src/antigravity_manager");


function cmdUninstallHelp() {
  log(`
${C.cyan}konoha uninstall${C.reset} — Safely remove Konoha MCP server configuration

${C.bold}USAGE${C.reset}
  konoha uninstall [options]

${C.bold}OPTIONS${C.reset}
  ${C.cyan}--yes, -y${C.reset}  Non-interactive confirmation.

${C.bold}EXAMPLES${C.reset}
  konoha uninstall
`);
}

async function cmdUninstall(args = []) {
  if (args && (args.includes('help') || args.includes('--help') || args.includes('-h'))) {
    cmdUninstallHelp();
    return;
  }
  header('🗑️  Uninstalling Konoha MCP');

  // Remove server files (preserving the konoha.db database and its metrics)
  if (fileExists(SKILLS_DB_DIR)) {
    const files = fs.readdirSync(SKILLS_DB_DIR);
    const preservedDbs = new Set(['konoha.db', 'konoha.db-journal', 'konoha.db-wal', 'konoha.db-shm', 'skills.db', 'skills.db-journal', 'skills.db-wal', 'skills.db-shm']);
    files.forEach(file => {
      if (!preservedDbs.has(file)) {
        const filePath = path.join(SKILLS_DB_DIR, file);
        try {
          if (fs.statSync(filePath).isDirectory()) {
            fs.rmSync(filePath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(filePath);
          }
        } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
      }
    });
    success(`Cleaned server files in: ${SKILLS_DB_DIR} (preserved konoha.db)`);
  }

  // Remove Konoha MCP servers from the Pi (pi.dev) config
  if (fileExists(piManager.PI_MCP_CONFIG)) {
    if (piManager.removePiMcp(true)) {
      success('Removed Konoha MCP servers from Pi (pi.dev) config');
    } else {
      warn('Could not update Pi (pi.dev) MCP config');
    }
  }
  piManager.removePiRtkRule(true);
  piManager.removePiContract(true);

  const ccSettingsPath = path.join(HOME, '.commandcode', 'settings.json');
  if (fileExists(ccSettingsPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(ccSettingsPath, 'utf-8'));
      if (cfg.hooks && Array.isArray(cfg.hooks.SessionStart)) {
        const before = cfg.hooks.SessionStart.length;
        cfg.hooks.SessionStart = cfg.hooks.SessionStart.filter(
          (e) => !(e.hooks || []).some((h) => h.command && h.command.includes('workflow_reminder'))
        );
        if (cfg.hooks.SessionStart.length !== before) {
          fs.writeFileSync(ccSettingsPath, JSON.stringify(cfg, null, 2) + '\n');
          success('Removed Konoha workflow reminder from Command Code SessionStart hooks');
        }
      }
    } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }

  const claudeSettingsPath = path.join(HOME, '.claude', 'settings.json');
  if (fileExists(claudeSettingsPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(claudeSettingsPath, 'utf-8'));
      let changed = false;
      for (const eventName of ['UserPromptSubmit', 'SessionStart']) {
        if (!cfg.hooks || !Array.isArray(cfg.hooks[eventName])) continue;
        const before = cfg.hooks[eventName].length;
        cfg.hooks[eventName] = cfg.hooks[eventName].filter(
          (e) => !(e.hooks || []).some((h) => h.command && h.command.includes('workflow_reminder'))
        );
        if (cfg.hooks[eventName].length === 0) delete cfg.hooks[eventName];
        if (cfg.hooks[eventName].length !== before) changed = true;
      }
      if (changed) {
        fs.writeFileSync(claudeSettingsPath, JSON.stringify(cfg, null, 2) + '\n');
        success('Removed Konoha workflow reminder from Claude Code hooks');
      }
    } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }

  // Remove global `konoha` command shims that point into ~/.konoha
  // (shims pointing at an npm/pnpm-managed package are left for that
  // package manager to manage)
  try {
    const isWin = process.platform === 'win32';
    const homeDir = os.homedir();
    const shimDirs = new Set();
    try {
      const npmCmd = isWin ? 'npm.cmd' : 'npm';
      const res = spawnSync(npmCmd, ['config', 'get', 'prefix'], { encoding: 'utf-8', timeout: 8000, shell: isWin });
      const prefix = ((res.stdout || '') + '').trim().split(/\r?\n/).filter(Boolean).pop();
      if (prefix && fs.existsSync(prefix)) shimDirs.add(isWin ? prefix : path.join(prefix, 'bin'));
    } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
    if (isWin) {
      const localAppData = process.env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local');
      shimDirs.add(path.join(localAppData, 'pnpm'));
    } else {
      shimDirs.add(path.join(homeDir, '.local', 'share', 'pnpm'));
      shimDirs.add(path.join(homeDir, 'Library', 'pnpm'));
      shimDirs.add(path.join(homeDir, '.local', 'bin'));
    }
    const konohaPrefix = SKILLS_DB_DIR + path.sep;
    for (const dir of shimDirs) {
      for (const name of ['konoha', 'konoha.cmd', 'konoha.ps1']) {
        const shimPath = path.join(dir, name);
        try {
          if (!fs.existsSync(shimPath) && !fs.lstatSync(shimPath).isSymbolicLink()) continue;
        } catch (_) { continue; }
        try {
          const st = fs.lstatSync(shimPath);
          if (st.isSymbolicLink()) {
            const target = path.resolve(dir, fs.readlinkSync(shimPath));
            if (target === path.join(SKILLS_DB_DIR, 'bin', 'cli.js')) {
              fs.unlinkSync(shimPath);
              success(`Removed command shim: ${shimPath}`);
            }
          } else {
            const content = fs.readFileSync(shimPath, 'utf8');
            if (content.includes(konohaPrefix)) {
              fs.unlinkSync(shimPath);
              success(`Removed command shim: ${shimPath}`);
            }
          }
        } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
      }
    }
  } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }

  if (fileExists(MCP_CONFIG_PATH)) {
    try {
      const config = JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, 'utf-8'));
      let updated = false;
      if (config.mcpServers && config.mcpServers['skills-db']) {
        delete config.mcpServers['skills-db'];
        success('Removed skills-db from MCP config');
        updated = true;
      }
      if (config.mcpServers && config.mcpServers['semble']) {
        delete config.mcpServers['semble'];
        success('Removed semble from MCP config');
        updated = true;
      }
      if (config.mcpServers && config.mcpServers['aislop']) {
        delete config.mcpServers['aislop'];
        success('Removed aislop from MCP config');
        updated = true;
      }
      if (config.mcpServers && config.mcpServers['konoha-files']) {
        delete config.mcpServers['konoha-files'];
        success('Removed konoha-files from MCP config');
        updated = true;
      }
      if (config.mcpServers && config.mcpServers['konoha']) {
        delete config.mcpServers['konoha'];
        success('Removed konoha from MCP config');
        updated = true;
      }
      if (updated) {
        fs.writeFileSync(MCP_CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
      }
    } catch {
      warn('Could not update MCP config');
    }
  }

  // Restore or strip Konoha block from GEMINI.md
  const backupPath = GEMINI_MD_PATH + '.backup';
  if (fileExists(backupPath)) {
    fs.copyFileSync(backupPath, GEMINI_MD_PATH);
    fs.unlinkSync(backupPath);
    success('Restored GEMINI.md from backup');
  } else if (fileExists(GEMINI_MD_PATH)) {
    try {
      const cur = fs.readFileSync(GEMINI_MD_PATH, 'utf8');
      const stripped = cur.replace(/\n?<!-- KONOHA-START -->[\s\S]*?<!-- KONOHA-END -->\n?/g, '\n').trim();
      if (stripped && !stripped.startsWith('# Global Agent Instructions')) {
        fs.writeFileSync(GEMINI_MD_PATH, stripped + '\n', 'utf8');
      } else {
        fs.unlinkSync(GEMINI_MD_PATH);
      }
    } catch (_) { /* intentional best-effort fallback */ }
  }

  // Restore or strip Konoha block from AGENTS.md
  const agentsBackupPath = AGENTS_MD_PATH + '.backup';
  if (fileExists(agentsBackupPath)) {
    fs.copyFileSync(agentsBackupPath, AGENTS_MD_PATH);
    fs.unlinkSync(agentsBackupPath);
    success('Restored AGENTS.md from backup');
  } else if (fileExists(AGENTS_MD_PATH)) {
    try {
      const cur = fs.readFileSync(AGENTS_MD_PATH, 'utf8');
      const stripped = cur.replace(/\n?<!-- KONOHA-START -->[\s\S]*?<!-- KONOHA-END -->\n?/g, '\n').trim();
      if (stripped && !stripped.startsWith('# AGENTS.md — Multi-Agent Team Configuration')) {
        fs.writeFileSync(AGENTS_MD_PATH, stripped + '\n', 'utf8');
      } else {
        fs.unlinkSync(AGENTS_MD_PATH);
      }
    } catch (_) { /* intentional best-effort fallback */ }
  }

  const pkgSkillsDir = path.join(__dirname, '..', '.agents', 'skills');
  const globalSkillsDir = path.join(HOME, '.agents', 'skills');
  if (fileExists(pkgSkillsDir) && fileExists(globalSkillsDir)) {
    try {
      const files = fs.readdirSync(pkgSkillsDir, { withFileTypes: true });
      files.forEach(entry => {
        const name = entry.name;
        const targetPath = path.join(globalSkillsDir, name);
        if (fileExists(targetPath)) {
          const isOfficial = (entry.isDirectory() && (name.endsWith('-skill') || name === 'konoha')) ||
                             (entry.isFile() && name.endsWith('-skill.md'));
          if (isOfficial) {
            fs.rmSync(targetPath, { recursive: true, force: true });
            success(`Removed official skill: ${targetPath}`);
          }
        }
      });
    } catch (_) {
      // ignore
    }
  }

  log('');
  success('Konoha MCP uninstalled.');
  info('Your custom skills in ~/.agents/skills/ are untouched.');

  try {
    cursorManager.removeCursorConfig(true);
    success('Removed Konoha entries from ~/.cursor/ (MCP, subagents, hooks)');
  } catch {
    warn('Could not fully clean Cursor configuration');
  }

  try {
    mcpClientsManager.removeClaudeCodeConfig(true);
    success('Removed Konoha entries from Claude Code global MCP config (when present)');
  } catch {
    warn('Could not fully clean Claude Code configuration');
  }

  try {
    registerHooks(true, false);
    unregisterPermissions(true);
    antigravityManager.removeAntigravityAgents(true);
    success('Removed Konoha entries from Antigravity (hooks, permissions, subagents)');
  } catch {
    warn('Could not fully clean Antigravity configuration');
  }
}



module.exports = {
  cmdUninstall,
  cmdUninstallHelp,
};
