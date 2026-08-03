/**
 * bin/lib/paths.js — Centralized Konoha path definitions.
 *
 * Previously every module (agent_manager.js, cli.js, cursor_manager.js,
 * deploy_utils.js, mcp_clients_manager.js, antigravity_manager.js,
 * cursor_bootstrap.js, skill_manager.js, antigravity_subagent_hook.js,
 * file_tools_mcp.js, file_tools_router.js) defined its own HOME, SKILLS_DB_DIR,
 * SERVER_PATH, etc. This created massive duplication and inconsistency.
 *
 * This module is the single source of truth for all Konoha-managed paths.
 *
 * IMPORTANT: Do NOT rename or reorder any exported constant. Every consumer
 * imports by name. If a path changes, update it here only.
 *
 * DESIGN NOTES:
 * - All user-homedir paths are built at require-time so they reflect the
 *   actual home even if HOME env var differs between processes.
 * - __dirname-relative paths (SRC_DIR, TOOLS_DIR, etc.) are fixed at
 *   build/install time and are process-independent.
 * - Antigravity paths (ANTIGRAVITY_*) mirror .gemini/antigravity-* conventions.
 * - IDE paths (CURSOR_, CLAUDE_) mirror each editor's config locations.
 */

const path = require('path');
const os = require('os');

// ──────────────── Base roots ────────────────

/** Home directory (~) */
const HOME = os.homedir();

/** Project src root (where this file lives: bin/lib/) */
const LIB_DIR = __dirname;

/** Project root (one level up: bin/) */
const BIN_DIR = path.resolve(LIB_DIR, '..');

/** Parent dir relative to bin/ (project root) */
const PROJECT_ROOT = path.resolve(BIN_DIR, '..');

// ──────────────── Core Konoha ~/.konoha ────────────────

const KONOHA = path.join(HOME, '.konoha');
const SKILLS_DB_DIR = KONOHA;

/** Main server entry point */
const SERVER_PATH = path.join(KONOHA, 'server.py');

/** SQLite database */
const DB_PATH = path.join(KONOHA, 'skills.db');

/** Deploy fingerprint */
const FINGERPRINT_PATH = path.join(KONOHA, '.deploy-fingerprint');

/** Bridges configuration */
const BRIDGES_JSON_PATH = path.join(KONOHA, 'bridges.json');

/** File-tools subdirectory */
const FILE_TOOLS_DIR = path.join(KONOHA, 'file_tools');

/** file_tools_mcp.js in ~/.konoha */
const FILE_TOOLS_MCP_PATH = path.join(KONOHA, 'file_tools_mcp.js');

/** file_tools_launcher.sh in ~/.konoha */
const FILE_TOOLS_LAUNCHER_PATH = path.join(KONOHA, 'file_tools_launcher.sh');

/** Python executable cache file */
const FILE_TOOLS_PYTHON_CMD_FILE = path.join(KONOHA, '.python_cmd');

/** Node.js executable cache file */
const FILE_TOOLS_NODE_PATH_FILE = path.join(KONOHA, '.node_exec_path');

/** Konoha temp/scratch base (used by RPC task dispatcher) */
const TMP_DIR = path.join(KONOHA, 'tmp');

/** file_tools_router.js in ~/.konoha */
const FILE_TOOLS_ROUTER_PATH = path.join(KONOHA, 'file_tools_router.js');

/** file_tools dir in ~/.konoha (alias for FILE_TOOLS_DIR) */
const FILE_TOOLS_PY_DIR = FILE_TOOLS_DIR;

/** file_tools/ dir next to router.js (src/file_tools/) — different from ~/.konoha/file_tools */
const TOOL_WORKERS_DIR = path.join(__dirname, 'file_tools');

// ──────────────── Agent definitions ~/.agents ────────────────

const AGENTS = path.join(HOME, '.agents');
const AGENTS_SKILLS = path.join(AGENTS, 'skills');

/** User agent definitions YAML */
const USER_AGENTS_YAML_PATH = path.join(AGENTS, 'agents.yaml');

/** Global agent docs */
const AGENTS_MD_PATH = path.join(AGENTS, 'AGENTS.md');

// ──────────────── Templates (bundled with konoha) ────────────────

/** Source directory (src/) — relative to bin/lib paths.js */
const SRC_DIR = path.resolve(LIB_DIR, '..', '..', 'src');

/** Template directory (src/templates/) */
const TEMPLATES_DIR = path.join(SRC_DIR, 'templates');

const DEFAULT_AGENTS_YAML_PATH = path.join(TEMPLATES_DIR, 'agents.yaml');
const GEMINI_TEMPLATE_PATH = path.join(TEMPLATES_DIR, 'GEMINI.md');
const AGENTS_TEMPLATE_PATH = path.join(TEMPLATES_DIR, 'AGENTS.md');

/** Docs directory (docs/) */
const DOCS_DIR = path.resolve(BIN_DIR, '..', 'docs');

/** Docs templates directory (docs/templates/) */
const DOCS_TEMPLATES_DIR = path.join(DOCS_DIR, 'templates');

// ──────────────── .gemini — Gemini/Google toolchain ────────────────

const GEMINI = path.join(HOME, '.gemini');
const GEMINI_MD_PATH = path.join(GEMINI, 'GEMINI.md');

const ANTIGRAVITY_CLI = path.join(GEMINI, 'antigravity-cli');
const ANTIGRAVITY_IDE = path.join(GEMINI, 'antigravity-ide');

/** Default skills search dirs (in order of precedence) */
const DEFAULT_SKILLS_DIRS = [
  path.join(process.cwd(), '.agents', 'skills'), // local project .agents/skills
  path.join(process.cwd(), '.cursor', 'skills'), // local project .cursor/skills
  path.join(process.cwd(), 'skills'),          // local project skills/
  path.join(process.cwd(), '.skills'),         // local project .skills/
  path.join(process.cwd(), 'docs', 'skills'),   // local project docs/skills
  AGENTS_SKILLS,                        // ~/.agents/skills
  path.join(ANTIGRAVITY_CLI, 'skills'), // ~/.gemini/antigravity-cli/skills
];

/** Antigravity agent deployment targets */
const ANTIGRAVITY_AGENTS_GLOBAL = path.join(GEMINI, 'config', 'agents');
const ANTIGRAVITY_CLI_GLOBAL = path.join(ANTIGRAVITY_CLI, 'agents');
const ANTIGRAVITY_IDE_GLOBAL = path.join(ANTIGRAVITY_IDE, 'agents');

/** CLI settings */
const SETTINGS_PATH = path.join(ANTIGRAVITY_CLI, 'settings.json');

/** MCP schema directory for antigravity-cli */
const SCHEMA_DIR = path.join(ANTIGRAVITY_CLI, 'mcp', 'konoha');

/** CLI brain conversation dir template */
function getAntigravityCliBrainDir(convId) {
  return path.join(ANTIGRAVITY_CLI, 'brain', convId);
}

/** IDE brain conversation dir template */
function getAntigravityIdeBrainDir(convId) {
  return path.join(ANTIGRAVITY_IDE, 'brain', convId);
}

/** CLI global brain dir */
const ANTIGRAVITY_CLI_BRAIN = path.join(ANTIGRAVITY_CLI, 'brain');

/** IDE global brain dir */
const ANTIGRAVITY_IDE_BRAIN = path.join(ANTIGRAVITY_IDE, 'brain');

/** CLI/MCP config directory */
const GEMINI_CONFIG = path.join(GEMINI, 'config');
const MCP_CONFIG_PATH = path.join(GEMINI_CONFIG, 'mcp_config.json');
const HOOKS_PATH = path.join(GEMINI_CONFIG, 'hooks.json');

/** Legacy alias for antigravity_subagent_hook.js */
const GLOBAL_CLI_AGENTS_DIR = path.join(ANTIGRAVITY_CLI, 'agents');

/** Legacy alias for antigravity_subagent_hook.js */
const GLOBAL_IDE_AGENTS_DIR = path.join(ANTIGRAVITY_IDE, 'agents');

/** Legacy alias for antigravity_subagent_hook.js */
const GLOBAL_CONFIG_AGENTS_DIR = path.join(GEMINI_CONFIG, 'agents');

// ──────────────── Cursor integration ────────────────

const CURSOR_DIR = path.join(HOME, '.cursor');
const CURSOR_MCP = path.join(CURSOR_DIR, 'mcp.json');
const CURSOR_SKILLS = path.join(CURSOR_DIR, 'skills');

const CURSOR_MCP_GLOBAL = path.join(CURSOR_DIR, 'mcp.yaml');
const CURSOR_AGENTS_GLOBAL = path.join(CURSOR_DIR, 'agents');
const CURSOR_SKILLS_GLOBAL = path.join(CURSOR_DIR, 'skills');
const CURSOR_HOOKS_GLOBAL = path.join(CURSOR_DIR, 'hooks.json');
const CURSOR_CLI_CONFIG = path.join(CURSOR_DIR, 'cli-config.json');
const CURSOR_BOOTSTRAP_PATH = path.join(KONOHA, 'cursor_bootstrap.js');

// ──────────────── VS Code / Claude Code ────────────────
// Claude Code v2.1+ stores global MCP servers in ~/.claude.json (not settings.json).
// We write to BOTH for backward compatibility (legacy ~/.claude.yaml).

const CLAUDE_JSON = path.join(HOME, '.claude.json');
const CLAUDE_SETTINGS = path.join(HOME, '.claude', 'settings.yaml');
const CLAUDE_JSON_LEGACY = path.join(HOME, '.claude.yaml');

// ──────────────── OpenCode ────────────────
const OPENCODE_DIR = path.join(HOME, '.opencode');
const OPENCODE_CONFIG = path.join(OPENCODE_DIR, 'config.json');

// ──────────────── Migration paths ────────────────

// ──────────────── Exports ────────────────
module.exports = {
  // Base roots
  HOME,
  LIB_DIR,
  BIN_DIR,
  PROJECT_ROOT,
  // Core Konoha
  KONOHA,
  SKILLS_DB_DIR,
  SERVER_PATH,
  DB_PATH,
  FINGERPRINT_PATH,
  BRIDGES_JSON_PATH,
  FILE_TOOLS_DIR,
  FILE_TOOLS_MCP_PATH,
  FILE_TOOLS_LAUNCHER_PATH,
  FILE_TOOLS_PYTHON_CMD_FILE,
  FILE_TOOLS_NODE_PATH_FILE,
  TMP_DIR,
  FILE_TOOLS_ROUTER_PATH,
  FILE_TOOLS_PY_DIR,
  // Agent definitions
  AGENTS,
  AGENTS_SKILLS,
  USER_AGENTS_YAML_PATH,
  AGENTS_MD_PATH,
  // Templates
  SRC_DIR,
  TEMPLATES_DIR,
  DEFAULT_AGENTS_YAML_PATH,
  GEMINI_TEMPLATE_PATH,
  AGENTS_TEMPLATE_PATH,
  // Docs
  DOCS_DIR,
  DOCS_TEMPLATES_DIR,
  // Antigravity / Gemini
  GEMINI,
  GEMINI_MD_PATH,
  ANTIGRAVITY_CLI,
  ANTIGRAVITY_IDE,
  DEFAULT_SKILLS_DIRS,
  ANTIGRAVITY_AGENTS_GLOBAL,
  ANTIGRAVITY_CLI_GLOBAL,
  ANTIGRAVITY_IDE_GLOBAL,
  SETTINGS_PATH,
  SCHEMA_DIR,
  getAntigravityCliBrainDir,
  getAntigravityIdeBrainDir,
  ANTIGRAVITY_CLI_BRAIN,
  ANTIGRAVITY_IDE_BRAIN,
  GEMINI_CONFIG,
  MCP_CONFIG_PATH,
  HOOKS_PATH,
  GLOBAL_CLI_AGENTS_DIR,
  GLOBAL_IDE_AGENTS_DIR,
  GLOBAL_CONFIG_AGENTS_DIR,
  // Cursor
  CURSOR_DIR,
  CURSOR_MCP,
  CURSOR_SKILLS,
  CURSOR_MCP_GLOBAL,
  CURSOR_AGENTS_GLOBAL,
  CURSOR_SKILLS_GLOBAL,
  CURSOR_HOOKS_GLOBAL,
  CURSOR_CLI_CONFIG,
  CURSOR_BOOTSTRAP_PATH,
  // Claude Code
  CLAUDE_JSON,
  CLAUDE_SETTINGS,
  CLAUDE_JSON_LEGACY,
  // OpenCode
  OPENCODE_DIR,
  OPENCODE_CONFIG,
  // Tool workers
  TOOL_WORKERS_DIR,
};
