'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  HOME,
  SKILLS_DB_DIR,
  DB_PATH,
  SERVER_PATH,
  MIGRATE_PATH,
  MIGRATION_TIMEOUT_MS,
  FILE_TOOLS_MCP_PATH,
  MCP_CONFIG_PATH,
  DEFAULT_SKILLS_DIRS,
  SRC_DIR
} = require('./paths');
const { fileExists, ensureDir, checkPython } = require('./prompt');
const { info, warn, success, getCliVersion } = require('./format');
const { installUv, getUvxCommand } = require('./extension');
const agentManager = require('../../src/agent_manager');
const skillManager = require('../../src/skill_manager');
const antigravityManager = require('../../src/antigravity_manager');
const {
  ensureCoreDirectories,
  registerMcp,
  registerHooks,
  installFileTools
} = require('./runtime_mcp');
const {
  copyIfDifferent,
  copyRecursiveIfDifferent,
  installCliRuntime
} = require('./runtime_install');

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
    const required = ['skills', 'skills_fts', 'tool_calls', 'active_sessions', 'agents', 'bridges'];
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
    const hasRequired = !!db.prepare('SELECT 1 FROM skills WHERE name = ?').get(requiredSkill);
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

function ensureAutoSetup(force = false) {
  if (!force && (!fileExists(DB_PATH) || !fileExists(SERVER_PATH))) {
    return;
  }
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
    const safeTimeoutMs = Number.isFinite(Number(MIGRATION_TIMEOUT_MS)) && Number(MIGRATION_TIMEOUT_MS) > 0
      ? Number(MIGRATION_TIMEOUT_MS)
      : 180000;
    if (fileExists(pkgSkillsDir)) {
      const skills = detectCustomSkills(pkgSkillsDir);
      if (skills.length > 0) {
        try {
          const bootstrapArgs = [MIGRATE_PATH, '--skills-dir', pkgSkillsDir, '--skills', ...skills, '--require-skill', 'genin-skill'];
          let run = spawnSync(process.execPath, [...bootstrapArgs, ...extraArgs], {
            encoding: 'utf-8', cwd: SKILLS_DB_DIR, timeout: safeTimeoutMs
          });
          if (run.status !== 0) {
            run = spawnSync(process.execPath, [...bootstrapArgs, '--skills-only', '--skip-embeddings'], {
              encoding: 'utf-8', cwd: SKILLS_DB_DIR, timeout: 120000
            });
          }
        } catch (_) {
          try {
            spawnSync(process.execPath, [MIGRATE_PATH, '--require-skill', 'genin-skill', ...extraArgs], {
              encoding: 'utf-8', cwd: SKILLS_DB_DIR, timeout: safeTimeoutMs
            });
          } catch (_) { /* intentional best-effort fallback */ }
        }
      }
    } else {
      try {
        spawnSync(process.execPath, [MIGRATE_PATH, '--require-skill', 'genin-skill', ...extraArgs], {
          encoding: 'utf-8', cwd: SKILLS_DB_DIR, timeout: safeTimeoutMs
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
  syncTemplateSkills,
  copySkillsDirFast,
  ensureAutoSetup,
  updateGeminiMd,
  moveUnusedSkills
};
