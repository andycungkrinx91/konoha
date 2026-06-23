#!/usr/bin/env node
/**
 * Cursor sessionStart hook — silently ensures Konoha MCP + subagents are registered.
 * Self-contained (no package-relative requires) so it works from ~/.gemini/skills-db/.
 * Exits 0 always (fail-open).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const HOME = os.homedir();
const CURSOR_DIR = path.join(HOME, '.cursor');
const CURSOR_MCP = path.join(CURSOR_DIR, 'mcp.json');
const CURSOR_AGENTS = path.join(CURSOR_DIR, 'agents');
const CURSOR_SKILLS = path.join(CURSOR_DIR, 'skills');
const AGENTS_SKILLS = path.join(HOME, '.agents', 'skills');
const AGENTS_JSON = path.join(HOME, '.agents', 'agents.json');
const SERVER_PATH = path.join(HOME, '.gemini', 'skills-db', 'server.py');
const FILE_TOOLS_MCP_PATH = path.join(HOME, '.gemini', 'skills-db', 'file_tools_mcp.js');

const SEMBLE_POLICY_LINE =
  '- **Code search default**: Use `semble` MCP (`search`, `find_related`) for ALL codebase discovery. Do NOT use grep/glob/find/rg, Antigravity search tools, or Cursor `Grep`/`Glob`/`SemanticSearch`. Always pass absolute `repo`. Skills: `skills-db` only — never semble for skills.';

const DEFAULT_CURSOR_MODELS = {
  genin: 'inherit',
  kage: 'inherit',
  chunin: 'inherit',
  jonin: 'inherit',
  anbu: 'inherit',
  'tokubetsu-jonin': 'inherit'
};

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

function adaptInstructionsForCursor(instructions) {
  if (!instructions) return '';
  return instructions
    .replace(/Always set RequestFeedback:\s*false\s+and\s+UserFacing:\s*false\s+in\s+ArtifactMetadata\s+when\s+writing\s+files\.?\s*/gi, '')
    .replace(/view_file/g, 'Read')
    .replace(/write_to_file|replace_file_content/g, 'Write/StrReplace')
    .replace(/run_command/g, 'Shell')
    .trim();
}

function registerMcp(python) {
  if (!fileExists(SERVER_PATH)) return;
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

  const servers = {
    'skills-db': {
      type: 'stdio',
      command: python,
      args: [SERVER_PATH]
    },
    semble: {
      type: 'stdio',
      command: getUvx(),
      args: ['--from', 'semble[mcp]@latest', 'semble', '--content', 'all']
    }
  };
  if (fileExists(FILE_TOOLS_MCP_PATH)) {
    const entry = deployUtils.buildKonohaFilesMcpEntry('cursor');
    if (entry) {
      servers['konoha-files'] = entry;
    }
  }

  let updated = false;
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

function loadAgents() {
  if (!fileExists(AGENTS_JSON)) return [];
  try {
    return JSON.parse(fs.readFileSync(AGENTS_JSON, 'utf-8'));
  } catch {
    return [];
  }
}

function deploySubagents(agents) {
  ensureDir(CURSOR_AGENTS);
  const official = ['genin', 'kage', 'chunin', 'jonin', 'anbu', 'tokubetsu-jonin'];
  for (const agent of agents) {
    if (!official.includes(agent.name)) continue;
    const configured = (agent.cursorModel || '').trim().toLowerCase();
    const model = configured === 'auto' ? 'inherit' : (agent.cursorModel || DEFAULT_CURSOR_MODELS[agent.name] || 'inherit');
    const readonly = agent.name === 'genin';
    const desc = `${agent.description || agent.name}. Use proactively when tasks match: ${agent.delegationKeywords || agent.purpose || agent.name}.`;
    const body = adaptInstructionsForCursor(agent.instructions || '');
    const lines = [
      '---',
      `name: ${agent.name}`,
      `description: ${desc.replace(/\n/g, ' ')}`,
      `model: ${model}`,
    ];
    if (readonly) lines.push('readonly: true');
    lines.push('---', '', body, '', SEMBLE_POLICY_LINE, '');
    fs.writeFileSync(path.join(CURSOR_AGENTS, `${agent.name}.md`), lines.join('\n'));
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
    deploySubagents(loadAgents());
  } catch {
    // fail-open
  }
  process.exit(0);
}

main();
