const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const https = require('https');
const { execSync, spawnSync } = require('child_process');
const deployUtils = require('./deploy_utils');

function validateInputs(repoUrl, skillName) {
  const skillNameRegex = /^[a-zA-Z0-9_-]+$/;
  if (!skillNameRegex.test(skillName)) {
    throw new Error('Invalid skill name. Only alphanumeric characters, dashes, and underscores are allowed.');
  }
  if (!repoUrl.startsWith('https://') && !repoUrl.startsWith('git@') && !repoUrl.startsWith('http://')) {
    throw new Error('Invalid repository URL. Must be a valid HTTPS or SSH Git URL.');
  }
}

const HOME = os.homedir();
const {
  AGENTS_SKILLS, AGENTS, GEMINI, ANTIGRAVITY_CLI
} = require('../bin/lib/paths');

let currentCwd = HOME;
try {
  currentCwd = process.cwd();
} catch (e) {
  if (process.env.PWD) {
    try {
      if (fs.existsSync(process.env.PWD)) {
        currentCwd = process.env.PWD;
      }
    } catch (_) {}
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
            } catch (e) {}
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
              } catch {}
              
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
      } catch {}
    }
  }
  return Object.values(installed);
}

// Search skills on skills.sh registry API
function searchRegistry(query) {
  return new Promise((resolve, reject) => {
    const url = `https://skills.sh/api/search?q=${encodeURIComponent(query)}`;
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
        } catch (e) {
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

  console.log(`🗑️  Removing skill folder: ${target.path}`);
  fs.rmSync(target.path, { recursive: true, force: true });

  const cursorPaths = [
    path.join(HOME, '.cursor', 'skills', name),
    path.join(currentCwd, '.cursor', 'skills', name)
  ];
  for (const cursorPath of cursorPaths) {
    if (fileExists(cursorPath)) {
      console.log(`🗑️  Removing Cursor mirror: ${cursorPath}`);
      fs.rmSync(cursorPath, { recursive: true, force: true });
    }
  }
  return target.path;
}

// Interactive search and install using readline
function runInteractiveSearch(query) {
  console.log(`🔍 Searching skills.sh for "${query}"...`);
  searchRegistry(query)
    .then((results) => {
      if (!results || results.length === 0) {
        console.log('❌ No skills found matching that query.');
        return;
      }

      console.log('\nResults from skills.sh:');
      console.log('────────────────────────────────────────────────────────────');
      
      const limitedResults = results.slice(0, 15); // Show top 15
      limitedResults.forEach((item, index) => {
        console.log(`[${index + 1}] ${item.skillId || item.name} (${item.installs || 0} installs)`);
        console.log(`    Source: github.com/${item.source}`);
      });
      console.log('────────────────────────────────────────────────────────────');

      if (!process.stdin || !process.stdin.isTTY) {
        console.log('❌ Interactive search requires a TTY terminal.');
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
          console.log('❌ Installation cancelled.');
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

        console.log(`\n📦 Installing "${skillName}" from ${repoUrl}...`);
        try {
          const runCmd = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
          const run = spawnSync(runCmd, ['dlx', 'skills', 'add', repoUrl, '--skill', skillName], { stdio: 'inherit', shell: false });
          if (run.status !== 0) throw new Error(`Process exited with status ${run.status}`);
          console.log(`\n✓ Skill "${skillName}" installed successfully!`);

          console.log('\n🔄 Re-indexing SQLite database...');
          const cliPath = path.join(__dirname, '..', 'bin', 'cli.js');
          const migrate = spawnSync('node', [cliPath, 'migrate'], { stdio: 'inherit', shell: false });
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
  validateInputs(repoUrl, skillName);
  console.log(`📦 Installing "${skillName}" from ${repoUrl}...`);
  const runCmd = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const run = spawnSync(runCmd, ['dlx', 'skills', 'add', repoUrl, '--skill', skillName], { stdio: 'inherit', shell: false });
  if (run.status !== 0) throw new Error(`Process exited with status ${run.status}`);
  console.log(`\n✓ Skill "${skillName}" installed successfully!`);

  syncAllClientSkills({ projectRoot: currentCwd, silent: false });

  console.log('\n🔄 Re-indexing SQLite database...');
  const cliPath = path.join(__dirname, '..', 'bin', 'cli.js');
  const migrate = spawnSync('node', [cliPath, 'migrate'], { stdio: 'inherit', shell: false });
  if (migrate.status !== 0) throw new Error(`Skill migration exited with status ${migrate.status}`);
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
  console.log(`🔍 Checking skills registry for "${skillName}"...`);
  try {
    const results = await searchRegistry(skillName);
    const found = results && results.find(item => (item.skillId === skillName || item.name === skillName));
    if (found && found.source) {
      const repoUrl = `https://github.com/${found.source}`;
      console.log(`📦 Found skill in registry: ${repoUrl}`);
      return addSkillDirect(repoUrl, skillName);
    }
  } catch (err) {
    console.log(`⚠️  Registry search skipped: ${err.message}`);
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
    console.log(`\n✓ Skill "${skillName}" created successfully at ${targetDir}`);
    deployUtils.syncCursorSkillsFromAgents({ deployProject: true, projectRoot: currentCwd, silent: false });

    console.log('\n🔄 Re-indexing SQLite database...');
    const cliPath = path.join(__dirname, '..', 'bin', 'cli.js');
    const migrate = spawnSync('node', [cliPath, 'migrate'], { stdio: 'inherit', shell: false });
    if (migrate.status !== 0) throw new Error(`Skill migration exited with status ${migrate.status}`);
    return targetDir;
  } else {
    console.log(`✓ Skill "${skillName}" is already installed locally.`);
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

  const syncedTargets = [];
  for (const target of targetDirs) {
    try {
      deployUtils.copySkillsDirFast(sourceSkillsDir, target);
      syncedTargets.push(target);
    } catch (e) {
      // Ignore if directory permissions restrict write
    }
  }

  if (!silent) {
    console.log(`✓ Synchronized all skills across ${syncedTargets.length} client directories.`);
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
      const run = spawnSync('node', [cliPath, 'migrate', '--skills-dir', dir], { stdio: 'pipe', encoding: 'utf8' });
      if (run.status === 0) {
        totalMigrated++;
      }
    } catch {}
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
