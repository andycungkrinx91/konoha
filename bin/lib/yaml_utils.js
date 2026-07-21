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

// ────────────────────────────────────────────────────────────────────
// parseYaml — extracted verbatim from src/agent_manager.js (lines 33–180).
// ────────────────────────────────────────────────────────────────────

function parseYaml(yamlStr) {
  if (!yamlStr) return null;
  const lines = yamlStr.split(/\r?\n/);
  const root = {};
  let isRootArray = false;
  let rootArray = [];
  const stack = [];
  let current = root;
  let inMultiLine = false;
  let multiLineIndent = 0;
  let multiLineValue = [];
  let multiLineNode = null;
  let multiLineKey = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (inMultiLine) {
      const matchIndent = line.match(/^(\s*)/);
      const indent = matchIndent ? matchIndent[1].length : 0;
      if (line.trim() === '' || indent >= multiLineIndent) {
        multiLineValue.push(line.slice(multiLineIndent));
        continue;
      } else {
        multiLineNode[multiLineKey] = multiLineValue.join('\n').replace(/\r/g, '');
        inMultiLine = false;
      }
    }
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const indent = line.match(/^(\s*)/)[0].length;
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    if (stack.length > 0) {
      current = stack[stack.length - 1].value;
    } else {
      current = isRootArray ? rootArray : root;
    }
    if (trimmed.startsWith('-')) {
      if (stack.length === 0 && Object.keys(root).length === 0 && !isRootArray) {
        isRootArray = true;
        current = rootArray;
      }
      const rest = trimmed.slice(1).trim();
      const colonIdx = rest.indexOf(':');
      if (colonIdx !== -1) {
        const key = rest.slice(0, colonIdx).trim();
        let val = rest.slice(colonIdx + 1).trim();
        const obj = {};
        if (Array.isArray(current)) {
          current.push(obj);
        }
        if (val.startsWith('"') && val.endsWith('"')) {
          try { val = JSON.parse(val); } catch {}
        } else if (val === 'true') {
          val = true;
        } else if (val === 'false') {
          val = false;
        } else if (val === 'null') {
          val = null;
        } else if (!isNaN(val) && val !== '') {
          val = Number(val);
        }
        obj[key] = val;
        stack.push({ indent: indent, value: obj });
      } else {
        let val = rest;
        if (val.startsWith('"') && val.endsWith('"')) {
          try { val = JSON.parse(val); } catch {}
        } else if (val === 'true') {
          val = true;
        } else if (val === 'false') {
          val = false;
        } else if (val === 'null') {
          val = null;
        } else if (!isNaN(val) && val !== '') {
          val = Number(val);
        }
        if (Array.isArray(current)) {
          current.push(val);
        }
      }
      continue;
    }
    const colonIdx = line.indexOf(':');
    if (colonIdx !== -1) {
      const key = line.slice(0, colonIdx).trim();
      let val = line.slice(colonIdx + 1).trim();
      if (val === '|') {
        inMultiLine = true;
        multiLineValue = [];
        multiLineNode = current;
        multiLineKey = key;
        let nextIdx = i + 1;
        while (nextIdx < lines.length && lines[nextIdx].trim() === '') {
          nextIdx++;
        }
        if (nextIdx < lines.length) {
          const nextMatch = lines[nextIdx].match(/^(\s*)/);
          multiLineIndent = nextMatch ? nextMatch[1].length : 0;
        } else {
          multiLineIndent = indent + 2;
        }
        continue;
      }
      if (val === '[]') {
        current[key] = [];
        continue;
      }
      if (val === '{}') {
        current[key] = {};
        continue;
      }
      if (val === '') {
        let nextIdx = i + 1;
        while (nextIdx < lines.length && lines[nextIdx].trim() === '') {
          nextIdx++;
        }
        let isNextArray = false;
        if (nextIdx < lines.length && lines[nextIdx].trim().startsWith('-')) {
          isNextArray = true;
        }
        const nextVal = isNextArray ? [] : {};
        current[key] = nextVal;
        stack.push({ indent: indent, value: nextVal });
        continue;
      }
      if (val.startsWith('"') && val.endsWith('"')) {
        try { val = JSON.parse(val); } catch {}
      } else if (val === 'true') {
        val = true;
      } else if (val === 'false') {
        val = false;
      } else if (val === 'null') {
        val = null;
      } else if (!isNaN(val) && val !== '') {
        val = Number(val);
      }
      current[key] = val;
    }
  }
  if (inMultiLine && multiLineNode && multiLineKey) {
    multiLineNode[multiLineKey] = multiLineValue.join('\n').replace(/\r/g, '');
  }
  return isRootArray ? rootArray : root;
}

// ────────────────────────────────────────────────────────────────────
// stringifyYaml — extracted verbatim from src/agent_manager.js (lines 182–221).
// ────────────────────────────────────────────────────────────────────

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