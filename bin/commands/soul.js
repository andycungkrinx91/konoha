"use strict";

/**
 * bin/commands/soul.js — Will of Fire Tenets & Subagent Archetype Spirits.
 */

const { C, log, header } = require("../lib/format");


async function cmdSoul(args = []) {
  const personaMemory = require('../../src/persona_memory');
  const isRaw = args.includes('--raw') || args.includes('-r');
  const isJson = args.includes('--json') || args.includes('-j');
  const agentArg = args.find(a => !a.startsWith('-'))?.toLowerCase();

  const soul = personaMemory.getSoul({ agentName: agentArg, projectPath: process.cwd() });

  if (isRaw) {
    process.stdout.write((soul.content || 'No SOUL.md found.') + '\n');
    return;
  }

  if (isJson) {
    log(JSON.stringify(soul, null, 2));
    return;
  }

  const arch = soul.archetype || soul.selected_archetype;
  if (agentArg && arch) {
    header(`Soul of ${arch.name || agentArg}`);
    log(`  ${C.bold}Role / Title:${C.reset}       ${C.cyan}${arch.role || 'Ninja'}${C.reset}`);
    log(`  ${C.bold}Creed / Voice:${C.reset}      ${C.yellow}"${arch.voice || ''}"${C.reset}`);
    if (arch.calling) {
      log(`  ${C.bold}Sacred Calling:${C.reset}     ${C.green}${arch.calling}${C.reset}`);
    }
    if (arch.antislop_skills && arch.antislop_skills.length) {
      log(`  ${C.bold}Anti-Slop Skills:${C.reset}   ${C.cyan}${arch.antislop_skills.join(', ')}${C.reset}`);
    }
    if (arch.adhd_shaping) {
      log(`  ${C.bold}ADHD Standard:${C.reset}      ${C.magenta}${arch.adhd_shaping}${C.reset}`);
    }
    log(`  ${C.bold}Source Path:${C.reset}        ${C.dim}${soul.path || soul.source_path}${C.reset}\n`);
    log(`  ${C.dim}Tip: Run ${C.cyan}konoha soul${C.dim} to view all 7 archetype souls and village tenets.${C.reset}`);
    return;
  }

  header('The Soul of Konoha — Will of Fire');
  log(`  ${C.dim}Every subagent in the village carries this core philosophy and operational ethos.${C.reset}`);
  log(`  ${C.yellow}Universal i-have-adhd Standard:${C.reset} ${C.dim}Lead with action, numbered steps, cap lists to 5, zero filler.${C.reset}\n`);

  log(`  ${C.bold}Universal Tenets:${C.reset}`);
  (soul.tenets || []).forEach((t, i) => {
    log(`    ${C.cyan}${i + 1}. ${t.name}:${C.reset} ${t.summary}`);
  });
  log('');

  log(`  ${C.bold}Ninja Archetype Spirits (7 Specialists):${C.reset}`);
  const archetypes = soul.archetypes || {};
  Object.keys(archetypes).forEach((key) => {
    const a = archetypes[key];
    log(`    ${C.yellow}${a.name || key}${C.reset} — ${C.dim}${a.role || ''}${C.reset}`);
    if (a.voice) log(`      ${C.dim}Creed: "${a.voice}"${C.reset}`);
    if (a.antislop_skills && a.antislop_skills.length) {
      log(`      ${C.cyan}Anti-Slop: ${a.antislop_skills.join(', ')}${C.reset}`);
    }
    if (a.adhd_shaping) log(`      ${C.magenta}ADHD Standard: ${a.adhd_shaping}${C.reset}`);
  });

  log(`\n  ${C.bold}Resolved Source:${C.reset} ${C.dim}${soul.path}${C.reset}`);
  log(`  ${C.dim}Commands: ${C.cyan}konoha soul <archetype>${C.dim} | ${C.cyan}konoha soul --raw${C.dim} | ${C.cyan}konoha soul --json${C.reset}\n`);
}



module.exports = {
  cmdSoul,
};
