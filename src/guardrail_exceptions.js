'use strict';

/**
 * src/guardrail_exceptions.js
 *
 * Storage for a human-accepted guardrail risk: a scoped, expiring exception
 * plus an append-only audit trail. Separate from the guardrail's decision logic
 * so the decision stays readable and the store can be tested on its own.
 *
 * Both files live under `.konoha/` in the checkout and are gitignored: an
 * acceptance is a decision about one machine, so it must never ship in a tag.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const EXCEPTIONS_RELATIVE_PATH = path.join('.konoha', 'guardrail-exceptions.json');
const AUDIT_RELATIVE_PATH = path.join('.konoha', 'guardrail-audit.jsonl');
const DEFAULT_EXCEPTION_TTL_MS = 30 * 60 * 1000;
const MAX_EXCEPTION_TTL_MS = 60 * 60 * 1000;
const MIN_JUSTIFICATION_CHARS = 8;

/**
 * The store itself is not a normal file: a tool call that could write it would
 * mint its own bypass, so both paths are refused the same way a secret is.
 */
const GUARDRAIL_STATE_FILES = Object.freeze([
  'guardrail-exceptions.json',
  'guardrail-audit.jsonl'
]);

/**
 * Denials no human can wave through. Accepting one would re-grant exactly what
 * the rule forbids — a secret write, a destructive command, the retired IPC path
 * — so the menu offers only "block" and the store refuses to record them.
 */
const NON_ACCEPTABLE_CODES = Object.freeze([
  'GUARDRAIL_STATE_WRITE_DENIED',
  'SECRET_FILE_WRITE_DENIED',
  'SHELL_GUARDRAIL_VIOLATION',
  'RETIRED_LEGACY_IPC',
  'RETIRED_LEGACY_MCP'
]);

function guardrailExceptionsPath(repoRoot) {
  return path.join(repoRoot, EXCEPTIONS_RELATIVE_PATH);
}

function guardrailAuditPath(repoRoot) {
  return path.join(repoRoot, AUDIT_RELATIVE_PATH);
}

/**
 * Active = not expired. Expired entries are pruned on read so an accepted risk
 * cannot outlive its TTL by accident.
 */
function readGuardrailExceptions(repoRoot, now = Date.now()) {
  const file = guardrailExceptionsPath(repoRoot);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return [];
  }
  const entries = Array.isArray(parsed && parsed.exceptions) ? parsed.exceptions : [];
  const active = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const expiresAt = Date.parse(entry.expires_at);
    if (!Number.isFinite(expiresAt) || expiresAt <= now) continue;
    // A hand-edited store can claim any expiry; nothing outlives the ceiling.
    const createdAt = Date.parse(entry.created_at);
    if (Number.isFinite(createdAt) && createdAt + MAX_EXCEPTION_TTL_MS <= now) continue;
    active.push(entry);
  }
  if (active.length !== entries.length) {
    try {
      fs.writeFileSync(file, `${JSON.stringify({ version: 1, exceptions: active }, null, 2)}\n`, 'utf8');
    } catch (_) { /* read-only checkout: report what is still active */ }
  }
  return active;
}

function appendGuardrailAudit(repoRoot, record) {
  const line = `${JSON.stringify({ recorded_at: new Date().toISOString(), ...record })}\n`;
  fs.mkdirSync(path.dirname(guardrailAuditPath(repoRoot)), { recursive: true });
  fs.appendFileSync(guardrailAuditPath(repoRoot), line, 'utf8');
}

/**
 * Record a human-accepted risk. The exception is scoped to one denial code and
 * one tool, and it expires.
 */
function recordGuardrailException(repoRoot, options = {}) {
  const code = String(options.code || '').trim();
  if (NON_ACCEPTABLE_CODES.includes(code)) {
    throw new Error(`Denial ${code} cannot be risk-accepted; route the call another way.`);
  }
  const justification = String(options.justification || '').trim();
  if (justification.length < MIN_JUSTIFICATION_CHARS) {
    throw new Error(`A risk acceptance needs a justification of at least ${MIN_JUSTIFICATION_CHARS} characters.`);
  }
  const requestedTtlMs = Number.isFinite(options.ttlMs) && options.ttlMs > 0 ? options.ttlMs : DEFAULT_EXCEPTION_TTL_MS;
  const ttlMs = Math.min(requestedTtlMs, MAX_EXCEPTION_TTL_MS);
  const now = Date.now();
  const entry = {
    id: `grx_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    code,
    tool: String(options.tool || '*').trim().toLowerCase() || '*',
    path: options.targetPath ? path.resolve(String(options.targetPath)) : '*',
    justification,
    accepted_by: String(options.acceptedBy || process.env.KONOHA_USER || os.userInfo().username || 'unknown'),
    harness: String(options.harness || 'unknown'),
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + ttlMs).toISOString()
  };
  const file = guardrailExceptionsPath(repoRoot);
  const existing = readGuardrailExceptions(repoRoot, now);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ version: 1, exceptions: [...existing, entry] }, null, 2)}\n`, 'utf8');
  appendGuardrailAudit(repoRoot, {
    event: 'risk_accepted',
    exception_id: entry.id,
    code: entry.code,
    tool: entry.tool,
    path: entry.path,
    harness: entry.harness,
    accepted_by: entry.accepted_by,
    justification: entry.justification,
    expires_at: entry.expires_at
  });
  return entry;
}

function revokeGuardrailExceptions(repoRoot) {
  const file = guardrailExceptionsPath(repoRoot);
  const removed = readGuardrailExceptions(repoRoot).length;
  try {
    fs.unlinkSync(file);
  } catch (_) { /* nothing to revoke */ }
  if (removed > 0) appendGuardrailAudit(repoRoot, { event: 'exceptions_revoked', count: removed });
  return removed;
}

module.exports = {
  EXCEPTIONS_RELATIVE_PATH,
  AUDIT_RELATIVE_PATH,
  DEFAULT_EXCEPTION_TTL_MS,
  MAX_EXCEPTION_TTL_MS,
  MIN_JUSTIFICATION_CHARS,
  GUARDRAIL_STATE_FILES,
  NON_ACCEPTABLE_CODES,
  guardrailExceptionsPath,
  guardrailAuditPath,
  readGuardrailExceptions,
  appendGuardrailAudit,
  recordGuardrailException,
  revokeGuardrailExceptions
};
