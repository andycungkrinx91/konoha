/**
 * Konoha file-tools router — Node orchestration spawning Python workers.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const platform = require('./platform_utils');

const TOOLS_DIR = path.join(__dirname, 'file_tools');
const PYTHON_CMD_FILE = path.join(__dirname, '.python_cmd');
const SCRIPT_TIMEOUT_MS = 60000;

let workspaceRoot = null;

function getPythonCommand() {
  if (process.env.KONOHA_PYTHON) {
    return process.env.KONOHA_PYTHON;
  }
  if (fs.existsSync(PYTHON_CMD_FILE)) {
    const recorded = fs.readFileSync(PYTHON_CMD_FILE, 'utf8').trim();
    if (recorded) {
      return recorded;
    }
  }
  return platform.detectPythonOrDefault();
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
  if (!rawPath || typeof rawPath !== 'string') {
    throw new Error('path is required');
  }
  const expanded = platform.expandUser(rawPath);
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
  assertWithinWorkspace(real);
  return real;
}

function assertWithinWorkspace(resolvedPath) {
  const workspace = getWorkspaceRoot();
  if (!workspace) return;
  let wsReal;
  try {
    wsReal = fs.realpathSync(path.resolve(workspace));
  } catch {
    wsReal = path.resolve(workspace);
  }
  const wsNorm = platform.normPath(wsReal);
  const pathNorm = platform.normPath(resolvedPath);
  const rel = path.relative(wsNorm, pathNorm);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path outside workspace: ${resolvedPath}`);
  }
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
    result = spawnSync(getPythonCommand(), [scriptPath, JSON.stringify(payload)], {
      encoding: 'utf-8',
      timeout: SCRIPT_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      shell: platform.IS_WIN
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

function readFileRange({ path: filePath, start_line, end_line }) {
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

function readFileHead({ path: filePath, max_lines }) {
  const resolved = resolveInputPath(filePath);
  const payload = { path: resolved };
  if (max_lines !== undefined) {
    payload.max_lines = Number(max_lines);
  }
  return runPythonScript('read_file_head.py', payload);
}

function fileInfo({ path: filePath }) {
  const resolved = resolveInputPath(filePath);
  return runPythonScript('file_info.py', { path: resolved });
}

function tokenEfficientGrep({ pattern, dir, glob, file_glob, ignore_case, max_matches }) {
  if (!pattern) {
    return { error: 'pattern is required' };
  }
  const resolvedDir = resolveInputPath(dir || '.');
  const payload = { pattern, dir: resolvedDir };
  if (glob || file_glob) payload.glob = glob || file_glob;
  if (ignore_case !== undefined) payload.ignore_case = Boolean(ignore_case);
  if (max_matches !== undefined) payload.max_matches = Number(max_matches);
  return runPythonScript('token_efficient_grep.py', payload);
}

function getFileStructure({ path: filePath }) {
  const resolved = resolveInputPath(filePath);
  return runPythonScript('get_file_structure.py', { path: resolved });
}

function findFilesClean({ pattern, dir }) {
  const resolvedDir = resolveInputPath(dir || '.');
  return runPythonScript('find_files_clean.py', {
    pattern: pattern || '*',
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
    result = spawnSync(getPythonCommand(), [serverPyPath, '--tool', toolName, JSON.stringify(args || {})], {
      encoding: 'utf-8',
      timeout: SCRIPT_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      shell: platform.IS_WIN
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
  build_from_source: (args) => runPythonSkillTool('build_from_source', args),
  build_from_text: (args) => runPythonSkillTool('build_from_text', args)
};

function dispatchTool(name, args) {
  const handler = TOOL_HANDLERS[name];
  if (!handler) {
    return { text: JSON.stringify({ error: `Unknown tool: ${name}` }), isError: true };
  }
  try {
    const result = handler(args || {});
    return formatToolResult(result);
  } catch (err) {
    return { text: JSON.stringify({ error: err.message || String(err) }), isError: true };
  }
}

function listToolSchemas() {
  return [
    {
      name: 'read_file_head',
      description:
        'Token-efficient file preview. Reads the first N lines (default 80, max 200) with line numbers. Use before read_file_range to avoid loading large files.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute or workspace-relative file path' },
          max_lines: { type: 'number', description: 'Lines to read from start (default 80, max 200)' }
        },
        required: ['path']
      }
    },
    {
      name: 'read_file_range',
      description:
        'Token-efficient file read. Streams only lines between start_line and end_line (1-indexed) with line numbers. Refuses spans > 500 lines.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute or workspace-relative file path' },
          start_line: { type: 'number', description: 'First line to read (1-indexed)' },
          end_line: { type: 'number', description: 'Last line to read (1-indexed, inclusive)' }
        },
        required: ['path', 'start_line', 'end_line']
      }
    },
    {
      name: 'file_info',
      description:
        'File metadata without content: size, line count (text files), mtime, extension. Use to plan read_file_range windows and save tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute or workspace-relative file path' }
        },
        required: ['path']
      }
    },
    {
      name: 'token_efficient_grep',
      description:
        'Compressed regex search capped at 20 matches (max 50). Output: [relative/path:line] snippet. Skips node_modules, .git, dist, build, venv, lockfiles.',
      inputSchema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Python regex pattern' },
          dir: { type: 'string', description: 'Directory to search (default: workspace root)' },
          glob: { type: 'string', description: 'Optional filename glob filter (e.g. "*.js")' },
          ignore_case: { type: 'boolean', description: 'Case-insensitive regex (default false)' },
          max_matches: { type: 'number', description: 'Match cap (default 20, max 50)' }
        },
        required: ['pattern']
      }
    },
    {
      name: 'get_file_structure',
      description:
        'Returns compact class/function signature map for a file (ast for Python, regex for JS/TS and other languages). Omits function bodies to save tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute or workspace-relative file path' }
        },
        required: ['path']
      }
    },
    {
      name: 'find_files_clean',
      description:
        'Find files by glob pattern under dir. Skips .git, node_modules, dist, build, venv, .venv, and lockfiles. Returns dense JSON { files: [...] }.',
      inputSchema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern (e.g. "*.py", "**/*.test.js")' },
          dir: { type: 'string', description: 'Root directory (default: workspace root)' }
        }
      }
    },
    {
      name: 'find_skill',
      description: 'Search SQLite FTS5 database for skills matching keyword. Returns top matching skill chunks.',
      inputSchema: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: 'Search keyword or query string' },
          limit: { type: 'number', description: 'Maximum number of results to return (default 3, max 5)' },
          agent: { type: 'string', description: 'Calling subagent name (optional)' },
          compact: { type: 'boolean', description: 'Return 500-char compact previews (default false)' }
        },
        required: ['keyword']
      }
    },
    {
      name: 'list_skills',
      description: 'List indexed skill names and metadata from SQLite database.',
      inputSchema: {
        type: 'object',
        properties: {
          agent: { type: 'string', description: 'Calling subagent name (optional)' },
          fields: { type: 'array', items: { type: 'string' }, description: 'Specific fields to return (optional)' }
        }
      }
    },
    {
      name: 'get_skill',
      description: 'Retrieve full content of a specific skill or reference by exact name.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Exact skill or reference name (e.g. "anbu-skill" or "anbu-skill/ci-cd-security")' },
          agent: { type: 'string', description: 'Calling subagent name (optional)' }
        },
        required: ['name']
      }
    },
    {
      name: 'optimize_report',
      description: 'Analyze token footprint and return token optimization recommendations for skills.',
      inputSchema: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: 'Skill topic or keyword (optional)' },
          agent: { type: 'string', description: 'Calling subagent name (optional)' }
        }
      }
    },
    {
      name: 'build_from_source',
      description: 'Build UI components/apps with 100% exact layout/color match to input mockup images.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Project or component name' },
          source_dir: { type: 'string', description: 'Directory containing source design mockup images' },
          framework: { type: 'string', description: 'Target framework (e.g. svelte, nextjs, react)' }
        },
        required: ['name', 'source_dir', 'framework']
      }
    },
    {
      name: 'build_from_text',
      description: 'Scaffold modern UI applications directly from text description using premium design standards.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Project name' },
          description: { type: 'string', description: 'Text description of desired web application or UI' },
          framework: { type: 'string', description: 'Target framework (e.g. svelte, nextjs, react)' }
        },
        required: ['name', 'description', 'framework']
      }
    }
  ];
}

function validateInstall() {
  const errors = [];
  if (!fs.existsSync(path.join(__dirname, 'file_tools_mcp.js'))) {
    errors.push('file_tools_mcp.js missing');
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
  setWorkspaceRoot,
  getWorkspaceRoot,
  uriToPath,
  dispatchTool,
  listToolSchemas,
  validateInstall,
  TOOL_HANDLERS
};
