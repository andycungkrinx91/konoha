'use strict';

/**
 * Cross-file symbol & module dependency resolver.
 *
 * Resolves relative imports, `tsconfig.json` / `jsconfig.json` path aliases,
 * `package.json` local exports, Python dotted/relative imports, Go/Rust/C/C++
 * module paths, and `extends`/`implements` heritage targets into `code_edges`.
 */

const fs = require('fs');
const path = require('path');

const RESOLVE_EXTENSIONS = [
  '.ts', '.tsx', '.mts', '.cts',
  '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java',
  '.c', '.h', '.cpp', '.hpp', '.cc',
  '.sh', '.bash', '.sql'
];

function _stripJsonComments(raw) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    const next = raw[i + 1];
    if (inString) {
      out += ch;
      escaped = !escaped && ch === '\\';
      if (!escaped && ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < raw.length && raw[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < raw.length && !(raw[i] === '*' && raw[i + 1] === '/')) i++;
      i++;
      continue;
    }
    out += ch;
  }
  return out.replace(/,\s*([}\]])/g, '$1');
}

function _safeReadJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    try {
      return JSON.parse(raw);
    } catch (_) {
      return JSON.parse(_stripJsonComments(raw));
    }
  } catch (_) {
    return null;
  }
}

function loadProjectAliases(rootPath) {
  const aliases = [];
  let baseUrl = '';
  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    const cfg = _safeReadJson(path.join(rootPath, name));
    const opts = cfg && cfg.compilerOptions;
    if (!opts) continue;
    if (opts.baseUrl && !baseUrl) {
      baseUrl = String(opts.baseUrl).replace(/^\.\//, '').replace(/\/+$/, '');
    }
    if (opts.paths && typeof opts.paths === 'object') {
      for (const [pattern, targets] of Object.entries(opts.paths)) {
        if (!Array.isArray(targets) || targets.length === 0) continue;
        aliases.push({ pattern, targets });
      }
    }
  }

  const pkg = _safeReadJson(path.join(rootPath, 'package.json'));
  const localExports = [];
  if (pkg && pkg.imports && typeof pkg.imports === 'object') {
    for (const [key, val] of Object.entries(pkg.imports)) {
      if (typeof val === 'string') localExports.push({ pattern: key, targets: [val] });
    }
  }
  return { baseUrl, aliases: [...aliases, ...localExports] };
}

function _tryCandidatePath(baseRel, fileByRel) {
  const clean = path.posix.normalize(baseRel).replace(/^\/+/, '');
  if (fileByRel.has(clean)) return { fileId: fileByRel.get(clean), confidence: 1.0 };
  for (const ext of RESOLVE_EXTENSIONS) {
    if (fileByRel.has(`${clean}${ext}`)) return { fileId: fileByRel.get(`${clean}${ext}`), confidence: 0.95 };
  }
  for (const idxFile of ['index.ts', 'index.tsx', 'index.js', 'index.mjs', 'index.cjs', '__init__.py', 'mod.rs']) {
    const joined = `${clean}/${idxFile}`;
    if (fileByRel.has(joined)) return { fileId: fileByRel.get(joined), confidence: 0.9 };
  }
  return null;
}

function _resolveAliasCandidates(specifier, aliasConfig, fileByRel) {
  for (const entry of aliasConfig.aliases) {
    const starIdx = entry.pattern.indexOf('*');
    if (starIdx >= 0) {
      const prefix = entry.pattern.slice(0, starIdx);
      const suffix = entry.pattern.slice(starIdx + 1);
      if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue;
      const wildcard = specifier.slice(prefix.length, specifier.length - suffix.length);
      for (const t of entry.targets) {
        const replaced = t.replace('*', wildcard).replace(/^\.\//, '');
        const candidate = aliasConfig.baseUrl ? `${aliasConfig.baseUrl}/${replaced}` : replaced;
        const hit = _tryCandidatePath(candidate, fileByRel) || _tryCandidatePath(replaced, fileByRel);
        if (hit) return { ...hit, confidence: 0.9 };
      }
    } else if (specifier === entry.pattern) {
      for (const t of entry.targets) {
        const cleaned = t.replace(/^\.\//, '');
        const hit = _tryCandidatePath(cleaned, fileByRel);
        if (hit) return { ...hit, confidence: 0.9 };
      }
    }
  }
  if (aliasConfig.baseUrl && !specifier.startsWith('.')) {
    const hit = _tryCandidatePath(`${aliasConfig.baseUrl}/${specifier}`, fileByRel);
    if (hit) return { ...hit, confidence: 0.85 };
  }
  return null;
}

function _resolvePythonImport(sourceRel, specifier, fileByRel) {
  if (specifier.startsWith('.')) {
    let curDir = path.posix.dirname(sourceRel);
    let dots = 0;
    while (dots < specifier.length && specifier[dots] === '.') dots++;
    for (let i = 1; i < dots; i++) curDir = path.posix.dirname(curDir);
    const tail = specifier.slice(dots).replace(/\./g, '/');
    const relTarget = tail ? path.posix.join(curDir, tail) : curDir;
    return _tryCandidatePath(relTarget, fileByRel);
  }
  return _tryCandidatePath(specifier.replace(/\./g, '/'), fileByRel);
}

function _resolveRustImport(sourceRel, specifier, fileByRel) {
  const dir = path.posix.dirname(sourceRel);
  const parts = specifier.replace(/::\{[^}]*\}$/, '').split('::').filter(Boolean);
  if (parts.length === 0) return null;
  if (parts[0] === 'crate') {
    const rest = parts.slice(1).join('/');
    return _tryCandidatePath(`src/${rest}`, fileByRel) || _tryCandidatePath(rest, fileByRel);
  }
  if (parts[0] === 'self' || parts.length === 1) {
    const rest = parts[0] === 'self' ? parts.slice(1).join('/') : parts[0];
    return _tryCandidatePath(path.posix.join(dir, rest), fileByRel);
  }
  return _tryCandidatePath(parts.join('/'), fileByRel);
}

function _resolveGoImport(spec, fileByRel) {
  if (!spec.includes('/')) return null;
  const segs = spec.split('/');
  for (let start = 1; start < segs.length; start++) {
    const sub = segs.slice(start).join('/');
    for (const rel of fileByRel.keys()) {
      if (rel === `${sub}.go` || rel.startsWith(`${sub}/`)) {
        return { fileId: fileByRel.get(rel), confidence: 0.75 };
      }
    }
  }
  return null;
}

function resolveModuleSpecifier(sourceRel, language, specifier, fileByRel, aliasConfig) {
  if (!specifier) return null;
  const spec = specifier.trim();
  const dir = path.posix.dirname(sourceRel);

  if (spec.startsWith('./') || spec.startsWith('../') || spec === '.' || spec === '..') {
    return _tryCandidatePath(path.posix.join(dir === '.' ? '' : dir, spec), fileByRel);
  }
  if (language === 'python') return _resolvePythonImport(sourceRel, spec, fileByRel);
  if (language === 'rust') return _resolveRustImport(sourceRel, spec, fileByRel);
  if (language === 'c' || language === 'cpp') {
    return (
      _tryCandidatePath(path.posix.join(dir === '.' ? '' : dir, spec), fileByRel) ||
      _tryCandidatePath(`include/${spec}`, fileByRel) ||
      _tryCandidatePath(spec, fileByRel)
    );
  }

  const aliasHit = _resolveAliasCandidates(spec, aliasConfig, fileByRel);
  if (aliasHit) return aliasHit;
  if (language === 'go') return _resolveGoImport(spec, fileByRel);
  return null;
}

function _buildSymbolLookup(conn, rootHash) {
  const byName = new Map();
  const rows = conn.prepare(
    'SELECT id, file_id, name, kind, start_line FROM code_symbols WHERE root_hash = ?'
  ).all(rootHash);
  for (const r of rows) {
    if (!byName.has(r.name)) byName.set(r.name, []);
    byName.get(r.name).push(r);
  }
  return byName;
}

function _resolveTargetSymbol(targetName, importedFileIds, byName) {
  const candidates = byName.get(targetName);
  if (!candidates || candidates.length === 0) return null;
  if (importedFileIds.length > 0) {
    const preferred = candidates.find((c) => importedFileIds.includes(c.file_id));
    if (preferred) return { fileId: preferred.file_id, symbolId: preferred.id, confidence: 0.95 };
  }
  if (candidates.length === 1) {
    return { fileId: candidates[0].file_id, symbolId: candidates[0].id, confidence: 0.8 };
  }
  return { fileId: candidates[0].file_id, symbolId: candidates[0].id, confidence: 0.6 };
}

function _applyResolvedEdge(edge, ctx) {
  const srcFile = ctx.fileById.get(edge.source_file_id);
  if (!srcFile) return 0;

  if (edge.edge_kind === 'imports' || edge.edge_kind === 'reexports') {
    const hit = resolveModuleSpecifier(srcFile.rel_path, srcFile.language, edge.specifier, ctx.fileByRel, ctx.aliasConfig);
    if (!hit || hit.fileId === edge.source_file_id) return 0;
    ctx.updateEdge.run(hit.fileId, edge.target_symbol_id || null, hit.confidence, edge.id);
    if (!ctx.importedByFile.has(edge.source_file_id)) ctx.importedByFile.set(edge.source_file_id, []);
    ctx.importedByFile.get(edge.source_file_id).push(hit.fileId);
    return 1;
  }

  if (edge.edge_kind === 'extends' || edge.edge_kind === 'implements') {
    const preferredFiles = ctx.importedByFile.get(edge.source_file_id) || [];
    const hit = _resolveTargetSymbol(edge.specifier, preferredFiles, ctx.symbolLookup);
    if (!hit) return 0;
    ctx.updateEdge.run(hit.fileId, hit.symbolId, hit.confidence, edge.id);
    return 1;
  }
  return 0;
}

/**
 * Resolves preliminary edges (`target_file_id IS NULL` or in `updatedFileIds`)
 * across all files indexed under `rootHash`.
 */
function resolveEdgesForRoot(conn, rootHash, rootPath, updatedFileIds = null) {
  const fileRows = conn.prepare('SELECT id, rel_path, language FROM code_files WHERE root_hash = ?').all(rootHash);
  if (fileRows.length === 0) return 0;

  const fileById = new Map();
  const fileByRel = new Map();
  for (const r of fileRows) {
    fileById.set(r.id, r);
    fileByRel.set(r.rel_path, r.id);
  }

  const aliasConfig = loadProjectAliases(rootPath);
  const symbolLookup = _buildSymbolLookup(conn, rootHash);
  const edges = updatedFileIds && updatedFileIds.length > 0
    ? conn.prepare(
        `SELECT * FROM code_edges WHERE root_hash = ? AND (target_file_id IS NULL OR source_file_id IN (${updatedFileIds.map(() => '?').join(',')}))`
      ).all(rootHash, ...updatedFileIds)
    : conn.prepare('SELECT * FROM code_edges WHERE root_hash = ?').all(rootHash);

  const importedByFile = new Map();
  for (const e of edges) {
    if ((e.edge_kind === 'imports' || e.edge_kind === 'reexports') && e.target_file_id) {
      if (!importedByFile.has(e.source_file_id)) importedByFile.set(e.source_file_id, []);
      importedByFile.get(e.source_file_id).push(e.target_file_id);
    }
  }

  const updateEdge = conn.prepare(
    'UPDATE code_edges SET target_file_id = ?, target_symbol_id = ?, confidence = ? WHERE id = ?'
  );
  const ctx = { fileById, fileByRel, aliasConfig, symbolLookup, importedByFile, updateEdge };
  let resolvedCount = 0;

  const tx = conn.transaction(() => {
    for (const edge of edges) {
      resolvedCount += _applyResolvedEdge(edge, ctx);
    }
  });
  tx();
  return resolvedCount;
}

module.exports = {
  loadProjectAliases,
  resolveModuleSpecifier,
  resolveEdgesForRoot
};
