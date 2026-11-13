/**
 * Argument normalization/validation split out of file_tools_router.js to keep that file under the 700-line lint cap.
 * The manifest loader is shared with the router; requiring the router back would be circular.
 */
const { loadManifest } = require('./manifest');

const MCP_MANIFEST = loadManifest();

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
    // Integer-ness is derived from type === 'integer' ONLY. The legacy `integer: true`
    // annotation is not a JSON Schema keyword and is rejected by Gemini's tool-schema
    // validator, so it must never be required or honoured here.
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

const TOOL_SPECIFIC_PARAM_MAP = {
  read_file_head: { lines: 'max_lines', limit: 'max_lines', count: 'max_lines', FilePath: 'file_path', filepath: 'file_path', Path: 'path' },
  read_file_range: { FilePath: 'file_path', filepath: 'file_path', Path: 'path', StartLine: 'start_line', EndLine: 'end_line' },
  file_info: { FilePath: 'file_path', filepath: 'file_path', Path: 'path' },
  token_efficient_grep: { DirectoryPath: 'dir', dir_path: 'dir', directory: 'dir', Pattern: 'pattern', Glob: 'glob', file_glob: 'glob', CaseInsensitive: 'ignore_case' },
  get_file_structure: { FilePath: 'file_path', filepath: 'file_path', Path: 'path', DirectoryPath: 'dir', dir_path: 'dir', directory: 'dir' },
  find_files_clean: { DirectoryPath: 'dir', dir_path: 'dir', directory: 'dir', Pattern: 'pattern', root_dir: 'dir', rootDir: 'dir', max_results: 'limit', maxResults: 'limit' },
  find_skill: { query: 'keyword', Query: 'keyword', keywords: 'keyword', Keywords: 'keyword' },
  find_skills: { query: 'keyword', Query: 'keyword', keywords: 'keyword', Keywords: 'keyword' },
};

const GLOBAL_PARAM_MAP = {
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
  if (typeof rawArgs === 'string') {
    const trimmed = rawArgs.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        rawArgs = JSON.parse(trimmed);
      } catch (_) { /* ignore */ }
    }
    if (typeof rawArgs === 'string') {
      const AGENT_DELEGATION_TOOLS = ['genin', 'kage', 'jonin', 'anbu', 'chunin', 'tokubetsu_jonin', 'sannin', 'akatsuki'];
      if (AGENT_DELEGATION_TOOLS.includes(name)) {
        rawArgs = { task: trimmed };
      }
    }
  }
  if (!rawArgs || typeof rawArgs !== 'object' || Array.isArray(rawArgs)) return rawArgs;
  const normalized = { ...rawArgs };
  const toolParamMap = TOOL_SPECIFIC_PARAM_MAP[name] || {};
  for (const [rawKey, targetKey] of Object.entries(toolParamMap)) {
    if (rawKey in normalized && !(targetKey in normalized)) {
      normalized[targetKey] = normalized[rawKey];
      delete normalized[rawKey];
    }
  }
  for (const [rawKey, targetKey] of Object.entries(GLOBAL_PARAM_MAP)) {
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
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    const expectedProps = Object.keys(schema.properties || {}).join(', ');
    throw new Error(`Tool "${name}" expects a JSON args object with schema { ${expectedProps} }, received ${typeof args}`);
  }
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

module.exports = {
  validateSchemaValue,
  normalizeToolArguments,
  validateToolArguments
};