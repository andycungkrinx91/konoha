#!/usr/bin/env node
/**
 * Cursor sessionStart hook — silently ensures Konoha MCP is registered and skills are synchronized.
 * Self-contained (no package-relative requires) so it works from ~/.konoha/.
 * Exits 0 always (fail-open).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const HOME = os.homedir();
const CURSOR_DIR = path.join(HOME, '.cursor');
const CURSOR_MCP = path.join(CURSOR_DIR, 'mcp.json');
const CURSOR_SKILLS = path.join(CURSOR_DIR, 'skills');
const AGENTS_SKILLS = path.join(HOME, '.agents', 'skills');
const SERVER_PATH = path.join(HOME, '.konoha', 'server.py');
const FILE_TOOLS_MCP_PATH = path.join(HOME, '.konoha', 'file_tools_mcp.js');

function fileExists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

function ensureDir(d) {
  if (!fileExists(d)) fs.mkdirSync(d, { recursive: true });
}

function checkPython() {
  for (const cmd of ['python3', 'python']) {
    try {
      const r = spawnSync(cmd, ['--version'], { encoding: 'utf-8', timeout: 5000 });
      if (r.status === 0) return cmd;
    } catch {}
  }
  return 'python3';
}

function getUvx() {
  try {
    spawnSync('uvx', ['--version'], { stdio: 'ignore', timeout: 5000 });
    return 'uvx';
  } catch {}
  const local = path.join(HOME, '.local', 'bin', 'uvx');
  return fileExists(local) ? local : 'uvx';
}

function buildKonohaFilesMcpEntry() {
  const launcherJs = path.join(HOME, '.konoha', 'file_tools_launcher.js');
  const mcpJs = path.join(HOME, '.konoha', 'file_tools_mcp.js');
  if (!fs.existsSync(mcpJs)) return null;
  const target = fs.existsSync(launcherJs) ? launcherJs : mcpJs;
  return {
    type: 'stdio',
    command: 'node',
    args: [target]
  };
}

function registerMcp(python) {
  ensureDir(CURSOR_DIR);
  let config = null;
  if (fileExists(CURSOR_MCP)) {
    try {
      config = JSON.parse(fs.readFileSync(CURSOR_MCP, 'utf-8'));
    } catch {
      return;
    }
    if (!config.mcpServers) config.mcpServers = {};
  } else {
    config = { mcpServers: {} };
  }
  let updated = false;
  // Clean legacy servers if present
  if (config.mcpServers['skills-db']) {
    delete config.mcpServers['skills-db'];
    updated = true;
  }
  if (config.mcpServers['konoha-files']) {
    delete config.mcpServers['konoha-files'];
    updated = true;
  }

  const servers = {
    semble: {
      type: 'stdio',
      command: getUvx(),
      args: ['--from', 'semble[mcp]@latest', 'semble', '--content', 'all']
    }
  };
  if (FILE_TOOLS_MCP_PATH && fileExists(FILE_TOOLS_MCP_PATH)) {
    const entry = buildKonohaFilesMcpEntry();
    if (entry) {
      servers['konoha'] = entry;
      updated = true;
    }
  }
  for (const [name, entry] of Object.entries(servers)) {
    const existing = config.mcpServers[name];
    if (
      !existing ||
      existing.command !== entry.command ||
      JSON.stringify(existing.args || []) !== JSON.stringify(entry.args || [])
    ) {
      config.mcpServers[name] = entry;
      updated = true;
    }
  }

  if (updated || !fileExists(CURSOR_MCP)) {
    fs.writeFileSync(CURSOR_MCP, JSON.stringify(config, null, 2) + '\n');
  }
}

function listSkillEntries(skillsDir) {
  if (!fileExists(skillsDir)) return [];
  const names = [];
  try {
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (entry.isDirectory() && fileExists(path.join(skillsDir, entry.name, 'SKILL.md'))) {
        names.push(entry.name);
      } else if (entry.isFile() && entry.name.endsWith('-skill.md')) {
        names.push(entry.name);
      }
    }
  } catch {}
  return names;
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
    for (const entry of fs.readdirSync(src)) {
      copyRecursiveIfDifferent(path.join(src, entry), path.join(dest, entry));
    }
    return;
  }
  if (!fileExists(dest)) {
    fs.copyFileSync(src, dest);
    return;
  }
  try {
    const a = fs.readFileSync(src);
    const b = fs.readFileSync(dest);
    if (!a.equals(b)) fs.copyFileSync(src, dest);
  } catch {
    try { fs.copyFileSync(src, dest); } catch {}
  }
}

function syncCursorSkills() {
  if (!fileExists(AGENTS_SKILLS)) return;
  ensureDir(CURSOR_SKILLS);
  for (const name of listSkillEntries(AGENTS_SKILLS)) {
    copyRecursiveIfDifferent(path.join(AGENTS_SKILLS, name), path.join(CURSOR_SKILLS, name));
  }
}

async function main() {
  try {
    await new Promise((resolve) => {
      let data = '';
      process.stdin.on('data', c => { data += c; });
      process.stdin.on('end', resolve);
      setTimeout(resolve, 50);
    });

    if (!fileExists(SERVER_PATH)) {
      process.exit(0);
    }

    const python = checkPython();
    registerMcp(python);
    syncCursorSkills();
  } catch {
    // fail-open
  }
  process.exit(0);
}

main();
