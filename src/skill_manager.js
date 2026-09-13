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
const {
  AGENTS_SKILLS, AGENTS, ANTIGRAVITY_CLI
} = require('../bin/lib/paths');

let currentCwd = HOME;
try {
  currentCwd = process.cwd();
} catch (_) {
  if (process.env.PWD) {
    try {
      if (fs.existsSync(process.env.PWD)) {
        currentCwd = process.env.PWD;
      }
    } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }
}

const DEFAULT_SKILLS_DIRS = [
  path.join(currentCwd, '.agents', 'skills'),
  path.join(currentCwd, '.cursor', 'skills'),
  path.join(currentCwd, 'skills'),
  path.join(currentCwd, '.skills'),
  path.join(currentCwd, 'docs', 'skills'),
  path.join(AGENTS, 'skills'),
  path.join(ANTIGRAVITY_CLI, 'skills'),
];

// Helper to check if file exists
function fileExists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

// List all installed skills across scan directories
function listInstalledSkills() {
  const installed = {};
  for (const dir of DEFAULT_SKILLS_DIRS) {
    if (fileExists(dir)) {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          let isDir = entry.isDirectory();
          if (entry.isSymbolicLink()) {
            try {
              const realPath = fs.realpathSync(path.join(dir, entry.name));
              isDir = fs.statSync(realPath).isDirectory();
            } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
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
              } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
              
              // Prevent duplicates if found in multiple paths, prioritize workspace/cwd
              if (!installed[entry.name] || dir.startsWith(currentCwd)) {
                installed[entry.name] = {
                  name: entry.name,
                  path: path.join(dir, entry.name),
                  description
                };
              }
            }
          }
        }
      } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
    }
  }
  return Object.values(installed);
}

// Search skills on skills.sh registry API
function searchRegistry(query) {
  return new Promise((resolve, reject) => {
    const registryBase = process.env.KONOHA_SKILLS_REGISTRY_URL || 'https://skills.sh/api/search';
  const url = `${registryBase}?q=${encodeURIComponent(query)}`;
    https.get(url, { headers: { 'User-Agent': 'konoha-cli' } }, (res) => {
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
    }).on('error', (err) => {
      reject(err);
    });
  });
}

// Remove/delete an installed skill
function removeSkill(name) {
  const installed = listInstalledSkills();
  const target = installed.find(s => s.name === name);
  if (!target) {
    throw new Error(`Skill "${name}" is not installed.`);
  }

  process.stderr.write(`🗑️  Removing skill folder: ${target.path}\n`);
  fs.rmSync(target.path, { recursive: true, force: true });

  const cursorPaths = [
    path.join(HOME, '.cursor', 'skills', name),
    path.join(currentCwd, '.cursor', 'skills', name)
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
          const runCmd = isWin ? 'pnpm.cmd' : 'pnpm';
          const run = spawnSync(runCmd, ['dlx', 'skills', 'add', repoUrl, '--skill', skillName, '-y', '--agent', '*'], { stdio: 'inherit', shell: isWin });
          if (run.status !== 0) throw new Error(`Process exited with status ${run.status}`);
          process.stderr.write(`\n✓ Skill "${skillName}" installed successfully!\n`);

          process.stderr.write('\n🔄 Re-indexing SQLite database...\n');
          const cliPath = path.join(__dirname, '..', 'bin', 'cli.js');
          const migrate = spawnSync(process.execPath || 'node', [cliPath, 'migrate'], { stdio: 'inherit', shell: isWin });
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
function addSkillDirect(repoUrl, skillName) {
  let normalizedRepo = (repoUrl || '').trim();
  if (normalizedRepo && !normalizedRepo.startsWith('https://') && !normalizedRepo.startsWith('git@') && !normalizedRepo.startsWith('http://')) {
    if (normalizedRepo.includes('/') && !normalizedRepo.includes(' ')) {
      normalizedRepo = `https://github.com/${normalizedRepo}`;
    }
  }
  validateInputs(normalizedRepo, skillName);
  process.stderr.write(`📦 Installing "${skillName}" from ${normalizedRepo}...\n`);
  const isWin = process.platform === 'win32';
  const runCmd = isWin ? 'pnpm.cmd' : 'pnpm';
  const run = spawnSync(runCmd, ['dlx', 'skills', 'add', normalizedRepo, '--skill', skillName, '-y', '--agent', '*'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: isWin
  });
  if (run.status !== 0) {
    const errorMsg = (run.stderr && run.stderr.toString().trim()) || (run.stdout && run.stdout.toString().trim()) || `Process exited with status ${run.status}`;
    throw new Error(errorMsg);
  }
  process.stderr.write(`\n✓ Skill "${skillName}" installed successfully!\n`);

  syncAllClientSkills({ projectRoot: currentCwd, silent: false });

  process.stderr.write('\n🔄 Re-indexing SQLite database...\n');
  const cliPath = path.join(__dirname, '..', 'bin', 'cli.js');
  const migrate = spawnSync(process.execPath || 'node', [cliPath, 'migrate'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: isWin
  });
  if (migrate.status !== 0) {
    const migrateErr = (migrate.stderr && migrate.stderr.toString().trim()) || (migrate.stdout && migrate.stdout.toString().trim()) || `Skill migration exited with status ${migrate.status}`;
    throw new Error(migrateErr);
  }
}

// Add skill either by name (lookup from registry or scaffold local) or direct repo URL
async function addSkill(nameOrUrl, optionalName) {
  if (optionalName || nameOrUrl.startsWith('https://') || nameOrUrl.startsWith('git@') || nameOrUrl.startsWith('http://')) {
    const repoUrl = nameOrUrl;
    const skillName = optionalName;
    if (!skillName) {
      throw new Error('Skill name must be specified when adding via repository URL.');
    }
    return addSkillDirect(repoUrl, skillName);
  }

  const skillName = nameOrUrl;
  process.stderr.write(`🔍 Checking skills registry for "${skillName}"...\n`);
  try {
    const results = await searchRegistry(skillName);
    const found = results && results.find(item => (item.skillId === skillName || item.name === skillName));
    if (found && found.source) {
      const repoUrl = `https://github.com/${found.source}`;
      process.stderr.write(`📦 Found skill in registry: ${repoUrl}\n`);
      return addSkillDirect(repoUrl, skillName);
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
    deployUtils.syncCursorSkillsFromAgents({ deployProject: true, projectRoot: currentCwd, silent: false });

    process.stderr.write('\n🔄 Re-indexing SQLite database...\n');
    const cliPath = path.join(__dirname, '..', 'bin', 'cli.js');
    const migrate = spawnSync(process.execPath || 'node', [cliPath, 'migrate'], { stdio: 'inherit', shell: process.platform === 'win32' });
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
    targetDirs.push(path.join(projectRoot, '.agents', 'skills'));
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
    path.join(ws, '.cursor', 'skills'),
    path.join(ws, '.gemini', 'skills'),
    path.join(ws, '.gemini', 'antigravity-cli', 'skills'),
  ];

  const foundDirs = candidateDirs.filter(d => fs.existsSync(d) && fs.statSync(d).isDirectory());
  if (foundDirs.length === 0) return { migrated: 0, skills: [] };

  const cliPath = path.join(__dirname, '..', 'bin', 'cli.js');
  let totalMigrated = 0;
  for (const dir of foundDirs) {
    try {
      const run = spawnSync(process.execPath || 'node', [cliPath, 'migrate', '--skills-dir', dir], { stdio: 'pipe', encoding: 'utf8', shell: process.platform === 'win32' });
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
