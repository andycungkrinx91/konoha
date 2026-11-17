"use strict";

/**
 * bin/commands/savings.js — Token Savings Telemetry & Combined Metric Reporting.
 */

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
  padEndVisual
} = require("../lib/format");

const { fileExists } = require("../lib/prompt");

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
  if (pct === null || pct === undefined) {
    return '[' + C.dim + 'no data yet' + C.reset + ']';
  }
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
    const baselineBytes = stats.today.db_size_bytes ?? stats.alltime.db_size_bytes ?? null;
    // The measurement is real when present; never substitute a constant for it.
    const baselineText = baselineBytes ? Math.round(baselineBytes / 1024) + ' KB actual baseline' : 'baseline unavailable';
    log(`     ${C.dim}Calculated relative to full context index sizing (${baselineText})${C.reset}`);

    if (stats.error) {
      log(`     ${C.yellow}⚠${C.reset} Database error: ${stats.error}`);
      return;
    }

    log('    ' + applyGradientToBorders('┌──────────────┬─────────┬──────────────┬────────────────────────────────────────────────────────┐', LEAF_THEME));
    log('    ' + applyGradientToBorders(`│ ${C.bold}${padEndVisual('Period', 12)}${C.reset} │ ${C.bold}${padEndVisual('Calls', 7)}${C.reset} │ ${C.bold}${padEndVisual('Bytes Saved', 12)}${C.reset} │ ${C.bold}${padEndVisual('Visual Savings (Tokens & Thought Reasoning)', 54)}${C.reset} │`, LEAF_THEME));
    log('    ' + applyGradientToBorders('├──────────────┼─────────┼──────────────┼────────────────────────────────────────────────────────┤', LEAF_THEME));
    log('    ' + applyGradientToBorders(`│ ${padEndVisual('Today', 12)} │ ${padEndVisual(stats.today.calls.toString(), 7)} │ ${padEndVisual(formatBytes(stats.today.bytes), 12)} │ ${padEndVisual(formatSavings(stats.today.tokens, stats.today.pct, stats.today.thought_tokens), 54)} │`, LEAF_THEME));
    log('    ' + applyGradientToBorders(`│ ${padEndVisual('Last 7 days', 12)} │ ${padEndVisual(stats.last7days.calls.toString(), 7)} │ ${padEndVisual(formatBytes(stats.last7days.bytes), 12)} │ ${padEndVisual(formatSavings(stats.last7days.tokens, stats.last7days.pct, stats.last7days.thought_tokens), 54)} │`, LEAF_THEME));
    log('    ' + applyGradientToBorders(`│ ${padEndVisual('All time', 12)} │ ${padEndVisual(stats.alltime.calls.toString(), 7)} │ ${padEndVisual(formatBytes(stats.alltime.bytes), 12)} │ ${padEndVisual(formatSavings(stats.alltime.tokens, stats.alltime.pct, stats.alltime.thought_tokens), 54)} │`, LEAF_THEME));
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

function fmtPct(value) {
  if (value === null || value === undefined) return C.dim + 'no data' + C.reset;
  return C.green + Math.round(value) + '%' + C.reset;
}

function printCombinedSavings() {
  header('🏆 Total Savings');
  log('');

  const combinedSummaryLines = [
    `${C.bold}Today:${C.reset}       ${String(global.skillsDbTodayCalls || 0).padStart(5)} calls   ~${C.bold}${formatTokensComb(global.skillsDbTodayTokens || 0).padEnd(7)}${C.reset} tokens   ${fmtPct(global.skillsDbTodayPct)}`,
    `${C.bold}Last 7 Days:${C.reset} ${String(global.skillsDbLast7DaysCalls || 0).padStart(5)} calls   ~${C.bold}${formatTokensComb(global.skillsDbLast7DaysTokens || 0).padEnd(7)}${C.reset} tokens   ${fmtPct(global.skillsDbLast7DaysPct)}`,
    `${C.bold}All Time:${C.reset}    ${String(global.skillsDbAllTimeCalls || 0).padStart(5)} calls   ~${C.bold}${formatTokensComb(global.skillsDbAllTimeTokens || 0).padEnd(7)}${C.reset} tokens   ${fmtPct(global.skillsDbAllTimePct)}`
  ];
  drawBox('Total Savings Metric', combinedSummaryLines, FIRE_THEME);
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
  printCombinedSavings();
}

module.exports = {
  cmdSavings,
  cmdSavingsHelp,
};
