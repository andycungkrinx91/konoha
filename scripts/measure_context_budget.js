#!/usr/bin/env node
'use strict';

/**
 * scripts/measure_context_budget.js — Where the tokens actually go.
 *
 * Two different costs get confused when someone says "Konoha is expensive":
 *   CONSTANT — paid once per session (tool manifest, contract head, skill entry).
 *   PER-REQUEST — paid again on every turn because the prefix or the transcript grew.
 *
 * Only the per-request column can produce a five-figure bill. This prints both, with the
 * bytes measured from the code that serves them, so an optimization has a number to beat.
 *
 *   rtk node scripts/measure_context_budget.js [--json]
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BYTES_PER_TOKEN = 3.8; // measured from the 9Router samples this repo's traffic produced

const bytes = (value) => Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
const tokens = (n) => Math.round(n / BYTES_PER_TOKEN);
const size = (p) => (fs.existsSync(p) ? bytes(fs.readFileSync(p, 'utf8')) : null);

function constantCosts() {
  const { listToolSchemas } = require(path.join(ROOT, 'src', 'file_tools_router'));
  const { buildContractManifest, buildMainAgentContract, buildSubagentContract } = require(path.join(ROOT, 'src', 'agent_contract'));
  const { MAX_CONTENT_SIZE } = require(path.join(ROOT, 'src', 'mcp', 'skills_common'));

  const schemas = listToolSchemas();
  const skillDir = path.join(ROOT, 'src', 'templates', 'skills', 'konoha');
  const references = fs.readdirSync(path.join(skillDir, 'references'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => ({ name: f, bytes: size(path.join(skillDir, 'references', f)) }))
    .sort((a, b) => b.bytes - a.bytes);

  const clients = buildContractManifest().contractClients;
  const contracts = clients.map((client) => ({ client, bytes: bytes(buildMainAgentContract(client)) }));

  return {
    manifest: { tools: schemas.length, bytes: bytes(schemas), tokens: tokens(bytes(schemas)) },
    contractHead: {
      clients: contracts,
      bytes: Math.max(...contracts.map((c) => c.bytes)),
      tokens: tokens(Math.max(...contracts.map((c) => c.bytes))),
    },
    subagentContract: bytes(buildSubagentContract('genin')),
    skillEntry: { bytes: size(path.join(skillDir, 'SKILL.md')), cap: MAX_CONTENT_SIZE },
    skillReferences: references,
  };
}

function perRequestCaps() {
  const { PROMPT_CEILING_BYTES, SYSTEM_PROMPT_FLOOR_BYTES, MIN_SKILL_PREVIEW_BYTES } = require(path.join(ROOT, 'src', 'mcp', 'memory_subagent_runner'));
  const { MAX_ENVELOPE_SKILLS, SOUL_SNIPPET_BYTES, MAX_RECALL_ITEMS, RECALL_SNIPPET_CHARS } = require(path.join(ROOT, 'src', 'mcp', 'sannin_router'));
  return {
    subagentPromptCeiling: PROMPT_CEILING_BYTES,
    systemPromptFloor: SYSTEM_PROMPT_FLOOR_BYTES,
    minSkillPreview: MIN_SKILL_PREVIEW_BYTES,
    envelope: { maxSkills: MAX_ENVELOPE_SKILLS, soulBytes: SOUL_SNIPPET_BYTES, maxRecall: MAX_RECALL_ITEMS, recallChars: RECALL_SNIPPET_CHARS },
  };
}

function main() {
  const report = { bytesPerToken: BYTES_PER_TOKEN, constant: constantCosts(), perRequest: perRequestCaps() };

  if (process.argv.includes('--check')) {
    const assert = require('assert');
    const { manifest, contractHead, skillEntry } = report.constant;
    assert.ok(manifest.bytes <= 30000, `manifest is ${manifest.bytes} B, over the 30000 B wire budget`);
    assert.ok(contractHead.bytes <= 1200, `worst contract head is ${contractHead.bytes} B, over the 1200 B budget`);
    assert.ok(skillEntry.bytes <= skillEntry.cap, `konoha/SKILL.md is ${skillEntry.bytes} B, over the ${skillEntry.cap} B digest`);
    console.log(`✓ budget check: manifest ${manifest.bytes} B, contract head ${contractHead.bytes} B, skill entry ${skillEntry.bytes} B`);
    return report;
  }

  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report;
  }

  const { manifest, contractHead, subagentContract, skillEntry, skillReferences } = report.constant;
  const pad = (s, n) => String(s).padEnd(n);
  console.log('Konoha context budget (bytes / ~tokens at 3.8 B per token)\n');
  console.log('CONSTANT — once per session');
  console.log(`  ${pad('MCP tool manifest', 32)}${pad(manifest.bytes, 9)}B  ${pad(manifest.tokens, 7)}tok  (${manifest.tools} tools)`);
  console.log(`  ${pad('Client contract head', 32)}${pad(contractHead.bytes, 9)}B  ${pad(contractHead.tokens, 7)}tok  (worst of ${contractHead.clients.length} clients)`);
  console.log(`  ${pad('Subagent contract', 32)}${pad(subagentContract, 9)}B  ${pad(tokens(subagentContract), 7)}tok`);
  console.log(`  ${pad('konoha skill entry', 32)}${pad(skillEntry.bytes, 9)}B  ${pad(tokens(skillEntry.bytes), 7)}tok  (cap ${skillEntry.cap}B)`);
  const totalConstant = manifest.bytes + contractHead.bytes + skillEntry.bytes;
  console.log(`  ${pad('sum', 32)}${pad(totalConstant, 9)}B  ${pad(tokens(totalConstant), 7)}tok\n`);

  console.log('ON DEMAND — only when a pointer is followed');
  for (const ref of skillReferences) console.log(`  ${pad(`konoha/${ref.name}`, 32)}${pad(ref.bytes, 9)}B  ${pad(tokens(ref.bytes), 7)}tok`);

  const { subagentPromptCeiling, systemPromptFloor, minSkillPreview, envelope } = report.perRequest;
  console.log('\nPER REQUEST — repeated every turn');
  console.log(`  ${pad('subagent prompt ceiling', 32)}${pad(subagentPromptCeiling, 9)}B  ${pad(tokens(subagentPromptCeiling), 7)}tok`);
  console.log(`  ${pad('system prompt floor', 32)}${pad(systemPromptFloor, 9)}B  ${pad(tokens(systemPromptFloor), 7)}tok`);
  console.log(`  ${pad('min skill preview', 32)}${pad(minSkillPreview, 9)}B  ${pad(tokens(minSkillPreview), 7)}tok`);
  console.log(`  ${pad('delegation envelope', 32)}<= ${envelope.maxSkills} skill names, ${envelope.soulBytes}B soul, ${envelope.maxRecall}x${envelope.recallChars} recall`);

  console.log('\nRead this as: the constant column is a session tax in the low thousands of tokens.');
  console.log('Anything above that is transcript growth, which no server-side trimming can undo.');
  return report;
}

if (require.main === module) main();

module.exports = { main, constantCosts, perRequestCaps, BYTES_PER_TOKEN };
