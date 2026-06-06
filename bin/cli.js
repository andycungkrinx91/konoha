#!/usr/bin/env node

/**
 * konoha CLI
 * 
 * SQLite FTS5 Skills-DB installer for Antigravity IDE/CLI.
 * Migrates agent skills into a searchable MCP server to reduce token usage.
 *
 * Usage:
 *   npx konoha init          # Install MCP server + migrate skills
 *   npx konoha migrate       # Re-run migration (after editing skills)
 *   npx konoha test          # Test MCP server search
 *   npx konoha status        # Show installation status
 *   npx konoha uninstall     # Remove skills-db
 * 
 * Cross-platform: Linux, macOS, Windows
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawn, spawnSync } = require('child_process');

const agentManager = require('../src/agent_manager');
const skillManager = require('../src/skill_manager');

// ─── Constants ───────────────────────────────────────────────────────────────

const HOME = os.homedir();
const SKILLS_DB_DIR = path.join(HOME, '.gemini', 'skills-db');
const MCP_CONFIG_PATH = path.join(HOME, '.gemini', 'config', 'mcp_config.json');
const GEMINI_MD_PATH = path.join(HOME, '.gemini', 'GEMINI.md');
const AGENTS_MD_PATH = path.join(HOME, '.agents', 'AGENTS.md');
const DB_PATH = path.join(SKILLS_DB_DIR, 'skills.db');
const SERVER_PATH = path.join(SKILLS_DB_DIR, 'server.py');
const MIGRATE_PATH = path.join(SKILLS_DB_DIR, 'migrate.py');

const SRC_DIR = path.join(__dirname, '..', 'src');
const DOCS_DIR = path.join(__dirname, '..', 'docs');

// Default skills directories to scan
const DEFAULT_SKILLS_DIRS = [
  path.join(HOME, '.agents', 'skills'),
  path.join(HOME, '.gemini', 'antigravity-cli', 'skills'),
  path.join(process.cwd(), '.agents', 'skills'),
];

// Colors for terminal output
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function log(msg) { console.log(msg); }
function info(msg) { log(`${C.cyan}ℹ${C.reset} ${msg}`); }
function success(msg) { log(`${C.green}✓${C.reset} ${msg}`); }
function warn(msg) { log(`${C.yellow}⚠${C.reset} ${msg}`); }
function error(msg) { log(`${C.red}✗${C.reset} ${msg}`); }
function header(msg) { log(`\n${C.bold}${C.blue}${msg}${C.reset}`); }
function divider() { log(`${C.dim}${'─'.repeat(60)}${C.reset}`); }

function fileExists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest) {
  fs.copyFileSync(src, dest);
}

function checkPython() {
  const cmds = ['python3', 'python'];
  for (const cmd of cmds) {
    try {
      const version = execSync(`${cmd} --version 2>&1`, { encoding: 'utf-8' }).trim();
      if (version.includes('Python 3')) {
        return cmd;
      }
    } catch {}
  }
  return null;
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
      } catch {}
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

// ─── Commands ────────────────────────────────────────────────────────────────

function cmdInit(args) {
  header('🚀 Konoha Installer');
  divider();
  log(`${C.dim}SQLite FTS5 Skills-DB for Antigravity IDE/CLI${C.reset}`);
  log(`${C.dim}Reduces token usage by 83-98% via on-demand skill search${C.reset}\n`);

  // 1. Check Python
  info('Checking Python 3...');
  const python = checkPython();
  if (!python) {
    error('Python 3 is required but not found.');
    log('  Install from: https://www.python.org/downloads/');
    process.exit(1);
  }
  success(`Python 3 found: ${python}`);

  // 2. Check for existing installation
  if (fileExists(SERVER_PATH) && fileExists(DB_PATH)) {
    warn('Skills-DB already installed.');
    info(`Database: ${DB_PATH}`);
    info(`Server: ${SERVER_PATH}`);
    log('');
    info('Use "konoha migrate" to re-index skills.');
    info('Use "konoha status" to check status.');

    if (!args.includes('--force')) {
      log(`\n${C.dim}Run with --force to reinstall.${C.reset}`);
      return;
    }
    warn('Reinstalling (--force)...');
  }

  // 3. Detect skills directories
  info('Detecting skills directories...');
  const skillsDirs = detectSkillsDirs();

  if (skillsDirs.length === 0) {
    warn('No skills directories found with SKILL.md files.');
    info('Expected locations:');
    DEFAULT_SKILLS_DIRS.forEach(d => info(`  ${d}`));
    log('');
    info('You can still install the server and migrate manually later.');
    info('Use: konoha migrate --skills-dir /path/to/skills');
  } else {
    skillsDirs.forEach(s => {
      success(`Found: ${s.path} (${s.count} skills)`);
    });
  }

  // 4. Install server files
  header('📦 Installing MCP Server');
  ensureDir(SKILLS_DB_DIR);

  // Copy basic subagent skills to global directory
  const pkgSkillsDir = path.join(__dirname, '..', '.agents', 'skills');
  const globalSkillsDir = path.join(HOME, '.agents', 'skills');
  if (fileExists(pkgSkillsDir)) {
    ensureDir(globalSkillsDir);
    try {
      const files = fs.readdirSync(pkgSkillsDir);
      files.forEach(file => {
        if (file.endsWith('-skill.md')) {
          const srcPath = path.join(pkgSkillsDir, file);
          const destPath = path.join(globalSkillsDir, file);
          copyFile(srcPath, destPath);
          success(`Installed global basic skill: ${file}`);
        }
      });
    } catch (err) {
      warn(`Failed to copy basic subagent skills: ${err.message}`);
    }
  }

  copyFile(path.join(SRC_DIR, 'server.py'), SERVER_PATH);
  success(`Installed: ${SERVER_PATH}`);

  copyFile(path.join(SRC_DIR, 'migrate.py'), MIGRATE_PATH);
  success(`Installed: ${MIGRATE_PATH}`);

  const statsScriptSrc = path.join(SRC_DIR, 'db_stats.py');
  const statsScriptDest = path.join(SKILLS_DB_DIR, 'db_stats.py');
  if (fileExists(statsScriptSrc)) {
    copyFile(statsScriptSrc, statsScriptDest);
    success(`Installed: ${statsScriptDest}`);
  }

  const savingsScriptSrc = path.join(SRC_DIR, 'db_savings.py');
  const savingsScriptDest = path.join(SKILLS_DB_DIR, 'db_savings.py');
  if (fileExists(savingsScriptSrc)) {
    copyFile(savingsScriptSrc, savingsScriptDest);
    success(`Installed: ${savingsScriptDest}`);
  }

  // 5. Run migration
  if (skillsDirs.length > 0) {
    header('📊 Migrating Skills to SQLite FTS5');
    
    for (const s of skillsDirs) {
      const skills = detectCustomSkills(s.path);
      if (skills.length === 0) continue;
      
      info(`Migrating from: ${s.path}`);
      info(`Skills found: ${skills.join(', ')}`);
      log('');

      try {
        const run = spawnSync(python, [MIGRATE_PATH, '--skills-dir', s.path, '--skills', ...skills], {
          encoding: 'utf-8', cwd: SKILLS_DB_DIR, timeout: 30000
        });
        if (run.status !== 0) throw new Error(run.stderr || 'Migration failed');
        log(run.stdout);
      } catch (e) {
        // Fallback: run without args (uses defaults in script)
        try {
          const runFallback = spawnSync(python, [MIGRATE_PATH], {
            encoding: 'utf-8', cwd: SKILLS_DB_DIR, timeout: 30000
          });
          if (runFallback.status !== 0) throw new Error(runFallback.stderr || 'Migration fallback failed');
          log(runFallback.stdout);
        } catch (e2) {
          error(`Migration failed for ${s.path}: ${e2.message}`);
        }
      }
    }
  }

  // 6. Register MCP config
  header('⚙️  Registering MCP Server');
  registerMcp(python);

  // 7. Update GEMINI.md
  header('📝 Updating GEMINI.md');
  updateGeminiMd();

  // 8. Update AGENTS.md
  header('👥 Updating AGENTS.md');
  updateAgentsMd();

  // 9. Summary
  header('✅ Installation Complete!');
  divider();
  log('');
  success('Skills-DB MCP server installed and configured.');
  log('');
  info(`${C.bold}Files created:${C.reset}`);
  log(`  ${C.dim}Server:${C.reset}    ${SERVER_PATH}`);
  log(`  ${C.dim}Migration:${C.reset} ${MIGRATE_PATH}`);
  log(`  ${C.dim}Database:${C.reset}  ${DB_PATH}`);
  log(`  ${C.dim}MCP Config:${C.reset} ${MCP_CONFIG_PATH}`);
  log(`  ${C.dim}GEMINI.md:${C.reset}  ${GEMINI_MD_PATH}`);
  log(`  ${C.dim}AGENTS.md:${C.reset}  ${AGENTS_MD_PATH}`);
  log('');

  info(`${C.bold}Next steps:${C.reset}`);
  log(`  1. Restart Antigravity IDE/CLI to pick up the new MCP server`);
  log(`  2. Test: ${C.cyan}npx konoha test${C.reset}`);
  log(`  3. Check: ${C.cyan}npx konoha status${C.reset}`);
  log('');

  info(`${C.bold}For Antigravity IDE:${C.reset}`);
  log(`  The MCP server is auto-detected from mcp_config.json.`);
  log(`  Update your IDE user_rules with the new subagent definitions from GEMINI.md.`);
  log('');

  info(`${C.bold}For Antigravity CLI (agy):${C.reset}`);
  log(`  The MCP server is auto-detected from mcp_config.json.`);
  log(`  Run: ${C.cyan}agy inspect${C.reset} to verify skills-db is loaded.`);
  log('');
}

function installUv() {
  info('Attempting to auto-install "uv" for Semble MCP...');
  try {
    if (process.platform === 'win32') {
      execSync('powershell -ExecutionPolicy Bypass -Command "irm https://astral.sh/uv/install.ps1 | iex"', { stdio: 'inherit' });
    } else {
      execSync('curl -LsSf https://astral.sh/uv/install.sh | sh', { stdio: 'inherit' });
    }
    success('uv installed successfully!');
    return true;
  } catch (err) {
    warn(`Failed to auto-install uv: ${err.message}`);
    log('Please install uv manually: https://docs.astral.sh/uv/');
    return false;
  }
}

function getUvCommand() {
  try {
    execSync('uv --version', { stdio: 'ignore' });
    return 'uv';
  } catch {}

  const home = os.homedir();
  const localPaths = [];
  if (process.platform === 'win32') {
    localPaths.push(
      path.join(home, '.local', 'bin', 'uv.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'programs', 'uv', 'uv.exe')
    );
  } else {
    localPaths.push(
      path.join(home, '.local', 'bin', 'uv'),
      path.join(home, '.cargo', 'bin', 'uv'),
      '/usr/local/bin/uv',
      '/usr/bin/uv'
    );
  }

  for (const p of localPaths) {
    if (p && fileExists(p)) {
      try {
        execSync(`"${p}" --version`, { stdio: 'ignore' });
        return p;
      } catch {}
    }
  }

  return null;
}

function registerMcp(python) {
  const pythonCmd = python || checkPython() || 'python3';
  
  ensureDir(path.dirname(MCP_CONFIG_PATH));

  let config = { mcpServers: {} };

  if (fileExists(MCP_CONFIG_PATH)) {
    try {
      config = JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, 'utf-8'));
      if (!config.mcpServers) config.mcpServers = {};
      info('Existing MCP config found, registering servers...');
    } catch {
      warn('Could not parse existing MCP config, creating new one...');
      config = { mcpServers: {} };
    }
  } else {
    info('Creating new MCP config...');
  }

  config.mcpServers['skills-db'] = {
    command: pythonCmd,
    args: [SERVER_PATH]
  };

  let uvCmd = getUvCommand();
  if (!uvCmd) {
    if (installUv()) {
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

  config.mcpServers['semble'] = {
    command: uvxCmd,
    args: ['--from', 'semble[mcp]@latest', 'semble']
  };
  success(`Registered 'semble' using command: ${uvxCmd}`);

  fs.writeFileSync(MCP_CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
  success(`MCP config updated with skills-db and semble: ${MCP_CONFIG_PATH}`);
}

function updateGeminiMd() {
  agentManager.regenerateAndDeploy();
}

function updateAgentsMd() {
  agentManager.regenerateAndDeploy();
}

function cmdMigrate(args) {
  header('📊 Re-running Skills Migration');

  const python = checkPython();
  if (!python) {
    error('Python 3 is required but not found.');
    process.exit(1);
  }

  if (!fileExists(MIGRATE_PATH)) {
    error('Migration script not found. Run "konoha init" first.');
    process.exit(1);
  }

  // Check for custom skills dir
  const customDirIdx = args.indexOf('--skills-dir');
  if (customDirIdx >= 0 && args[customDirIdx + 1]) {
    const customDir = args[customDirIdx + 1];
    try {
      const run = spawnSync(python, [MIGRATE_PATH, '--skills-dir', customDir], {
        encoding: 'utf-8', cwd: SKILLS_DB_DIR, timeout: 30000
      });
      if (run.status !== 0) throw new Error(run.stderr || 'Migration failed');
      log(run.stdout);
      success('Migration complete!');
    } catch (e) {
      error(`Migration failed: ${e.message}`);
      process.exit(1);
    }
  } else {
    // Migrate all detected skill directories
    const skillsDirs = detectSkillsDirs();
    if (skillsDirs.length === 0) {
      // Fallback: run without args
      try {
        const runFallback = spawnSync(python, [MIGRATE_PATH], {
          encoding: 'utf-8', cwd: SKILLS_DB_DIR, timeout: 30000
        });
        if (runFallback.status !== 0) throw new Error(runFallback.stderr || 'Migration failed');
        log(runFallback.stdout);
        success('Migration complete!');
      } catch (e) {
        error(`Migration failed: ${e.message}`);
        process.exit(1);
      }
    } else {
      let anySuccess = false;
      for (const s of skillsDirs) {
        const skills = detectCustomSkills(s.path);
        if (skills.length === 0) continue;

        info(`Migrating from: ${s.path}`);
        try {
          const run = spawnSync(python, [MIGRATE_PATH, '--skills-dir', s.path, '--skills', ...skills], {
            encoding: 'utf-8', cwd: SKILLS_DB_DIR, timeout: 30000
          });
          if (run.status !== 0) throw new Error(run.stderr || 'Migration failed');
          log(run.stdout);
          anySuccess = true;
        } catch (e) {
          warn(`Migration failed for ${s.path}: ${e.message}`);
        }
      }
      if (anySuccess) {
        success('Migration complete!');
      } else {
        error('Migration failed for all directories.');
        process.exit(1);
      }
    }
  }
}

function cmdTest() {
  header('🧪 Testing Skills-DB MCP Server');

  const python = checkPython();
  if (!python) {
    error('Python 3 is required.');
    process.exit(1);
  }

  if (!fileExists(SERVER_PATH)) {
    error('Server not installed. Run "konoha init" first.');
    process.exit(1);
  }

  if (!fileExists(DB_PATH)) {
    error('Database not found. Run "konoha migrate" first.');
    process.exit(1);
  }

  const tests = [
    { name: 'Initialize', req: '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' },
    { name: 'List Tools', req: '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' },
    { name: 'Find Skill (security)', req: '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"find_skill","arguments":{"keyword":"security"}}}' },
    { name: 'List Skills', req: '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"list_skills","arguments":{}}}' },
  ];

  let allPassed = true;

  for (const test of tests) {
    try {
      const run = spawnSync(python, [SERVER_PATH], {
        input: test.req,
        encoding: 'utf-8',
        timeout: 10000
      });
      if (run.status !== 0) throw new Error(run.stderr || 'Execution failed');
      const output = run.stdout;

      const response = JSON.parse(output.trim());
      if (response.error) {
        error(`${test.name}: ${response.error.message}`);
        allPassed = false;
      } else {
        success(`${test.name}: OK`);

        // Show extra info for specific tests
        if (test.name === 'Find Skill (security)') {
          try {
            const content = JSON.parse(response.result.content[0].text);
            info(`  Found ${content.found} results for "security"`);
            if (content.results) {
              content.results.forEach(r => {
                log(`  ${C.dim}→ ${r.name} (${r.type}, ${r.full_size} bytes)${C.reset}`);
              });
            }
          } catch {}
        }

        if (test.name === 'List Skills') {
          try {
            const content = JSON.parse(response.result.content[0].text);
            info(`  Total indexed: ${content.total} entries`);
          } catch {}
        }
      }
    } catch (e) {
      error(`${test.name}: FAILED - ${e.message}`);
      allPassed = false;
    }
  }

  log('');
  if (allPassed) {
    success('All tests passed! 🎉');
  } else {
    error('Some tests failed. Check the output above.');
    process.exit(1);
  }
}

function cmdStatus() {
  header('📋 Skills-DB Status');
  divider();

  // Check files
  const checks = [
    { label: 'Server', path: SERVER_PATH },
    { label: 'Migration script', path: MIGRATE_PATH },
    { label: 'Database', path: DB_PATH },
    { label: 'MCP Config', path: MCP_CONFIG_PATH },
    { label: 'GEMINI.md', path: GEMINI_MD_PATH },
    { label: 'AGENTS.md', path: AGENTS_MD_PATH },
  ];

  log(`\n${C.bold}Files:${C.reset}`);
  for (const check of checks) {
    if (fileExists(check.path)) {
      const stats = fs.statSync(check.path);
      const size = (stats.size / 1024).toFixed(1);
      success(`${check.label}: ${check.path} (${size} KB)`);
    } else {
      error(`${check.label}: NOT FOUND (${check.path})`);
    }
  }

  // Check Python
  log(`\n${C.bold}Python:${C.reset}`);
  const python = checkPython();
  if (python) {
    const version = execSync(`${python} --version 2>&1`, { encoding: 'utf-8' }).trim();
    success(`${version} (${python})`);
  } else {
    error('Python 3 not found');
  }

  // Check MCP config
  log(`\n${C.bold}MCP Config:${C.reset}`);
  if (fileExists(MCP_CONFIG_PATH)) {
    try {
      const config = JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, 'utf-8'));
      if (config.mcpServers && config.mcpServers['skills-db']) {
        success('skills-db registered in MCP config');
        log(`  ${C.dim}Command: ${config.mcpServers['skills-db'].command}${C.reset}`);
        log(`  ${C.dim}Args: ${config.mcpServers['skills-db'].args.join(' ')}${C.reset}`);
      } else {
        warn('skills-db NOT registered in MCP config');
      }
      if (config.mcpServers && config.mcpServers['semble']) {
        success('semble registered in MCP config');
        log(`  ${C.dim}Command: ${config.mcpServers['semble'].command}${C.reset}`);
        log(`  ${C.dim}Args: ${config.mcpServers['semble'].args.join(' ')}${C.reset}`);
      } else {
        warn('semble NOT registered in MCP config');
      }
    } catch {
      error('Could not parse MCP config');
    }
  }

  // Check GEMINI.md
  log(`\n${C.bold}GEMINI.md:${C.reset}`);
  if (fileExists(GEMINI_MD_PATH)) {
    const content = fs.readFileSync(GEMINI_MD_PATH, 'utf-8');
    const isUsingSkillsDb = (() => {
      try {
        const config = JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, 'utf-8'));
        return !!(config.mcpServers && config.mcpServers['skills-db']);
      } catch { return false; }
    })();
    
    const hasSkillsDb = content.includes('skills-db find_skill');
    const hasOldPattern = content.includes('Load and follow');
    
    if (isUsingSkillsDb) {
      if (hasSkillsDb) {
        success('Contains skills-db references');
      } else {
        warn('Does NOT contain skills-db references');
      }
      if (hasOldPattern) {
        warn('Still contains old "Load and follow" pattern');
      } else {
        success('No old "Load and follow" patterns');
      }
    } else {
      if (hasOldPattern) {
        success('Contains disk-based Load and follow patterns');
      } else {
        warn('Does NOT contain disk-based Load and follow patterns');
      }
      if (hasSkillsDb) {
        warn('Contains obsolete skills-db references');
      } else {
        success('No obsolete skills-db references');
      }
    }
  }

  // Check AGENTS.md
  log(`\n${C.bold}AGENTS.md:${C.reset}`);
  if (fileExists(AGENTS_MD_PATH)) {
    const content = fs.readFileSync(AGENTS_MD_PATH, 'utf-8');
    const hasGenin = content.includes('@genin');
    
    if (hasGenin) {
      success('Contains rebranded subagent configurations');
    } else {
      warn('Still contains old agent configurations');
    }
  } else {
    error('AGENTS.md not found');
  }

  // Subagents list
  log(`\n${C.bold}Subagents (Naruto Ninja Ranks):${C.reset}`);
  const agents = agentManager.loadAgents();
  const iconMap = {
    'genin': '🍃',
    'chunin': '📜',
    'jonin': '🛡️',
    'anbu': '👥',
    'tokubetsu-jonin': '🎯',
    'kage': '🌀'
  };

  agents.forEach(a => {
    const icon = a.icon || iconMap[a.name] || '👤';
    const displayName = `${icon} ${a.name.charAt(0).toUpperCase() + a.name.slice(1)}`;
    const role = a.purpose || 'Custom Subagent';
    const activeSkills = a.skills && a.skills.length > 0 ? `Active (${a.skills.join(', ')})` : 'Active';
    log(`  ${C.bold}${displayName.padEnd(20)}${C.reset} ${role.padEnd(42)} [${C.green}${activeSkills}${C.reset}]`);
  });

  // Database stats
  log(`\n${C.bold}Database Stats:${C.reset}`);
  if (fileExists(DB_PATH) && python) {
    const statsScript = path.join(SKILLS_DB_DIR, 'db_stats.py');
    const statsScriptPkg = path.join(SRC_DIR, 'db_stats.py');
    const scriptToUse = fileExists(statsScript) ? statsScript : fileExists(statsScriptPkg) ? statsScriptPkg : null;

    if (scriptToUse) {
      try {
        const output = execSync(
          `${python} "${scriptToUse}" "${DB_PATH}"`,
          { encoding: 'utf-8', timeout: 5000 }
        );
        const stats = JSON.parse(output.trim());
        if (stats.error) {
          warn(`Database error: ${stats.error}`);
        } else {
          info(`Total entries: ${stats.total}`);
          info(`Skills: ${stats.skills}`);
          info(`References: ${stats.refs}`);
          info(`Indexed content: ${(stats.bytes / 1024).toFixed(1)} KB`);
        }
      } catch {
        warn('Could not read database stats');
      }
    } else {
      warn('Stats helper script not found. Run "konoha init --force" to reinstall.');
    }
  }

  // Skills directories
  log(`\n${C.bold}Skills Directories:${C.reset}`);
  const skillsDirs = detectSkillsDirs();
  if (skillsDirs.length > 0) {
    skillsDirs.forEach(s => {
      success(`${s.path} (${s.count} skills)`);
    });
  } else {
    warn('No skills directories found');
  }

  log('');
}

function cmdUninstall() {
  header('🗑️  Uninstalling Skills-DB');

  // Remove server files
  if (fileExists(SKILLS_DB_DIR)) {
    fs.rmSync(SKILLS_DB_DIR, { recursive: true });
    success(`Removed: ${SKILLS_DB_DIR}`);
  }

  // Remove from MCP config
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
      if (updated) {
        fs.writeFileSync(MCP_CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
      }
    } catch {
      warn('Could not update MCP config');
    }
  }

  // Restore GEMINI.md backup if exists
  const backupPath = GEMINI_MD_PATH + '.backup';
  if (fileExists(backupPath)) {
    fs.copyFileSync(backupPath, GEMINI_MD_PATH);
    fs.unlinkSync(backupPath);
    success('Restored GEMINI.md from backup');
  }

  // Restore AGENTS.md backup if exists
  const agentsBackupPath = AGENTS_MD_PATH + '.backup';
  if (fileExists(agentsBackupPath)) {
    fs.copyFileSync(agentsBackupPath, AGENTS_MD_PATH);
    fs.unlinkSync(agentsBackupPath);
    success('Restored AGENTS.md from backup');
  }

  log('');
  success('Skills-DB uninstalled.');
  info('Your original skills in ~/.agents/skills/ are untouched.');
}

function cmdSavings() {
  header('📊 Token Savings Report');
  divider();

  // 1. Get python command
  const python = checkPython();
  if (!python) {
    error('Python 3 is required but not found.');
    process.exit(1);
  }

  const savingsScript = path.join(SKILLS_DB_DIR, 'db_savings.py');
  const savingsScriptPkg = path.join(SRC_DIR, 'db_savings.py');
  const scriptToUse = fileExists(savingsScript) ? savingsScript : fileExists(savingsScriptPkg) ? savingsScriptPkg : null;

  if (scriptToUse && fileExists(DB_PATH)) {
    try {
      log(`${C.bold}1. ⚡ Skills-DB (konoha) Savings${C.reset}`);
      log(`${C.dim}Calculated relative to full context index sizing (~550 KB baseline)${C.reset}\n`);

      const run = spawnSync(python, [scriptToUse, DB_PATH], {
        encoding: 'utf-8',
        timeout: 5000
      });
      if (run.status !== 0) throw new Error(run.stderr || 'Savings query failed');
      const output = run.stdout;
      const stats = JSON.parse(output.trim());
      
      if (stats.error) {
        warn(`Database error: ${stats.error}`);
      } else {
        // Format size as KB/MB
        const formatBytes = (b) => {
          if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(2)} MB`;
          return `${(b / 1024).toFixed(1)} KB`;
        };

        const formatTokens = (t) => {
          if (t >= 1000000) return `${(t / 1000000).toFixed(1)}M`;
          if (t >= 1000) return `${(t / 1000).toFixed(1)}k`;
          return t;
        };

        const formatSavings = (tokens, pct) => {
          const width = 16;
          const filledCount = Math.min(width, Math.max(0, Math.round((pct / 100) * width)));
          const filled = '█'.repeat(filledCount);
          const empty = '░'.repeat(width - filledCount);
          return `[${filled}${empty}]  ~${formatTokens(tokens)} tokens (${pct}%)`;
        };

        // Table
        log(`  ${C.bold}${'Period'.padEnd(15)} ${'Calls'.padEnd(8)} ${'Bytes Saved'.padEnd(15)} ${'Savings'}${C.reset}`);
        log(`  ${C.dim}${'─'.repeat(70)}${C.reset}`);
        log(`  ${'Today'.padEnd(15)} ${stats.today.calls.toString().padEnd(8)} ${formatBytes(stats.today.bytes).padEnd(15)} ${formatSavings(stats.today.tokens, stats.today.pct || 0)}`);
        log(`  ${'Last 7 days'.padEnd(15)} ${stats.last7days.calls.toString().padEnd(8)} ${formatBytes(stats.last7days.bytes).padEnd(15)} ${formatSavings(stats.last7days.tokens, stats.last7days.pct || 0)}`);
        log(`  ${'All time'.padEnd(15)} ${stats.alltime.calls.toString().padEnd(8)} ${formatBytes(stats.alltime.bytes).padEnd(15)} ${formatSavings(stats.alltime.tokens, stats.alltime.pct || 0)}`);
        log('');

        // Store values for combined calculations
        global.skillsDbCalls = stats.alltime.calls;
        global.skillsDbTokens = stats.alltime.tokens;
        global.skillsDbBytes = stats.alltime.bytes;
      }
    } catch (e) {
      warn(`Could not read Skills-DB savings: ${e.message}`);
    }
  } else {
    warn('Skills-DB database not found or savings script not installed.');
    info('Please run "npx konoha init" first.');
    log('');
  }

  // 2. Query Semble Savings
  log(`${C.bold}2. 🔍 Semble (Semantic Code Search) Savings${C.reset}`);
  log(`${C.dim}Fetching from Semble tool cli...${C.reset}\n`);

  let sembleCalls = 0;
  let sembleTokens = 0;

  try {
    const runSemble = spawnSync('uvx', ['--from', 'semble[mcp]@latest', 'semble', 'savings', '--verbose'], {
      encoding: 'utf-8',
      timeout: 45000
    });
    if (runSemble.status !== 0) throw new Error(runSemble.stderr || 'Semble savings query failed');
    const sembleOutput = runSemble.stdout;
    // Print Semble output directly
    log(sembleOutput);

    // Try to parse calls and tokens from output if possible for combined summary
    const lines = sembleOutput.split('\n');
    for (const line of lines) {
      if (line.includes('All time')) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 5) {
          sembleCalls = parseInt(parts[2]) || 0;
          const tokenStr = parts[4].replace('~', '');
          if (tokenStr.endsWith('M')) {
            sembleTokens = Math.round(parseFloat(tokenStr.slice(0, -1)) * 1000000);
          } else if (tokenStr.endsWith('k')) {
            sembleTokens = Math.round(parseFloat(tokenStr.slice(0, -1)) * 1000);
          } else {
            sembleTokens = parseInt(tokenStr) || 0;
          }
        }
      }
    }
  } catch (e) {
    warn(`Could not fetch Semble savings: ${e.message}`);
    info('Please check that uv is installed and works.');
    log('');
  }

  // 3. Combined Summary
  const combinedCalls = (global.skillsDbCalls || 0) + sembleCalls;
  const combinedTokens = (global.skillsDbTokens || 0) + sembleTokens;
  const combinedBytes = (global.skillsDbBytes || 0) + (sembleTokens * 4); // Reverse approximation for display

  const formatBytesComb = (b) => {
    if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(2)} MB`;
    return `${(b / 1024).toFixed(1)} KB`;
  };

  const formatTokensComb = (t) => {
    if (t >= 1000000) return `${(t / 1000000).toFixed(2)}M`;
    if (t >= 1000) return `${(t / 1000).toFixed(1)}k`;
    return t;
  };

  header('🏆 Combined Total Savings');
  divider();
  log(`  ${C.bold}Combined Total Calls:${C.reset}  ${combinedCalls} calls`);
  log(`  ${C.bold}Combined Total Saved:${C.reset}  ~${formatTokensComb(combinedTokens)} tokens (~${formatBytesComb(combinedBytes)} equivalent)`);
  log('');
}

function cmdSkill(args) {
  const subcommand = args[0];
  const subArgs = args.slice(1);

  if (!subcommand) {
    error('Usage: konoha skill <subcommand> [args]');
    log('Available subcommands: list, search, add, remove');
    process.exit(1);
  }

  switch (subcommand) {
    case 'list': {
      header('Installed Skills');
      divider();
      const installed = skillManager.listInstalledSkills();
      if (installed.length === 0) {
        warn('No custom skills currently installed.');
      } else {
        installed.forEach(s => {
          success(`${C.bold}${s.name}${C.reset}`);
          log(`  ${C.dim}Path:${C.reset} ${s.path}`);
          log(`  ${C.dim}Desc:${C.reset} ${s.description}`);
        });
      }
      break;
    }
    case 'search': {
      const query = subArgs.join(' ');
      if (!query) {
        error('Usage: konoha skill search <query>');
        process.exit(1);
      }
      skillManager.runInteractiveSearch(query);
      break;
    }
    case 'add': {
      const url = subArgs[0];
      const name = subArgs[1];
      if (!url || !name) {
        error('Usage: konoha skill add <repository-url> <skill-name>');
        process.exit(1);
      }
      try {
        skillManager.addSkillDirect(url, name);
      } catch (err) {
        error(`Failed to add skill: ${err.message}`);
        process.exit(1);
      }
      break;
    }
    case 'remove': {
      const name = subArgs[0];
      if (!name) {
        error('Usage: konoha skill remove <skill-name>');
        process.exit(1);
      }
      try {
        skillManager.removeSkill(name);
        success(`Successfully removed skill: ${name}`);
        info('Re-indexing SQLite database...');
        cmdMigrate([]);
      } catch (err) {
        error(`Failed to remove skill: ${err.message}`);
        process.exit(1);
      }
      break;
    }
    default:
      error(`Unknown skill subcommand: ${subcommand}`);
      log(`Available subcommands: list, search, add, remove`);
      process.exit(1);
  }
}

function cmdAgent(args) {
  const subcommand = args[0];
  const subArgs = args.slice(1);

  if (!subcommand) {
    error('Usage: konoha agent <subcommand> [args]');
    log('Available subcommands: list, create, embed, unembed, delete');
    process.exit(1);
  }

  switch (subcommand) {
    case 'list': {
      header('Subagents List');
      divider();
      const agents = agentManager.loadAgents();
      if (agents.length === 0) {
        warn('No subagents found.');
      } else {
        agents.forEach(a => {
          const iconStr = a.icon ? `${a.icon} ` : '';
          success(`@${C.bold}${a.name}${C.reset} — ${iconStr}${a.title}`);
          log(`  ${C.dim}Purpose:${C.reset} ${a.purpose}`);
          const skillsList = a.skills && a.skills.length > 0 ? a.skills.map(s => `\`${s}\``).join(', ') : 'None';
          log(`  ${C.dim}Active Skills:${C.reset} ${skillsList}`);
          log(`  ${C.dim}Keywords:${C.reset} ${a.delegationKeywords}`);
        });
      }
      break;
    }
    case 'create': {
      const name = subArgs[0];
      if (!name) {
        error('Usage: konoha agent create <agent-name> [options]');
        process.exit(1);
      }
      
      const options = {};
      const titleIdx = subArgs.indexOf('--title');
      if (titleIdx >= 0 && subArgs[titleIdx + 1]) options.title = subArgs[titleIdx + 1];
      
      const purposeIdx = subArgs.indexOf('--purpose');
      if (purposeIdx >= 0 && subArgs[purposeIdx + 1]) options.purpose = subArgs[purposeIdx + 1];
      
      const instrIdx = subArgs.indexOf('--instructions');
      if (instrIdx >= 0 && subArgs[instrIdx + 1]) options.instructions = subArgs[instrIdx + 1];
      
      const keywordsIdx = subArgs.indexOf('--keywords');
      if (keywordsIdx >= 0 && subArgs[keywordsIdx + 1]) options.delegationKeywords = subArgs[keywordsIdx + 1];

      try {
        const newAgent = agentManager.createSubagent(name, options);
        success(`Successfully created subagent: @${newAgent.name}`);
        info('Updated configurations and deployed to ~/.gemini/GEMINI.md and ~/.agents/AGENTS.md');
      } catch (err) {
        error(`Failed to create subagent: ${err.message}`);
        process.exit(1);
      }
      break;
    }
    case 'embed': {
      const agentName = subArgs[0];
      const skillName = subArgs[1];
      if (!agentName || !skillName) {
        error('Usage: konoha agent embed <agent-name> <skill-name>');
        process.exit(1);
      }
      try {
        const added = agentManager.embedSkill(agentName, skillName);
        if (added) {
          success(`Successfully embedded skill "${skillName}" into @${agentName}`);
          info('Re-deployed team configurations.');
        } else {
          warn(`Skill "${skillName}" is already embedded in @${agentName}`);
        }
      } catch (err) {
        error(`Failed to embed skill: ${err.message}`);
        process.exit(1);
      }
      break;
    }
    case 'unembed': {
      const agentName = subArgs[0];
      const skillName = subArgs[1];
      if (!agentName || !skillName) {
        error('Usage: konoha agent unembed <agent-name> <skill-name>');
        process.exit(1);
      }
      try {
        const removed = agentManager.unembedSkill(agentName, skillName);
        if (removed) {
          success(`Successfully removed skill "${skillName}" from @${agentName}`);
          info('Re-deployed team configurations.');
        } else {
          warn(`Skill "${skillName}" was not embedded in @${agentName}`);
        }
      } catch (err) {
        error(`Failed to unembed skill: ${err.message}`);
        process.exit(1);
      }
      break;
    }
    case 'delete': {
      const name = subArgs[0];
      if (!name) {
        error('Usage: konoha agent delete <agent-name>');
        process.exit(1);
      }
      try {
        agentManager.deleteAgent(name);
        success(`Successfully deleted subagent: @${name}`);
        info('Updated and redeployed configurations.');
      } catch (err) {
        error(`Failed to delete subagent: ${err.message}`);
        process.exit(1);
      }
      break;
    }
    default:
      error(`Unknown agent subcommand: ${subcommand}`);
      log(`Available subcommands: list, create, embed, unembed, delete`);
      process.exit(1);
  }
}

function cmdHelp() {
  log(`
${C.bold}${C.blue}konoha${C.reset} — SQLite FTS5 Skills-DB for Antigravity IDE/CLI

${C.bold}USAGE${C.reset}
  npx konoha <command> [options]

${C.bold}COMMANDS${C.reset}
  ${C.cyan}init${C.reset}          Install MCP server, migrate skills, configure Antigravity
  ${C.cyan}migrate${C.reset}       Re-run skill migration (after editing skills)
  ${C.cyan}test${C.reset}          Test MCP server with sample queries
  ${C.cyan}status${C.reset}        Show installation status and database stats
  ${C.cyan}savings${C.reset}       Show token savings for Skills-DB and Semble (Today, 7 days, All time)
  ${C.cyan}uninstall${C.reset}     Remove Skills-DB (keeps original skills)
  ${C.cyan}skill${C.reset}         Manage custom skills (list, search, add, remove)
  ${C.cyan}agent${C.reset}         Manage subagent configurations (list, create, embed, unembed, delete)
  ${C.cyan}help${C.reset}          Show this help message

${C.bold}OPTIONS${C.reset}
  ${C.dim}--force${C.reset}        Force reinstall (for init)
  ${C.dim}--skills-dir${C.reset}   Custom skills directory (for migrate)

${C.bold}EXAMPLES${C.reset}
  ${C.dim}# List installed skills${C.reset}
  konoha skill list

  ${C.dim}# Search skills.sh registry interactively${C.reset}
  konoha skill search terraform

  ${C.dim}# List all subagents and active skills${C.reset}
  konoha agent list

  ${C.dim}# Create a new subagent${C.reset}
  konoha agent create test-ninja --instructions "You are a test subagent"

  ${C.dim}# Embed a skill to a subagent${C.reset}
  konoha agent embed test-ninja documentation

  ${C.dim}# Check token savings metrics${C.reset}
  konoha savings

${C.bold}WHAT IT DOES${C.reset}
  1. Creates ~/.gemini/skills-db/ with SQLite FTS5 database
  2. Indexes all SKILL.md + references/*.md for full-text search
  3. Registers skills-db MCP server in ~/.gemini/config/mcp_config.json
  4. Updates ~/.gemini/GEMINI.md with on-demand skill loading instructions

${C.bold}TOKEN SAVINGS${C.reset}
  Before: ~550 KB loaded per session (all skills + references)
  After:  ~12 KB per query (only relevant content returned)
  Savings: 83-98% reduction in token usage
`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

const [,, command, ...args] = process.argv;

switch (command) {
  case 'init':
    cmdInit(args);
    break;
  case 'migrate':
    cmdMigrate(args);
    break;
  case 'test':
    cmdTest();
    break;
  case 'status':
    cmdStatus();
    break;
  case 'savings':
    cmdSavings();
    break;
  case 'uninstall':
    cmdUninstall();
    break;
  case 'skill':
    cmdSkill(args);
    break;
  case 'agent':
    cmdAgent(args);
    break;
  case 'help':
  case '--help':
  case '-h':
    cmdHelp();
    break;
  case undefined:
    cmdHelp();
    break;
  default:
    error(`Unknown command: ${command}`);
    log(`Run ${C.cyan}npx konoha help${C.reset} for usage.`);
    process.exit(1);
}
