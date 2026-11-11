/**
 * src/workflow/qa-automation/qa_runner.js — the single place that spawns Playwright.
 * Shared by qa_codify (flow verification) and qa_tools (suite runs) so both agree
 * on the working directory, the Windows invocation, and the failure shape.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

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

module.exports = {
  resolveTargetProjectDir,
  localPlaywrightBin,
  playwrightExec,
  verifyPlaywrightSpec
};
