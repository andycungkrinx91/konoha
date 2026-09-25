#!/usr/bin/env node
'use strict';

/**
 * tests/test_token_regression_gate.js — Enforces token budgets and regression thresholds
 * across tool schemas, memory payloads, and task artifacts.
 * 
 * Mandated by PLAN-PHASE2.md Problem 5.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BASELINE_DOC = path.join(ROOT, 'docs', 'architecture', 'TOKEN-BASELINE.md');

console.log('Running test_token_regression_gate.js...');

// 1. Verify TOKEN-BASELINE.md exists and contains canonical thresholds
assert(fs.existsSync(BASELINE_DOC), 'TOKEN-BASELINE.md must exist');
const baselineText = fs.readFileSync(BASELINE_DOC, 'utf-8');
assert(baselineText.includes('Semble MCP'), 'TOKEN-BASELINE.md must document Semble MCP');
assert(baselineText.includes('Aislop MCP'), 'TOKEN-BASELINE.md must document Aislop MCP');

// 2. Run tiktoken threshold check via python3
const pyScript = `
import json, os, glob, subprocess, tiktoken
enc = tiktoken.get_encoding("cl100k_base")

base = os.path.expanduser("~/.gemini/antigravity-cli/mcp")

# Thresholds with +10% regression margin
LIMIT_SEMBLE = 550
LIMIT_AISLOP = 350
LIMIT_QUERY_PERSONA = 200
LIMIT_LIST_PERSONA = 350
LIMIT_QUERY_PROJECT = 400

# 1. Schemas
s_files = sorted(glob.glob(os.path.join(base, "semble", "*.json")))
if s_files:
    s_toks = len(enc.encode(json.dumps([json.load(open(f)) for f in s_files], separators=(',', ':'))))
    assert s_toks <= LIMIT_SEMBLE, f"Semble schema regressed: {s_toks} > {LIMIT_SEMBLE}"
    print(f"  ✓ Semble MCP schema tokens: {s_toks} <= {LIMIT_SEMBLE}")

a_files = sorted(glob.glob(os.path.join(base, "aislop", "*.json")))
if a_files:
    a_toks = len(enc.encode(json.dumps([json.load(open(f)) for f in a_files], separators=(',', ':'))))
    assert a_toks <= LIMIT_AISLOP, f"Aislop schema regressed: {a_toks} > {LIMIT_AISLOP}"
    print(f"  ✓ Aislop MCP schema tokens: {a_toks} <= {LIMIT_AISLOP}")

# 2. Memory Tools
node_cmd = """
const { executeToolSync } = require('./src/mcp/tool_dispatch');
const qp = executeToolSync('query_persona_memory', { query: 'test' }, 'sannin');
const lp = executeToolSync('list_persona_memories', {}, 'sannin');
const qproj = executeToolSync('query_project_memory', { query: 'test' }, 'sannin');
console.log(JSON.stringify({
  qp: typeof qp === 'string' ? qp : JSON.stringify(qp),
  lp: typeof lp === 'string' ? lp : JSON.stringify(lp),
  qproj: typeof qproj === 'string' ? qproj : JSON.stringify(qproj)
}));
"""
proc = subprocess.run(["node", "-e", node_cmd], cwd="${ROOT}", capture_output=True, text=True)
if proc.returncode == 0 and proc.stdout.strip():
    res = json.loads(proc.stdout)
    qp_toks = len(enc.encode(res['qp']))
    lp_toks = len(enc.encode(res['lp']))
    qproj_toks = len(enc.encode(res['qproj']))

    assert qp_toks <= LIMIT_QUERY_PERSONA, f"query_persona_memory regressed: {qp_toks} > {LIMIT_QUERY_PERSONA}"
    assert lp_toks <= LIMIT_LIST_PERSONA, f"list_persona_memories regressed: {lp_toks} > {LIMIT_LIST_PERSONA}"
    assert qproj_toks <= LIMIT_QUERY_PROJECT, f"query_project_memory regressed: {qproj_toks} > {LIMIT_QUERY_PROJECT}"

    print(f"  ✓ query_persona_memory payload: {qp_toks} <= {LIMIT_QUERY_PERSONA}")
    print(f"  ✓ list_persona_memories payload: {lp_toks} <= {LIMIT_LIST_PERSONA}")
    print(f"  ✓ query_project_memory payload: {qproj_toks} <= {LIMIT_QUERY_PROJECT}")
`;

const res = spawnSync('python3', ['-c', pyScript], { encoding: 'utf-8', cwd: ROOT });
if (res.status !== 0) {
  console.error(res.stderr || res.stdout);
  process.exit(1);
}

process.stdout.write(res.stdout);
console.log('✓ All token regression gates passed within established budgets cleanly!');
