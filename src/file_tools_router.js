/**
 * Konoha file-tools router — Node orchestration spawning Python workers.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const platform = require('./platform_utils');
const MCP_MANIFEST = require('./mcp_tool_manifest.json');

// Support both dev (require bin/lib/paths) and deployed (~/.konoha/) contexts.
const devPaths = (() => {
  try { return require('../bin/lib/paths'); } catch(_) { return null; }
})();


const { readFileRange: readFileRangeWorker } = require('./file_tools/read_file_range');
const { readFileHead: readFileHeadWorker } = require('./file_tools/read_file_head');
const { fileInfo: fileInfoWorker } = require('./file_tools/file_info');
const { tokenEfficientGrep: tokenEfficientGrepWorker } = require('./file_tools/token_efficient_grep');
const { getFileStructure: getFileStructureWorker } = require('./file_tools/get_file_structure');
const { findFilesClean: findFilesCleanWorker } = require('./file_tools/find_files_clean');

// Allow paths under the Konoha install directory (~/\.konoha/).
// This ensures the MCP server can work on workspace-internal paths
// even when the IDE workspace is something else (e.g. a brain/session dir).
const HOME = os.homedir();
const KONOHA_DIR = path.join(HOME, '.konoha');
let konoHaReal = null;
try { konoHaReal = fs.realpathSync(KONOHA_DIR); } catch { konoHaReal = path.resolve(KONOHA_DIR); }
const KONOHA_DIR_NORM = platform.normPath(konoHaReal);

// In dev mode (running from the source repo rather than ~/.konoha/), the
// repository root is also an allowed root so tests and local dev against the
// repo itself are not rejected by the workspace guard.
const DEV_PROJECT_ROOT_NORM = devPaths
  ? platform.normPath(devPaths.PROJECT_ROOT)
  : null;

let workspaceRoot = null;


function isIdeInstallationDirectory(dirPath) {
  if (!dirPath || typeof dirPath !== 'string') return false;
  const norm = dirPath.replace(/\\/g, '/').toLowerCase();
  if (
    norm.includes('/appdata/local/programs/antigravity') ||
    norm.includes('/program files/antigravity') ||
    norm.includes('/program files (x86)/antigravity') ||
    norm.includes('/antigravity ide') ||
    norm.includes('/antigravity-ide')
  ) {
    return true;
  }
  try {
    if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
      const entries = fs.readdirSync(dirPath);
      const isIde = entries.some(f => {
        const fl = f.toLowerCase();
        return (
          fl === 'antigravity ide.exe' ||
          fl === 'antigravity.exe' ||
          fl === 'antigravity ide.visualelementsmanifest.xml' ||
          fl === 'dxcompiler.dll'
        );
      }) || (entries.includes('resources.pak') && entries.includes('v8_context_snapshot.bin'));
      if (isIde) return true;
    }
  } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  return false;
}

function detectWorkspaceRoot() {
  const envCandidates = [
    process.env.WORKSPACE_ROOT,
    process.env.KONOHA_WORKSPACE,
    process.env.PROJECT_DIR,
    process.env.INIT_CWD
  ];
  for (const c of envCandidates) {
    if (c && typeof c === 'string' && fs.existsSync(c) && !isIdeInstallationDirectory(c)) {
      return c;
    }
  }

  let curClient = '';
  try {
    const runtimeState = require('./mcp/runtime_state');
    curClient = runtimeState.getActiveClient() || '';
  } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }

  if (curClient === 'agy' || curClient === 'antigravity') {
    const HOME = os.homedir();
    const convId = process.env.ANTIGRAVITY_CONVERSATION_ID;

    const cliCache = path.join(HOME, '.gemini', 'antigravity-cli', 'cache');
    const ideCache = path.join(HOME, '.gemini', 'antigravity-ide', 'cache');
    for (const cacheDir of [cliCache, ideCache]) {
      const lastConvFile = path.join(cacheDir, 'last_conversations.json');
      if (convId && fs.existsSync(lastConvFile)) {
        try {
          const mapping = JSON.parse(fs.readFileSync(lastConvFile, 'utf8'));
          for (const [p, id] of Object.entries(mapping)) {
            if (id === convId && fs.existsSync(p) && !isIdeInstallationDirectory(p)) {
              return p;
            }
          }
        } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
      }
    }
  }

  return null;
}

function setWorkspaceRoot(root) {
  if (root && isIdeInstallationDirectory(root)) {
    workspaceRoot = null;
    return;
  }
  workspaceRoot = root ? platform.stripWinExtendedPrefix(root) : null;
  try {
    const runtimeState = require('./mcp/runtime_state');
    runtimeState.setWorkspaceRoot(workspaceRoot);
  } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
}

function getWorkspaceRoot() {
  let ws = null;
  if (workspaceRoot && !isIdeInstallationDirectory(workspaceRoot)) {
    ws = workspaceRoot;
  } else {
    const detected = detectWorkspaceRoot();
    if (detected && !isIdeInstallationDirectory(detected)) {
      workspaceRoot = detected;
      ws = detected;
    } else {
      const cwd = process.cwd();
      ws = !isIdeInstallationDirectory(cwd) ? cwd : os.homedir();
    }
  }
  return ws ? platform.stripWinExtendedPrefix(ws) : ws;
}

function uriToPath(uri) {
  return platform.uriToPath(uri);
}

function resolveInputPath(rawPath) {
  let p = rawPath;
  if (p && typeof p === 'object') {
    p = p.path || p.file_path || p.filepath || p.dir_path || p.dir;
  }
  if (!p || typeof p !== 'string') {
    throw new Error('path is required');
  }
  const expanded = platform.expandUser(p);
  const base = getWorkspaceRoot();
  const resolved = path.isAbsolute(expanded)
    ? path.resolve(expanded)
    : path.resolve(base, expanded);
  let real;
  try {
    real = fs.realpathSync(resolved);
  } catch {
    real = resolved;
  }
  real = platform.stripWinExtendedPrefix(real);
  assertWithinAllowed(real);
  return real;
}

/**
 * Allow a path if it's inside the workspace root, inside ~/.konoha/,
 * or inside any IDE agent scratch directory (~/.gemini/, ~/.claude/,
 * ~/.cursor/, etc).
 */
function assertWithinAllowed(resolvedPath) {
  const pathNorm = platform.normPath(resolvedPath);

  // 0. Explicit block for IDE binary installation directory
  if (isIdeInstallationDirectory(resolvedPath) || isIdeInstallationDirectory(pathNorm)) {
    throw new Error(`Access to IDE installation directory is forbidden: ${resolvedPath}`);
  }

  // 1. Konoha install directory — always allowed
  if (pathNorm === KONOHA_DIR_NORM || pathNorm.startsWith(KONOHA_DIR_NORM + path.sep) || pathNorm.startsWith(KONOHA_DIR_NORM + '/')) {
    return;
  }

  // 1b. Dev repository root (source checkout) — allowed in dev mode only
  if (DEV_PROJECT_ROOT_NORM && (pathNorm === DEV_PROJECT_ROOT_NORM || pathNorm.startsWith(DEV_PROJECT_ROOT_NORM + path.sep) || pathNorm.startsWith(DEV_PROJECT_ROOT_NORM + '/'))) {
    return;
  }

  // 2. Inside home-scoped agent scratch dirs — IDE internal caches
  //    These paths are used by tools like read_file_head to inspect
  //    output files written by agent sub-sessions (e.g. Gemini brain/,
  //    Claude sessions, Cursor .md files).
  const HOME = os.homedir();
  const SCRATCH_PREFIXES = [
    path.join(HOME, '.gemini'),
    path.join(HOME, '.claude'),
    path.join(HOME, '.cursor'),
    path.join(HOME, '.vscode'),
    path.join(HOME, '.openai'),
    path.join(HOME, '.windsurf'),
    path.join(HOME, '.commandcode'),
    path.join(HOME, '.opencode'),
    path.join(HOME, '.config'),
    path.join(HOME, '.codex'),
    path.join(HOME, '.agents'),
    path.join(HOME, '.claude.json'),
    path.join(HOME, '.pi'),
  ].map(d => platform.normPath(d));
  for (const p of SCRATCH_PREFIXES) {
    if (pathNorm === p || pathNorm.startsWith(p + path.sep) || pathNorm.startsWith(p + '/')) {
      return;
    }
  }

  // 3. Inside workspace root — if set
  const workspace = getWorkspaceRoot();
  if (!workspace) return;
  let wsReal;
  try {
    wsReal = fs.realpathSync(path.resolve(workspace));
  } catch {
    wsReal = path.resolve(workspace);
  }
  wsReal = platform.stripWinExtendedPrefix(wsReal);
  const wsNorm = platform.normPath(wsReal);
  const rel = path.relative(wsNorm, pathNorm);
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
    return;
  }

  // 4. Not allowed
  throw new Error(`Path outside workspace: ${resolvedPath}`);
}


function formatToolResult(data) {
  if (data.error) {
    return { text: JSON.stringify({ error: data.error }), isError: true };
  }
  if (typeof data.text === 'string') {
    return { text: data.text, isError: false };
  }
  if (Array.isArray(data.files)) {
    return { text: JSON.stringify(data), isError: false };
  }
  return { text: JSON.stringify(data), isError: false };
}

function readFileRange(args = {}) {
  const filePath = args.path || args.file_path || args.filepath || args.FilePath || args.Path;
  const start_line = args.start_line !== undefined ? args.start_line : args.StartLine;
  const end_line = args.end_line !== undefined ? args.end_line : args.EndLine;
  if (start_line === undefined || end_line === undefined) {
    return { error: 'start_line and end_line are required' };
  }
  const resolved = resolveInputPath(filePath);
  return readFileRangeWorker({
    path: resolved,
    start_line: Number(start_line),
    end_line: Number(end_line),
    workspace: getWorkspaceRoot()
  });
}

function readFileHead(args = {}) {
  const filePath = args.path || args.file_path || args.filepath || args.FilePath || args.Path;
  const max_lines = args.max_lines !== undefined ? args.max_lines : (args.lines !== undefined ? args.lines : (args.limit !== undefined ? args.limit : args.count));
  const resolved = resolveInputPath(filePath);
  const payload = { path: resolved, workspace: getWorkspaceRoot() };
  if (max_lines !== undefined) {
    payload.max_lines = Number(max_lines);
  }
  return readFileHeadWorker(payload);
}

function fileInfo(args = {}) {
  const filePath = args.path || args.file_path || args.filepath || args.FilePath || args.Path;
  const resolved = resolveInputPath(filePath);
  return fileInfoWorker({ path: resolved, workspace: getWorkspaceRoot() });
}

function tokenEfficientGrep(args = {}) {
  const pattern = args.pattern || args.Pattern;
  const { glob, file_glob, ignore_case, max_matches, CaseInsensitive } = args;
  if (!pattern) {
    return { error: 'pattern is required' };
  }
  const dirPath = args.dir || args.path || args.file_path || args.directory || args.dir_path || args.DirectoryPath || '.';
  const resolvedDir = resolveInputPath(dirPath);

  let finalDir = resolvedDir;
  let finalGlob = glob || file_glob || args.Glob;
  try {
    const stat = fs.statSync(resolvedDir);
    if (stat.isFile()) {
      finalDir = path.dirname(resolvedDir);
      // Only search this specific file
      finalGlob = path.basename(resolvedDir);
    }
  } catch (_) {
    // Ignore error, let worker handle if missing
  }

  const payload = { pattern, dir: finalDir, workspace: getWorkspaceRoot() };
  if (finalGlob) payload.glob = finalGlob;
  const effIgnoreCase = ignore_case !== undefined ? ignore_case : CaseInsensitive;
  if (effIgnoreCase !== undefined) payload.ignore_case = effIgnoreCase;
  if (max_matches !== undefined) payload.max_matches = max_matches;
  return tokenEfficientGrepWorker(payload);
}

function getFileStructure(args = {}) {
  const filePath = args.path || args.file_path || args.filepath || args.dir_path || args.dir || args.DirectoryPath || '.';
  const resolved = resolveInputPath(filePath);
  return getFileStructureWorker({ path: resolved, workspace: getWorkspaceRoot() });
}

function findFilesClean(args = {}) {
  const pattern = args.pattern || args.Pattern || '*';
  const dirPath = args.dir || args.path || args.file_path || args.directory || args.dir_path || args.DirectoryPath || args.root_dir || args.rootDir || '.';
  const resolvedDir = resolveInputPath(dirPath);
  const payload = {
    pattern,
    dir: resolvedDir,
    workspace: getWorkspaceRoot()
  };
  if (args.limit !== undefined) payload.limit = args.limit;
  return findFilesCleanWorker(payload);
}

let _serverModule = null;
function getServerModule() {
  if (!_serverModule) {
    _serverModule = require('./server');
  }
  return _serverModule;
}

function runNodeSkillTool(toolName, args) {
  try {
    const server = getServerModule();
    const text = server.executeToolSync(toolName, args);
    let isError = false;
    try {
      const parsed = JSON.parse(text);
      isError = typeof parsed === 'object' && parsed !== null && parsed.error !== undefined;
    } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
    return { text, isError };
  } catch (err) {
    return { error: err.message || String(err), text: JSON.stringify({ error: err.message || String(err) }), isError: true };
  }
}

const TOOL_HANDLERS = {
  read_file_range: readFileRange,
  read_file_head: readFileHead,
  file_info: fileInfo,
  token_efficient_grep: tokenEfficientGrep,
  get_file_structure: getFileStructure,
  find_files_clean: findFilesClean,
  find_skill: (args) => runNodeSkillTool('find_skill', args),
  find_skills: (args) => runNodeSkillTool('find_skill', args),
  list_skills: (args) => runNodeSkillTool('list_skills', args),
  get_skill: (args) => runNodeSkillTool('get_skill', args),
  optimize_report: (args) => runNodeSkillTool('optimize_report', args),
  build_with_image_design: (args) => runNodeSkillTool('build_with_image_design', args),
  build_from_source: (args) => runNodeSkillTool('build_from_source', args),
  build_from_text: (args) => runNodeSkillTool('build_from_text', args),
  sannin: (args) => runNodeSkillTool('sannin', args),
  kage: (args) => runNodeSkillTool('kage', args),
  jonin: (args) => runNodeSkillTool('jonin', args),
  anbu: (args) => runNodeSkillTool('anbu', args),
  chunin: (args) => runNodeSkillTool('chunin', args),
  tokubetsu_jonin: (args) => runNodeSkillTool('tokubetsu_jonin', args),
  genin: (args) => runNodeSkillTool('genin', args),
  delegate_to_sannin: (args) => runNodeSkillTool('delegate_to_sannin', args),
  delegate_to_kage: (args) => runNodeSkillTool('delegate_to_kage', args),
  delegate_to_jonin: (args) => runNodeSkillTool('delegate_to_jonin', args),
  delegate_to_anbu: (args) => runNodeSkillTool('delegate_to_anbu', args),
  delegate_to_chunin: (args) => runNodeSkillTool('delegate_to_chunin', args),
  delegate_to_tokubetsu_jonin: (args) => runNodeSkillTool('delegate_to_tokubetsu_jonin', args),
  delegate_to_genin: (args) => runNodeSkillTool('delegate_to_genin', args),
  report_from_agent: (args) => runNodeSkillTool('report_from_agent', args),
  get_project_context: (args) => runNodeSkillTool('get_project_context', args),
  save_project_context: (args) => runNodeSkillTool('save_project_context', args),
  query_project_memory: (args) => runNodeSkillTool('query_project_memory', args),
  web_search: (args) => runNodeSkillTool('web_search', args),
  migrate_skills: (args) => runNodeSkillTool('migrate_skills', args),
  save_persona_memory: (args) => runNodeSkillTool('save_persona_memory', args),
  query_persona_memory: (args) => runNodeSkillTool('query_persona_memory', args),
  list_persona_memories: (args) => runNodeSkillTool('list_persona_memories', args),
  delete_persona_memory: (args) => runNodeSkillTool('delete_persona_memory', args),
  get_resolved_task_dir: (args) => runNodeSkillTool('get_resolved_task_dir', args),
  check_readiness: (args) => runNodeSkillTool('check_readiness', args),
  get_task_evidence: (args) => runNodeSkillTool('get_task_evidence', args),
  get_slop_findings: (args) => runNodeSkillTool('get_slop_findings', args),
  website_ai_detector: (args) => runNodeSkillTool('website_ai_detector', args),
  docs_ai_detector: (args) => runNodeSkillTool('docs_ai_detector', args)
};

function validateSchemaValue(value, schema, key) {
  if (schema.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${key} must be an object`);
    return;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) throw new Error(`${key} must be an array`);
    if (schema.items) value.forEach((item, index) => validateSchemaValue(item, schema.items, `${key}[${index}]`));
    return;
  }
  if (schema.type === 'number' || schema.type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${key} must be a finite number`);
    if (schema.integer && !Number.isInteger(value)) throw new Error(`${key} must be an integer`);
    if (schema.type === 'integer' && !Number.isInteger(value)) throw new Error(`${key} must be an integer`);
    if (schema.minimum !== undefined && value < schema.minimum) throw new Error(`${key} must be at least ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) throw new Error(`${key} must be at most ${schema.maximum}`);
    return;
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string') throw new Error(`${key} must be a string`);
    if (schema.minLength !== undefined && value.length < schema.minLength) throw new Error(`${key} must not be empty`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) throw new Error(`${key} is too long`);
    return;
  }
  if (schema.type === 'boolean' && typeof value !== 'boolean') throw new Error(`${key} must be a boolean`);
}

const TOOL_SPECIFIC_ALIASES = {
  read_file_head: { lines: 'max_lines', limit: 'max_lines', count: 'max_lines', FilePath: 'file_path', filepath: 'file_path', Path: 'path' },
  read_file_range: { FilePath: 'file_path', filepath: 'file_path', Path: 'path', StartLine: 'start_line', EndLine: 'end_line' },
  file_info: { FilePath: 'file_path', filepath: 'file_path', Path: 'path' },
  token_efficient_grep: { DirectoryPath: 'dir', dir_path: 'dir', directory: 'dir', Pattern: 'pattern', Glob: 'glob', file_glob: 'glob', CaseInsensitive: 'ignore_case' },
  get_file_structure: { FilePath: 'file_path', filepath: 'file_path', Path: 'path', DirectoryPath: 'dir', dir_path: 'dir', directory: 'dir' },
  find_files_clean: { DirectoryPath: 'dir', dir_path: 'dir', directory: 'dir', Pattern: 'pattern', root_dir: 'dir', rootDir: 'dir', max_results: 'limit', maxResults: 'limit' },
};

const GLOBAL_ALIASES = {
  filepath: 'file_path',
  FilePath: 'file_path',
  Path: 'path',
  StartLine: 'start_line',
  EndLine: 'end_line',
  Pattern: 'pattern',
  CaseInsensitive: 'ignore_case',
  Keyword: 'keyword',
  TasteDials: 'taste_dials',
  ProjectPath: 'project_path',
  TaskDir: 'task_dir',
  AgentName: 'agent_name',
};

function normalizeToolArguments(name, rawArgs) {
  if (!rawArgs || typeof rawArgs !== 'object' || Array.isArray(rawArgs)) return rawArgs;
  const normalized = { ...rawArgs };
  const toolAliases = TOOL_SPECIFIC_ALIASES[name] || {};
  for (const [rawKey, targetKey] of Object.entries(toolAliases)) {
    if (rawKey in normalized && !(targetKey in normalized)) {
      normalized[targetKey] = normalized[rawKey];
      delete normalized[rawKey];
    }
  }
  for (const [rawKey, targetKey] of Object.entries(GLOBAL_ALIASES)) {
    if (rawKey in normalized && !(targetKey in normalized)) {
      normalized[targetKey] = normalized[rawKey];
      delete normalized[rawKey];
    }
  }
  return normalized;
}

function validateToolArguments(name, args) {
  const schema = MCP_MANIFEST.tools.find((tool) => tool.name === name)?.inputSchema;
  if (!schema) throw new Error(`Unknown tool: ${name}`);
  if (args === null || typeof args !== 'object' || Array.isArray(args)) throw new Error('arguments must be an object');
  for (const required of schema.required || []) {
    if (!(required in args)) throw new Error(`${required} is required`);
  }
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(args)) {
      if (!schema.properties || !Object.prototype.hasOwnProperty.call(schema.properties, key)) throw new Error(`Unknown argument: ${key}`);
    }
  }
  for (const [key, value] of Object.entries(args)) {
    const property = schema.properties && schema.properties[key];
    if (property) {
      validateSchemaValue(value, property, key);
      if (property.enum && !property.enum.includes(value)) throw new Error(`${key} must be one of: ${property.enum.join(', ')}`);
    }
  }
  if (schema.anyOf && !schema.anyOf.some((option) => (option.required || []).every((key) => key in args))) {
    throw new Error('one of the supported path arguments is required');
  }
}

function dispatchTool(name, rawArgs) {
  const args = normalizeToolArguments(name, rawArgs || {});
  const handler = TOOL_HANDLERS[name];
  try {
    validateToolArguments(name, args);
  } catch (err) {
    return { text: JSON.stringify({ error: err.message || String(err) }), isError: true };
  }
  if (!handler) {
    return { text: JSON.stringify({ error: `Unknown tool: ${name}` }), isError: true };
  }
  try {
    const result = handler(args);
    return formatToolResult(result);
  } catch (err) {
    return { text: JSON.stringify({ error: err.message || String(err) }), isError: true };
  }
}

// Deprecated compatibility aliases — hidden from tools/list to slim the
// per-session schema payload; dispatch paths remain functional for direct calls.
const DEPRECATED_TOOL_ALIASES = new Set([
  'delegate_to_sannin', 'delegate_to_kage', 'delegate_to_jonin', 'delegate_to_anbu',
  'delegate_to_chunin', 'delegate_to_tokubetsu_jonin', 'delegate_to_genin',
  'build_with_image_design',
]);

function listToolSchemas() {
  return MCP_MANIFEST.tools.filter((t) => !DEPRECATED_TOOL_ALIASES.has(t.name));
}

function validateInstall() {
  const errors = [];
  if (!fs.existsSync(path.join(__dirname, 'file_tools_mcp.js'))) {
    errors.push('file_tools_mcp.js missing');
  }
  if (!fs.existsSync(path.join(__dirname, 'mcp_tool_manifest.json'))) {
    errors.push('mcp_tool_manifest.json missing');
  }
  for (const runtimeFile of ['server.js', 'migrate.js', 'tools_savings_logger.js', 'db.js', 'vector_search.js']) {
    if (!fs.existsSync(path.join(__dirname, runtimeFile))) errors.push(`${runtimeFile} missing`);
  }
  return errors;
}

module.exports = {
  resolveInputPath,
  setWorkspaceRoot,
  getWorkspaceRoot,
  assertWithinAllowed,
  isIdeInstallationDirectory,
  uriToPath,
  dispatchTool,
  listToolSchemas,
  validateInstall,
  TOOL_HANDLERS,
  normalizeToolArguments,
  validateToolArguments,
  MCP_MANIFEST
};
