/**
 * src/workflow/qa-automation/qa_runner.js — the single place that spawns Playwright.
 * Shared by qa_codify (flow verification) and qa_tools (suite runs) so both agree
 * on the working directory, the Windows invocation, and the failure shape.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

const ANSI_RE = /\u001b\[[0-9;]*[a-zA-Z]/g;

/**
 * Pick the directory Playwright must be invoked from.
 * A repo root with no root config but an `apps/web` config resolves to `apps/web`.
 */
function resolveTargetProjectDir(projectPath) {
  let resolved = path.resolve(projectPath);
  const hasRootConfig = fs.existsSync(path.join(resolved, 'playwright.config.js')) || fs.existsSync(path.join(resolved, 'playwright.config.ts'));
  if (!hasRootConfig && fs.existsSync(path.join(resolved, 'apps/web/playwright.config.js'))) {
    resolved = path.join(resolved, 'apps/web');
  }
  return resolved;
}

/** The project's own Playwright shim, or null when Playwright is not installed there. */
function localPlaywrightBin(resolvedProject) {
  const bin = path.join(resolvedProject, 'node_modules', '.bin', process.platform === 'win32' ? 'playwright.cmd' : 'playwright');
  return fs.existsSync(bin) ? bin : null;
}

/**
 * Run `pnpm <args>` in the project. Windows needs the .cmd shim through a shell.
 * The project's own `node_modules/.bin` goes first on PATH: a global Playwright
 * of a different version would otherwise win and fail with `unknown command 'test'`.
 */
function playwrightExec(resolvedProject, args, extraEnv) {
  const localBin = path.join(resolvedProject, 'node_modules', '.bin');
  const env = { ...process.env, ...extraEnv };
  env.PATH = localBin + path.delimiter + (env.PATH || '');
  const isWin = process.platform === 'win32';
  return isWin
    ? spawnSync(`pnpm.cmd ${args.join(' ')}`, { cwd: resolvedProject, env, encoding: 'utf-8', shell: true, windowsHide: true })
    : spawnSync('pnpm', args, { cwd: resolvedProject, env, encoding: 'utf-8' });
}

/**
 * Run one spec. Returns { ok: true } or
 * { ok: false, reason: 'playwright-not-installed' | 'flow-failed', detail }.
 */
function verifyPlaywrightSpec(resolvedProject, specPath) {
  if (!localPlaywrightBin(resolvedProject)) return { ok: false, reason: 'playwright-not-installed' };
  const probe = playwrightExec(resolvedProject, ['exec', 'playwright', '--version']);
  if (probe.status !== 0) return { ok: false, reason: 'playwright-not-installed' };

  const run = playwrightExec(resolvedProject, ['exec', 'playwright', 'test', specPath, '--reporter=line']);
  if (run.status === 0) return { ok: true };

  const raw = `${run.stdout || ''}\n${run.stderr || ''}`.replace(ANSI_RE, '').trim();
  return { ok: false, reason: 'flow-failed', detail: raw.slice(0, 500) || 'Playwright exited with a non-zero status.' };
}

function _wireAsyncProcess(child, options, resolve) {
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  let cancelled = false;

  const timeoutMs = Number(options.timeoutMs) || 300000;
  const timer = setTimeout(() => {
    timedOut = true;
    try { child.kill('SIGTERM'); } catch (_) { /* ignore */ }
  }, timeoutMs);
  if (typeof timer.unref === 'function') timer.unref();

  const onAbort = () => {
    cancelled = true;
    try { child.kill('SIGTERM'); } catch (_) { /* ignore */ }
  };
  if (options.signal) {
    if (options.signal.aborted) onAbort();
    else options.signal.addEventListener('abort', onAbort, { once: true });
  }

  child.stdout?.on('data', (chunk) => {
    const text = chunk.toString('utf8');
    if (stdout.length < 1024 * 1024) stdout += text;
    if (typeof options.onLog === 'function') options.onLog('stdout', text);
  });
  child.stderr?.on('data', (chunk) => {
    const text = chunk.toString('utf8');
    if (stderr.length < 512 * 1024) stderr += text;
    if (typeof options.onLog === 'function') options.onLog('stderr', text);
  });
  child.on('error', (err) => {
    clearTimeout(timer);
    resolve({ status: 1, stdout, stderr: `${stderr}\n${err.message}`.trim(), timedOut, cancelled });
  });
  child.on('close', (code) => {
    clearTimeout(timer);
    resolve({ status: code ?? 1, stdout, stderr, timedOut, cancelled });
  });
}

function playwrightExecAsync(resolvedProject, args, extraEnv = {}, options = {}) {
  return new Promise((resolve) => {
    const localBin = path.join(resolvedProject, 'node_modules', '.bin');
    const env = { ...process.env, ...extraEnv };
    env.PATH = localBin + path.delimiter + (env.PATH || '');
    const isWin = process.platform === 'win32';
    const child = isWin
      ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'pnpm.cmd', ...args], { cwd: resolvedProject, env, windowsHide: true })
      : spawn('pnpm', args, { cwd: resolvedProject, env, windowsHide: true });

    if (typeof options.onSpawn === 'function') options.onSpawn(child);
    _wireAsyncProcess(child, options, resolve);
  });
}

module.exports = {
  resolveTargetProjectDir,
  localPlaywrightBin,
  playwrightExec,
  playwrightExecAsync,
  verifyPlaywrightSpec
};
