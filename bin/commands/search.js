"use strict";

/**
 * bin/commands/search.js — SearXNG Multi-Source Search & Public Web Search.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const { C, log, info, warn, success, header } = require("../lib/format");


function handleSearchStatus(searxngDir) {
  header('🔍 SearXNG Multi-Source Search Status');
  const bestPath = path.join(searxngDir, 'best_instance.json');
  const instPath = path.join(searxngDir, 'instances_cache.json');
  const logPath = path.join(searxngDir, 'search.log');
  let bestInstance = null;
  let candidatesCount = 0;
  let logLines = 0;

  if (fs.existsSync(bestPath)) {
    try { bestInstance = JSON.parse(fs.readFileSync(bestPath, 'utf8')); } catch (_) { /* best-effort */ }
  }
  if (fs.existsSync(instPath)) {
    try {
      const insts = JSON.parse(fs.readFileSync(instPath, 'utf8'));
      candidatesCount = Array.isArray(insts) ? insts.length : 0;
    } catch (_) { /* best-effort */ }
  }
  if (fs.existsSync(logPath)) {
    try {
      logLines = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).length;
    } catch (_) { /* best-effort */ }
  }

  const custom = process.env.SEARXNG_URL || process.env.KONOHA_SEARXNG_URL;
  log(`  ${C.cyan}Search Chain:${C.reset}       SearXNG ➔ DuckDuckGo HTML ➔ Startpage HTML ➔ Wikipedia`);
  log(`  ${C.cyan}API Key Status:${C.reset}     ${C.green}Zero-API-Key Required${C.reset} (Public HTTPS + Fallbacks)`);
  log(`  ${C.cyan}Custom Instance:${C.reset}    ${custom ? C.green + custom : C.dim + 'None configured (using dynamic public selector)'}${C.reset}`);
  log(`  ${C.cyan}Elected Instance:${C.reset}   ${bestInstance ? C.green + bestInstance.url : C.yellow + 'Dynamic resolution on query'}${C.reset}`);
  log(`  ${C.cyan}Cached Candidates:${C.reset}  ${candidatesCount} instances from searx.space`);
  log(`  ${C.cyan}Search Log Size:${C.reset}    ${logLines} recorded queries (~/.konoha/searxng/search.log)\n`);
  log(`  ${C.dim}Tip: Run ${C.cyan}konoha search <query>${C.dim} to perform web search.${C.reset}`);
}

function handleSearchPrune(searxngDir) {
  header('🧹 Pruning SearXNG Search Cache & Logs');
  let pruned = 0;
  const files = ['best_instance.json', 'instances_cache.json', 'search.log'];
  for (const f of files) {
    const fp = path.join(searxngDir, f);
    if (fs.existsSync(fp)) {
      try { fs.unlinkSync(fp); pruned++; } catch (_) { /* best-effort */ }
    }
  }
  success(`Pruned ${pruned} SearXNG cache/log files.`);
}

function parseSearchArgs(args) {
  let numResults = 5;
  let searchDepth = 'standard';
  let jsonOutput = false;
  const queryParts = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--num=')) {
      numResults = parseInt(a.slice('--num='.length), 10);
    } else if (a === '--num' && args[i + 1]) {
      numResults = parseInt(args[++i], 10);
    } else if (a.startsWith('--depth=')) {
      searchDepth = a.slice('--depth='.length);
    } else if (a === '--depth' && args[i + 1]) {
      searchDepth = args[++i];
    } else if (a === '--json') {
      jsonOutput = true;
    } else if (!a.startsWith('-')) {
      queryParts.push(a);
    }
  }
  return { numResults, searchDepth, jsonOutput, query: queryParts.join(' ').trim() };
}

function showSearchHelp() {
  header('🔍 Konoha Multi-Source Web Search');
  log(`  ${C.yellow}Usage:${C.reset}  konoha search <query> [options]`);
  log(`  ${C.yellow}        konoha search [status|prune]`);
  log(`\n  ${C.cyan}Options:${C.reset}`);
  log(`    --num=<n>         Number of results (default: 5)`);
  log(`    --depth=<depth>   Search depth: standard | deep (default: standard)`);
  log(`    --json            Output raw JSON response`);
  log(`\n  ${C.cyan}Examples:${C.reset}`);
  log(`    konoha search "SvelteKit 5 runes tutorial"`);
  log(`    konoha search "Rust RTK token killer" --num=8`);
  log(`    konoha search status\n`);
}

function printSearchResults(result) {
  if (result.status !== 'success' || !result.results || result.results.length === 0) {
    warn('No search results found or query timed out.');
    if (result.message) log(`  ${C.dim}${result.message}${C.reset}`);
    return;
  }
  log(`\n  ${C.green}✓ Found ${result.results.length} results${C.reset} ${C.dim}via ${result.results[0]?.source || 'SearXNG'}${C.reset}\n`);
  for (const item of result.results) {
    const numBadge = `${C.cyan}[#${item.citation_id}]${C.reset}`;
    const srcBadge = `${C.magenta}[${item.source || 'Web'}]${C.reset}`;
    log(`  ${numBadge} ${C.bold}${item.title}${C.reset} ${srcBadge}`);
    log(`     ${C.blue}${item.url}${C.reset}`);
    if (item.snippet) log(`     ${C.dim}${item.snippet.replace(/\n/g, ' ')}${C.reset}`);
    log('');
  }
}

async function cmdSearch(args = []) {
  const searxngDir = path.join(os.homedir(), '.konoha', 'searxng');
  const first = args[0] || '';
  if (first === 'status') return handleSearchStatus(searxngDir);
  if (first === 'prune' || first === 'clear') return handleSearchPrune(searxngDir);

  const { numResults, searchDepth, jsonOutput, query } = parseSearchArgs(args);
  if (!query) return showSearchHelp();

  if (!jsonOutput) {
    header(`🔍 Searching: "${query}" (depth: ${searchDepth})`);
    info('Querying zero-API-key search chain (SearXNG ➔ DDG ➔ Startpage ➔ Wikipedia)...');
  }

  const { runWebSearch } = require('../../src/mcp/web_search');
  const raw = await runWebSearch(query, numResults, searchDepth, 'cli');
  let result;
  try {
    result = JSON.parse(raw);
  } catch (_) {
    result = { status: 'error', message: raw };
  }

  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  printSearchResults(result);
}



module.exports = {
  cmdSearch,
};
