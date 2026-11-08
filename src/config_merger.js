'use strict';

/**
 * src/config_merger.js — Syntax-Aware Append-Only Configuration Merger
 * and Ownership-Aware Uninstaller across JSON, JSONC, YAML, TOML, XML, and Text.
 */

const fs = require('fs');
const path = require('path');
const {
  detectFormat,
  stripJsonComments,
  validateFileSyntax,
  backupConfigFile,
  loadOwnershipManifest,
  recordOwnership
} = require('./config_backup_manager');

const KONOHA_START_TAG = '<!-- KONOHA-START -->';
const KONOHA_END_TAG = '<!-- KONOHA-END -->';

function isPlainObject(val) {
  return Boolean(val && typeof val === 'object' && !Array.isArray(val));
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Append-only merge for JSON/JSONC objects:
 * - Preserves all existing user keys and values.
 * - For arrays, appends missing items without duplicating existing entries.
 * - For Konoha-owned keys explicitly listed in `konohaOwnedKeys`, updates/sets
 *   the Konoha entry while recording ownership path.
 */
function _mergeUniqueArrayItems(existingVal, addVal) {
  const mergedArr = [...existingVal];
  for (const item of addVal) {
    if (!mergedArr.some((ex) => deepEqual(ex, item))) {
      mergedArr.push(item);
    }
  }
  return mergedArr;
}

function mergeObjectAppendOnly(target, additions, prefix = '', ownedKeysOut = [], forceUpdateKeys = new Set()) {
  const result = isPlainObject(target) ? { ...target } : {};

  for (const [key, addVal] of Object.entries(additions || {})) {
    const keyPath = prefix ? `${prefix}.${key}` : key;
    const isKonohaKey =
      key === 'konoha' ||
      key === 'semble' ||
      key.startsWith('konoha') ||
      forceUpdateKeys.has(keyPath) ||
      forceUpdateKeys.has(key);

    if (!(key in result) || result[key] === undefined) {
      result[key] = addVal;
      ownedKeysOut.push(keyPath);
      continue;
    }

    const existingVal = result[key];
    if (Array.isArray(existingVal) && Array.isArray(addVal)) {
      result[key] = _mergeUniqueArrayItems(existingVal, addVal);
      ownedKeysOut.push(keyPath);
    } else if (isPlainObject(existingVal) && isPlainObject(addVal)) {
      result[key] = mergeObjectAppendOnly(existingVal, addVal, keyPath, ownedKeysOut, forceUpdateKeys);
    } else if (isKonohaKey) {
      result[key] = addVal;
      ownedKeysOut.push(keyPath);
    }
    // Otherwise: preserve existing user primitive value (strictly append-only)
  }

  return result;
}

function _parseExistingJsonOrJsonc(absPath, options) {
  if (!fs.existsSync(absPath)) return {};
  const raw = fs.readFileSync(absPath, 'utf8');
  if (!raw.trim()) return {};
  const fmt = detectFormat(absPath);
  try {
    return JSON.parse(fmt === 'jsonc' ? stripJsonComments(raw) : raw);
  } catch (err) {
    if (options.abortOnInvalidSyntax !== false) {
      throw new Error(`Cannot safely extend malformed JSON/JSONC file ${absPath}: ${err.message}`);
    }
    return {};
  }
}

function mergeJsonConfigFile(filePath, additions, options = {}) {
  const absPath = path.resolve(filePath);
  const backupRes = backupConfigFile(absPath, options);
  if (!backupRes.ok) {
    throw new Error(`Aborted config modification on ${absPath}: backup failed (${backupRes.error})`);
  }

  const existingObj = _parseExistingJsonOrJsonc(absPath, options);
  const ownedKeys = [];
  const forceUpdateKeys = new Set(options.konohaOwnedKeys || []);
  const merged = mergeObjectAppendOnly(existingObj, additions, '', ownedKeys, forceUpdateKeys);

  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const serialized = JSON.stringify(merged, null, 2) + '\n';
  const syntaxCheck = validateFileSyntax(absPath, serialized);
  if (!syntaxCheck.valid) {
    throw new Error(`Merged JSON failed syntax validation for ${absPath}: ${syntaxCheck.error}`);
  }

  const tmpPath = `${absPath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmpPath, serialized, 'utf8');
  fs.renameSync(tmpPath, absPath);

  recordOwnership(absPath, {
    client: options.client,
    scope: options.scope,
    ownedKeys
  }, options);

  return { ok: true, merged, ownedKeys, backupPath: backupRes.backupPath };
}

/**
 * Append-only TOML section merger:
 * - Preserves all existing top-level keys, comments, and unrelated sections (`[features]`, `sandbox_mode`, etc.).
 * - Replaces/appends only the specified Konoha-owned TOML sections (e.g. `[mcp_servers.konoha]`, `[agents.sannin]`).
 */
function mergeTomlSectionsAppendOnly(existingToml, konohaSectionsMap = {}) {
  const normalizedMap = {};
  if (Array.isArray(konohaSectionsMap)) {
    for (const entry of konohaSectionsMap) {
      if (!entry || !entry.header) continue;
      const secName = String(entry.header).replace(/^\[|\]$/g, '').trim();
      normalizedMap[secName] = entry.body || '';
    }
  } else if (konohaSectionsMap && typeof konohaSectionsMap === 'object') {
    Object.assign(normalizedMap, konohaSectionsMap);
  }
  const lines = String(existingToml || '').split(/\r?\n/);
  const ownedSectionHeaders = new Set(Object.keys(normalizedMap).map(s => `[${s}]`));
  const keptLines = [];
  let skippingOwnedSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const headerMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (headerMatch) {
      const fullHeader = `[${headerMatch[1].trim()}]`;
      skippingOwnedSection = ownedSectionHeaders.has(fullHeader);
    }
    if (!skippingOwnedSection) {
      keptLines.push(line);
    }
  }

  while (keptLines.length > 0 && keptLines[keptLines.length - 1].trim() === '') {
    keptLines.pop();
  }

  const sectionBlocks = [];
  for (const [secName, bodyLines] of Object.entries(normalizedMap)) {
    const body = Array.isArray(bodyLines) ? bodyLines.join('\n') : String(bodyLines || '').trim();
    sectionBlocks.push(`[${secName}]\n${body}`);
  }

  const prefix = keptLines.join('\n').trimEnd();
  const suffix = sectionBlocks.join('\n\n');
  return (prefix ? `${prefix}\n\n${suffix}\n` : `${suffix}\n`);
}

function mergeTomlConfigFile(filePath, konohaSectionsMap, options = {}) {
  const absPath = path.resolve(filePath);
  const backupRes = backupConfigFile(absPath, options);
  if (!backupRes.ok) {
    throw new Error(`Aborted TOML modification on ${absPath}: backup failed (${backupRes.error})`);
  }

  const existing = fs.existsSync(absPath) ? fs.readFileSync(absPath, 'utf8') : '';
  const merged = mergeTomlSectionsAppendOnly(existing, konohaSectionsMap);

  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const tmpPath = `${absPath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmpPath, merged, 'utf8');
  fs.renameSync(tmpPath, absPath);

  const ownedSections = Object.keys(konohaSectionsMap);
  recordOwnership(absPath, {
    client: options.client,
    scope: options.scope,
    ownedSections
  }, options);

  return { ok: true, content: merged, ownedSections, backupPath: backupRes.backupPath };
}

/**
 * Append-only YAML block merger:
 * - Preserves all existing YAML content outside `# KONOHA-YAML-START` / `# KONOHA-YAML-END`
 *   or appends missing top-level keys without truncating user settings.
 */
function mergeYamlConfigFile(filePath, konohaYamlBlock, options = {}) {
  const absPath = path.resolve(filePath);
  const backupRes = backupConfigFile(absPath, options);
  if (!backupRes.ok) {
    throw new Error(`Aborted YAML modification on ${absPath}: backup failed (${backupRes.error})`);
  }

  const startMarker = options.startMarker || '# KONOHA-YAML-START';
  const endMarker = options.endMarker || '# KONOHA-YAML-END';
  const blockText = `${startMarker}\n${String(konohaYamlBlock || '').trim()}\n${endMarker}`;

  let existing = fs.existsSync(absPath) ? fs.readFileSync(absPath, 'utf8') : '';
  let updated;
  if (existing.includes(startMarker) && existing.includes(endMarker)) {
    const startIdx = existing.indexOf(startMarker);
    const endIdx = existing.indexOf(endMarker) + endMarker.length;
    updated = existing.slice(0, startIdx) + blockText + existing.slice(endIdx);
  } else if (existing.trim()) {
    updated = `${existing.trimEnd()}\n\n${blockText}\n`;
  } else {
    updated = `${blockText}\n`;
  }

  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, updated, 'utf8');
  recordOwnership(absPath, {
    client: options.client,
    scope: options.scope,
    ownedSections: [startMarker]
  }, options);

  return { ok: true, content: updated, backupPath: backupRes.backupPath };
}

/**
 * Append-only XML node merger:
 * - Preserves existing XML elements and inserts/updates only `<konoha ...>...</konoha>`
 *   or `<!-- KONOHA-XML-START -->...<!-- KONOHA-XML-END -->` before closing root tag.
 */
function mergeXmlConfigFile(filePath, konohaXmlSnippet, options = {}) {
  const absPath = path.resolve(filePath);
  const backupRes = backupConfigFile(absPath, options);
  if (!backupRes.ok) {
    throw new Error(`Aborted XML modification on ${absPath}: backup failed (${backupRes.error})`);
  }

  const startMarker = '<!-- KONOHA-XML-START -->';
  const endMarker = '<!-- KONOHA-XML-END -->';
  const wrapped = `${startMarker}\n${String(konohaXmlSnippet || '').trim()}\n${endMarker}`;

  let existing = fs.existsSync(absPath) ? fs.readFileSync(absPath, 'utf8') : '<configuration>\n</configuration>\n';
  const syntax = validateFileSyntax(absPath, existing);
  if (!syntax.valid) {
    throw new Error(`Cannot safely extend malformed XML file ${absPath}: ${syntax.error}`);
  }

  let updated;
  if (existing.includes(startMarker) && existing.includes(endMarker)) {
    const sIdx = existing.indexOf(startMarker);
    const eIdx = existing.indexOf(endMarker) + endMarker.length;
    updated = existing.slice(0, sIdx) + wrapped + existing.slice(eIdx);
  } else {
    const lastCloseMatch = existing.match(/<\/[a-zA-Z0-9_:-]+\s*>\s*$/);
    if (lastCloseMatch && lastCloseMatch.index !== undefined) {
      updated = `${existing.slice(0, lastCloseMatch.index).trimEnd()}\n  ${wrapped}\n${existing.slice(lastCloseMatch.index)}`;
    } else {
      updated = `${existing.trimEnd()}\n${wrapped}\n`;
    }
  }

  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, updated, 'utf8');
  recordOwnership(absPath, {
    client: options.client,
    scope: options.scope,
    ownedSections: [startMarker]
  }, options);

  return { ok: true, content: updated, backupPath: backupRes.backupPath };
}

/**
 * Plain-text / Markdown append-only managed block injector.
 */
function mergeTextManagedBlock(filePath, managedContent, options = {}) {
  const absPath = path.resolve(filePath);
  const backupRes = backupConfigFile(absPath, options);
  if (!backupRes.ok) {
    throw new Error(`Aborted text modification on ${absPath}: backup failed (${backupRes.error})`);
  }

  const startTag = options.startTag || KONOHA_START_TAG;
  const endTag = options.endTag || KONOHA_END_TAG;
  const trimmedBlock = String(managedContent || '').trim();
  const wrapped = trimmedBlock.startsWith(startTag)
    ? trimmedBlock
    : `${startTag}\n${trimmedBlock}\n${endTag}`;

  let existing = '';
  if (fs.existsSync(absPath)) {
    existing = fs.readFileSync(absPath, 'utf8');
  }

  let updated;
  if (existing.includes(startTag) && existing.includes(endTag)) {
    const startIdx = existing.indexOf(startTag);
    const endIdx = existing.indexOf(endTag) + endTag.length;
    updated = existing.slice(0, startIdx) + wrapped + existing.slice(endIdx);
  } else if (existing.trim().length > 0) {
    updated = `${existing.trimEnd()}\n\n${wrapped}\n`;
  } else {
    updated = `${wrapped}\n`;
  }

  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, updated, 'utf8');
  recordOwnership(absPath, {
    client: options.client,
    scope: options.scope,
    ownedSections: [startTag]
  }, options);

  return { ok: true, content: updated, backupPath: backupRes.backupPath };
}

/**
 * Remove ONLY Konoha-owned entries from a file during uninstall/rollback,
 * preserving all user modifications made before or after Konoha installation.
 */
function _stripKonohaFromJsonObject(obj) {
  if (isPlainObject(obj.mcpServers)) {
    delete obj.mcpServers.konoha;
    delete obj.mcpServers.semble;
    delete obj.mcpServers['konoha-file-tools'];
  }
  if (isPlainObject(obj.mcp)) {
    delete obj.mcp.konoha;
    delete obj.mcp.semble;
  }
  if (isPlainObject(obj.hooks)) {
    for (const hkKey of Object.keys(obj.hooks)) {
      if (Array.isArray(obj.hooks[hkKey])) {
        obj.hooks[hkKey] = obj.hooks[hkKey].filter((item) => !JSON.stringify(item).includes('konoha'));
      }
    }
  }
  if (Array.isArray(obj.instructions)) {
    obj.instructions = obj.instructions.filter((i) => !String(i).includes('konoha'));
  }
}

function _removeKonohaFromToml(absPath, record) {
  const raw = fs.readFileSync(absPath, 'utf8');
  const owned = new Set((record && record.owned_sections) || ['mcp_servers.konoha', 'mcp_servers.semble']);
  const lines = raw.split(/\r?\n/);
  const kept = [];
  let skipping = false;
  for (const line of lines) {
    const m = line.trim().match(/^\[([^\]]+)\]$/);
    if (m) {
      const sec = m[1].trim();
      skipping = owned.has(sec) || sec === 'mcp_servers.konoha' || sec === 'mcp_servers.semble';
    }
    if (!skipping) kept.push(line);
  }
  fs.writeFileSync(absPath, kept.join('\n').trimEnd() + '\n', 'utf8');
  return { ok: true, removed: true };
}

function removeKonohaOwnedEntries(filePath, options = {}) {
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) return { ok: true, removed: false };

  const manifest = loadOwnershipManifest(options);
  const record = manifest.files[absPath];
  const fmt = detectFormat(absPath);

  if (fmt === 'json' || fmt === 'jsonc') {
    const raw = fs.readFileSync(absPath, 'utf8');
    if (!raw.trim()) return { ok: true, removed: false };
    let obj;
    try {
      obj = JSON.parse(fmt === 'jsonc' ? stripJsonComments(raw) : raw);
    } catch (_) {
      return { ok: false, error: `Cannot parse ${absPath} for Konoha entry removal` };
    }
    _stripKonohaFromJsonObject(obj);
    fs.writeFileSync(absPath, JSON.stringify(obj, null, 2) + '\n', 'utf8');
    return { ok: true, removed: true };
  }

  if (fmt === 'toml') {
    return _removeKonohaFromToml(absPath, record);
  }

  const raw = fs.readFileSync(absPath, 'utf8');
  const markers = [
    [KONOHA_START_TAG, KONOHA_END_TAG],
    ['# KONOHA-YAML-START', '# KONOHA-YAML-END'],
    ['<!-- KONOHA-XML-START -->', '<!-- KONOHA-XML-END -->']
  ];
  let updated = raw;
  for (const [sTag, eTag] of markers) {
    if (updated.includes(sTag) && updated.includes(eTag)) {
      const sIdx = updated.indexOf(sTag);
      const eIdx = updated.indexOf(eTag) + eTag.length;
      updated = (updated.slice(0, sIdx).trimEnd() + '\n' + updated.slice(eIdx).trimStart()).trim();
    }
  }
  fs.writeFileSync(absPath, updated ? `${updated}\n` : '', 'utf8');
  return { ok: true, removed: true };
}

function computeLineDiffPatch(oldText, newText) {
  const oldLines = String(oldText || '').split(/\r?\n/);
  const newLines = String(newText || '').split(/\r?\n/);
  const hunks = [];
  const maxLen = Math.max(oldLines.length, newLines.length);

  let i = 0;
  while (i < maxLen) {
    if (oldLines[i] === newLines[i]) {
      i++;
      continue;
    }
    const start = i;
    const removed = [];
    const added = [];
    while (i < maxLen && oldLines[i] !== newLines[i]) {
      if (i < oldLines.length) removed.push(oldLines[i]);
      if (i < newLines.length) added.push(newLines[i]);
      i++;
    }
    hunks.push({ start, removed, added });
  }

  return {
    changed: hunks.length > 0,
    hunkCount: hunks.length,
    hunks
  };
}

function applyTargetedTextPatch(existingText, baselineText, nextTemplateText) {
  const current = String(existingText || '');
  const baseline = String(baselineText || '');
  const target = String(nextTemplateText || '');

  if (current === target) {
    return { status: 'unchanged', content: current, hunksApplied: 0, conflict: false };
  }
  if (!baseline || current === baseline) {
    const diff = computeLineDiffPatch(baseline || current, target);
    return {
      status: 'patched_clean',
      content: target,
      hunksApplied: diff.hunkCount,
      conflict: false
    };
  }

  const baseLines = baseline.split(/\r?\n/);
  const currLines = current.split(/\r?\n/);
  const nextLines = target.split(/\r?\n/);

  if (currLines.length !== baseLines.length || nextLines.length !== baseLines.length) {
    if (current.startsWith(baseline.trimEnd())) {
      const userAppended = current.slice(baseline.trimEnd().length);
      return {
        status: 'merged_with_user_append',
        content: `${target.trimEnd()}${userAppended}`,
        hunksApplied: 1,
        conflict: false
      };
    }
    return {
      status: 'conflict_preserved',
      content: current,
      hunksApplied: 0,
      conflict: true,
      reason: 'User modified line structure in a Konoha-managed file; preserving user file untouched.'
    };
  }

  const merged = [];
  let hunksApplied = 0;
  for (let idx = 0; idx < baseLines.length; idx++) {
    const b = baseLines[idx];
    const c = currLines[idx];
    const n = nextLines[idx];
    if (c === b) {
      if (n !== b) hunksApplied++;
      merged.push(n);
    } else if (n === b || c === n) {
      merged.push(c);
    } else {
      return {
        status: 'conflict_preserved',
        content: current,
        hunksApplied: 0,
        conflict: true,
        reason: `Line ${idx + 1} modified by both user and Konoha upgrade; preserving user file untouched.`
      };
    }
  }

  return {
    status: 'merged_clean',
    content: merged.join('\n'),
    hunksApplied,
    conflict: false
  };
}

module.exports = {
  KONOHA_START_TAG,
  KONOHA_END_TAG,
  mergeObjectAppendOnly,
  mergeJsonConfigFile,
  mergeJsonConfigAppendOnly: mergeJsonConfigFile,
  mergeTomlSectionsAppendOnly,
  mergeTomlConfigFile,
  mergeTomlConfigAppendOnly: mergeTomlConfigFile,
  mergeYamlConfigFile,
  mergeYamlConfigAppendOnly: mergeYamlConfigFile,
  mergeXmlConfigFile,
  mergeXmlConfigAppendOnly: mergeXmlConfigFile,
  mergeTextManagedBlock,
  mergePlainTextAppendOnly: mergeTextManagedBlock,
  removeKonohaOwnedEntries,
  computeLineDiffPatch,
  applyTargetedTextPatch
};
