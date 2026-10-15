"use strict";

/**
 * bin/commands/detect.js — Website & Document AI Fingerprint Scanners.
 *
 * Commands:
 * - detect-ai: Detects AI generation artifacts on web sites and components
 * - detect-docs: Audits documents (.docx, .pdf, .xlsx, .pptx, .md) for AI signatures
 */

const { C, log, header, drawLogo } = require("../lib/format");


async function cmdDetectAiHelp() {
  log(`Usage:
  konoha detect-ai <target> [--json]

Scan a website for AI-generation fingerprints (anonymiz.com-style) and score
it 0-100. 0-20 = Human-Built band per PLAN_HUMAN_BUILT.md.

ARGUMENTS
  target    Site directory path or http(s) URL
  --json    Emit machine-readable JSON

EXAMPLES
  konoha detect-ai ./my-portfolio
  konoha detect-ai https://example.com --json
`);
}

async function cmdDetectAi(args = []) {
  if (args && (args.includes('help') || args.includes('--help') || args.includes('-h'))) {
    cmdDetectAiHelp();
    return;
  }
  const json = args.includes('--json');
  const target = args.find((a) => !a.startsWith('--'));
  if (!target) {
    cmdDetectAiHelp();
    process.exitCode = 1;
    return;
  }

  // Auto-route document deliverables (.docx, .pdf, .pptx, .xlsx, .md, .txt) directly to detect-docs
  const path = require('path');
  const ext = path.extname(target).toLowerCase();
  const DOC_EXTS = new Set(['.docx', '.pdf', '.pptx', '.xlsx', '.md', '.txt']);
  if (DOC_EXTS.has(ext)) {
    return cmdDetectDocs(args);
  }

  const { detectWebsiteAi, detectWebsiteAiAsync } = require('../../src/ai_detector');
  const result = /^https?:\/\//i.test(target)
    ? await detectWebsiteAiAsync(target)
    : detectWebsiteAi(target);

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    if (result.error) process.exitCode = 1;
    return;
  }

  drawLogo();
  header('🕵  Website AI Detector');

  if (result.error) {
    log(`  ${C.red}✗${C.reset} ${result.error}`);
    process.exitCode = 1;
    return;
  }

  const barLen = 30;
  const filled = Math.round((result.score / 100) * barLen);
  const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);
  const scoreColor = result.score <= 20 ? C.green : result.score <= 40 ? C.yellow : C.red;
  log(`\n  Target:   ${result.target} (${result.mode})`);
  log(`  Score:    ${scoreColor}${result.score}/100${C.reset}  [${scoreColor}${bar}${C.reset}]`);
  log(`  Label:    ${C.bold}${result.label}${C.reset}`);
  log(`  Verdict:  ${result.score <= 20 ? C.green + '✓' : C.red + '✗'}${C.reset} ${result.verdict}`);
  log(`  Scanned:  ${result.stats.files_scanned} files, ${(result.stats.bytes_scanned / 1024).toFixed(1)} KB in ${result.stats.elapsed_ms} ms\n`);

  if (result.findings.length === 0) {
    log(`  ${C.green}✓${C.reset} No AI fingerprints detected.`);
  } else {
    log(`  ${C.bold}Findings (${result.findings.length})${C.reset}`);
    for (const f of result.findings) {
      const sev = f.severity === 'high' ? C.red : f.severity === 'medium' ? C.yellow : C.dim;
      log(`\n   ${sev}[${f.rule}]${C.reset} ${f.title} ${C.dim}(+${f.weight})${C.reset}`);
      log(`     ${C.dim}${f.evidence}${C.reset}`);
    }
  }
  log('');
  if (result.score > 20) process.exitCode = 1;
}

async function cmdDetectDocsHelp() {
  log(`Usage:
  konoha detect-docs <file_path> [--json]

Scan a document (.docx, .pdf, .pptx, .xlsx, .md, .txt) for AI-generation fingerprints,
watermarks, automated library metadata, dark theme violations, lowercase formulas,
AI clichés, and burstiness rhythm. Scores 0-100 (0-20 = HUMAN_WRITTEN).

ARGUMENTS
  file_path   Path to document file to scan (.docx, .pdf, .pptx, .xlsx, .md, .txt)
  --json      Emit machine-readable JSON

EXAMPLES
  konoha detect-docs docs/KONOHA-OVERVIEW.docx
  konoha detect-docs docs/KONOHA-OVERVIEW.pdf --json
`);
}

async function cmdDetectDocs(args = []) {
  if (args && (args.includes('help') || args.includes('--help') || args.includes('-h'))) {
    cmdDetectDocsHelp();
    return;
  }
  const json = args.includes('--json');
  const target = args.find((a) => !a.startsWith('--'));
  if (!target) {
    cmdDetectDocsHelp();
    process.exitCode = 1;
    return;
  }

  const { detectDocsAi } = require('../../src/docs_ai_detector');
  const result = detectDocsAi(target);

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    if (result.error) process.exitCode = 1;
    return;
  }

  drawLogo();
  header('📄  Document AI Detector');

  if (result.error) {
    log(`  ${C.red}✗${C.reset} ${result.error}`);
    process.exitCode = 1;
    return;
  }

  const barLen = 30;
  const filled = Math.round((result.score / 100) * barLen);
  const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);
  const scoreColor = result.score <= 20 ? C.green : result.score <= 40 ? C.yellow : C.red;
  log(`\n  Target:       ${result.target} (${result.format.toUpperCase()})`);
  log(`  AI Score:     ${scoreColor}${result.score}/100${C.reset}  [${scoreColor}${bar}${C.reset}]`);
  log(`  Human Score:  ${C.bold}${result.human_score}%${C.reset}`);
  log(`  Label:        ${C.bold}${result.label}${C.reset}`);
  log(`  Verdict:      ${result.score <= 20 ? C.green + '✓' : C.red + '✗'}${C.reset} ${result.verdict}`);
  log(`  Watermarks:   ${result.watermark_detected ? C.red + 'Detected ✗' : C.green + 'None ✓'}${C.reset}`);
  log(`  Stats:        ${result.stats.words} words, ${result.stats.sentences} sentences, burstiness ${result.stats.burstiness} in ${result.stats.elapsed_ms} ms\n`);

  if (result.findings.length === 0) {
    log(`  ${C.green}✓${C.reset} Perfect Human Writer consistency: Zero AI fingerprints and zero watermarks.`);
  } else {
    log(`  ${C.bold}Findings (${result.findings.length})${C.reset}`);
    for (const f of result.findings) {
      const sev = f.severity === 'high' ? C.red : f.severity === 'medium' ? C.yellow : C.dim;
      log(`\n   ${sev}[${f.rule}]${C.reset} ${f.title} ${C.dim}(+${f.weight})${C.reset}`);
      log(`     ${C.dim}${f.evidence}${C.reset}`);
    }
  }
  log('');
  if (result.score > 20) process.exitCode = 1;
}



module.exports = {
  cmdDetectAi,
  cmdDetectAiHelp,
  cmdDetectDocs,
  cmdDetectDocsHelp,
};
