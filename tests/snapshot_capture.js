#!/usr/bin/env node
// tests/snapshot_capture.js
// Capture pre/post-refactor CLI snapshots for snapshot_diff.
//
// Usage:
//   node tests/snapshot_capture.js capture pre   # capture baseline
//   node tests/snapshot_capture.js capture post  # capture current state
//
// Snapshots are stripped of ANSI codes, absolute $HOME paths, and
// transient tokens (pids, timestamps, random ids) before being written.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const SNAP_DIR = path.join(__dirname, 'snapshots');
const mode = process.argv[2] || 'capture';
const out = process.argv[3] || 'pre';

const ANSI = /\x1b\[[0-9;]*[a-zA-Z]/g;
const RGB = /\x1b\[(?:38;2|48;2);[\d;]+m/g;
const HOME_RE = new RegExp(process.env.HOME || '/home/andycungkrinx', 'g');
const PID_RE = /\bpid[=:]\s*\d+/gi;
const TS_RE = /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g;
const DURATION_RE = /\b\d+(?:\.\d+)?\s*(?:ms|s|sec|seconds)\b/gi;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const TRAILING_WS = /[ \t]+$/gm;
const BLANK_LINES = /^\s*$\n/gm;

function normalize(buf) {
  let s = buf.toString('utf8');
  s = s.replace(ANSI, '');
  s = s.replace(RGB, '');
  s = s.replace(HOME_RE, '$HOME');
  s = s.replace(PID_RE, 'pid=$PID');
  s = s.replace(TS_RE, '$TS');
  s = s.replace(DURATION_RE, '~Xs');
  s = s.replace(UUID_RE, '$UUID');
  s = s.replace(TRAILING_WS, '');
  // collapse multiple blank lines into one
  s = s.replace(BLANK_LINES, '\n');
  return s.trim() + '\n';
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 30000,
    ...opts,
  });
  return (r.stdout || '') + (r.stderr ? '\n[STDERR]\n' + r.stderr : '');
}

const CLI_CMDS = [
  ['version', ['version']],
  ['help', ['help']],
  ['doctor', ['doctor']],
  ['status', ['status']],
  ['skill_help', ['skill']],
  ['agent_help', ['agent']],
  ['models_help', ['models']],
  ['data_help', ['data']],
  ['bridge_status', ['bridge', 'status']],
  ['bridge_list', ['bridge', 'list']],
  ['bridge_models', ['bridge', 'models']],
  // 'savings' / 'optimize_report' / 'run_web_search' intentionally excluded:
  // they read & write the live telemetry DB, so the second capture will
  // always differ from the first. Track these manually if needed.
];

// tools that mutate the telemetry DB (log_tool_call) or active_sessions
// table are excluded — second capture always differs from first.
// include-only tools that touch no persistent state:
//   tools/list, find_skill, list_skills, get_skill, list_agents,
//   optimize_report (does not write telemetry), get_main_model
const PY_TOOLS = [
  ['server_help', null], // tools/list
  ['find_skill', ['find_skill', '{"query":"konoha"}']],
  ['list_skills', ['list_skills', '{}']],
  ['get_skill', ['get_skill', '{"name":"anbu-skill"}']],
  ['list_agents', ['list_agents', '{}']],
  ['get_main_model', ['get_main_model', '{}']],
];

function captureCli() {
  const outDir = path.join(SNAP_DIR, out);
  fs.mkdirSync(outDir, { recursive: true });
  for (const [name, args] of CLI_CMDS) {
    const file = path.join(outDir, `cli_${name}.txt`);
    try {
      const data = run('node', ['bin/cli.js', ...args]);
      fs.writeFileSync(file, normalize(data));
      process.stdout.write(`  cli ${name} → ${path.relative(REPO_ROOT, file)}\n`);
    } catch (e) {
      fs.writeFileSync(file, `[CAPTURE ERROR] ${e.message}\n`);
      process.stdout.write(`  cli ${name} → ERROR\n`);
    }
  }
}

function capturePython() {
  const outDir = path.join(SNAP_DIR, out);
  fs.mkdirSync(outDir, { recursive: true });
  for (const [name, args] of PY_TOOLS) {
    const file = path.join(outDir, `py_${name}.txt`);
    try {
      let data;
      if (args === null) {
        // tools/list — JSON-RPC over stdin
        const r = spawnSync('python3', ['src/server.py'], {
          cwd: REPO_ROOT,
          input: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }) + '\n',
          encoding: 'utf8',
          timeout: 15000,
        });
        data = (r.stdout || '') + (r.stderr ? '\n[STDERR]\n' + r.stderr : '');
      } else {
        const [tool, jsonArgs] = args;
        data = run('python3', ['src/server.py', '--tool', tool, jsonArgs]);
      }
      fs.writeFileSync(file, normalize(data));
      process.stdout.write(`  py ${name} → ${path.relative(REPO_ROOT, file)}\n`);
    } catch (e) {
      fs.writeFileSync(file, `[CAPTURE ERROR] ${e.message}\n`);
      process.stdout.write(`  py ${name} → ERROR\n`);
    }
  }
}

if (mode === 'capture') {
  console.log(`Capturing ${out} snapshots to tests/snapshots/${out}/`);
  captureCli();
  capturePython();
  console.log('Done.');
} else {
  console.error(`Unknown mode: ${mode}. Use 'capture <pre|post>'.`);
  process.exit(1);
}
