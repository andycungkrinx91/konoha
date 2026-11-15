'use strict';

let vscode; try { vscode = require('vscode'); } catch { /* intentional best-effort fallback: failure here must never crash the runtime */ }
const fs = require('fs');
const os = require('os');
const path = require('path');

// Logging

function _safeAppendPrivateLog(filePath, entry) {
  let fd = null;
  try {
    const uid = typeof process.getuid === 'function' ? process.getuid() : null;
    try {
      const st = fs.lstatSync(filePath);
      if (st.isSymbolicLink() || !st.isFile()) return;
      if (uid !== null && st.uid !== uid) return;
      if ((st.mode & 0o077) !== 0) fs.chmodSync(filePath, 0o600);
    } catch (statErr) {
      if (statErr.code !== 'ENOENT') return;
    }
    const noFollow = fs.constants && fs.constants.O_NOFOLLOW ? fs.constants.O_NOFOLLOW : 0;
    const flags = fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | noFollow;
    fd = fs.openSync(filePath, flags, 0o600);
    const fdStat = fs.fstatSync(fd);
    if (!fdStat.isFile() || (uid !== null && fdStat.uid !== uid)) return;
    fs.writeSync(fd, entry, undefined, 'utf8');
  } catch {
    // ignore filesystem errors for log files
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* best effort */ }
    }
  }
}

function log(ctx, msg, isError = false) {
  if (typeof msg === 'object') {
    try {
      msg = JSON.stringify(msg);
    } catch {
      msg = String(msg);
    }
  }
  const safeMsg = redactSecrets(String(msg));
  const ts = new Date().toISOString().slice(11, 23);
  if (ctx.outputChannel) ctx.outputChannel.appendLine(`[${ts}] ${safeMsg}`);
  if (isError) console.error(`[ag-bridge] ${safeMsg}`);

  // Write to temporary global disk if verbose Request Logging is enabled in settings (for deep debugging)
  const config = vscode.workspace.getConfiguration('agLocalBridge');
  if (config.get('logRequests', false)) {
    const logFilePath = path.join(os.tmpdir(), 'ag-local-bridge.log');
    _safeAppendPrivateLog(logFilePath, `[${ts}] ${safeMsg}\n`);
  }
}

function _redactVerbosePayload(fullContent) {
  if (typeof fullContent === 'string') {
    try {
      const parsed = JSON.parse(fullContent);
      return JSON.stringify(redactPayloadKeys(parsed), null, 2);
    } catch {
      return redactSecrets(fullContent);
    }
  }
  if (typeof fullContent === 'object' && fullContent !== null) {
    try {
      return JSON.stringify(redactPayloadKeys(fullContent), null, 2);
    } catch {
      return redactSecrets(String(fullContent));
    }
  }
  return typeof fullContent === 'string' ? redactSecrets(fullContent) : fullContent;
}

function _writeVerbosePayloadLog(fullContent) {
  if (fullContent === null) return;
  const redactedContent = _redactVerbosePayload(fullContent);
  const payloadLogPath = path.join(os.tmpdir(), 'ag-local-bridge-payloads.log');
  const ts = new Date().toISOString().slice(11, 23);
  _safeAppendPrivateLog(
    payloadLogPath,
    `\n--- [${ts}] FULL PAYLOAD DUMP ---\n${redactedContent}\n--- [END PAYLOAD DUMP] ---\n`
  );
}

/** Log only when agLocalBridge.logRequests is enabled (verbose/debug output) */
function verboseLog(ctx, msg, fullContent = null) {
  const config = vscode.workspace.getConfiguration('agLocalBridge');
  if (!config.get('logRequests', false)) return;
  log(ctx, msg);
  _writeVerbosePayloadLog(fullContent);
}

// Status Bar

// Konoha gradient brand colors for status bar
const BRAND_COLORS = {
  orange: { r: 249, g: 115, b: 22 },
  green:  { r: 34,  g: 197, b: 94 },
  red:    { r: 239, g: 68,  b: 68 },
};

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}

function updateStatusBar(ctx, running, port) {
  if (!ctx.statusBarItem) return;
  const color = running
    ? rgbToHex(BRAND_COLORS.green.r, BRAND_COLORS.green.g, BRAND_COLORS.green.b)
    : rgbToHex(BRAND_COLORS.red.r,    BRAND_COLORS.red.g,    BRAND_COLORS.red.b);
  ctx.statusBarItem.text = running ? `$(radio-tower) AG Bridge :${port}` : '$(warning) AG Bridge OFF';
  ctx.statusBarItem.backgroundColor = running ? undefined : new vscode.ThemeColor('statusBarItem.warningBackground');
  ctx.statusBarItem.foregroundColor = running ? color : undefined;
  ctx.statusBarItem.show();
}

/**
 * Redact common secret patterns in payload strings written to disk.
 * Protects against accidental exfiltration via payload logs when
 * logRequests=true is enabled.
 */
function redactSecrets(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/((?:Bearer|Basic)\s+)[A-Za-z0-9._~+/=-]{6,}/gi, '$1[REDACTED]')
    .replace(/\b(sk-[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{20,}|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/g, '[REDACTED]')
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]')
    .replace(/\b(https?|wss?|postgres(?:ql)?|mysql|redis|mongodb(?:\+srv)?|amqp):\/\/[^:\s/@]+:[^@\s/]+@/gi, '$1://[REDACTED]@')
    .replace(/([?&](?:token|api[_-]?key|apikey|access_token|refresh_token|client_secret|secret|password)=)[^&\s"'#]+/gi, '$1[REDACTED]')
    .replace(/("(?:api[_-]?key|x-api-key|token|access[_-]?token|refresh[_-]?token|client[_-]?secret|session[_-]?token|authorization|password|secret|private[_-]?key|credential|dsn|connection[_-]?string)"\s*:\s*)"[^"]*"/gi, '$1"[REDACTED]"');
}

/** Recursively redact sensitive keys and secret-bearing strings from a JSON-compatible value */
function redactPayloadKeys(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return redactSecrets(obj);
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(redactPayloadKeys);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const lk = k.toLowerCase();
    if (lk.match(/(api.?key|password|secret|auth_|bearer|credential|token|authorization|x-api|private[_-]?key|dsn|connection.?string)/)) {
      out[k] = '***REDACTED***';
    } else {
      out[k] = redactPayloadKeys(v);
    }
  }
  return out;
}

// HTTP Response Helpers

function setupStreamResponse(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.writeHead(200);
  if (res.flushHeaders) res.flushHeaders();
  if (res.socket && res.socket.setNoDelay) res.socket.setNoDelay(true);
}

function sendJson(res, code, payload) {
  const body = JSON.stringify(payload);
  res.setHeader('Content-Type', 'application/json');
  res.writeHead(code);
  res.end(body);
}

function readBody(req, maxBytes = 200 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    req.on('data', (c) => {
      totalBytes += c.length;
      if (totalBytes > maxBytes) {
        req.destroy(new Error(`Request body exceeds ${maxBytes} bytes`));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// OpenAI Response Builders

function buildStreamChunk(id, model, content, finishReason = null) {
  const delta = content !== null ? { role: 'assistant', content } : {};
  return {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

function buildCompletion(id, model, content) {
  return {
    id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

// Error Parsing Helpers

/**
 * Extracts a sensible Retry-After value from a sidecar rate limit message.
 * Handles formats like 'reset after 42m41s' or 'reset after 45s'.
 */
function parseRetryAfter(message) {
  if (typeof message !== 'string') return 10;
  // Match either 'reset after 42m41s' or 'reset after 41s'
  const match = message.match(/reset after (?:(\d+)m)?(\d+)s/);
  if (match) {
    const mins = parseInt(match[1] || '0', 10);
    const secs = parseInt(match[2] || '0', 10);
    return Math.max(10, mins * 60 + secs + 2);
  }
  return 10;
}

/**
 * Extracts the inner provider error message from a raw sidecar error string.
 * Example input: 'HTTP 500: {"code":"unknown","message":"RESOURCE_EXHAUSTED (code 429): You have exhausted..."}'
 * Output: 'RESOURCE_EXHAUSTED (code 429): You have exhausted...'
 */
function extractProviderError(message) {
  if (typeof message !== 'string') return String(message);
  let extracted = message;
  try {
    const jsonMatch = message.match(/HTTP \d+: (\{[\s\S]*\})/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[1]);
      if (parsed && typeof parsed.message === 'string') {
        extracted = parsed.message;
      }
    } else {
      const msgMatch = message.match(/"message"\s*:\s*"([^"]+)"/);
      if (msgMatch) {
        extracted = msgMatch[1];
      }
    }
  } catch {
    // If parsing fails, fall back to regex
    const msgMatch = message.match(/"message"\s*:\s*"([^"]+)"/);
    if (msgMatch) {
      extracted = msgMatch[1];
    }
  }

  // Clarify Google's confusing 'check quota' message which is actually a TPM/RPM rate limit
  if (extracted.includes('RESOURCE_EXHAUSTED')) {
    return `Google API Rate Limit (TPM/RPM) exceeded. Please wait a minute for limits to reset, or reduce your context size. (Google's raw error: ${extracted})`;
  }
  return extracted;
}

module.exports = {
  log,
  verboseLog,
  updateStatusBar,
  setupStreamResponse,
  sendJson,
  readBody,
  buildStreamChunk,
  buildCompletion,
  parseRetryAfter,
  extractProviderError,
  redactSecrets,
  redactPayloadKeys,
};
