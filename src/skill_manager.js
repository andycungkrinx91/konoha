const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { execSync, spawnSync } = require('child_process');
const readline = require('readline');

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
const DEFAULT_SKILLS_DIRS = [
  path.join(HOME, '.agents', 'skills'),
  path.join(HOME, '.gemini', 'antigravity-cli', 'skills'),
  path.join(process.cwd(), '.agents', 'skills'),
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
          if (entry.isDirectory()) {
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
              if (!installed[entry.name] || dir.startsWith(process.cwd())) {
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
          const runCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
          const run = spawnSync(runCmd, ['skills', 'add', repoUrl, '--skill', skillName], { stdio: 'inherit' });
          if (run.status !== 0) throw new Error(`Process exited with status ${run.status}`);
          console.log(`\n✓ Skill "${skillName}" installed successfully!`);
          
          console.log('\n🔄 Re-indexing SQLite database...');
          const cliPath = path.join(__dirname, '..', 'bin', 'cli.js');
          spawnSync('node', [cliPath, 'migrate'], { stdio: 'inherit' });
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
  const runCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const run = spawnSync(runCmd, ['skills', 'add', repoUrl, '--skill', skillName], { stdio: 'inherit' });
  if (run.status !== 0) throw new Error(`Process exited with status ${run.status}`);
  console.log(`\n✓ Skill "${skillName}" installed successfully!`);
  
  console.log('\n🔄 Re-indexing SQLite database...');
  const cliPath = path.join(__dirname, '..', 'bin', 'cli.js');
  spawnSync('node', [cliPath, 'migrate'], { stdio: 'inherit' });
}

module.exports = {
  listInstalledSkills,
  searchRegistry,
  removeSkill,
  runInteractiveSearch,
  addSkillDirect
};
