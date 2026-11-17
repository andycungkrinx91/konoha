'use strict';

/**
 * Minimal Stdio JSON-RPC 2.0 Client for Language Server Protocol (LSP).
 *
 * Implements strict `Content-Length` byte framing over UTF-8 pipes, `initialize`
 * / `initialized` lifecycle, `$/cancelRequest` propagation on timeout or
 * `AbortSignal`, bounded stderr capture, and deterministic `shutdown`/`exit` ->
 * `SIGTERM` -> `SIGKILL` cleanup so zero child processes are leaked.
 */

const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL, fileURLToPath } = require('node:url');

const HEADER_DELIMITER = Buffer.from('\r\n\r\n', 'ascii');
const MAX_RX_BYTES = 16 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 2500;
const DEFAULT_SHUTDOWN_MS = 800;

function _resolveTimeoutMs(val, fallback) {
  const n = Number(val);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function _encodeJsonRpc(payload) {
  const json = JSON.stringify(payload);
  const byteLen = Buffer.byteLength(json, 'utf8');
  const header = Buffer.from(`Content-Length: ${byteLen}\r\n\r\n`, 'ascii');
  const body = Buffer.from(json, 'utf8');
  return Buffer.concat([header, body]);
}

function _parseContentLength(headerText) {
  const lines = headerText.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^content-length:\s*(\d+)\s*$/i);
    if (m) return Number(m[1]);
  }
  return -1;
}

function _normalizeHoverContents(contents) {
  if (!contents) return '';
  if (typeof contents === 'string') return contents.trim();
  if (Array.isArray(contents)) {
    return contents.map(_normalizeHoverContents).filter(Boolean).join('\n').trim();
  }
  if (typeof contents === 'object') {
    if (typeof contents.value === 'string') return contents.value.trim();
  }
  return '';
}

function _safeUriToRelPath(uri, rootPath) {
  if (!uri || !String(uri).startsWith('file:')) return null;
  try {
    const abs = path.resolve(fileURLToPath(uri));
    const root = path.resolve(rootPath);
    const rel = path.relative(root, abs);
    if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
      return rel === '' ? '.' : null;
    }
    return rel.replace(/\\/g, '/');
  } catch (_) {
    return null;
  }
}

function _normalizeLocation(loc, rootPath) {
  if (!loc || typeof loc !== 'object') return null;
  const targetUri = loc.uri || loc.targetUri;
  const range = loc.range || loc.targetSelectionRange || loc.targetRange;
  const relPath = _safeUriToRelPath(targetUri, rootPath);
  if (!relPath || !range || !range.start) return null;
  return {
    relPath,
    line: Number(range.start.line || 0) + 1,
    character: Number(range.start.character || 0),
    endLine: Number((range.end && range.end.line) || range.start.line || 0) + 1,
    endCharacter: Number((range.end && range.end.character) || range.start.character || 0)
  };
}

class LspClient {
  constructor(options = {}) {
    this.command = options.command;
    this.args = Array.isArray(options.args) ? [...options.args] : [];
    this.rootPath = path.resolve(options.rootPath || process.cwd());
    this.env = options.env || null;
    this.initializationOptions = options.initializationOptions || null;
    this.defaultTimeoutMs = _resolveTimeoutMs(
      options.timeoutMs ?? process.env.KONOHA_LSP_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS
    );
    this.shutdownTimeoutMs = _resolveTimeoutMs(options.shutdownTimeoutMs, DEFAULT_SHUTDOWN_MS);
    this.proc = null;
    this.nextId = 1;
    this.pending = new Map();
    this.rxBuffer = Buffer.alloc(0);
    this.openedDocs = new Map();
    this.serverCapabilities = null;
    this.initialized = false;
    this.closed = false;
    this.stderrTail = [];
    this.startedAt = 0;
    this.lastUsedAt = 0;
    this._startPromise = null;
    this._closePromise = null;
    this._exitCode = null;
  }

  get pid() {
    return this.proc ? this.proc.pid : null;
  }

  isAlive() {
    return Boolean(this.proc && !this.closed && this.proc.exitCode === null && this.proc.signalCode === null);
  }

  async start() {
    if (this.initialized && this.isAlive()) return this;
    if (this._startPromise) return this._startPromise;
    this._startPromise = this._doStart().finally(() => {
      this._startPromise = null;
    });
    return this._startPromise;
  }

  async _doStart() {
    if (this.closed) throw new Error('LSP_CLIENT_CLOSED');
    if (!this.command) throw new Error('LSP_COMMAND_REQUIRED');

    const child = spawn(this.command, this.args, {
      cwd: this.rootPath,
      env: this.env ? { ...process.env, ...this.env } : process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true
    });
    this.proc = child;
    this.startedAt = Date.now();
    this.lastUsedAt = this.startedAt;

    child.stdout.on('data', (chunk) => this._onStdoutData(chunk));
    child.stderr.on('data', (chunk) => {
      const lines = chunk.toString('utf8').split(/\r?\n/).filter(Boolean);
      for (const l of lines) {
        this.stderrTail.push(l.slice(0, 300));
        if (this.stderrTail.length > 20) this.stderrTail.shift();
      }
    });
    child.on('error', (err) => {
      this._rejectAllPending(new Error(`LSP_PROCESS_ERROR: ${err.message}`));
    });
    child.on('exit', (code, signal) => {
      this._exitCode = code !== null ? code : signal;
      this.initialized = false;
      this._rejectAllPending(new Error(`LSP_PROCESS_EXITED: ${code !== null ? code : signal}`));
    });

    const rootUri = pathToFileURL(this.rootPath).href;
    const initParams = {
      processId: process.pid,
      clientInfo: { name: 'konoha-code-intel', version: '2.2.22' },
      rootUri,
      rootPath: this.rootPath,
      capabilities: {
        textDocument: {
          synchronization: { dynamicRegistration: false, didSave: true },
          definition: { dynamicRegistration: false, linkSupport: true },
          references: { dynamicRegistration: false },
          hover: { dynamicRegistration: false, contentFormat: ['markdown', 'plaintext'] },
          callHierarchy: { dynamicRegistration: false }
        }
      },
      workspaceFolders: [{ uri: rootUri, name: path.basename(this.rootPath) }]
    };
    if (this.initializationOptions) initParams.initializationOptions = this.initializationOptions;

    const initResult = await this.request('initialize', initParams, { timeoutMs: this.defaultTimeoutMs });
    this.serverCapabilities = (initResult && initResult.capabilities) || {};
    this.initialized = true;
    this.notify('initialized', {});
    return this;
  }

  _onStdoutData(chunk) {
    if (!chunk || chunk.length === 0) return;
    if (this.rxBuffer.length + chunk.length > MAX_RX_BYTES) {
      this.rxBuffer = Buffer.alloc(0);
      this._rejectAllPending(new Error('LSP_BUFFER_OVERFLOW'));
      return;
    }
    this.rxBuffer = Buffer.concat([this.rxBuffer, chunk]);
    while (this.rxBuffer.length > 0) {
      const sepIdx = this.rxBuffer.indexOf(HEADER_DELIMITER);
      if (sepIdx === -1) break;
      const headerText = this.rxBuffer.subarray(0, sepIdx).toString('ascii');
      const contentLen = _parseContentLength(headerText);
      if (!Number.isFinite(contentLen) || contentLen < 0) {
        this.rxBuffer = this.rxBuffer.subarray(sepIdx + HEADER_DELIMITER.length);
        continue;
      }
      const msgStart = sepIdx + HEADER_DELIMITER.length;
      const msgEnd = msgStart + contentLen;
      if (this.rxBuffer.length < msgEnd) break;
      const bodyStr = this.rxBuffer.subarray(msgStart, msgEnd).toString('utf8');
      this.rxBuffer = this.rxBuffer.subarray(msgEnd);
      this._handleMessage(bodyStr);
    }
  }

  _handleMessage(bodyStr) {
    let msg;
    try {
      msg = JSON.parse(bodyStr);
    } catch (_) {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    if (Object.hasOwn(msg, 'id') && this.pending.has(msg.id)) {
      const entry = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (entry.signal && entry.abortHandler) {
        entry.signal.removeEventListener('abort', entry.abortHandler);
      }
      if (msg.error) {
        const err = new Error(`LSP_ERROR (${msg.error.code}): ${msg.error.message || 'unknown'}`);
        err.lspCode = msg.error.code;
        entry.reject(err);
      } else {
        entry.resolve(msg.result);
      }
    }
  }

  _rejectAllPending(err) {
    for (const [id, entry] of this.pending.entries()) {
      clearTimeout(entry.timer);
      if (entry.signal && entry.abortHandler) {
        entry.signal.removeEventListener('abort', entry.abortHandler);
      }
      this.pending.delete(id);
      entry.reject(err);
    }
  }

  notify(method, params) {
    if (!this.proc || !this.proc.stdin || this.proc.stdin.destroyed || !this.proc.stdin.writable) return;
    try {
      this.proc.stdin.write(_encodeJsonRpc({ jsonrpc: '2.0', method, params }));
    } catch (_) {
      // Best-effort write while closing
    }
  }

  request(method, params, options = {}) {
    if (this.closed) return Promise.reject(new Error('LSP_CLIENT_CLOSED'));
    if (!this.proc || !this.proc.stdin || !this.proc.stdin.writable) {
      return Promise.reject(new Error('LSP_NOT_RUNNING'));
    }
    const signal = options.signal;
    if (signal && signal.aborted) {
      this.notify('$/cancelRequest', { id: this.nextId });
      const err = new Error('LSP_ABORTED');
      err.code = 'ABORT_ERR';
      return Promise.reject(err);
    }

    const id = this.nextId++;
    const timeoutMs = _resolveTimeoutMs(options.timeoutMs, this.defaultTimeoutMs);
    this.lastUsedAt = Date.now();

    return new Promise((resolve, reject) => {
      const cancelAndReject = (err) => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        clearTimeout(timer);
        if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
        this.notify('$/cancelRequest', { id });
        reject(err);
      };

      const timer = setTimeout(() => {
        const err = new Error(`LSP_TIMEOUT: ${method} exceeded ${timeoutMs}ms`);
        err.code = 'ETIMEDOUT';
        cancelAndReject(err);
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();

      let abortHandler = null;
      if (signal) {
        abortHandler = () => {
          const err = new Error(`LSP_ABORTED: ${method}`);
          err.code = 'ABORT_ERR';
          cancelAndReject(err);
        };
        signal.addEventListener('abort', abortHandler, { once: true });
      }

      this.pending.set(id, { resolve, reject, timer, signal, abortHandler });
      try {
        this.proc.stdin.write(_encodeJsonRpc({ jsonrpc: '2.0', id, method, params }));
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
        reject(err);
      }
    });
  }

  ensureDocumentOpen(absPath, languageId, text) {
    const uri = pathToFileURL(path.resolve(absPath)).href;
    const hash = crypto.createHash('sha1').update(text, 'utf8').digest('hex');
    const prev = this.openedDocs.get(uri);
    if (!prev) {
      this.openedDocs.set(uri, { version: 1, hash });
      this.notify('textDocument/didOpen', {
        textDocument: { uri, languageId: languageId || 'plaintext', version: 1, text }
      });
      return uri;
    }
    if (prev.hash !== hash) {
      const version = prev.version + 1;
      this.openedDocs.set(uri, { version, hash });
      this.notify('textDocument/didChange', {
        textDocument: { uri, version },
        contentChanges: [{ text }]
      });
    }
    return uri;
  }

  async definition(uri, line0, char0, opts = {}) {
    const res = await this.request('textDocument/definition', {
      textDocument: { uri },
      position: { line: Math.max(0, line0), character: Math.max(0, char0) }
    }, opts);
    const items = Array.isArray(res) ? res : res ? [res] : [];
    return items.map((loc) => _normalizeLocation(loc, this.rootPath)).filter(Boolean);
  }

  async references(uri, line0, char0, opts = {}) {
    const res = await this.request('textDocument/references', {
      textDocument: { uri },
      position: { line: Math.max(0, line0), character: Math.max(0, char0) },
      context: { includeDeclaration: Boolean(opts.includeDeclaration) }
    }, opts);
    const items = Array.isArray(res) ? res : [];
    return items.map((loc) => _normalizeLocation(loc, this.rootPath)).filter(Boolean);
  }

  async hover(uri, line0, char0, opts = {}) {
    const res = await this.request('textDocument/hover', {
      textDocument: { uri },
      position: { line: Math.max(0, line0), character: Math.max(0, char0) }
    }, opts);
    if (!res || !res.contents) return '';
    return _normalizeHoverContents(res.contents).slice(0, 600);
  }

  async callHierarchyIncoming(uri, line0, char0, opts = {}) {
    if (this.serverCapabilities && this.serverCapabilities.callHierarchyProvider === false) {
      return [];
    }
    const items = await this.request('textDocument/prepareCallHierarchy', {
      textDocument: { uri },
      position: { line: Math.max(0, line0), character: Math.max(0, char0) }
    }, opts);
    if (!Array.isArray(items) || items.length === 0) return [];
    const incoming = await this.request('callHierarchy/incomingCalls', { item: items[0] }, opts);
    if (!Array.isArray(incoming)) return [];
    return incoming
      .map((entry) => {
        const from = entry && entry.from;
        if (!from) return null;
        const relPath = _safeUriToRelPath(from.uri, this.rootPath);
        if (!relPath) return null;
        const range = from.selectionRange || from.range;
        return {
          name: from.name || '',
          kind: from.kind || null,
          relPath,
          line: range && range.start ? Number(range.start.line || 0) + 1 : 1
        };
      })
      .filter(Boolean);
  }

  forceKillSync() {
    this.closed = true;
    this.initialized = false;
    this._rejectAllPending(new Error('LSP_CLIENT_CLOSED'));
    const child = this.proc;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    try { child.kill('SIGTERM'); } catch (_) { /* ignore */ }
    try { child.kill('SIGKILL'); } catch (_) { /* ignore */ }
  }

  async close() {
    if (this._closePromise) return this._closePromise;
    this.closed = true;
    this.initialized = false;
    const child = this.proc;
    this._closePromise = (async () => {
      if (child && child.exitCode === null && child.signalCode === null) {
        try {
          await this._requestRawForClose('shutdown', null, Math.min(400, this.shutdownTimeoutMs));
          this.notify('exit', null);
        } catch (_) {
          // Server may already be exiting or hung
        }
        try {
          if (child.stdin && !child.stdin.destroyed) child.stdin.end();
        } catch (_) { /* ignore */ }

        await new Promise((resolve) => {
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            clearTimeout(termTimer);
            clearTimeout(killTimer);
            resolve();
          };
          child.once('exit', finish);
          const termTimer = setTimeout(() => {
            if (child.exitCode === null && child.signalCode === null) {
              try { child.kill('SIGTERM'); } catch (_) { /* ignore */ }
            }
          }, Math.min(250, this.shutdownTimeoutMs));
          if (typeof termTimer.unref === 'function') termTimer.unref();

          const killTimer = setTimeout(() => {
            if (child.exitCode === null && child.signalCode === null) {
              try { child.kill('SIGKILL'); } catch (_) { /* ignore */ }
            }
            finish();
          }, this.shutdownTimeoutMs);
          if (typeof killTimer.unref === 'function') killTimer.unref();
        });
      }
      this._rejectAllPending(new Error('LSP_CLIENT_CLOSED'));
    })();
    return this._closePromise;
  }

  _requestRawForClose(method, params, timeoutMs) {
    if (!this.proc || !this.proc.stdin || !this.proc.stdin.writable) {
      return Promise.resolve(null);
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('LSP_SHUTDOWN_TIMEOUT'));
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.proc.stdin.write(_encodeJsonRpc({ jsonrpc: '2.0', id, method, params }));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }
}

module.exports = {
  LspClient,
  _encodeJsonRpc,
  _safeUriToRelPath
};
