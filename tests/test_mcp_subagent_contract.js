#!/usr/bin/env node
'use strict';

/**
 * tests/test_mcp_subagent_contract.js — Validates canonical and deployed MCP tool blocks parity.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const source = path.join(ROOT, 'src/templates/skills/konoha/references/mcp-tools-block.md');
const deployed = path.join(ROOT, '.agents/skills/konoha/references/mcp-tools-block.md');

async function run() {
  console.log('Running test_mcp_subagent_contract tests...');

  assert.ok(fs.existsSync(source), 'canonical MCP tool block must exist');
  assert.ok(fs.existsSync(deployed), 'deployed MCP tool block must exist');

  const sourceBytes = fs.readFileSync(source);
  const deployedBytes = fs.readFileSync(deployed);
  assert.ok(sourceBytes.equals(deployedBytes), 'canonical and deployed MCP tool blocks differ');

  const content = fs.readFileSync(source, 'utf-8');
  const requiredPhrases = [
    'Konoha is mandatory',
    'Semble is mandatory',
    'RTK is mandatory',
    'Resume safety',
    'mcp__semble__search',
    'mcp__konoha__find_skill'
  ];

  for (const phrase of requiredPhrases) {
    assert.ok(content.includes(phrase), `MCP subagent contract missing: ${phrase}`);
  }

  console.log('✓ Direct MCP subagent contract and source/deployed parity passed.');
}

if (require.main === module) {
  run().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { run };
