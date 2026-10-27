"use strict";

/**
 * bin/commands/task.js — SDLC Governance Tasks, Readiness Gates & Audit Persistence.
 */

const { DB_PATH } = require("../lib/paths");
const {
  C,
  log,
  info,
  error,
  success,
  header,
  chidoriTransition
} = require("../lib/format");




function cmdTaskHelp() {
  log(`
${C.cyan}konoha task${C.reset} — Native Medium-Weight SDLC governance tasks, readiness gates, and audits

${C.bold}USAGE${C.reset}
  konoha task <subcommand> [options]

${C.bold}SUBCOMMANDS${C.reset}
  ${C.cyan}list [--status <s>] [--limit <n>]${C.reset}  📋 List SDLC tasks with status, DoR flags, and review mode.
  ${C.cyan}show <id>${C.reset}                         🔍 Inspect task details, DoR checklist, and validation evidence.
  ${C.cyan}slop <id>${C.reset}                         🛡️ View authoritative anti-slop Delivery Gate findings and cycles.
  ${C.cyan}delete <id> [--all] [--status <s>]${C.reset} 🗑️ Delete specific task or bulk delete tasks by status.
  ${C.cyan}clear [--status <s>] [--project <p>]${C.reset}🧹 Clear tasks from database to prevent stale task hallucination.

${C.bold}EXAMPLES${C.reset}
  ${C.dim}1. List recent tasks:${C.reset}
     konoha task list

  ${C.dim}2. Show task details and persisted evidence:${C.reset}
     konoha task show task_123

  ${C.dim}3. Inspect anti-slop audit report and findings:${C.reset}
     konoha task slop task_123

  ${C.dim}4. Delete a completed or obsolete task:${C.reset}
     konoha task delete task_123

  ${C.dim}5. Clear all tasks from previous sessions:${C.reset}
     konoha task clear
`);
}

function parseTaskFilterFlags(args) {
  let allFlag = false;
  let statusFilter = null;
  let projectFilter = null;
  let targetId = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--all') {
      allFlag = true;
    } else if (arg === '--status' && args[i + 1]) {
      statusFilter = args[i + 1];
      i++;
    } else if (arg === '--project' && args[i + 1]) {
      projectFilter = args[i + 1];
      i++;
    } else if (!arg.startsWith('-') && !targetId) {
      targetId = arg;
    }
  }

  return { allFlag, statusFilter, projectFilter, targetId };
}

async function cmdTask(args) {
  await chidoriTransition('task');
  const sub = args[0] || 'list';
  const subArgs = args.slice(1);
  const sdlcManager = require('../../src/workflow/kage-reviewer/sdlc_manager');

  if (sub === 'help' || sub === '--help' || sub === '-h') {
    cmdTaskHelp();
    return;
  }

  const resolveTaskOrExit = (id, cmdName) => {
    if (!id) {
      error(`Usage: konoha task ${cmdName} <id>`);
      return null;
    }
    const task = sdlcManager.getTask(id, DB_PATH);
    if (!task) {
      error(`Task not found: ${id}`);
      return null;
    }
    return task;
  };

  if (sub === 'list') {
    let statusFilter = null;
    let limit = 50;
    let allProjects = false;
    for (let i = 0; i < subArgs.length; i++) {
      if (subArgs[i] === '--status' && subArgs[i + 1]) {
        statusFilter = subArgs[i + 1];
        i++;
      } else if (subArgs[i] === '--limit' && subArgs[i + 1]) {
        limit = parseInt(subArgs[i + 1], 10) || 50;
        i++;
      } else if (subArgs[i] === '--all' || subArgs[i] === '--all-projects') {
        allProjects = true;
      }
    }
    try {
      const projPath = allProjects ? null : process.cwd();
      const tasks = sdlcManager.listTasks({ projectPath: projPath, status: statusFilter, limit }, DB_PATH);
      header('📋 SDLC Governance Tasks (sdlc_tasks)');
      if (!tasks || tasks.length === 0) {
        log(`  ${C.dim}No SDLC tasks recorded yet.${C.reset}\n`);
        return;
      }
      tasks.forEach((t, idx) => {
        const dorStatus = t.dor_result && t.dor_result.ready ? `${C.green}ready${C.reset}` : `${C.yellow}advisory-flagged${C.reset}`;
        log(`  ${C.cyan}${idx + 1}.${C.reset} ${C.bold}${t.id}${C.reset} ${C.yellow}[${t.status.toUpperCase()}]${C.reset} ${C.dim}(Review: ${t.review_mode})${C.reset}`);
        log(`     ${C.dim}Desc:${C.reset} ${t.description.substring(0, 80)}${t.description.length > 80 ? '...' : ''}`);
        log(`     ${C.dim}DoR:${C.reset} ${dorStatus} | ${C.dim}Slop Cycles:${C.reset} ${t.slop_cycles || 0}`);
        log('');
      });
      success(`Total: ${tasks.length} task(s).`);
    } catch (e) {
      error(`Failed to list tasks: ${e.message}`);
    }
  } else if (sub === 'show') {
    try {
      const task = resolveTaskOrExit(subArgs[0], 'show');
      if (!task) return;
      header(`📋 SDLC Task: ${task.id}`);
      log(`  ${C.bold}Status:${C.reset}        ${C.yellow}${task.status.toUpperCase()}${C.reset}`);
      log(`  ${C.bold}Description:${C.reset}   ${task.description}`);
      log(`  ${C.bold}Review Mode:${C.reset}   ${task.review_mode}`);
      log(`  ${C.bold}Slop Cycles:${C.reset}   ${task.slop_cycles || 0}`);
      log(`  ${C.bold}Project Path:${C.reset}  ${task.project_path || 'N/A'}`);
      log(`  ${C.bold}Created At:${C.reset}    ${task.created_at}`);
      log(`  ${C.bold}Updated At:${C.reset}    ${task.updated_at}`);
      log('');

      if (task.dor_result && Object.keys(task.dor_result).length > 0) {
        log(`  ${C.bold}Definition-of-Readiness (DoR):${C.reset}`);
        log(`    Ready: ${task.dor_result.ready ? C.green + 'true' + C.reset : C.red + 'false' + C.reset} (Confidence: ${task.dor_result.confidence})`);
        if (task.dor_result.missing && task.dor_result.missing.length > 0) {
          log(`    Missing items:`);
          task.dor_result.missing.forEach(m => log(`      - ${m}`));
        }
        log('');
      }

      if (task.evidence && Object.keys(task.evidence).length > 0) {
        log(`  ${C.bold}Validation Evidence:${C.reset}`);
        log(`    Verified: ${task.evidence.verified ? C.green + 'true' + C.reset : C.red + 'false' + C.reset}`);
        if (task.evidence.verification_reason) log(`    Reason:   ${task.evidence.verification_reason}`);
        if (task.evidence.validation && task.evidence.validation.length > 0) {
          log(`    Entries:`);
          task.evidence.validation.forEach(v => log(`      - ${v}`));
        }
        log('');
      }

      if (task.slop_result && Object.keys(task.slop_result).length > 0) {
        log(`  ${C.bold}Anti-Slop Delivery Gate Result:${C.reset}`);
        log(`    Pass: ${task.slop_result.pass ? C.green + 'PASS' + C.reset : C.red + 'FAIL' + C.reset}`);
        if (task.slop_result.scanned_at) log(`    Scanned At: ${task.slop_result.scanned_at}`);
        if (task.slop_result.findings && task.slop_result.findings.length > 0) {
          log(`    Findings:`);
          task.slop_result.findings.forEach(f => log(`      - [${f.rule || 'R-SLOP'}] ${f.description || f}`));
        }
        log('');
      }
    } catch (e) {
      error(`Failed to show task: ${e.message}`);
    }
  } else if (sub === 'slop') {
    try {
      const task = resolveTaskOrExit(subArgs[0], 'slop');
      if (!task) return;
      header(`🛡️ Anti-Slop Audit for Task: ${task.id}`);
      const slop = task.slop_result || {};
      const pass = slop.pass === true;
      log(`  ${C.bold}Authoritative Verdict:${C.reset} ${pass ? C.green + 'PASS (0 findings)' + C.reset : C.red + 'FAIL' + C.reset}`);
      log(`  ${C.bold}Remediation Cycles:${C.reset}    ${task.slop_cycles || 0}`);
      if (slop.scanned_at) log(`  ${C.bold}Scanned At:${C.reset}            ${slop.scanned_at}`);
      log('');

      const findings = slop.findings || [];
      if (findings.length === 0) {
        success('Zero AI slop findings recorded. Task complies with anti-slop rules R-01..R-38.');
      } else {
        log(`  ${C.bold}Delivery Gate Findings (${findings.length}):${C.reset}`);
        findings.forEach(f => {
          log(`    ${C.red}•${C.reset} [${f.rule || 'R-SLOP'}] ${f.description || f}`);
        });
        log('');
        info(`Run remediation cycle or delegate to Anbu to fix flagged violations.`);
      }
    } catch (e) {
      error(`Failed to get slop report for task: ${e.message}`);
    }
  } else if (sub === 'rm') {
    error("Unknown subcommand 'rm' for 'konoha task'. Use canonical subcommand 'konoha task delete'.");
    process.exit(1);
  } else if (sub === 'delete') {
    const { allFlag, statusFilter, projectFilter, targetId } = parseTaskFilterFlags(subArgs);

    if (!targetId && !allFlag && !statusFilter && !projectFilter) {
      error('Usage: konoha task delete <id> | konoha task delete --all | konoha task delete --status <status>');
      return;
    }

    try {
      if (targetId) {
        const deleted = sdlcManager.deleteTask(targetId, DB_PATH);
        if (deleted) {
          success(`Task '${targetId}' deleted successfully.`);
        } else {
          error(`Task '${targetId}' not found.`);
        }
      } else {
        const filters = {
          all: allFlag,
          status: statusFilter,
          projectPath: projectFilter
        };
        const result = sdlcManager.deleteTasks(filters, DB_PATH);
        success(`Deleted ${result.deleted} SDLC task(s).`);
      }
    } catch (e) {
      error(`Failed to delete task(s): ${e.message}`);
    }
  } else if (sub === 'clear') {
    const { allFlag, statusFilter, projectFilter } = parseTaskFilterFlags(subArgs);

    try {
      const filters = {
        all: allFlag || (!statusFilter && !projectFilter),
        status: statusFilter,
        projectPath: projectFilter
      };
      const result = sdlcManager.deleteTasks(filters, DB_PATH);
      success(`Cleared ${result.deleted} SDLC task(s).`);
    } catch (e) {
      error(`Failed to clear task(s): ${e.message}`);
    }
  } else {
    cmdTaskHelp();
  }
}




module.exports = {
  cmdTask,
  cmdTaskHelp,
  parseTaskFilterFlags,
};
