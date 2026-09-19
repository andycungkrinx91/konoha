const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const https = require('https');
const { spawnSync } = require('child_process');
const deployUtils = require('./deploy_utils');

function validateInputs(repoUrl, skillName) {
  const skillNameRegex = /^[a-zA-Z0-9_.-]+$/;
  if (!skillNameRegex.test(skillName)) {
    throw new Error('Invalid skill name. Only alphanumeric characters, dashes, and underscores are allowed.');
  }
  if (!repoUrl.startsWith('https://') && !repoUrl.startsWith('git@') && !repoUrl.startsWith('http://')) {
    throw new Error('Invalid repository URL. Must be a valid HTTPS or SSH Git URL.');
  }
}

const HOME = os.homedir();
const currentCwd = (() => {
  try { return process.cwd(); } catch (_) { return HOME; }
})();
const {
  AGENTS_SKILLS, AGENTS, ANTIGRAVITY_CLI
} = require('../bin/lib/paths');

function getSkillsScanDirs(targetCwd = null) {
  let cwd = targetCwd || null;
  if (!cwd) {
    try { cwd = process.cwd(); } catch (_) { cwd = HOME; }
  }
  const dirs = [
    path.join(cwd, '.agents', 'skills'),
    path.join(cwd, '.cursor', 'skills'),
    path.join(cwd, '.gemini', 'skills'),
    path.join(cwd, '.commandcode', 'skills'),
    path.join(cwd, '.claude', 'skills'),
    path.join(cwd, 'skills'),
    path.join(cwd, '.skills'),
    path.join(cwd, 'agent', 'skills'),
    path.join(cwd, 'docs', 'skills'),
    path.join(AGENTS, 'skills'),
    path.join(ANTIGRAVITY_CLI, 'skills'),
    path.join(HOME, '.cursor', 'skills'),
    path.join(HOME, '.commandcode', 'skills'),
    path.join(HOME, '.claude', 'skills'),
    path.join(HOME, '.gemini', 'skills'),
    path.join(HOME, '.config', 'opencode', 'skills'),
    path.join(HOME, '.opencode', 'skills'),
    path.join(HOME, '.codex', 'skills'),
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

// List all installed skills across scan directories
function listInstalledSkills(targetCwd = null) {
  const installed = {};
  const scanDirs = getSkillsScanDirs(targetCwd);
  const cwd = targetCwd || process.cwd() || HOME;
  for (const dir of scanDirs) {
    if (fileExists(dir)) {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          let isDir = entry.isDirectory();
          if (entry.isSymbolicLink()) {
            try {
              const realPath = fs.realpathSync(path.join(dir, entry.name));
              isDir = fs.statSync(realPath).isDirectory();
            } catch (_) { /* intentional best-effort fallback */ }
          }
          if (isDir) {
            const skillMd = path.join(dir, entry.name, 'SKILL.md');
            if (fileExists(skillMd)) {
              let description = 'No description available';
              try {
                const content = fs.readFileSync(skillMd, 'utf-8');
                const descMatch = /description:\s*["']?(.*?)["']?\s*$/m.exec(content);
                if (descMatch && descMatch[1]) {
                  description = descMatch[1].trim();
                }
              } catch (_) { /* intentional best-effort fallback */ }
              
              // Prevent duplicates if found in multiple paths, prioritize workspace/cwd
              if (!installed[entry.name] || dir.startsWith(cwd)) {
                installed[entry.name] = {
                  name: entry.name,
                  path: path.join(dir, entry.name),
                  description
                };
              }
            }
          }
        }
      } catch (_) { /* intentional best-effort fallback */ }
    }
  }
  return Object.values(installed);
}

// Search skills on skills.sh registry API
function searchRegistry(query) {
  return new Promise((resolve, reject) => {
    const registryBase = process.env.KONOHA_SKILLS_REGISTRY_URL || 'https://skills.sh/api/search';
  const url = `${registryBase}?q=${encodeURIComponent(query)}`;
    const req = https.get(url, { headers: { 'User-Agent': 'konoha-cli' }, timeout: 8000 }, (res) => {
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

      rl.question('\nEnter number to install (or press Enter to cancel): ', (answer) => {
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

        process.stderr.write(`\n📦 Installing "${skillName}" from ${repoUrl}...\n`);
        try {
          const isWin = process.platform === 'win32';
          const { env: childEnv, nodePath: resolvedNode } = deployUtils.resolveCompatibleNodeEnv(process.env);
          let run = null;
          let pnpmError = null;
          const runCmd = isWin ? 'pnpm.cmd' : 'pnpm';
          try {
            run = spawnSync(runCmd, ['dlx', 'skills', 'add', repoUrl, '--skill', skillName, '-y', '--agent', '*'], { stdio: 'inherit', shell: isWin, env: childEnv });
            if (run.status !== 0) {
              pnpmError = `Process exited with status ${run.status}`;
            }
          } catch (err) {
            pnpmError = err.message;
          }
          if (!run || run.status !== 0) {
            process.stderr.write(`⚠️ pnpm dlx failed (${pnpmError || 'unknown error'}). Attempting fallback via npx...\n`);
            const npxCmd = isWin ? 'npx.cmd' : 'npx';
            run = spawnSync(npxCmd, ['-y', 'skills', 'add', repoUrl, '--skill', skillName, '-y', '--agent', '*'], { stdio: 'inherit', shell: isWin, env: childEnv });
          }
          if (!run || run.status !== 0) throw new Error(`Process exited with status ${run ? run.status : 1}`);
          const verifiedPath = verifySkillInstalled(skillName);
          if (!verifiedPath) throw new Error(skillNotFoundMessage(skillName));
          process.stderr.write(`\n✓ Skill "${skillName}" installed successfully at ${verifiedPath}!\n`);

          process.stderr.write('\n🔄 Re-indexing SQLite database...\n');
          const cliPath = path.join(__dirname, '..', 'bin', 'cli.js');
          const migrate = spawnSync(resolvedNode, [cliPath, 'migrate'], { stdio: 'inherit', shell: isWin, env: childEnv });
          if (migrate.status !== 0) throw new Error(`Skill migration exited with status ${migrate.status}`);
        } catch (err) {
          console.error(`❌ Installation failed: ${err.message}`);
        }
      });
    })
    .catch((err) => {
      console.error(`❌ Search error: ${err.message}`);
    });
}

// Add skill directly from a repository URL
function addSkillDirect(repoUrl, skillName, options = {}) {
  let normalizedRepo = (repoUrl || '').trim();
  if (normalizedRepo && !normalizedRepo.startsWith('https://') && !normalizedRepo.startsWith('git@') && !normalizedRepo.startsWith('http://')) {
    if (normalizedRepo.includes('/') && !normalizedRepo.includes(' ')) {
      normalizedRepo = `https://github.com/${normalizedRepo}`;
    }
  }
  validateInputs(normalizedRepo, skillName);
  process.stderr.write(`📦 Installing "${skillName}" from ${normalizedRepo}...\n`);
  const isWin = process.platform === 'win32';
  const execCwd = (options && options.projectRoot) || currentCwd;
  const { env: childEnv, nodePath: resolvedNode } = deployUtils.resolveCompatibleNodeEnv(process.env);

  let run = null;
  let pnpmError = null;
  const pnpmCmd = isWin ? 'pnpm.cmd' : 'pnpm';
  try {
    run = spawnSync(pnpmCmd, ['dlx', 'skills', 'add', normalizedRepo, '--skill', skillName, '-y', '--agent', '*'], {
      cwd: execCwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: isWin,
      env: childEnv
    });
    if (run.status !== 0) {
      pnpmError = (run.stderr && run.stderr.toString().trim()) || (run.stdout && run.stdout.toString().trim()) || `Process exited with status ${run.status}`;
    }
  } catch (err) {
    pnpmError = err.message;
  }

  if (!run || run.status !== 0) {
    process.stderr.write(`⚠️ pnpm dlx failed (${pnpmError || 'unknown error'}). Attempting fallback via npx...\n`);
    try {
      const npxCmd = isWin ? 'npx.cmd' : 'npx';
      const npxRun = spawnSync(npxCmd, ['-y', 'skills', 'add', normalizedRepo, '--skill', skillName, '-y', '--agent', '*'], {
        cwd: execCwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: isWin,
        env: childEnv
      });
      if (npxRun && npxRun.status === 0) {
        run = npxRun;
      } else {
        const npxError = (npxRun && ((npxRun.stderr && npxRun.stderr.toString().trim()) || (npxRun.stdout && npxRun.stdout.toString().trim())));
        throw new Error(npxError || pnpmError || `Process exited with status ${run ? run.status : (npxRun ? npxRun.status : 1)}`);
      }
    } catch (fallbackErr) {
      throw new Error(fallbackErr.message || pnpmError || 'Process exited with error');
    }
  }
  // Zero exit code is NOT proof of installation. Verify a discoverable
  // SKILL.md exists before reporting success so callers (CLI, MCP, web API)
  // can never be told an install landed when it did not.
  const verifiedPath = verifySkillInstalled(skillName, execCwd);
  if (!verifiedPath) {
    throw new Error(skillNotFoundMessage(skillName, run.stdout && run.stdout.toString(), execCwd));
  }
  process.stderr.write(`\n✓ Skill "${skillName}" installed successfully at ${verifiedPath}!\n`);

  // Ensure skill is synced to global ~/.agents/skills if installed in project, or vice-versa
  const globalSkillDir = path.join(AGENTS, 'skills', skillName);
  if (verifiedPath !== globalSkillDir && !fs.existsSync(globalSkillDir)) {
    try {
      deployUtils.copySkillsDirFast(path.dirname(verifiedPath), path.join(AGENTS, 'skills'));
    } catch (_) { /* intentional best-effort fallback */ }
  }
  if (execCwd && fs.existsSync(execCwd)) {
    const projectSkillDir = path.join(execCwd, '.agents', 'skills', skillName);
    if (verifiedPath !== projectSkillDir && !fs.existsSync(projectSkillDir)) {
      try {
        deployUtils.copySkillsDirFast(path.dirname(verifiedPath), path.join(execCwd, '.agents', 'skills'));
      } catch (_) { /* intentional best-effort fallback */ }
    }
  }

  syncAllClientSkills({ projectRoot: execCwd, silent: false });

  process.stderr.write('\n🔄 Re-indexing SQLite database and embedding vectors...\n');
  const cliPath = path.join(__dirname, '..', 'bin', 'cli.js');
  const migrate = spawnSync(resolvedNode, [cliPath, 'migrate', '--skills-dir', path.dirname(verifiedPath)], {
    cwd: execCwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: isWin,
    env: childEnv
  });
  if (migrate.status !== 0) {
    const migrateErr = (migrate.stderr && migrate.stderr.toString().trim()) || (migrate.stdout && migrate.stdout.toString().trim()) || `Skill migration exited with status ${migrate.status}`;
    process.stderr.write(`⚠️ Skill migration warning: ${migrateErr}\n`);
  }
  process.stderr.write(`✓ Skill "${skillName}" indexed in FTS5 database and vector search.\n`);
  return verifiedPath;
}

// Add skill either by name (lookup from registry or scaffold local) or direct repo URL
async function addSkill(nameOrUrl, optionalName, options = {}) {
  if (optionalName || nameOrUrl.startsWith('https://') || nameOrUrl.startsWith('git@') || nameOrUrl.startsWith('http://')) {
    const repoUrl = nameOrUrl;
    const skillName = optionalName;
    if (!skillName) {
      throw new Error('Skill name must be specified when adding via repository URL.');
    }
    return addSkillDirect(repoUrl, skillName, options);
  }

  const skillName = nameOrUrl;
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
  const targetDir = path.join(AGENTS_SKILLS, skillName);
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
  const projectRoot = options.projectRoot || null;
  const sourceSkillsDir = options.sourceSkillsDir || (
    fs.existsSync(path.join(__dirname, '..', 'src', 'templates', 'skills'))
      ? path.join(__dirname, '..', 'src', 'templates', 'skills')
      : (fs.existsSync(path.join(HOME, '.agents', 'skills'))
          ? path.join(HOME, '.agents', 'skills')
          : path.join(__dirname, '..', '.agents', 'skills'))
  );

  if (!fs.existsSync(sourceSkillsDir)) return { synced: 0, targets: [] };

  const targetDirs = [
    path.join(HOME, '.cursor', 'skills'),
    path.join(HOME, '.gemini', 'antigravity-cli', 'skills'),
    path.join(HOME, '.claude', 'skills'),
    path.join(HOME, '.config', 'opencode', 'skills'),
    path.join(HOME, '.opencode', 'skills'),
    path.join(HOME, '.commandcode', 'skills'),
    path.join(HOME, '.codex', 'skills'),
  ];

  if (projectRoot && fs.existsSync(projectRoot)) {
    targetDirs.push(path.join(projectRoot, '.cursor', 'skills'));
    targetDirs.push(path.join(projectRoot, '.gemini', 'skills'));
    targetDirs.push(path.join(projectRoot, '.commandcode', 'skills'));
    targetDirs.push(path.join(projectRoot, '.claude', 'skills'));
    targetDirs.push(path.join(projectRoot, '.agents', 'skills'));
    if (fs.existsSync(path.join(projectRoot, '.config', 'opencode'))) {
      targetDirs.push(path.join(projectRoot, '.config', 'opencode', 'skills'));
    }
    if (fs.existsSync(path.join(projectRoot, '.opencode'))) {
      targetDirs.push(path.join(projectRoot, '.opencode', 'skills'));
    }
  }

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
    process.stderr.write(`✓ Synchronized all skills across ${syncedTargets.length} client directories.\n`);
  }

  return { synced: syncedTargets.length, targets: syncedTargets };
}

function autoMigrateProjectSkills(projectRoot) {
  const ws = projectRoot || currentCwd;
  if (!ws || !fs.existsSync(ws)) return { migrated: 0, skills: [] };

  const candidateDirs = [
    path.join(ws, '.agents', 'skills'),
    path.join(ws, 'skills'),
    path.join(ws, '.skills'),
    path.join(ws, '.cursor', 'skills'),
    path.join(ws, '.gemini', 'skills'),
    path.join(ws, '.gemini', 'antigravity-cli', 'skills'),
    path.join(ws, '.claude', 'skills'),
    path.join(ws, 'agent', 'skills'),
    path.join(ws, 'docs', 'skills')
  ];

  const foundDirs = candidateDirs.filter(d => fs.existsSync(d) && fs.statSync(d).isDirectory());
  if (foundDirs.length === 0) return { migrated: 0, skills: [] };

  const cliPath = path.join(__dirname, '..', 'bin', 'cli.js');
  const { env: childEnv, nodePath: resolvedNode } = deployUtils.resolveCompatibleNodeEnv(process.env);
  let totalMigrated = 0;
  for (const dir of foundDirs) {
    try {
      const run = spawnSync(resolvedNode, [cliPath, 'migrate', '--skip-embeddings', '--skills-dir', dir], { stdio: 'pipe', encoding: 'utf8', shell: process.platform === 'win32', env: childEnv });
      if (run.status === 0) {
        totalMigrated++;
      }
    } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }
  return { migrated: totalMigrated, dirs: foundDirs };
}

module.exports = {
  listInstalledSkills,
  searchRegistry,
  removeSkill,
  runInteractiveSearch,
  addSkillDirect,
  addSkill,
  embedSkillInAgent,
  unembedSkillFromAgent,
  syncAllClientSkills,
  autoMigrateProjectSkills
};
