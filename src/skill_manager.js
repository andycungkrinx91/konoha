const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const https = require('https');
const { spawnSync, spawn } = require('child_process');
const deployUtils = require('./deploy_utils');
const skillGuardian = require('./workflow/kage-reviewer/skill_guardian');

function runAsyncSpawn(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, opts);
    let stdout = '';
    let stderr = '';
    if (child.stdout) child.stdout.on('data', d => { stdout += d.toString(); });
    if (child.stderr) child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', code => resolve({ status: code, stdout, stderr }));
  });
}

function validateSkillName(skillName) {
  if (!skillName || typeof skillName !== 'string') {
    throw new Error('Skill name must be a non-empty string.');
  }
  const clean = skillName.trim();
  const skillNameRegex = /^[a-zA-Z0-9_.-]+$/;
  if (!skillNameRegex.test(clean) || clean.includes('..') || clean.startsWith('/') || clean.startsWith('\\')) {
    throw new Error('Invalid skill name. Only alphanumeric characters, dashes, dots, and underscores are allowed.');
  }
  return clean;
}

function validateInputs(repoUrl, skillName) {
  validateSkillName(skillName);
  if (!repoUrl || typeof repoUrl !== 'string') {
    throw new Error('Repository URL must be a non-empty string.');
  }
  const cleanUrl = repoUrl.trim();
  if (/[\s;&|`$<>"'\\]/.test(cleanUrl) || /[\x00-\x1f]/.test(cleanUrl)) {
    throw new Error('Invalid repository URL: contains forbidden shell characters or whitespace.');
  }
  if (!cleanUrl.startsWith('https://') && !cleanUrl.startsWith('git@') && !cleanUrl.startsWith('http://') && !cleanUrl.startsWith('file://')) {
    throw new Error('Invalid repository URL. Must be a valid HTTPS, SSH, or local file:// Git URL.');
  }
}

const HOME = os.homedir();
const currentCwd = (() => {
  try { return process.cwd(); } catch (_) { return HOME; }
})();
const {
  AGENTS_SKILLS, AGENTS, ANTIGRAVITY_CLI
} = require('../bin/lib/paths');

function getSkillsScanDirs(_targetCwd = null) {
  const dirs = [
    path.join(AGENTS, 'skills'),
    path.join(ANTIGRAVITY_CLI, 'skills'),
    path.join(HOME, '.cursor', 'skills'),
    path.join(HOME, '.commandcode', 'skills'),
    path.join(HOME, '.claude', 'skills'),
    path.join(HOME, '.gemini', 'skills'),
    path.join(HOME, '.config', 'opencode', 'skills'),
    path.join(HOME, '.opencode', 'skills'),
    path.join(HOME, '.codex', 'skills'),
    path.join(HOME, '.omp', 'agent', 'skills'),
  ];
  return Array.from(new Set(dirs.filter(d => {
    try { return fs.existsSync(d) && fs.statSync(d).isDirectory(); } catch { return false; }
  })));
}

// Helper to check if file exists
function fileExists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function _isEntryDirectory(entry, dir) {
  if (entry.isDirectory()) return true;
  if (!entry.isSymbolicLink()) return false;
  try {
    const realPath = fs.realpathSync(path.join(dir, entry.name));
    return fs.statSync(realPath).isDirectory();
  } catch (_) {
    return false;
  }
}

function _readSkillDescription(skillMd) {
  try {
    const content = fs.readFileSync(skillMd, 'utf-8');
    const descMatch = /description:\s*["']?(.*?)["']?\s*$/m.exec(content);
    return descMatch && descMatch[1] ? descMatch[1].trim() : 'No description available';
  } catch (_) {
    return 'No description available';
  }
}

function _scanSkillsFromDir(dir, cwd, installed) {
  if (!fileExists(dir)) return;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!_isEntryDirectory(entry, dir)) continue;
      const skillMd = path.join(dir, entry.name, 'SKILL.md');
      if (!fileExists(skillMd)) continue;
      if (installed[entry.name] && !dir.startsWith(cwd)) continue;

      installed[entry.name] = {
        name: entry.name,
        path: path.join(dir, entry.name),
        description: _readSkillDescription(skillMd)
      };
    }
  } catch (_) { /* intentional best-effort fallback */ }
}

// List all installed skills across scan directories
function listInstalledSkills(targetCwd = null) {
  const installed = {};
  const scanDirs = getSkillsScanDirs(targetCwd);
  const cwd = targetCwd || process.cwd() || HOME;
  for (const dir of scanDirs) {
    _scanSkillsFromDir(dir, cwd, installed);
  }
  return Object.values(installed);
}

function _handleRegistryResponse(res, resolve, reject) {
  if (res.statusCode !== 200) {
    reject(new Error(`Failed to contact skills.sh API: ${res.statusCode}`));
    return;
  }
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    try {
      const payload = JSON.parse(data);
      resolve(payload.isDuplicate ? [] : (payload.skills || payload.results || payload));
    } catch (_) {
      reject(new Error('Failed to parse search results JSON'));
    }
  });
}

// Search skills on skills.sh registry API
function searchRegistry(query) {
  return new Promise((resolve, reject) => {
    const registryBase = process.env.KONOHA_SKILLS_REGISTRY_URL || 'https://skills.sh/api/search';
    const url = `${registryBase}?q=${encodeURIComponent(query)}`;
    const req = https.get(url, { headers: { 'User-Agent': 'konoha-cli' }, timeout: 8000 }, (res) => {
      _handleRegistryResponse(res, resolve, reject);
    });
    req.on('timeout', () => {
      req.destroy(new Error('skills.sh request timed out'));
    });
    req.on('error', (err) => {
      reject(err);
    });
  });
}

// Verify a skill is actually discoverable on disk after an install. The
// skills CLI can exit 0 without writing a discoverable SKILL.md (partial
// installs, upstream layout changes), so a zero exit code alone must NEVER
// be reported as success — that produced "install succeeded but the skill
// cannot be found anywhere" regressions reported from the web frontend.
function verifySkillInstalled(skillName, targetCwd = null) {
  const installed = listInstalledSkills(targetCwd);
  const hit = installed.find(s => s.name === skillName);
  return hit ? hit.path : null;
}

function skillNotFoundMessage(skillName, runOutput, targetCwd = null) {
  const scanned = getSkillsScanDirs(targetCwd).map(d => `- ${d}`).join('\n');
  let detail = '';
  if (runOutput) {
    const text = String(runOutput).trim();
    if (text) detail = `\nInstaller output (tail):\n${text.slice(-1500)}`;
  }
  return `Skill "${skillName}" was NOT found on disk after install. Scanned directories:\n${scanned}${detail}\nThe installer reported success but no SKILL.md is discoverable — refusing to claim success.`;
}

// Remove/delete an installed skill
function removeSkill(name, targetCwd = null) {
  const cwd = targetCwd || currentCwd;
  const installed = listInstalledSkills(cwd);
  const target = installed.find(s => s.name === name);
  if (!target) {
    throw new Error(`Skill "${name}" is not installed.`);
  }

  process.stderr.write(`🗑️  Removing skill folder: ${target.path}\n`);
  fs.rmSync(target.path, { recursive: true, force: true });

  const cursorPaths = [
    path.join(HOME, '.cursor', 'skills', name),
    path.join(cwd, '.cursor', 'skills', name)
  ];
  for (const cursorPath of cursorPaths) {
    if (fileExists(cursorPath)) {
      process.stderr.write(`🗑️  Removing Cursor mirror: ${cursorPath}\n`);
      fs.rmSync(cursorPath, { recursive: true, force: true });
    }
  }
  return target.path;
}

// Interactive search and install using readline
function runInteractiveSearch(query) {
  process.stderr.write(`🔍 Searching skills.sh for "${query}"...\n`);
  searchRegistry(query)
    .then((results) => {
      if (!results || results.length === 0) {
        process.stderr.write('❌ No skills found matching that query.\n');
        return;
      }

      process.stderr.write('\nResults from skills.sh:\n');
      process.stderr.write('────────────────────────────────────────────────────────────\n');
      
      const limitedResults = results.slice(0, 15); // Show top 15
      limitedResults.forEach((item, index) => {
        console.log(`[${index + 1}] ${item.skillId || item.name} (${item.installs || 0} installs)`);
        process.stderr.write(`    Source: github.com/${item.source}\n`);
      });
      process.stderr.write('────────────────────────────────────────────────────────────\n');

      if (!process.stdin || !process.stdin.isTTY) {
        process.stderr.write('❌ Interactive search requires a TTY terminal.\n');
        return;
      }

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      rl.question('\nEnter number to install (or press Enter to cancel): ', async (answer) => {
        rl.close();
        const num = parseInt(answer.trim(), 10);
        if (isNaN(num) || num < 1 || num > limitedResults.length) {
          process.stderr.write('❌ Installation cancelled.\n');
          return;
        }

        const selected = limitedResults[num - 1];
        const repoUrl = `https://github.com/${selected.source}`;
        const skillName = selected.skillId || selected.name;

        try {
          validateInputs(repoUrl, skillName);
        } catch (validationErr) {
          console.error(`❌ Validation failed: ${validationErr.message}`);
          return;
        }

        try {
          await addSkillDirect(repoUrl, skillName);
        } catch (err) {
          console.error(`❌ Installation failed: ${err.message}`);
        }
      });
    })
    .catch((err) => {
      console.error(`❌ Search error: ${err.message}`);
    });
}

function _syncInstalledSkillPaths(verifiedPath, skillName, execCwd) {
  const globalSkillDir = path.join(AGENTS, 'skills', skillName);
  if (verifiedPath !== globalSkillDir && !fs.existsSync(globalSkillDir)) {
    try {
      deployUtils.copySkillsDirFast(path.dirname(verifiedPath), path.join(AGENTS, 'skills'));
    } catch (_) { /* intentional best-effort fallback */ }
  }
  if (!execCwd || !fs.existsSync(execCwd)) return;
  const projectSkillDir = path.join(execCwd, '.agents', 'skills', skillName);
  if (verifiedPath !== projectSkillDir && !fs.existsSync(projectSkillDir)) {
    try {
      deployUtils.copySkillsDirFast(path.dirname(verifiedPath), path.join(execCwd, '.agents', 'skills'));
    } catch (_) { /* intentional best-effort fallback */ }
  }
}

// Add skill directly from a repository URL
async function addSkillDirect(repoUrl, skillName, options = {}) {
  let normalizedRepo = (repoUrl || '').trim();
  if (normalizedRepo && !normalizedRepo.startsWith('https://') && !normalizedRepo.startsWith('git@') && !normalizedRepo.startsWith('http://') && !normalizedRepo.startsWith('file://')) {
    if (normalizedRepo.includes('/') && !normalizedRepo.includes(' ')) {
      normalizedRepo = `https://github.com/${normalizedRepo}`;
    }
  }
  validateInputs(normalizedRepo, skillName);
  if (!options.skipGuardian) {
    return skillGuardian.installSkillWithGuardian(normalizedRepo, skillName, options);
  }
  process.stderr.write(`📦 Installing "${skillName}" from ${normalizedRepo}...\n`);
  const isWin = process.platform === 'win32';
  const execCwd = (options && options.projectRoot) || currentCwd;
  const { env: childEnv, nodePath: resolvedNode } = deployUtils.resolveCompatibleNodeEnv(process.env);

  let run = null;
  let pnpmError = null;
  const pnpmCmd = isWin ? 'pnpm.cmd' : 'pnpm';
  try {
    run = await runAsyncSpawn(pnpmCmd, ['dlx', 'skills', 'add', normalizedRepo, '--skill', skillName, '-y', '--agent', '*'], {
      cwd: execCwd,
      shell: isWin,
      env: childEnv
    });
    if (run.status !== 0) {
      pnpmError = (run.stderr && run.stderr.trim()) || (run.stdout && run.stdout.trim()) || `Process exited with status ${run.status}`;
    }
  } catch (err) {
    pnpmError = err.message;
  }

  if (!run || run.status !== 0) {
    throw new Error(`pnpm dlx skills add failed: ${pnpmError || 'Process exited with error'}`);
  }
  // Zero exit code is NOT proof of installation. Verify a discoverable
  // SKILL.md exists before reporting success so callers (CLI, MCP, web API)
  // can never be told an install landed when it did not.
  const verifiedPath = verifySkillInstalled(skillName, execCwd);
  if (!verifiedPath) {
    throw new Error(skillNotFoundMessage(skillName, run.stdout, execCwd));
  }
  process.stderr.write(`\n✓ Skill "${skillName}" installed successfully at ${verifiedPath}!\n`);

  _syncInstalledSkillPaths(verifiedPath, skillName, execCwd);

  syncAllClientSkills({ projectRoot: execCwd, silent: false });

  process.stderr.write('\n🔄 Re-indexing SQLite database and embedding vectors...\n');
  const cliPath = path.join(__dirname, '..', 'bin', 'cli.js');
  const migrate = await runAsyncSpawn(resolvedNode, [cliPath, 'migrate', '--skills-dir', path.dirname(verifiedPath)], {
    cwd: execCwd,
    shell: isWin,
    env: childEnv
  });
  if (migrate.status !== 0) {
    const migrateErr = (migrate.stderr && migrate.stderr.trim()) || (migrate.stdout && migrate.stdout.trim()) || `Skill migration exited with status ${migrate.status}`;
    process.stderr.write(`⚠️ Skill migration warning: ${migrateErr}\n`);
  }
  try {
    const mcpSkills = require('./mcp/skills');
    if (mcpSkills && typeof mcpSkills.clearSkillQueryCache === 'function') {
      mcpSkills.clearSkillQueryCache();
    }
  } catch (_) { /* best effort cache clearing */ }
  process.stderr.write(`✓ Skill "${skillName}" indexed in FTS5 database and vector search.\n`);
  return verifiedPath;
}

// Add skill either by name (lookup from registry or scaffold local) or direct repo URL
async function addSkill(nameOrUrl, optionalName, options = {}) {
  if (optionalName || nameOrUrl.startsWith('https://') || nameOrUrl.startsWith('git@') || nameOrUrl.startsWith('http://') || nameOrUrl.startsWith('file://')) {
    const repoUrl = nameOrUrl;
    const skillName = optionalName;
    if (!skillName) {
      throw new Error('Skill name must be specified when adding via repository URL.');
    }
    return addSkillDirect(repoUrl, skillName, options);
  }

  const skillName = validateSkillName(nameOrUrl);
  process.stderr.write(`🔍 Checking skills registry for "${skillName}"...\n`);
  try {
    const results = await searchRegistry(skillName);
    const found = results && results.find(item => (item.skillId === skillName || item.name === skillName));
    if (found && found.source) {
      const repoUrl = `https://github.com/${found.source}`;
      process.stderr.write(`📦 Found skill in registry: ${repoUrl}\n`);
      return addSkillDirect(repoUrl, skillName, options);
    }
  } catch (err) {
    process.stderr.write(`⚠️  Registry search skipped: ${err.message}\n`);
  }

  // If not found in registry or search failed, create custom local skill
  const targetDir = path.resolve(path.join(AGENTS_SKILLS, skillName));
  if (!targetDir.startsWith(path.resolve(AGENTS_SKILLS))) {
    throw new Error('Path traversal detected: target directory is outside skills path.');
  }
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
    const content = `---
name: ${skillName}
description: Custom skill for ${skillName}
---

# ${skillName} Skill

## Overview
Standard Operating Procedures and guidelines for ${skillName}.
`;
    fs.writeFileSync(path.join(targetDir, 'SKILL.md'), content, 'utf8');
    process.stderr.write(`\n✓ Skill "${skillName}" created successfully at ${targetDir}\n`);
    const execCwd = (options && options.projectRoot) || currentCwd;
    deployUtils.syncCursorSkillsFromAgents({ deployProject: true, projectRoot: execCwd, silent: false });

    process.stderr.write('\n🔄 Re-indexing SQLite database...\n');
    const cliPath = path.join(__dirname, '..', 'bin', 'cli.js');
    const { env: childEnv, nodePath: resolvedNode } = deployUtils.resolveCompatibleNodeEnv(process.env);
    const migrate = spawnSync(resolvedNode, [cliPath, 'migrate'], { stdio: 'inherit', shell: process.platform === 'win32', env: childEnv });
    if (migrate.status !== 0) throw new Error(`Skill migration exited with status ${migrate.status}`);
    return targetDir;
  } else {
    process.stderr.write(`✓ Skill "${skillName}" is already installed locally.\n`);
    return targetDir;
  }
}

function embedSkillInAgent(skillName, agentName) {
  const agentManager = require('./agent_manager');
  return agentManager.embedSkill(agentName, skillName);
}

function unembedSkillFromAgent(skillName, agentName) {
  const agentManager = require('./agent_manager');
  return agentManager.unembedSkill(agentName, skillName);
}

function syncAllClientSkills(options = {}) {
  const silent = options.silent !== false;
  const effectiveHome = options.home || process.env.HOME || process.env.USERPROFILE || HOME || require('os').homedir();
  const sourceSkillsDir = options.sourceSkillsDir || (
    fs.existsSync(path.join(__dirname, 'templates', 'skills'))
      ? path.join(__dirname, 'templates', 'skills')
      : (fs.existsSync(path.join(__dirname, '..', 'src', 'templates', 'skills'))
          ? path.join(__dirname, '..', 'src', 'templates', 'skills')
          : (fs.existsSync(path.join(effectiveHome, '.agents', 'skills'))
              ? path.join(effectiveHome, '.agents', 'skills')
              : path.join(__dirname, '..', '.agents', 'skills')))
  );

  if (!fs.existsSync(sourceSkillsDir)) return { synced: 0, targets: [] };

  const targetDirs = [
    path.resolve(effectiveHome, '.agents', 'skills'),
    path.resolve(effectiveHome, '.gemini', 'antigravity-cli', 'skills'),
    path.resolve(effectiveHome, '.gemini', 'skills'),
    path.resolve(effectiveHome, '.cursor', 'skills'),
    path.resolve(effectiveHome, '.claude', 'skills'),
    path.resolve(effectiveHome, '.commandcode', 'skills'),
    path.resolve(effectiveHome, '.codex', 'skills'),
    path.resolve(effectiveHome, '.config', 'opencode', 'skills'),
    path.resolve(effectiveHome, '.opencode', 'skills'),
    path.resolve(effectiveHome, '.pi', 'agent', 'skills'),
    path.resolve(effectiveHome, '.pi', 'skills'),
    path.resolve(effectiveHome, '.omp', 'agent', 'skills'),
    path.resolve(effectiveHome, '.omp', 'skills')
  ];

  const sourceFp = deployUtils.treeFingerprint(sourceSkillsDir);
  const syncedTargets = [];
  for (const target of targetDirs) {
    try {
      deployUtils.copySkillsDirFast(sourceSkillsDir, target, sourceFp);
      syncedTargets.push(target);
    } catch (_) {
      // Ignore if directory permissions restrict write
    }
  }

  if (!silent) {
    process.stderr.write(`✓ Synchronized skills to ${syncedTargets.length} mirror location(s)\n`);
  }

  return { synced: syncedTargets.length, targets: syncedTargets };
}

function autoMigrateProjectSkills(projectRoot) {
  const ws = projectRoot || currentCwd;
  if (!ws || !fs.existsSync(ws)) return { migrated: 0, skills: [], dirs: [] };

  const candidateDirs = [
    path.join(ws, '.agents', 'skills'),
    path.join(ws, 'skills'),
    path.join(ws, '.skills'),
    path.join(ws, '.cursor', 'skills'),
    path.join(ws, '.gemini', 'skills'),
    path.join(ws, '.gemini', 'antigravity-cli', 'skills'),
    path.join(ws, '.commandcode', 'skills'),
    path.join(ws, '.claude', 'skills'),
    path.join(ws, '.omp', 'skills'),
    path.join(ws, '.config', 'opencode', 'skills'),
    path.join(ws, '.opencode', 'skills'),
    path.join(ws, 'docs', 'skills')
  ];

  const foundDirs = candidateDirs.filter(d => fs.existsSync(d) && fs.statSync(d).isDirectory());
  if (foundDirs.length === 0) return { migrated: 0, skills: [], dirs: [] };

  const cliPath = path.join(__dirname, '..', 'bin', 'cli.js');
  const { env: childEnv, nodePath: resolvedNode } = deployUtils.resolveCompatibleNodeEnv(process.env);
  let totalMigrated = 0;
  for (const dir of foundDirs) {
    try {
      const run = spawnSync(resolvedNode, [cliPath, 'migrate', '--skip-embeddings', '--skills-dir', dir], { stdio: 'pipe', encoding: 'utf8', shell: process.platform === 'win32', env: childEnv });
      if (run.status === 0) {
        totalMigrated++;
      }
    } catch { /* intentional best-effort fallback */ }
  }

  try {
    deployUtils.pruneWorkspacePollution(ws);
  } catch (_) { /* intentional best-effort fallback */ }

  return { migrated: totalMigrated, dirs: foundDirs };
}

module.exports = {
  validateInputs,
  validateSkillName,
  listInstalledSkills,
  searchRegistry,
  removeSkill,
  runInteractiveSearch,
  addSkillDirect,
  addSkill,
  embedSkillInAgent,
  unembedSkillFromAgent,
  syncAllClientSkills,
  autoMigrateProjectSkills,
  scanSkillDirectory: skillGuardian.scanSkillDirectory,
  installSkillWithGuardian: skillGuardian.installSkillWithGuardian,
  GUARDIAN_THRESHOLD: skillGuardian.GUARDIAN_THRESHOLD
};
