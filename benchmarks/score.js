#!/usr/bin/env node
'use strict';

// Aggregates benchmarks/runs/**/log.json into results.csv plus a per-task
// median table. Tokens come from the client CLI's provider-reported `usage`;
// nothing here trusts Konoha's own accounting.
const fs = require('fs');
const path = require('path');

const RUNS = path.join(__dirname, 'runs');
const CSV = path.join(__dirname, 'results.csv');

function parseRunDir(name) {
  const m = /^task_(\d+)_(baseline|konoha)_run(\d+)$/.exec(name);
  return m ? { task: Number(m[1]), mode: m[2], run: Number(m[3]) } : null;
}

function tokens(log) {
  const u = log && log.usage;
  if (!u) return null;
  const input = u.input_tokens || 0;
  const output = u.output_tokens || 0;
  const cacheRead = u.cache_read_input_tokens || 0;
  const cacheCreate = u.cache_creation_input_tokens || 0;
  return { input, output, cache_read: cacheRead, cache_create: cacheCreate,
    total: input + output + cacheRead + cacheCreate };
}

function median(xs) {
  const a = [...xs].sort((x, y) => x - y);
  const n = a.length;
  if (!n) return null;
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
}

function readRun(dir, id, day) {
  const read = (f, dflt = '') => {
    try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch (_) { return dflt; }
  };
  let log = null;
  try { log = JSON.parse(read('log.json', 'null')); } catch (_) { log = null; }
  const meta = Object.fromEntries(read('meta.txt').split('\n').filter(Boolean)
    .map((l) => l.split('=')));
  return { ...id, day, duration: Number(meta.duration_seconds) || 0,
    exit: meta.claude_exit, t: tokens(log) };
}

function collect(root = RUNS) {
  if (!fs.existsSync(root)) return [];
  const rows = [];
  for (const day of fs.readdirSync(root)) {
    const dayDir = path.join(root, day);
    if (!fs.statSync(dayDir).isDirectory()) continue;
    for (const runDir of fs.readdirSync(dayDir)) {
      const id = parseRunDir(runDir);
      if (id) rows.push(readRun(path.join(dayDir, runDir), id, day));
    }
  }
  return rows.sort((a, b) => a.task - b.task || a.mode.localeCompare(b.mode) || a.run - b.run);
}

function isValid(r) {
  return String(r.exit) === '0' && r.t && r.t.total > 0;
}

function summarize(rows) {
  const tasks = [...new Set(rows.map((r) => r.task))].sort((a, b) => a - b);
  return tasks.map((task) => {
    const out = { task };
    for (const mode of ['baseline', 'konoha']) {
      const picked = rows.filter((r) => r.task === task && r.mode === mode);
      const valid = picked.filter(isValid);
      out[mode] = {
        runs: valid.length,
        total_runs: picked.length,
        median_total: median(valid.map((r) => r.t.total)),
        median_duration: median(valid.map((r) => r.duration)),
      };
    }
    const b = out.baseline.median_total;
    const k = out.konoha.median_total;
    out.saving_pct = b && k !== null ? ((b - k) / b) * 100 : null;
    return out;
  });
}

function csv(rows) {
  const head = 'task,mode,run,input_token,output_token,cache_read_token,cache_create_token,total_token,duration_seconds,claude_exit';
  const body = rows.map((r) => [r.task, r.mode, r.run, r.t ? r.t.input : '', r.t ? r.t.output : '',
    r.t ? r.t.cache_read : '', r.t ? r.t.cache_create : '', r.t ? r.t.total : '',
    r.duration, r.exit ?? ''].join(','));
  return [head, ...body].join('\n') + '\n';
}

function table(summary) {
  const lines = ['| Task | Baseline tokens (median) | Konoha tokens (median) | Saving % | Valid runs b/k |',
    '|---|---|---|---|---|'];
  for (const s of summary) {
    lines.push(`| ${s.task} | ${s.baseline.median_total ?? '-'} | ${s.konoha.median_total ?? '-'} | ` +
      `${s.saving_pct === null ? '-' : s.saving_pct.toFixed(1)} | ` +
      `${s.baseline.runs}/${s.baseline.total_runs} : ${s.konoha.runs}/${s.konoha.total_runs} |`);
  }
  const savings = summary.map((s) => s.saving_pct).filter((v) => v !== null);
  lines.push('', `Median saving across tasks: ${savings.length ? median(savings).toFixed(1) : '-'}%`);
  return lines.join('\n');
}

function selfTest() {
  const assert = require('assert');
  assert.strictEqual(median([1, 2, 100]), 2);
  assert.strictEqual(median([1, 2]), 1.5);
  assert.strictEqual(median([]), null);
  assert.deepStrictEqual(parseRunDir('task_3_konoha_run2'), { task: 3, mode: 'konoha', run: 2 });
  assert.strictEqual(parseRunDir('task_3_run2'), null);
  assert.deepStrictEqual(tokens({ usage: { input_tokens: 10, output_tokens: 5,
    cache_read_input_tokens: 100, cache_creation_input_tokens: 7 } }),
  { input: 10, output: 5, cache_read: 100, cache_create: 7, total: 122 });
  assert.strictEqual(tokens({}), null);
  const rows = [
    { task: 1, mode: 'baseline', run: 1, exit: '0', duration: 10, t: { total: 1000 } },
    { task: 1, mode: 'baseline', run: 2, exit: '0', duration: 12, t: { total: 2000 } },
    { task: 1, mode: 'baseline', run: 3, exit: '1', duration: 2, t: null },
    { task: 1, mode: 'konoha', run: 1, exit: '0', duration: 9, t: { total: 300 } },
  ];
  const s = summarize(rows)[0];
  assert.strictEqual(s.baseline.median_total, 1500);
  assert.strictEqual(s.baseline.runs, 2);
  assert.strictEqual(s.baseline.total_runs, 3);
  assert.strictEqual(Math.round(s.saving_pct), 80);
  console.log('score.js self-test passed');
}

if (require.main === module) {
  if (process.argv.includes('--self-test')) selfTest();
  else {
    const rows = collect();
    fs.writeFileSync(CSV, csv(rows));
    console.log(table(summarize(rows)));
    console.log(`\n${rows.length} runs -> ${path.relative(process.cwd(), CSV)}`);
  }
}

module.exports = { parseRunDir, tokens, median, collect, summarize, csv, table };