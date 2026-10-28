/**
 * bin/lib/yaml_utils.js — minimal dependency-free YAML reader/writer.
 *
 * Konoha only emits / consumes a tiny YAML subset:
 *   - top-level can be a mapping or a list of mappings (with `- key: value`)
 *   - nested mappings with 2-space indent
 *   - scalar strings, numbers, booleans, null
 *   - multi-line block scalars (the `|` style)
 *
 * We avoid pulling in js-yaml because:
 *   1. it is a heavy transitive dependency for what we actually need
 *   2. the deployed hooks/agents_yaml paths are written by us, so the writer
 *      is the only consumer that has to round-trip
 *
 * Round-trip is NOT guaranteed against arbitrary YAML. Use this only for
 * Konoha-managed files (agents.yaml, MCP client configs, cursor mcp.json).
 *
 * HISTORY NOTE: parseYaml was previously inlined inside src/agent_manager.js
 * for years and only ever tested through the snapshot harness (which exercises
 * loadAgents → getAgentsList end-to-end). When first extracted it was
 * partially re-implemented and silently dropped nested arrays-of-scalars
 * (skills: [genin-skill] came back undefined). This module pins the exact
 * behavior of the original parser — DO NOT "clean it up" without regenerating
 * the snapshot harness AND running every agents.yaml consumer end-to-end.
 */

// Coerce a raw YAML scalar (quoted string / bool / null / number) to its JS value.
function coerceScalar(val) {
  if (val.startsWith('"') && val.endsWith('"')) {
    try { val = JSON.parse(val); } catch { /* intentional best-effort fallback: malformed quotes fall through as text */ }
  } else if (val === 'true') {
    val = true;
  } else if (val === 'false') {
    val = false;
  } else if (val === 'null') {
    val = null;
  } else if (!isNaN(val) && val !== '') {
    val = Number(val);
  }
  return val;
}


// parseYaml — extracted verbatim from src/agent_manager.js (lines 33–180).

function handleYamlDash(trimmed, current, stack, indent, rootState) {
  if (stack.length === 0 && Object.keys(rootState.root).length === 0 && !rootState.isRootArray) {
    rootState.isRootArray = true;
    current = rootState.rootArray;
  }
  const rest = trimmed.slice(1).trim();
  const colonIdx = rest.indexOf(':');
  if (colonIdx !== -1) {
    const key = rest.slice(0, colonIdx).trim();
    let val = coerceScalar(rest.slice(colonIdx + 1).trim());
    const obj = {};
    if (Array.isArray(current)) current.push(obj);
    obj[key] = val;
    stack.push({ indent, value: obj });
  } else {
    const val = coerceScalar(rest);
    if (Array.isArray(current)) current.push(val);
  }
  return current;
}

function findNextNonEmptyLine(lines, startIndex) {
  let nextIdx = startIndex + 1;
  while (nextIdx < lines.length && lines[nextIdx].trim() === '') nextIdx++;
  if (nextIdx >= lines.length) return null;
  const match = lines[nextIdx].match(/^(\s*)/);
  return { line: lines[nextIdx], indent: match ? match[1].length : 0 };
}

function handleEmptyYamlColon(entry, lines, i) {
  const { current, key, stack, indent } = entry;
  const next = findNextNonEmptyLine(lines, i);
  if (next && next.indent > indent) {
    const isNextArray = next.line.trim().startsWith('-');
    const nextVal = isNextArray ? [] : {};
    current[key] = nextVal;
    stack.push({ indent, value: nextVal });
    return;
  }
  current[key] = '';
}

function handleYamlColon(lineCtx, current, stack, lines, multiLine) {
  const { line, colonIdx, i } = lineCtx;
  const indent = line.match(/^(\s*)/)[0].length;
  const key = line.slice(0, colonIdx).trim();
  let val = line.slice(colonIdx + 1).trim();

  if (val === '|') {
    multiLine.inMultiLine = true;
    multiLine.value = [];
    multiLine.node = current;
    multiLine.key = key;
    const next = findNextNonEmptyLine(lines, i);
    multiLine.indent = next ? next.indent : indent + 2;
    return;
  }
  if (val === '[]') { current[key] = []; return; }
  if (val === '{}') { current[key] = {}; return; }
  if (val === '') {
    handleEmptyYamlColon({ current, key, stack, indent }, lines, i);
    return;
  }
  current[key] = coerceScalar(val);
}

function parseYaml(yamlStr) {
  if (!yamlStr) return null;
  const lines = yamlStr.split(/\r?\n/);
  const rootState = { root: {}, rootArray: [], isRootArray: false };
  const stack = [];
  let current = rootState.root;
  const multiLine = { inMultiLine: false, indent: 0, value: [], node: null, key: null };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (multiLine.inMultiLine) {
      const matchIndent = line.match(/^(\s*)/);
      const indent = matchIndent ? matchIndent[1].length : 0;
      if (line.trim() === '' || indent >= multiLine.indent) {
        multiLine.value.push(line.slice(multiLine.indent));
        continue;
      }
      multiLine.node[multiLine.key] = multiLine.value.join('\n').replace(/\r/g, '');
      multiLine.inMultiLine = false;
    }

    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const indent = line.match(/^(\s*)/)[0].length;
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    current = stack.length > 0 ? stack[stack.length - 1].value : (rootState.isRootArray ? rootState.rootArray : rootState.root);

    if (trimmed.startsWith('-')) {
      current = handleYamlDash(trimmed, current, stack, indent, rootState);
      continue;
    }
    const colonIdx = line.indexOf(':');
    if (colonIdx !== -1) {
      handleYamlColon({ line, colonIdx, i }, current, stack, lines, multiLine);
    }
  }

  if (multiLine.inMultiLine && multiLine.node && multiLine.key) {
    multiLine.node[multiLine.key] = multiLine.value.join('\n').replace(/\r/g, '');
  }
  return rootState.isRootArray ? rootState.rootArray : rootState.root;
}

// stringifyYaml — extracted verbatim from src/agent_manager.js (lines 182–221).

function stringifyYaml(val, indent = 0) {
  const spaces = ' '.repeat(indent);
  if (val === null || val === undefined) {
    return 'null';
  }
  if (typeof val === 'string') {
    if (val.includes('\n')) {
      const lines = val.split('\n').map(line => '  ' + spaces + line).join('\n');
      return '|\n' + lines;
    }
    if (/[#:*?[\]{}|&%@!]/.test(val) || val.startsWith('-') || val.startsWith(' ') || val === 'true' || val === 'false' || val === 'null' || !isNaN(val)) {
      return JSON.stringify(val);
    }
    return val;
  }
  if (typeof val === 'number' || typeof val === 'boolean') {
    return String(val);
  }
  if (Array.isArray(val)) {
    if (val.length === 0) return '[]';
    const prefix = indent === 0 ? '' : '\n';
    return prefix + val.map(item => `${spaces}- ${stringifyYaml(item, indent + 2).trim()}`).join('\n');
  }
  if (typeof val === 'object') {
    const keys = Object.keys(val);
    if (keys.length === 0) return '{}';
    const prefix = indent === 0 ? '' : '\n';
    const serializedKeys = keys.map((k) => {
      const v = val[k];
      const serialized = stringifyYaml(v, indent + 2);
      if (serialized.startsWith('\n')) {
        return `${spaces}${k}:${serialized}`;
      } else {
        return `${spaces}${k}: ${serialized}`;
      }
    }).join('\n');
    return prefix + serializedKeys;
  }
  return '';
}

module.exports = { parseYaml, stringifyYaml };