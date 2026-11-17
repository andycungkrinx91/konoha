'use strict';

/**
 * Complementary LSP Workspace Manager for Konoha Native Code Intelligence.
 *
 * Lazily spawns stdio LSP servers for the 16 supported programming languages when
 * semantic precision (`definition`, `references`, `hover`, `callHierarchy`) enriches
 * `code_symbol`, `code_impact`, `code_related`, `code_context`, and `code_status`.
 *
 * Enforces an LRU server pool cap, `.unref()` idle TTL timers, process-exit cleanup
 * hooks, strict workspace path containment, and fail-open degradation whenever a
 * language server binary is absent or times out.
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  SUPPORTED_LANGUAGES,
  isLanguageExcluded,
  isLanguageSupported,
  getCapability,
  detectLanguageByPath,
  getLspCandidates
} = require('./capabilities');
const { LspClient } = require('./lsp_client');

const DEFAULT_MAX_CLIENTS = 4;
const DEFAULT_IDLE_TTL_MS = 60000;

function _parsePositiveInt(val, fallback) {
  const n = Number(val);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function _isLspFeatureEnabled() {
  const raw = String(process.env.KONOHA_LSP_ENABLE || '').trim().toLowerCase();
  return !(raw === '0' || raw === 'false' || raw === 'off' || raw === 'no');
}

function _isExecutableFile(filePath) {
  try {
    const st = fs.statSync(filePath);
    if (!st.isFile()) return false;
    if (process.platform === 'win32') return true;
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch (_) {
    return false;
  }
}

function _findExecutable(cmd) {
  if (!cmd || typeof cmd !== 'string') return null;
  if (path.isAbsolute(cmd) || cmd.includes('/') || cmd.includes('\\')) {
    return _isExecutableFile(cmd) ? path.resolve(cmd) : null;
  }
  const pathEnv = process.env.PATH || '';
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32'
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
    : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, ext && !cmd.toLowerCase().endsWith(ext.toLowerCase()) ? `${cmd}${ext}` : cmd);
      if (_isExecutableFile(candidate)) return candidate;
    }
  }
  return null;
}

function _parseCommandSpec(spec) {
  if (!spec) return null;
  // An array is the unambiguous form: element 0 is the command verbatim, so a
  // path containing spaces (`C:\Program Files\nodejs\node.exe`) survives.
  if (Array.isArray(spec)) {
    if (!spec.length) return null;
    return { command: String(spec[0]), args: spec.slice(1).map(String), languageId: null };
  }
  if (typeof spec === 'object' && spec.command) {
    return {
      command: spec.command,
      args: Array.isArray(spec.args) ? spec.args : [],
      languageId: spec.languageId || null
    };
  }
  const raw = String(spec).trim();
  if (!raw) return null;
  // Env vars can only be strings, so honour quoting there: splitting on bare
  // whitespace turns `"C:\Program Files\nodejs\node.exe" mock.js` into a command
  // named `"C:\Program`, which no Windows install would ever find.
  const parts = [];
  const tokenRe = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = tokenRe.exec(raw)) !== null) {
    parts.push(match[1] !== undefined ? match[1] : (match[2] !== undefined ? match[2] : match[3]));
  }
  if (!parts.length) return null;
  return { command: parts[0], args: parts.slice(1), languageId: null };
}

function _findSymbolColumn(sourceText, line1, symbolName) {
  const lines = String(sourceText || '').split('\n');
  const rawLine = lines[Math.max(0, (line1 || 1) - 1)] || '';
  if (symbolName) {
    const idx = rawLine.indexOf(symbolName);
    if (idx >= 0) return idx;
  }
  const firstNonSpace = rawLine.search(/\S/);
  return firstNonSpace >= 0 ? firstNonSpace : 0;
}

function _resolveSafeFile(rootPath, relPath) {
  if (!rootPath || !relPath) return null;
  const root = path.resolve(rootPath);
  const target = path.resolve(root, relPath);
  const rel = path.relative(root, target);
  if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    return null;
  }
  return target;
}

class LspManager {
  constructor(options = {}) {
    this.maxClients = options.maxClients ?? null;
    this.idleTtlMs = options.idleTtlMs ?? null;
    this.timeoutMs = options.timeoutMs ?? null;
    this.pool = new Map();
    this._exitHookInstalled = false;
  }

  _effectiveMaxClients() {
    return this.maxClients ?? _parsePositiveInt(process.env.KONOHA_LSP_MAX_CLIENTS, DEFAULT_MAX_CLIENTS);
  }

  _effectiveIdleTtlMs() {
    return this.idleTtlMs ?? _parsePositiveInt(process.env.KONOHA_LSP_IDLE_MS, DEFAULT_IDLE_TTL_MS);
  }

  _installExitHooks() {
    if (this._exitHookInstalled) return;
    this._exitHookInstalled = true;
    process.once('exit', () => {
      this.forceKillAllSync();
    });
  }

  resolveServerSpec(language, relPath = '', options = {}) {
    if (!_isLspFeatureEnabled()) return { available: false, reason: 'disabled_by_env' };
    const lang = language || detectLanguageByPath(relPath);
    if (!lang || isLanguageExcluded(lang) || !isLanguageSupported(lang)) {
      return { available: false, reason: 'unsupported_language' };
    }
    const cap = getCapability(lang);
    if (!cap) return { available: false, reason: 'unsupported_language' };

    const candidates = getLspCandidates(lang, relPath);
    const defaultLangId = candidates[0] ? candidates[0].languageId : cap.id;

    const overrideSpec = _parseCommandSpec(
      options.commandOverride ||
      process.env[`KONOHA_LSP_COMMAND_${cap.id.toUpperCase()}`] ||
      process.env.KONOHA_LSP_COMMAND_OVERRIDE
    );
    if (overrideSpec) {
      const bin = _findExecutable(overrideSpec.command);
      if (!bin) return { available: false, reason: `server binary missing: ${overrideSpec.command}` };
      return {
        available: true,
        language: cap.id,
        languageId: overrideSpec.languageId || defaultLangId,
        command: bin,
        args: overrideSpec.args
      };
    }

    for (const c of candidates) {
      const bin = _findExecutable(c.command);
      if (bin) {
        return {
          available: true,
          language: cap.id,
          languageId: c.languageId || cap.id,
          command: bin,
          args: [...c.args]
        };
      }
    }
    return {
      available: false,
      language: cap.id,
      reason: `no LSP binary on PATH (tried: ${candidates.map((c) => c.command).join(', ') || 'none'})`
    };
  }

  _resetIdleTimer(entry) {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    const ttl = this._effectiveIdleTtlMs();
    if (!(ttl > 0)) return;
    entry.idleTimer = setTimeout(() => {
      this.pool.delete(entry.key);
      entry.client.close().catch(() => {});
    }, ttl);
    if (typeof entry.idleTimer.unref === 'function') entry.idleTimer.unref();
  }

  async _evictIfFull(excludeKey = null) {
    const cap = Math.max(1, this._effectiveMaxClients());
    const closing = [];
    while (this.pool.size >= cap) {
      const oldestKey = this.pool.keys().next().value;
      if (!oldestKey || oldestKey === excludeKey) break;
      const victim = this.pool.get(oldestKey);
      this.pool.delete(oldestKey);
      if (victim.idleTimer) clearTimeout(victim.idleTimer);
      closing.push(victim.client.close().catch(() => {}));
    }
    if (closing.length > 0) await Promise.all(closing);
  }

  async acquireClient(rootPath, language, relPath = '', options = {}) {
    const spec = this.resolveServerSpec(language, relPath, options);
    if (!spec.available) return { available: false, reason: spec.reason };

    const absRoot = path.resolve(rootPath);
    const key = `${absRoot}::${spec.command}::${spec.args.join(' ')}`;
    if (this.pool.has(key)) {
      const existing = this.pool.get(key);
      if (existing.client.isAlive()) {
        this.pool.delete(key);
        this.pool.set(key, existing);
        existing.lastUsedAt = Date.now();
        this._resetIdleTimer(existing);
        return { available: true, client: existing.client, spec };
      }
      if (existing.idleTimer) clearTimeout(existing.idleTimer);
      this.pool.delete(key);
      await existing.client.close().catch(() => {});
    }

    await this._evictIfFull(key);
    this._installExitHooks();
    const client = new LspClient({
      command: spec.command,
      args: spec.args,
      rootPath: absRoot,
      timeoutMs: options.timeoutMs ?? this.timeoutMs
    });
    try {
      await client.start();
    } catch (err) {
      await client.close().catch(() => {});
      return { available: false, reason: err.message };
    }

    const entry = {
      key,
      rootPath: absRoot,
      language: spec.language,
      command: spec.command,
      client,
      idleTimer: null,
      startedAt: client.startedAt,
      lastUsedAt: Date.now()
    };
    this.pool.set(key, entry);
    this._resetIdleTimer(entry);
    return { available: true, client, spec };
  }

  async _openDocumentFromRoot(client, rootPath, relPath, languageId) {
    const abs = _resolveSafeFile(rootPath, relPath);
    if (!abs || !fs.existsSync(abs)) return null;
    const text = fs.readFileSync(abs, 'utf8');
    const uri = client.ensureDocumentOpen(abs, languageId, text);
    return { uri, text };
  }

  async enrichSymbol({ rootPath, symbols = [], name, timeoutMs, commandOverride } = {}) {
    const anchor = symbols[0];
    if (!rootPath || !anchor || !anchor.relPath) {
      return { lsp_available: false, reason: 'no_anchor_symbol' };
    }
    const acquired = await this.acquireClient(rootPath, anchor.language, anchor.relPath, { timeoutMs, commandOverride });
    if (!acquired.available) return { lsp_available: false, reason: acquired.reason };

    const doc = await this._openDocumentFromRoot(acquired.client, rootPath, anchor.relPath, acquired.spec.languageId);
    if (!doc) return { lsp_available: false, reason: 'anchor_file_unreadable' };

    const line0 = Math.max(0, Number(anchor.startLine || 1) - 1);
    const char0 = _findSymbolColumn(doc.text, anchor.startLine, name || anchor.name);
    const reqOpts = { timeoutMs };
    const [definitions, references, hover, incomingCalls] = await Promise.all([
      acquired.client.definition(doc.uri, line0, char0, reqOpts).catch(() => []),
      acquired.client.references(doc.uri, line0, char0, reqOpts).catch(() => []),
      acquired.client.hover(doc.uri, line0, char0, reqOpts).catch(() => ''),
      acquired.client.callHierarchyIncoming(doc.uri, line0, char0, reqOpts).catch(() => [])
    ]);

    return {
      lsp_available: true,
      server: path.basename(acquired.spec.command),
      ...(hover ? { hover } : {}),
      definitions: definitions.slice(0, 10),
      references: references.slice(0, 25),
      incoming_calls: incomingCalls.slice(0, 15)
    };
  }

  async enrichImpact({ rootPath, anchorSymbol, name, timeoutMs, commandOverride } = {}) {
    if (!rootPath || !anchorSymbol || !anchorSymbol.relPath) {
      return { lsp_available: false, reason: 'no_anchor_symbol' };
    }
    const acquired = await this.acquireClient(
      rootPath,
      anchorSymbol.language,
      anchorSymbol.relPath,
      { timeoutMs, commandOverride }
    );
    if (!acquired.available) return { lsp_available: false, reason: acquired.reason };

    const doc = await this._openDocumentFromRoot(
      acquired.client,
      rootPath,
      anchorSymbol.relPath,
      acquired.spec.languageId
    );
    if (!doc) return { lsp_available: false, reason: 'anchor_file_unreadable' };

    const line0 = Math.max(0, Number(anchorSymbol.startLine || 1) - 1);
    const char0 = _findSymbolColumn(doc.text, anchorSymbol.startLine, name || anchorSymbol.name);
    const reqOpts = { timeoutMs };
    const [references, incomingCalls] = await Promise.all([
      acquired.client.references(doc.uri, line0, char0, reqOpts).catch(() => []),
      acquired.client.callHierarchyIncoming(doc.uri, line0, char0, reqOpts).catch(() => [])
    ]);

    return {
      lsp_available: true,
      server: path.basename(acquired.spec.command),
      references: references.slice(0, 30),
      incoming_calls: incomingCalls.slice(0, 20)
    };
  }

  async enrichRelated({ rootPath, relPath, line = 1, character = 0, symbol, language, timeoutMs, commandOverride } = {}) {
    if (!rootPath || !relPath) return { lsp_available: false, reason: 'no_anchor_file' };
    const lang = language || detectLanguageByPath(relPath);
    const acquired = await this.acquireClient(rootPath, lang, relPath, { timeoutMs, commandOverride });
    if (!acquired.available) return { lsp_available: false, reason: acquired.reason };

    const doc = await this._openDocumentFromRoot(acquired.client, rootPath, relPath, acquired.spec.languageId);
    if (!doc) return { lsp_available: false, reason: 'anchor_file_unreadable' };

    const line0 = Math.max(0, Number(line || 1) - 1);
    const char0 = symbol ? _findSymbolColumn(doc.text, line, symbol) : Math.max(0, Number(character || 0));
    const reqOpts = { timeoutMs };
    const [definitions, references] = await Promise.all([
      acquired.client.definition(doc.uri, line0, char0, reqOpts).catch(() => []),
      acquired.client.references(doc.uri, line0, char0, reqOpts).catch(() => [])
    ]);

    const fileMap = new Map();
    const record = (loc, kind) => {
      if (!loc || !loc.relPath || loc.relPath === relPath) return;
      if (!fileMap.has(loc.relPath)) {
        fileMap.set(loc.relPath, { relPath: loc.relPath, kinds: new Set(), lines: [] });
      }
      const entry = fileMap.get(loc.relPath);
      entry.kinds.add(kind);
      if (entry.lines.length < 5) entry.lines.push(loc.line);
    };
    definitions.forEach((d) => record(d, 'lsp_definition'));
    references.forEach((r) => record(r, 'lsp_reference'));

    return {
      lsp_available: true,
      server: path.basename(acquired.spec.command),
      related: [...fileMap.values()].map((e) => ({
        relPath: e.relPath,
        reasons: [...e.kinds],
        lines: e.lines
      }))
    };
  }

  async enrichContext({ rootPath, relPath, startLine = 1, character = 0, language, timeoutMs, commandOverride } = {}) {
    if (!rootPath || !relPath || !(startLine > 0)) {
      return { lsp_available: false, reason: 'no_context_span' };
    }
    const lang = language || detectLanguageByPath(relPath);
    const acquired = await this.acquireClient(rootPath, lang, relPath, { timeoutMs, commandOverride });
    if (!acquired.available) return { lsp_available: false, reason: acquired.reason };

    const doc = await this._openDocumentFromRoot(acquired.client, rootPath, relPath, acquired.spec.languageId);
    if (!doc) return { lsp_available: false, reason: 'anchor_file_unreadable' };

    const char0 = character > 0 ? character : _findSymbolColumn(doc.text, startLine, '');
    const hover = await acquired.client.hover(doc.uri, Math.max(0, startLine - 1), char0, { timeoutMs }).catch(() => '');
    return {
      lsp_available: true,
      server: path.basename(acquired.spec.command),
      ...(hover ? { hover } : {})
    };
  }

  getStatusSnapshot() {
    const enabled = _isLspFeatureEnabled();
    const detectedByLang = {};
    for (const lang of SUPPORTED_LANGUAGES) {
      const candidates = getLspCandidates(lang, '');
      const hit = candidates.find((c) => Boolean(_findExecutable(c.command)));
      detectedByLang[lang] = hit ? hit.command : null;
    }
    const active = [];
    for (const entry of this.pool.values()) {
      active.push({
        root: entry.rootPath,
        language: entry.language,
        command: path.basename(entry.command),
        pid: entry.client.pid,
        alive: entry.client.isAlive(),
        last_used_at: new Date(entry.lastUsedAt).toISOString()
      });
    }
    return {
      enabled,
      max_clients: this._effectiveMaxClients(),
      idle_ttl_ms: this._effectiveIdleTtlMs(),
      active_count: active.length,
      active_servers: active,
      available_binaries: detectedByLang
    };
  }

  forceKillAllSync() {
    for (const entry of this.pool.values()) {
      if (entry.idleTimer) clearTimeout(entry.idleTimer);
      entry.client.forceKillSync();
    }
    this.pool.clear();
  }

  async shutdownAll() {
    const closing = [];
    for (const entry of this.pool.values()) {
      if (entry.idleTimer) clearTimeout(entry.idleTimer);
      closing.push(entry.client.close().catch(() => {}));
    }
    this.pool.clear();
    await Promise.all(closing);
  }
}

const defaultManager = new LspManager();

module.exports = {
  LspManager,
  defaultManager,
  _findExecutable
};
