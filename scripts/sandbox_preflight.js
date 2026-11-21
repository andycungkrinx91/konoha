#!/usr/bin/env node
'use strict';

/**
 * scripts/sandbox_preflight.js
 *
 * Reports which of the three local CI legs this host can actually run, and why
 * the others cannot. The legs are not interchangeable — Linux and Windows have a
 * supported local path on any machine that meets their prerequisites, while the
 * macOS leg needs either Apple hardware, Apple's `container` runtime, or a
 * dockur/macos guest with 4 GB of allocatable RAM.
 *
 * Exit code is 0 whenever the report was produced. This is a report, not a gate:
 * a host that cannot run the macOS leg is not a broken host, and `docs/CI.md`
 * records "proxy-verified" as an allowed state on non-Apple hardware.
 *
 *   node scripts/sandbox_preflight.js [--json]
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const results = [];

function record(leg, state, detail) {
  results.push({ leg, state, detail });
}

function exists(p) {
  try {
    fs.accessSync(p, fs.constants.R_OK | fs.constants.W_OK);
    return true;
  } catch (_) {
    return false;
  }
}

function commandPath(cmd) {
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { encoding: 'utf8' });
  return probe.status === 0 ? (probe.stdout || '').split(/\r?\n/).filter(Boolean)[0] : null;
}

function cpuFlags() {
  try {
    return fs.readFileSync('/proc/cpuinfo', 'utf8');
  } catch (_) {
    return '';
  }
}

function memAvailableBytes() {
  try {
    const line = fs.readFileSync('/proc/meminfo', 'utf8').split('\n').find(l => l.startsWith('MemAvailable:'));
    if (!line) return null;
    return parseInt(line.replace(/[^0-9]/g, ''), 10) * 1024;
  } catch (_) {
    return null;
  }
}

function gib(bytes) {
  return bytes == null ? 'unknown' : `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function checkLinux() {
  const isLinux = process.platform === 'linux';
  const docker = commandPath('docker');
  const pnpm = commandPath('pnpm');
  const act = commandPath('act');
  const runtime = process.env.KONOHA_SANDBOX_RUNTIME || 'docker';

  if (!isLinux) {
    return record('linux', 'UNAVAILABLE', `host is ${process.platform}; the Linux legs need Linux`);
  }
  const missing = [];
  if (!pnpm) missing.push('pnpm');
  if (!docker) missing.push('docker');
  if (missing.length) {
    return record('linux', 'UNAVAILABLE', `missing ${missing.join(', ')}`);
  }
  const parts = [`pnpm test:sandbox (${runtime})`, 'pnpm ci:act'];
  if (!act) parts.push('act: NOT FOUND — only the sandbox leg is runnable');
  else parts.push('pnpm ci:act:shard');
  return record('linux', 'AVAILABLE', parts.join(', '));
}

function checkWindows() {
  if (process.platform === 'win32') {
    return record('windows', 'AVAILABLE', 'native Windows host; run oem/run-ci.cmd directly');
  }
  const docker = commandPath('docker');
  if (!docker) return record('windows', 'UNAVAILABLE', 'docker not found, so no dockur/windows guest');
  if (!exists('/dev/kvm')) return record('windows', 'UNAVAILABLE', '/dev/kvm missing; the dockur QEMU guest cannot boot');
  const compose = path.join(__dirname, '..', 'docker', 'windows-vm', 'compose.yml');
  if (!fs.existsSync(compose)) return record('windows', 'UNAVAILABLE', `no ${path.relative(process.cwd(), compose)}`);
  const envFile = path.join(path.dirname(compose), '.env');
  if (!fs.existsSync(envFile)) {
    return record('windows', 'UNAVAILABLE', 'docker/windows-vm/.env missing; compose fails closed without the guest credential');
  }
  return record('windows', 'AVAILABLE', 'docker compose -f docker/windows-vm/compose.yml up -d, then oem/run-ci.cmd in the guest');
}

// dockur/macos needs 4 GB allocatable; the floor is /run/entry.sh `: "${RAM_MINIMUM:="4G"}"`,
// which is env-overridable but not something this repository recommends overriding.
const MACOS_RAM_FLOOR = 4 * 1024 ** 3;

function checkMacos() {
  if (process.platform === 'darwin') {
    const containerCli = commandPath('container');
    const detail = containerCli
      ? 'native host: KONOHA_SANDBOX_RUNTIME=container pnpm test:sandbox, and CI=true pnpm test'
      : 'native host: CI=true pnpm test (Apple container CLI not installed)';
    return record('macos', 'AVAILABLE', detail);
  }

  const containerCli = commandPath('container');
  if (containerCli) {
    return record('macos', 'AVAILABLE', 'Apple container runtime present: KONOHA_SANDBOX_RUNTIME=container pnpm test:sandbox');
  }

  const blockers = [];
  if (!exists('/dev/kvm')) blockers.push('/dev/kvm missing');
  const flags = cpuFlags();
  if (flags && !flags.includes('avx2')) blockers.push('CPU has no AVX2');
  if (!exists('/dev/net/tun')) blockers.push('/dev/net/tun missing');
  const docker = commandPath('docker');
  if (!docker) blockers.push('docker missing');

  const avail = memAvailableBytes();
  if (avail != null && avail < MACOS_RAM_FLOOR) {
    blockers.push(`only ${gib(avail)} allocatable, dockur/macos needs ${gib(MACOS_RAM_FLOOR)}`);
  }

  if (blockers.length) {
    return record(
      'macos',
      'BLOCKED',
      `${blockers.join('; ')}. dockur/macos cannot run here; proxy only: symlinked-HOME suites per docs/CI.md, not a native claim`
    );
  }
  return record('macos', 'AVAILABLE', 'dockur/macos prerequisites met; see docs/CI.md "Local macOS VM"');
}

try {
  checkLinux();
  checkWindows();
  checkMacos();
} catch (err) {
  record('preflight', 'ERROR', err && err.message ? err.message : String(err));
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ platform: process.platform, arch: process.arch, legs: results }, null, 2));
} else {
  console.log(`sandbox preflight — ${process.platform}/${process.arch}\n`);
  for (const item of results) {
    console.log(`  ${item.leg.toUpperCase().padEnd(8)} ${item.state}`);
    console.log(`           ${item.detail}\n`);
  }
  const blocked = results.filter(r => r.state !== 'AVAILABLE');
  console.log(
    blocked.length
      ? `UNAVAILABLE: ${blocked.map(b => b.leg).join(', ')}. A missing local leg is not a failed gate; docs/CI.md states which proxy applies.`
      : 'All three legs are runnable on this host.'
  );
}
