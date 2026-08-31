/**
 * Konoha file-tools router — Node orchestration spawning Python workers.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const platform = require('./platform_utils');
const MCP_MANIFEST = require('./mcp_tool_manifest.json');

// Support both dev (require bin/lib/paths) and deployed (~/.konoha/) contexts.
const devPaths = (() => {
  try { return require('../bin/lib/paths'); } catch(_) { return null; }
})();
const TOOL_WORKERS_DIR = devPaths
  ? devPaths.TOOL_WORKERS_DIR
  : path.join(__dirname, 'file_tools');
const FILE_TOOLS_PYTHON_CMD_FILE = devPaths
  ? devPaths.FILE_TOOLS_PYTHON_CMD_FILE
  : path.join(__dirname, '.python_cmd');

const TOOLS_DIR = TOOL_WORKERS_DIR;
const PYTHON_CMD_FILE = FILE_TOOLS_PYTHON_CMD_FILE;
const SCRIPT_TIMEOUT_MS = 60000;

// Allow paths under the Konoha install directory (~/\.konoha/).
// This ensures the MCP server can work on workspace-internal paths
// even when the IDE workspace is something else (e.g. a brain/session dir).
const HOME = os.homedir();
const KONOHA_DIR = path.join(HOME, '.konoha');
let konoHaReal = null;
try { konoHaReal = fs.realpathSync(KONOHA_DIR); } catch { konoHaReal = path.resolve(KONOHA_DIR); }
const KONOHA_DIR_NORM = platform.normPath(konoHaReal);

let workspaceRoot = null;

function getPythonCommand() {
  if (process.env.KONOHA_PYTHON) {
    return platform.normalizeCommand(process.env.KONOHA_PYTHON);
  }
  if (fs.existsSync(PYTHON_CMD_FILE)) {
    const recorded = fs.readFileSync(PYTHON_CMD_FILE, 'utf8').trim();
    if (recorded) {
      return platform.normalizeCommand(recorded);
    }
  }
  return platform.normalizeCommand(platform.detectPythonOrDefault());
}

function setWorkspaceRoot(root) {
  workspaceRoot = root || null;
}

function getWorkspaceRoot() {
  return workspaceRoot || process.cwd();
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

  // 1. Konoha install directory — always allowed
  if (pathNorm === KONOHA_DIR_NORM || pathNorm.startsWith(KONOHA_DIR_NORM + path.sep) || pathNorm.startsWith(KONOHA_DIR_NORM + '/')) {
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
  const wsNorm = platform.normPath(wsReal);
  const rel = path.relative(wsNorm, pathNorm);
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
    return;
  }

  // 4. Not allowed
  throw new Error(`Path outside workspace: ${resolvedPath}`);
}

function runPythonScript(scriptName, args) {
  const scriptPath = path.join(TOOLS_DIR, scriptName);
  if (!fs.existsSync(scriptPath)) {
    return { error: `Python helper not found: ${scriptPath}. Run konoha doctor --yes.` };
  }

  const payload = {
    ...args,
    workspace: getWorkspaceRoot()
  };

  let result;
  try {
    const python = getPythonCommand();
    result = spawnSync(python.executable, [...python.prefixArgs, scriptPath, JSON.stringify(payload)], {
      encoding: 'utf-8',
      timeout: SCRIPT_TIMEOUT_MS,
      maxBuffer: 1024 * 1024 * 1024
    });
  } catch (err) {
    return { error: err.message || String(err) };
  }

  if (result.error) {
    return { error: result.error.message || String(result.error) };
  }

  const stdout = (result.stdout || '').trim();
  const stderr = (result.stderr || '').trim();

  if (!stdout) {
    return { error: stderr || `Python script exited with code ${result.status}` };
  }

  try {
    const parsed = JSON.parse(stdout);
    if (parsed.error) {
      return { error: parsed.error };
    }
    return parsed;
  } catch {
    return { text: stdout, stderr: stderr || undefined };
  }
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
  return runPythonScript('read_file_range.py', {
    path: resolved,
    start_line: Number(start_line),
    end_line: Number(end_line)
  });
}

function readFileHead(args = {}) {
  const filePath = args.path || args.file_path || args.filepath || args.FilePath || args.Path;
  const max_lines = args.max_lines !== undefined ? args.max_lines : (args.lines !== undefined ? args.lines : (args.limit !== undefined ? args.limit : args.count));
  const resolved = resolveInputPath(filePath);
  const payload = { path: resolved };
  if (max_lines !== undefined) {
    payload.max_lines = Number(max_lines);
  }
  return runPythonScript('read_file_head.py', payload);
}

function fileInfo(args = {}) {
  const filePath = args.path || args.file_path || args.filepath || args.FilePath || args.Path;
  const resolved = resolveInputPath(filePath);
  return runPythonScript('file_info.py', { path: resolved });
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
  } catch (e) {
    // Ignore error, let Python script handle if missing
  }

  const payload = { pattern, dir: finalDir };
  if (finalGlob) payload.glob = finalGlob;
  const effIgnoreCase = ignore_case !== undefined ? ignore_case : CaseInsensitive;
  if (effIgnoreCase !== undefined) payload.ignore_case = effIgnoreCase;
  if (max_matches !== undefined) payload.max_matches = max_matches;
  return runPythonScript('token_efficient_grep.py', payload);
}

function getFileStructure(args = {}) {
  const filePath = args.path || args.file_path || args.filepath || args.dir_path || args.dir || args.DirectoryPath || '.';
  const resolved = resolveInputPath(filePath);
  return runPythonScript('get_file_structure.py', { path: resolved });
}

function findFilesClean(args = {}) {
  const pattern = args.pattern || args.Pattern || '*';
  const dirPath = args.dir || args.path || args.file_path || args.directory || args.dir_path || args.DirectoryPath || '.';
  const resolvedDir = resolveInputPath(dirPath);
  return runPythonScript('find_files_clean.py', {
    pattern,
    dir: resolvedDir
  });
}

function runPythonSkillTool(toolName, args) {
  const serverPyPath = path.join(__dirname, 'server.py');
  if (!fs.existsSync(serverPyPath)) {
    return { error: `Python server helper not found: ${serverPyPath}` };
  }
  let result;
  try {
    const timeoutMs = toolName.startsWith('mcp_') ? 600000 : SCRIPT_TIMEOUT_MS; // 10 minutes for subagents
    const python = getPythonCommand();
    result = spawnSync(python.executable, [...python.prefixArgs, serverPyPath, '--tool', toolName, JSON.stringify(args || {})], {
      encoding: 'utf-8',
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024 * 1024
    });
  } catch (err) {
    return { error: err.message || String(err) };
  }
  if (result.error) {
    return { error: result.error.message || String(result.error) };
  }
  const stdout = (result.stdout || '').trim();
  if (result.status !== 0) {
    return { error: (result.stderr || '').trim() || `Exit code ${result.status}` };
  }
  return { text: stdout };
}

const TOOL_HANDLERS = {
  read_file_range: readFileRange,
  read_file_head: readFileHead,
  file_info: fileInfo,
  token_efficient_grep: tokenEfficientGrep,
  get_file_structure: getFileStructure,
  find_files_clean: findFilesClean,
  find_skill: (args) => runPythonSkillTool('find_skill', args),
  list_skills: (args) => runPythonSkillTool('list_skills', args),
  get_skill: (args) => runPythonSkillTool('get_skill', args),
  optimize_report: (args) => runPythonSkillTool('optimize_report', args),
  build_with_image_design: (args) => runPythonSkillTool('build_with_image_design', args),
  build_from_source: (args) => runPythonSkillTool('build_from_source', args),
  build_from_text: (args) => runPythonSkillTool('build_from_text', args),
  sannin: (args) => runPythonSkillTool('sannin', args),
  kage: (args) => runPythonSkillTool('kage', args),
  jonin: (args) => runPythonSkillTool('jonin', args),
  anbu: (args) => runPythonSkillTool('anbu', args),
  chunin: (args) => runPythonSkillTool('chunin', args),
  tokubetsu_jonin: (args) => runPythonSkillTool('tokubetsu_jonin', args),
  genin: (args) => runPythonSkillTool('genin', args),
  delegate_to_sannin: (args) => runPythonSkillTool('delegate_to_sannin', args),
  delegate_to_kage: (args) => runPythonSkillTool('delegate_to_kage', args),
  delegate_to_jonin: (args) => runPythonSkillTool('delegate_to_jonin', args),
  delegate_to_anbu: (args) => runPythonSkillTool('delegate_to_anbu', args),
  delegate_to_chunin: (args) => runPythonSkillTool('delegate_to_chunin', args),
  delegate_to_tokubetsu_jonin: (args) => runPythonSkillTool('delegate_to_tokubetsu_jonin', args),
  delegate_to_genin: (args) => runPythonSkillTool('delegate_to_genin', args),
  report_from_agent: (args) => runPythonSkillTool('report_from_agent', args),
  get_project_context: (args) => runPythonSkillTool('get_project_context', args),
  save_project_context: (args) => runPythonSkillTool('save_project_context', args),
  query_project_memory: (args) => runPythonSkillTool('query_project_memory', args),
  web_search: (args) => runPythonSkillTool('web_search', args),
  migrate_skills: (args) => runPythonSkillTool('migrate_skills', args),
  save_persona_memory: (args) => runPythonSkillTool('save_persona_memory', args),
  query_persona_memory: (args) => runPythonSkillTool('query_persona_memory', args),
  list_persona_memories: (args) => runPythonSkillTool('list_persona_memories', args),
  delete_persona_memory: (args) => runPythonSkillTool('delete_persona_memory', args),
  get_resolved_task_dir: (args) => runPythonSkillTool('get_resolved_task_dir', args)
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
  find_files_clean: { DirectoryPath: 'dir', dir_path: 'dir', directory: 'dir', Pattern: 'pattern' },
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

function listToolSchemas() {
  return MCP_MANIFEST.tools;
}

function validateInstall() {
  const errors = [];
  if (!fs.existsSync(path.join(__dirname, 'file_tools_mcp.js'))) {
    errors.push('file_tools_mcp.js missing');
  }
  if (!fs.existsSync(path.join(__dirname, 'mcp_tool_manifest.json'))) {
    errors.push('mcp_tool_manifest.json missing');
  }
  for (const runtimeFile of ['server.py', 'migrate.py', 'tools_savings_logger.py']) {
    if (!fs.existsSync(path.join(__dirname, runtimeFile))) errors.push(`${runtimeFile} missing`);
  }
  if (!fs.existsSync(TOOLS_DIR)) {
    errors.push(`file_tools/ directory missing at ${TOOLS_DIR}`);
  }
  for (const script of [
    'read_file_range.py',
    'read_file_head.py',
    'file_info.py',
    'token_efficient_grep.py',
    'get_file_structure.py',
    'find_files_clean.py',
    '_common.py'
  ]) {
    if (!fs.existsSync(path.join(TOOLS_DIR, script))) {
      errors.push(`missing ${script}`);
    }
  }
  return errors;
}

module.exports = {
  resolveInputPath,
  setWorkspaceRoot,
  getWorkspaceRoot,
  uriToPath,
  dispatchTool,
  listToolSchemas,
  validateInstall,
  TOOL_HANDLERS,
  validateToolArguments,
  MCP_MANIFEST
};
