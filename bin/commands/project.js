"use strict";

/**
 * bin/commands/project.js — Project Workspaces, Architecture Invariants & Memory.
 */

const path = require("path");
const { DB_PATH } = require("../lib/paths");
const {
  C,
  log,
  info,
  warn,
  error,
  success,
  header,
  chidoriTransition
} = require("../lib/format");

const { fileExists } = require("../lib/prompt");
const { cmdDataMemory } = require("./data");


function cmdProjectHelp() {
  log(`
${C.cyan}konoha project${C.reset} — Manage persistent project workspaces, detected stacks, and project invariants

${C.bold}USAGE${C.reset}
  konoha project <subcommand> [options]

${C.bold}SUBCOMMANDS${C.reset}
  ${C.cyan}context [path]${C.reset}        📊 View detected stack, package manager, and architectural invariants.
  ${C.cyan}list${C.reset}                  📁 List all tracked project workspaces in Konoha.
  ${C.cyan}memory [path]${C.reset}         🧠 List persistent memories & episodic learnings for a project workspace.
  ${C.cyan}add [path] <summary>${C.reset}  ➕ Save architectural invariants or rules for a project.
  ${C.cyan}set <dor-mode|review-mode|hitl-mode> <val> [path]${C.reset} ⚙️ Configure SDLC DoR gate, review mode, or HITL approval gates.
  ${C.cyan}delete <path|hash>${C.reset}    🗑️ Remove a project workspace profile from memory.
  ${C.cyan}delete-memory <id>${C.reset}    ❌ Remove a single episodic learning item by ID.
  ${C.cyan}prune [path]${C.reset}          🧹 Prune all episodic learnings for a project workspace.

${C.bold}EXAMPLES${C.reset}
  ${C.dim}1. View current project context:${C.reset}
     konoha project context

  ${C.dim}2. List all registered projects:${C.reset}
     konoha project list

  ${C.dim}3. Add persistent project invariants:${C.reset}
     konoha project add . "Use Tailwind v4 with @theme in globals.css, pnpm exclusively"

  ${C.dim}4. Delete a single project learning 1 by 1:${C.reset}
     konoha project delete-memory 12
     konoha project memory delete 12

  ${C.dim}5. Prune all project learnings while keeping invariants:${C.reset}
     konoha project prune

  ${C.dim}6. Set Definition-of-Readiness gate mode:${C.reset}
     konoha project set dor-mode enforced
     konoha project set review-mode cross-provider
`);
}

function handleProjectList(personaMemory) {
  try {
    const projs = personaMemory.listProjects(50, DB_PATH);
    header('📁 Tracked Project Workspaces in Konoha');
    if (!projs || projs.length === 0) {
      log(`  ${C.dim}No projects tracked yet. Run ${C.cyan}konoha project context${C.dim} in any workspace to register.${C.reset}\n`);
      return;
    }
    projs.forEach((p, idx) => {
      log(`  ${C.cyan}${idx + 1}.${C.reset} ${C.bold}${p.project_name}${C.reset} ${C.yellow}[${p.framework || 'Unknown'}]${C.reset} ${C.dim}(Hash: ${p.project_hash})${C.reset}`);
      log(`     ${C.dim}Path:${C.reset} ${p.project_path}`);
      log(`     ${C.dim}Styling:${C.reset} ${p.styling || 'CSS'} | ${C.dim}Package Manager:${C.reset} ${p.package_manager || 'pnpm'}`);
      if (p.context_summary) log(`     ${C.dim}Invariants:${C.reset} ${p.context_summary}`);
      log('');
    });
    success(`Total: ${projs.length} project workspace(s).`);
  } catch (e) {
    error(`Failed to list projects: ${e.message}`);
  }
}

function handleProjectContext(personaMemory, subArgs) {
  const targetPath = subArgs[0] || process.cwd();
  try {
    let profile = personaMemory.getProjectProfile(targetPath, DB_PATH);
    if (!profile) {
      const pHash = personaMemory.saveOrUpdateProject(targetPath, '', null, DB_PATH);
      profile = personaMemory.getProjectProfile(pHash, DB_PATH);
    }
    const mems = personaMemory.listMemories({ projectPath: targetPath, limit: 10, allSessions: true, dbPath: DB_PATH });
    const p = profile || {};
    header(`🏢 Project Workspace Context: ${p.project_name || 'Active Project'}`);
    log(`  ${C.bold}Project Path:${C.reset}     ${p.project_path || targetPath}`);
    log(`  ${C.bold}Project Hash:${C.reset}     ${C.cyan}${p.project_hash || 'N/A'}${C.reset}`);
    log(`  ${C.bold}Framework:${C.reset}        ${C.yellow}${p.framework || 'Unknown'}${C.reset}`);
    log(`  ${C.bold}Styling Engine:${C.reset}   ${p.styling || 'Standard CSS'}`);
    log(`  ${C.bold}Package Manager:${C.reset}  ${C.green}${p.package_manager || 'pnpm'}${C.reset}`);
    const sdlcManager = require('../../src/workflow/kage-reviewer/sdlc_manager');
    const sdlcCfg = sdlcManager.getProjectSdlcConfig(targetPath, DB_PATH);
    log(`  ${C.bold}SDLC Governance:${C.reset}  DoR: ${sdlcCfg.dor_mode} | Review: ${sdlcCfg.review_mode} | HITL Mode: ${C.cyan}${sdlcCfg.hitl_mode}${C.reset}`);
    if (p.context_summary) log(`  ${C.bold}Invariants & Rules:${C.reset}\n     ${p.context_summary}`);
    log('');
    if (mems && mems.length > 0) {
      log(`  ${C.bold}Persistent Project Learnings (${mems.length}):${C.reset}`);
      mems.forEach(m => log(`    - ${C.yellow}[${(m.memory_type || 'rule').toUpperCase()}]${C.reset} ${m.content}`));
      log('');
    }
    success('Project context is active and will be auto-injected to subagents.');
  } catch (e) {
    error(`Failed to get project context: ${e.message}`);
  }
}

async function handleProjectMemory(personaMemory, subArgs) {
  if (subArgs[0] === 'rm') {
    error("Unknown subcommand 'rm' for 'konoha project memory'. Use canonical subcommand 'konoha project memory delete'.");
    process.exit(1);
  }
  if (subArgs[0] === 'delete') {
    const memId = subArgs[1];
    if (!memId) return error('Usage: konoha project memory delete <id>');
    const deleted = personaMemory.deleteMemory(memId, DB_PATH);
    if (deleted) success(`Deleted project memory item ID: ${memId}`);
    else warn(`Memory item ID "${memId}" not found.`);
    return;
  }
  if (subArgs[0] === 'prune') {
    const targetPath = subArgs[1] || process.cwd();
    const res = personaMemory.pruneProjectMemories(targetPath, {}, DB_PATH);
    success(`Pruned ${res.deleted} memory item(s) for project (${res.project_hash || targetPath}).`);
    return;
  }
  const targetPath = subArgs[0] || process.cwd();
  await cmdDataMemory(['--project', targetPath]);
}

function handleProjectPrune(personaMemory, subArgs, sub) {
  if (sub === 'prune-all' || (sub === 'prune' && (subArgs.includes('--workspaces') || subArgs.includes('--all-workspaces')))) {
    try {
      const res = personaMemory.pruneAllProjects({}, DB_PATH);
      success(`Pruned all registered workspace profiles (${res.deleted} deleted).`);
    } catch (e) {
      error(`Failed to prune workspaces: ${e.message}`);
    }
    return;
  }
  const hasClearInvariants = subArgs.includes('--invariants') || subArgs.includes('--all');
  const filteredArgs = subArgs.filter(a => a !== '--invariants' && a !== '--all');
  const targetPath = filteredArgs[0] || process.cwd();
  try {
    const res = personaMemory.pruneProjectMemories(targetPath, { clearInvariants: hasClearInvariants }, DB_PATH);
    let msg = `Pruned ${res.deleted} memory item(s) for project context (${res.project_hash || targetPath}).`;
    if (res.invariants_cleared) msg += ' Architectural invariants cleared.';
    success(msg);
  } catch (e) {
    error(`Failed to prune project context: ${e.message}`);
  }
}

function handleProjectAdd(personaMemory, subArgs) {
  if (subArgs.length === 0) return error('Usage: konoha project add [path] "<summary>"');
  const targetPath = subArgs.length === 1 ? process.cwd() : subArgs[0];
  const summary = subArgs.length === 1 ? subArgs[0] : subArgs.slice(1).join(' ');
  const resolvedPath = path.resolve(targetPath);
  try {
    const pHash = personaMemory.saveOrUpdateProject(resolvedPath, summary, null, DB_PATH);
    const agentManager = require('../../src/agent_manager');
    agentManager.deployProjectWorkspace(resolvedPath, { summary, silent: false, force: true });
    success(`Saved architectural invariants & injected Konoha skills, rules, and configs with mandatory runtime contract into (${pHash} · ${resolvedPath}).`);
  } catch (e) {
    error(`Failed to save project invariants: ${e.message}`);
  }
}

function handleProjectDelete(personaMemory, subArgs) {
  if (subArgs.length === 0) return error('Usage: konoha project delete <path|hash>');
  if (subArgs[0] === '--memory' || subArgs[0] === '-m') {
    const memId = subArgs[1];
    const deleted = personaMemory.deleteMemory(memId, DB_PATH);
    if (deleted) success(`Deleted memory item ID: ${memId}`);
    else warn(`Memory item ID "${memId}" not found.`);
    return;
  }
  const target = subArgs[0];
  try {
    let deleted = personaMemory.deleteProject(target, true, DB_PATH);
    if (!deleted && /^\d+$/.test(target)) {
      deleted = personaMemory.deleteMemory(target, DB_PATH);
      if (deleted) return success(`Deleted memory item ID: ${target}`);
    }
    if (deleted) success(`Deleted project profile: ${target}`);
    else error(`Project profile not found or could not be deleted: ${target}`);
  } catch (e) {
    error(`Project profile delete failed: ${e.message}`);
  }
}

function handleProjectSet(subArgs) {
  if (subArgs.length < 2) return error('Usage: konoha project set <dor-mode|review-mode|hitl-mode> <value> [path]');
  const settingKey = subArgs[0].toLowerCase();
  const settingVal = subArgs[1].toLowerCase();
  const targetPath = subArgs[2] || process.cwd();
  const sdlcManager = require('../../src/workflow/kage-reviewer/sdlc_manager');

  try {
    if (settingKey === 'dor-mode' || settingKey === 'dor') {
      if (!['advisory', 'enforced', 'soft-mandatory', 'hard-mandatory'].includes(settingVal)) return error('Invalid dor-mode. Must be "advisory" or "enforced".');
      const updated = sdlcManager.setProjectSdlcConfig(targetPath, { dor_mode: settingVal }, DB_PATH);
      success(`Project dor-mode set to "${updated.dor_mode}" for ${targetPath}.`);
    } else if (settingKey === 'review-mode' || settingKey === 'review') {
      if (!['self', 'cross-provider'].includes(settingVal)) return error('Invalid review-mode. Must be "self" or "cross-provider".');
      const updated = sdlcManager.setProjectSdlcConfig(targetPath, { review_mode: settingVal }, DB_PATH);
      success(`Project review-mode set to "${updated.review_mode}" for ${targetPath}.`);
      if (updated.review_mode === 'cross-provider') info('Note: Cross-provider review requires 2+ enabled bridges or different Model Assignments.');
    } else if (settingKey === 'hitl-mode' || settingKey === 'hitl') {
      if (!['enabled', 'disabled', 'safe', 'autonomous'].includes(settingVal)) return error('Invalid hitl-mode. Must be "enabled" or "disabled".');
      const updated = sdlcManager.setProjectSdlcConfig(targetPath, { hitl_mode: settingVal }, DB_PATH);
      success(`Project hitl-mode set to "${updated.hitl_mode}" for ${targetPath}.`);
      if (updated.hitl_mode === 'disabled' || settingVal === 'autonomous') {
        info('Notice: Gate 1 (Plan Approval) and Gate 2 (Delivery Sign-Off) remain authoritative. Human approval is required regardless of execution autonomy.');
      }
    } else {
      error(`Unknown project setting: ${settingKey}. Supported: dor-mode, review-mode, hitl-mode`);
    }
  } catch (e) {
    error(`Failed to set project setting: ${e.message}`);
  }
}

async function cmdProject(args) {
  await chidoriTransition('project');
  const sub = args[0] || 'context';
  const subArgs = args.slice(1);

  if (sub === 'help' || sub === '--help' || sub === '-h') return cmdProjectHelp();
  if (!fileExists(DB_PATH)) return error('SQLite database not found.');

  const personaMemory = require('../../src/persona_memory');
  if (sub === 'list') return handleProjectList(personaMemory);
  if (sub === 'show') { error("Unknown subcommand 'show' for 'konoha project'. Use canonical subcommand 'konoha project context'."); process.exit(1); }
  if (sub === 'rm') { error("Unknown subcommand 'rm' for 'konoha project'. Use canonical subcommand 'konoha project delete'."); process.exit(1); }
  if (sub === 'context') return handleProjectContext(personaMemory, subArgs);
  if (sub === 'memory') return await handleProjectMemory(personaMemory, subArgs);
  if (sub === 'delete-memory') {
    if (subArgs.length === 0) return error('Usage: konoha project delete-memory <id>');
    const deleted = personaMemory.deleteMemory(subArgs[0], DB_PATH);
    if (deleted) success(`Deleted memory item ID: ${subArgs[0]}`);
    else warn(`Memory item ID "${subArgs[0]}" not found.`);
    return;
  }
  if (sub === 'prune-all' || sub === 'prune') return handleProjectPrune(personaMemory, subArgs, sub);
  if (sub === 'add') return handleProjectAdd(personaMemory, subArgs);
  if (sub === 'delete') return handleProjectDelete(personaMemory, subArgs);
  if (sub === 'set') return handleProjectSet(subArgs);

  cmdProjectHelp();
}




module.exports = {
  cmdProject,
  cmdProjectHelp,
};
