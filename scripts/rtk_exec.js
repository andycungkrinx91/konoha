#!/usr/bin/env node
'use strict';

/**
 * Runs a command through RTK when RTK is available on this machine.
 *
 * Test suites print thousands of repetitive lines; RTK rewrites that stream into
 * a failure-focused summary before it reaches the orchestrating model. The mode
 * follows the command: test runners go through `rtk test`, the lint gate goes
 * through `rtk err`, everything else passes through the plain RTK proxy. When
 * RTK is missing the command still runs, unwrapped and announced on stderr, so
 * no CI image or user machine is blocked by the wrapper.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MODES = new Set(['test', 'err', 'plain']);
const LINT_TARGETS = /(^|\/)lint\.js$/;
const TEST_TARGETS = /(^|\/)tests?\//;
const TEST_RUNNERS = new Set(['vitest', 'jest', 'playwright', 'mocha', 'pytest', 'ava', 'tap']);
const PACKAGE_MANAGERS = new Set(['pnpm', 'npm', 'yarn', 'bun']);

function resolveRtkCommand(env = process.env) {
  if (env.KONOHA_RTK_DISABLE === '1') return null;
  if (env.KONOHA_RTK_CMD) return env.KONOHA_RTK_CMD;
  try {
    const { getRtkCommand } = require(path.join(ROOT, 'src/platform_utils'));
    return getRtkCommand() || null;
  } catch {
    return null;
  }
}

function baseName(command) {
  return path.basename(String(command || '')).replace(/\.(exe|cmd|bat)$/i, '');
}

function resolveRtkMode({ command, args = [], env = process.env }) {
  const override = String(env.KONOHA_RTK_MODE || '').trim().toLowerCase();
  if (MODES.has(override)) return override;

  const bin = baseName(command);
  const first = baseName(args[0]);
  if (TEST_RUNNERS.has(bin)) return 'test';
  if (args.some((arg) => TEST_TARGETS.test(String(arg)))) return 'test';
  if (PACKAGE_MANAGERS.has(bin) && /^test(:|$)/.test(String(args[0] || ''))) return 'test';
  if (args.includes('test') && TEST_RUNNERS.has(first)) return 'test';
  if (args.some((arg) => LINT_TARGETS.test(String(arg)))) return 'err';
  return 'plain';
}

function buildInvocation({ command, args = [], rtk = null, mode = 'plain' }) {
  if (!command) throw new Error('rtk_exec requires a command to run');
  if (!rtk) return { command, args, wrapped: false, mode: null };
  const prefix = mode === 'plain' ? [] : [mode];
  return { command: rtk, args: [...prefix, command, ...args], wrapped: true, mode };
}

function main(argv) {
  const [command, ...args] = argv;
  if (!command) {
    process.stderr.write('usage: node scripts/rtk_exec.js <command> [...args]\n');
    return 2;
  }

  const rtk = resolveRtkCommand();
  const mode = resolveRtkMode({ command, args });
  const invocation = buildInvocation({ command, args, rtk, mode });
  if (!invocation.wrapped) {
    process.stderr.write(`[rtk_exec] RTK unavailable; running "${command}" without output compression\n`);
  }

  const result = spawnSync(invocation.command, invocation.args, {
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32'
  });

  if (result.error) {
    process.stderr.write(`[rtk_exec] failed to launch ${invocation.command}: ${result.error.message}\n`);
    return 1;
  }
  if (typeof result.status === 'number') return result.status;
  return result.signal ? 1 : 0;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = { resolveRtkCommand, resolveRtkMode, buildInvocation, main };
