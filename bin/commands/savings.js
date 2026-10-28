"use strict";

/**
 * bin/commands/savings.js — Token Savings Telemetry & Combined Metric Reporting.
 */

const path = require("path");
const { spawnSync } = require("child_process");

const { DB_PATH } = require("../lib/paths");
const {
  C,
  log,
  header,
  drawLogo,
  applyGradient,
  LEAF_THEME,
  FIRE_THEME,
  drawBox,
  applyGradientToBorders,
  padEndVisual,
  RASENGAN_THEME
} = require("../lib/format");

const { fileExists } = require("../lib/prompt");
const { getUvxCommand } = require("../lib/extension");
const { SEMBLE_PACKAGE } = require("../../src/semble_manager");


function cmdSavingsHelp() {
  log(`
${C.cyan}konoha savings${C.reset} — View your total token savings (Today, 7 days, All time)

${C.bold}USAGE${C.reset}
  konoha savings

${C.bold}EXAMPLES${C.reset}
  konoha savings
`);
}


function formatBytes(b) {
  if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(2)} MB`;
  return `${(b / 1024).toFixed(1)} KB`;
}

function formatTokensComb(t) {
  if (t >= 1000000) return `${(t / 1000000).toFixed(2)}M`;
  if (t >= 1000) return `${(t / 1000).toFixed(1)}k`;
  return String(t);
}

function formatSavings(tokens, pct, thoughtTokens) {
  const width = 10;
  const pctSafe = pct || 0;
  const filledCount = Math.min(width, Math.max(0, Math.round((pctSafe / 100) * width)));
  const filled = '█'.repeat(filledCount);
  const empty = '░'.repeat(width - filledCount);

  let coloredFilled = '';
  if (filledCount > 0) {
    const theme = pctSafe >= 80 ? LEAF_THEME : (pctSafe >= 50 ? FIRE_THEME : [[239, 68, 68], [239, 68, 68]]);
    coloredFilled = applyGradient(filled, theme);
  }

  const thoughtVal = thoughtTokens || 0;
  const thoughtText = ` (thought: ${formatTokensComb(thoughtVal)})`;
  const pctStr = `${Math.round(pctSafe)}%`.padStart(4);
  return `[${coloredFilled}${C.dim}${empty}${C.reset}] ${pctStr} ~${C.bold}${formatTokensComb(tokens).padEnd(5)}${C.reset} tokens${C.yellow}${thoughtText}${C.reset}`;
}

function printCallTypesTable(byCallType) {
  if (!byCallType || byCallType.length === 0) return;
  log(`    ${C.bold}By Call Type${C.reset}`);
  log(`    ${applyGradient('────────────────────────────────────────────────────────────────────────', LEAF_THEME)}`);
  log(`    ${C.bold}#     Call type            Calls  Share${C.reset}`);
  log(`    ${applyGradient('────────────────────────────────────────────────────────────────────────', LEAF_THEME)}`);

  const totalCalls = byCallType.reduce((sum, item) => sum + item.calls, 0);
  byCallType.forEach((item, index) => {
    const num = `${index + 1}.`.padEnd(6);
    const toolName = item.tool.padEnd(20);
    const calls = String(item.calls).padStart(6);

    let bar = `${C.dim}${'░'.repeat(16)}${C.reset}`;
    let pctText = '  0%';
    if (totalCalls > 0) {
      const itemPct = Math.round((item.calls / totalCalls) * 100);
      pctText = `${itemPct}%`.padStart(4);
      const filledCount = Math.min(16, Math.max(0, Math.round((item.calls / totalCalls) * 16)));
      const finalFilledCount = (item.calls > 0) ? Math.max(1, filledCount) : filledCount;
      const filled = '█'.repeat(finalFilledCount);
      const empty = '░'.repeat(16 - finalFilledCount);
      const coloredFilled = finalFilledCount > 0 ? applyGradient(filled, LEAF_THEME) : '';
      bar = `${coloredFilled}${C.dim}${empty}${C.reset}`;
    }
    log(`      ${num}${toolName}${calls}  ${bar}   ${pctText}`);
  });
  log(`    ${applyGradient('════════════════════════════════════════════════════════════════════════', LEAF_THEME)}\n`);
}

function printMcpSavingsSection() {
  if (!fileExists(DB_PATH)) {
    log(`     ${C.yellow}⚠${C.reset} Konoha MCP database not found. Run "konoha init" first.\n`);
    return;
  }
  try {
    log(`\n  ${C.bold}${applyGradient('1. ⚡ Konoha MCP Savings', LEAF_THEME)}${C.reset}`);
    const { getSavingsReport } = require('../../src/db_savings');
    const stats = getSavingsReport(DB_PATH);
    const actualBaselineKB = (stats.today.db_size_bytes ?? stats.alltime.db_size_bytes ?? (2065 * 1024)) / 1024;
    log(`     ${C.dim}Calculated relative to full context index sizing (${actualBaselineKB.toFixed(0)} KB actual baseline)${C.reset}\n`);

    if (stats.error) {
      log(`     ${C.yellow}⚠${C.reset} Database error: ${stats.error}`);
      return;
    }

    log('    ' + applyGradientToBorders('┌──────────────┬─────────┬──────────────┬────────────────────────────────────────────────────────┐', LEAF_THEME));
    log('    ' + applyGradientToBorders(`│ ${C.bold}${padEndVisual('Period', 12)}${C.reset} │ ${C.bold}${padEndVisual('Calls', 7)}${C.reset} │ ${C.bold}${padEndVisual('Bytes Saved', 12)}${C.reset} │ ${C.bold}${padEndVisual('Visual Savings (Tokens & Thought Reasoning)', 54)}${C.reset} │`, LEAF_THEME));
    log('    ' + applyGradientToBorders('├──────────────┼─────────┼──────────────┼────────────────────────────────────────────────────────┤', LEAF_THEME));
    log('    ' + applyGradientToBorders(`│ ${padEndVisual('Today', 12)} │ ${padEndVisual(stats.today.calls.toString(), 7)} │ ${padEndVisual(formatBytes(stats.today.bytes), 12)} │ ${padEndVisual(formatSavings(stats.today.tokens, stats.today.pct || 0, stats.today.thought_tokens), 54)} │`, LEAF_THEME));
    log('    ' + applyGradientToBorders(`│ ${padEndVisual('Last 7 days', 12)} │ ${padEndVisual(stats.last7days.calls.toString(), 7)} │ ${padEndVisual(formatBytes(stats.last7days.bytes), 12)} │ ${padEndVisual(formatSavings(stats.last7days.tokens, stats.last7days.pct || 0, stats.last7days.thought_tokens), 54)} │`, LEAF_THEME));
    log('    ' + applyGradientToBorders(`│ ${padEndVisual('All time', 12)} │ ${padEndVisual(stats.alltime.calls.toString(), 7)} │ ${padEndVisual(formatBytes(stats.alltime.bytes), 12)} │ ${padEndVisual(formatSavings(stats.alltime.tokens, stats.alltime.pct || 0, stats.alltime.thought_tokens), 54)} │`, LEAF_THEME));
    log('    ' + applyGradientToBorders('└──────────────┴─────────┴──────────────┴────────────────────────────────────────────────────────┘', LEAF_THEME));
    log('');

    printCallTypesTable(stats.by_call_type);

    if (stats.tiktoken_accuracy) {
      const acc = stats.tiktoken_accuracy;
      const statusColor = acc.isHealthy ? C.green : C.yellow;
      log(`    ${C.dim}Tiktoken Accuracy (cl100k_base):${C.reset} ${statusColor}${acc.empiricalBytesPerToken} bytes/token${C.reset} ${C.dim}(±${acc.divergencePct}% vs /4 heuristic, ${acc.status})${C.reset}`);
      if (acc.alertMessage) log(`    ${C.yellow}⚠ ${acc.alertMessage}${C.reset}`);
      log('');
    }

    global.skillsDbTodayCalls = stats.today.calls;
    global.skillsDbTodayTokens = stats.today.tokens;
    global.skillsDbTodayBytes = stats.today.bytes;
    global.skillsDbTodayTotalBytes = stats.today.total_bytes;
    global.skillsDbTodayPct = stats.today.pct;
    global.skillsDbTodayDbSize = stats.today.db_size_bytes;

    global.skillsDbLast7DaysCalls = stats.last7days.calls;
    global.skillsDbLast7DaysTokens = stats.last7days.tokens;
    global.skillsDbLast7DaysBytes = stats.last7days.bytes;
    global.skillsDbLast7DaysTotalBytes = stats.last7days.total_bytes;
    global.skillsDbLast7DaysPct = stats.last7days.pct;

    global.skillsDbAllTimeCalls = stats.alltime.calls;
    global.skillsDbAllTimeTokens = stats.alltime.tokens;
    global.skillsDbAllTimeBytes = stats.alltime.bytes;
    global.skillsDbAllTimeTotalBytes = stats.alltime.total_bytes;
    global.skillsDbAllTimePct = stats.alltime.pct;
  } catch (e) {
    log(`     ${C.yellow}⚠${C.reset} Could not read Konoha MCP savings: ${e.message}`);
  }
}

function parseSembleLines(lines, state) {
  const SEMBLE_REGEX = /^(Today|Last\s+7\s+days|All\s+time)\s+(\d+\.?\d*)([kKmM]?)(?:\s+(?:calls|searches?))?\s+(?:~?)(\d+\.?\d*)([kKmM]?)\s+tokens(?:\s+\((\d+)%\))?(?:.*?(\d+)%)?/i;
  for (const line of lines) {
    const cleanLine = line.replace(/\x1b\[[0-9;]*m/g, '').trim();
    if (!cleanLine) continue;
    const match = cleanLine.match(SEMBLE_REGEX);
    if (!match) continue;

    const period = match[1];
    const rawCalls = parseFloat(match[2]);
    const callUnit = (match[3] || '').toLowerCase();
    const rawTokens = parseFloat(match[4]);
    const tokenUnit = (match[5] || '').toLowerCase();
    const pct = parseInt(match[6], 10) || parseInt(match[7], 10) || 0;

    const calls = callUnit === 'm' ? Math.round(rawCalls * 1000000) : (callUnit === 'k' ? Math.round(rawCalls * 1000) : Math.round(rawCalls));
    const tokens = tokenUnit === 'm' ? Math.round(rawTokens * 1000000) : (tokenUnit === 'k' ? Math.round(rawTokens * 1000) : Math.round(rawTokens));

    if (period.startsWith('Today')) {
      state.todayCalls = calls; state.todayTokens = tokens; state.todayPct = pct;
    } else if (period.startsWith('Last')) {
      state.last7DaysCalls = calls; state.last7DaysTokens = tokens; state.last7DaysPct = pct;
    } else {
      state.allTimeCalls = calls; state.allTimeTokens = tokens; state.allTimePct = pct;
    }
  }
}

function fetchSembleSavings() {
  log(`  ${C.bold}${applyGradient('2. 🔍 Semble (Semantic Code Search) Savings', RASENGAN_THEME)}${C.reset}`);
  log(`     ${C.dim}Fetching from Semble tool cli...${C.reset}\n`);

  const state = {
    todayCalls: 0, todayTokens: 0, todayPct: 0,
    last7DaysCalls: 0, last7DaysTokens: 0, last7DaysPct: 0,
    allTimeCalls: 0, allTimeTokens: 0, allTimePct: 0
  };

  try {
    let runSemble = null;
    let sembleCmd = 'semble';
    const uvxCmd = getUvxCommand();
    if (uvxCmd !== 'uvx') {
      const companionSemble = path.join(path.dirname(uvxCmd), 'semble');
      if (fileExists(companionSemble)) sembleCmd = companionSemble;
    }
    try {
      runSemble = spawnSync(sembleCmd, ['savings'], { encoding: 'utf-8', timeout: 4000, shell: process.platform === 'win32' });
    } catch { /* non-fatal */ }

    if (!runSemble || runSemble.status !== 0 || runSemble.error) {
      runSemble = spawnSync(uvxCmd, ['semble', 'savings'], { encoding: 'utf-8', timeout: 5000, shell: process.platform === 'win32' });
    }
    if (!runSemble || runSemble.status !== 0 || runSemble.error) {
      runSemble = spawnSync(uvxCmd, ['--from', SEMBLE_PACKAGE, 'semble', 'savings'], { encoding: 'utf-8', timeout: 5000, shell: process.platform === 'win32' });
    }
    if (!runSemble || runSemble.status !== 0 || runSemble.error) {
      throw runSemble.error || new Error(runSemble.stderr || 'Semble savings query failed');
    }

    const sembleOutput = runSemble.stdout;
    log(sembleOutput.split('\n').map(l => '    ' + l).join('\n'));
    parseSembleLines(sembleOutput.split('\n'), state);
  } catch (e) {
    log(`     ${C.yellow}⚠${C.reset} Could not fetch Semble savings: ${e.message}`);
  }
  return state;
}

function printCombinedSavings(semble) {
  const combinedTodayCalls = (global.skillsDbTodayCalls || 0) + semble.todayCalls;
  const combinedTodayTokens = (global.skillsDbTodayTokens || 0) + semble.todayTokens;
  const combinedTodayBytes = (global.skillsDbTodayBytes || 0) + (semble.todayTokens * 4);

  const combinedLast7DaysCalls = (global.skillsDbLast7DaysCalls || 0) + semble.last7DaysCalls;
  const combinedLast7DaysTokens = (global.skillsDbLast7DaysTokens || 0) + semble.last7DaysTokens;
  const combinedLast7DaysBytes = (global.skillsDbLast7DaysBytes || 0) + (semble.last7DaysTokens * 4);

  const combinedAllTimeCalls = (global.skillsDbAllTimeCalls || 0) + semble.allTimeCalls;
  const combinedAllTimeTokens = (global.skillsDbAllTimeTokens || 0) + semble.allTimeTokens;
  const combinedAllTimeBytes = (global.skillsDbAllTimeBytes || 0) + (semble.allTimeTokens * 4);

  const skillsDbTodaySavedBytes = global.skillsDbTodayBytes || 0;
  const skillsDbTodayTotalBytes = global.skillsDbTodayTotalBytes || 0;
  const sembleTodaySavedBytes = semble.todayTokens * 4;
  const sembleTodayTotalBytes = (semble.todayPct > 0 && semble.todayTokens > 0)
    ? Math.round(sembleTodaySavedBytes / (semble.todayPct / 100))
    : (skillsDbTodayTotalBytes > 0 ? skillsDbTodayTotalBytes : 0);
  const combinedTodaySavedBytes = skillsDbTodaySavedBytes + sembleTodaySavedBytes;
  const combinedTodayTotalBytes = skillsDbTodayTotalBytes + (semble.todayPct > 0 ? sembleTodayTotalBytes : 0);
  const combinedTodayPct = (combinedTodayTotalBytes > 0) ? Math.round((combinedTodaySavedBytes / combinedTodayTotalBytes) * 100) : 0;

  const skillsDbLast7DaysSavedBytes = global.skillsDbLast7DaysBytes || 0;
  const skillsDbLast7DaysTotalBytes = global.skillsDbLast7DaysTotalBytes || 0;
  const sembleLast7DaysSavedBytes = semble.last7DaysTokens * 4;
  const sembleLast7DaysTotalBytes = (semble.last7DaysPct > 0 && semble.last7DaysTokens > 0)
    ? Math.round(sembleLast7DaysSavedBytes / (semble.last7DaysPct / 100))
    : (skillsDbLast7DaysTotalBytes > 0 ? skillsDbLast7DaysTotalBytes : 0);
  const combinedLast7DaysSavedBytes = skillsDbLast7DaysSavedBytes + sembleLast7DaysSavedBytes;
  const combinedLast7DaysTotalBytes = skillsDbLast7DaysTotalBytes + (semble.last7DaysPct > 0 ? sembleLast7DaysTotalBytes : 0);
  const combinedLast7DaysPct = (combinedLast7DaysTotalBytes > 0) ? Math.round((combinedLast7DaysSavedBytes / combinedLast7DaysTotalBytes) * 100) : 0;

  const skillsDbAllTimeSavedBytes = global.skillsDbAllTimeBytes || 0;
  const skillsDbAllTimeTotalBytes = global.skillsDbAllTimeTotalBytes || 0;
  const sembleAllTimeSavedBytes = semble.allTimeTokens * 4;
  const sembleAllTimeTotalBytes = (semble.allTimePct > 0 && semble.allTimeTokens > 0)
    ? Math.round(sembleAllTimeSavedBytes / (semble.allTimePct / 100))
    : (skillsDbAllTimeTotalBytes > 0 ? skillsDbAllTimeTotalBytes : 0);
  const combinedAllTimeSavedBytes = skillsDbAllTimeSavedBytes + sembleAllTimeSavedBytes;
  const combinedAllTimeTotalBytes = skillsDbAllTimeTotalBytes + (semble.allTimePct > 0 ? sembleAllTimeTotalBytes : 0);
  const combinedAllTimePct = (combinedAllTimeTotalBytes > 0) ? Math.round((combinedAllTimeSavedBytes / combinedAllTimeTotalBytes) * 100) : 0;

  header('🏆 Combined Total Savings');
  log('');

  const combinedSummaryLines = [
    `${C.bold}Today:${C.reset}        ${String(combinedTodayCalls).padStart(5)} calls   ~${C.bold}${formatTokensComb(combinedTodayTokens).padEnd(7)}${C.reset} tokens (~${C.bold}${formatBytes(combinedTodayBytes)}${C.reset} equivalent) (${C.green}${combinedTodayPct}%${C.reset})`,
    `${C.bold}Last 7 Days:${C.reset}  ${String(combinedLast7DaysCalls).padStart(5)} calls   ~${C.bold}${formatTokensComb(combinedLast7DaysTokens).padEnd(7)}${C.reset} tokens (~${C.bold}${formatBytes(combinedLast7DaysBytes)}${C.reset} equivalent) (${C.green}${combinedLast7DaysPct}%${C.reset})`,
    `${C.bold}All Time:${C.reset}     ${String(combinedAllTimeCalls).padStart(5)} calls   ~${C.bold}${formatTokensComb(combinedAllTimeTokens).padEnd(7)}${C.reset} tokens (~${C.bold}${formatBytes(combinedAllTimeBytes)}${C.reset} equivalent) (${C.green}${combinedAllTimePct}%${C.reset})`,
    '─',
    `Actual savings per query:  ${C.bold}${C.green}${combinedTodayPct > 0 ? combinedTodayPct : combinedLast7DaysPct > 0 ? combinedLast7DaysPct : combinedAllTimePct > 0 ? combinedAllTimePct : global.skillsDbTodayPct > 0 ? global.skillsDbTodayPct : global.skillsDbAllTimePct > 0 ? global.skillsDbAllTimePct : 0}${C.reset}% average per query (computed from live database metrics)`,
  ];
  drawBox('Combined Savings Metric', combinedSummaryLines, FIRE_THEME);
  log('');
}

async function cmdSavings(args = []) {
  if (args && (args.includes('help') || args.includes('--help') || args.includes('-h'))) {
    cmdSavingsHelp();
    return;
  }
  drawLogo();
  header('📊 Token Savings Report');

  printMcpSavingsSection();
  const semble = fetchSembleSavings();
  printCombinedSavings(semble);
}



module.exports = {
  cmdSavings,
  cmdSavingsHelp,
};
