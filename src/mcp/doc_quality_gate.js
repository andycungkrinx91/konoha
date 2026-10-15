/**
 * src/mcp/doc_quality_gate.js — Tokubetsu-Jonin Document Quality Gate & Regeneration Engine.
 *
 * Enforces the mandatory < 3.0% AI detection threshold for all documentation deliverables
 * (.docx, .pdf, .pptx, .xlsx, .md, .txt) and orchestrates bounded regeneration loops.
 *
 * Invariants:
 * 1. Score strictly below 3.0% passes (score >= 3.0% strictly fails).
 * 2. Missing files, detector timeouts, or errors fail closed (never treated as a pass).
 * 3. Both overall score and sliding-window ZeroGPT risk score must be < 3.0%.
 * 4. Zero watermarks and zero dark theme violations allowed.
 * 5. Bounded retries: up to MAX_GATE_ATTEMPTS (default 3), then fails closed.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { detectDocsAi } = require('../docs_ai_detector');
const { detectWebsiteAi } = require('../ai_detector');

const MAX_GATE_ATTEMPTS = parseInt(process.env.KONOHA_DOC_GATE_MAX_ATTEMPTS || '3', 10);
const GATE_THRESHOLD = 3.0; // strictly below 3.0%

/**
 * Supported document extensions evaluated via detectDocsAi.
 */
const DOC_EXTENSIONS = new Set(['.docx', '.pdf', '.pptx', '.xlsx', '.md', '.txt']);

/**
 * Evaluates a single deliverable artifact against the < 3.0% AI-detection gate.
 *
 * @param {string} filePath - Absolute or relative path to artifact
 * @param {object} options - Evaluation options { strict?: boolean }
 * @returns {object} Evaluation outcome
 */
function evaluateDeliverable(filePath, _options = {}) {
  if (!filePath || typeof filePath !== 'string' || !filePath.trim()) {
    return {
      passed: false,
      score: 100,
      file_path: filePath || '',
      error: 'Missing required file path for deliverable evaluation',
      findings: [{ rule: 'INPUT-01', severity: 'critical', title: 'Missing file path', evidence: 'No file path provided.' }],
      remediation_hints: ['Provide a valid, existing file path.']
    };
  }

  const resolved = path.resolve(filePath.trim());
  if (!fs.existsSync(resolved)) {
    return {
      passed: false,
      score: 100,
      file_path: resolved,
      error: `File not found: ${resolved}`,
      findings: [{ rule: 'FS-01', severity: 'critical', title: 'File not found', evidence: `File does not exist on disk: ${resolved}` }],
      remediation_hints: ['Ensure artifact is written to disk before running quality gate.']
    };
  }

  const ext = path.extname(resolved).toLowerCase();
  let detectorResult = null;

  try {
    if (DOC_EXTENSIONS.has(ext)) {
      detectorResult = detectDocsAi(resolved);
    } else {
      // Fallback for code, HTML, or other assets using general website/code AI detector in file mode
      detectorResult = detectWebsiteAi(resolved, { mode: 'file' });
    }
  } catch (err) {
    return {
      passed: false,
      score: 100,
      file_path: resolved,
      error: `Detector execution failed: ${err.message}`,
      findings: [{ rule: 'DETECTOR-ERR', severity: 'critical', title: 'Detector exception', evidence: err.message }],
      remediation_hints: ['Repair detector environment or inspect corrupted file contents.']
    };
  }

  if (!detectorResult || detectorResult.error) {
    return {
      passed: false,
      score: 100,
      file_path: resolved,
      error: detectorResult ? detectorResult.error : 'Empty detector result',
      findings: [{ rule: 'DETECTOR-FAIL', severity: 'critical', title: 'Detector error', evidence: detectorResult ? detectorResult.error : 'No output' }],
      remediation_hints: ['Ensure file format is valid and readable by detector parser.']
    };
  }

  const overallScore = typeof detectorResult.score === 'number' ? detectorResult.score : 100;
  const zeroGptScore = typeof detectorResult.zerogpt_risk_score === 'number'
    ? detectorResult.zerogpt_risk_score
    : 0.0;
  const hasWatermark = Boolean(detectorResult.watermark_detected);
  const hasDarkTheme = Boolean(detectorResult.dark_theme_detected);
  const findings = Array.isArray(detectorResult.findings) ? detectorResult.findings : [];

  // Mandatory target: AI-detection score strictly below 3% (score < 3.0).
  // A score of exactly 3% is a failure.
  const isScorePass = overallScore < GATE_THRESHOLD;
  const isZeroGptPass = zeroGptScore < GATE_THRESHOLD;
  const passed = isScorePass && isZeroGptPass && !hasWatermark && !hasDarkTheme;

  // Build targeted remediation hints for the regeneration loop
  const remediationHints = [];
  if (!isScorePass) {
    remediationHints.push(`Overall AI score (${overallScore}%) exceeds strict < ${GATE_THRESHOLD}% threshold.`);
  }
  if (!isZeroGptPass) {
    remediationHints.push(`ZeroGPT sliding-window risk (${zeroGptScore}%) exceeds strict < ${GATE_THRESHOLD}% threshold. Vary paragraph sentence lengths (target CV >= 0.85) to eliminate uniform synthetic cadence.`);
  }
  if (hasWatermark) {
    remediationHints.push('Remove all embedded watermark elements or stamp text. Enterprise documents must have zero watermarks.');
  }
  if (hasDarkTheme) {
    remediationHints.push('Enforce pure light mode. Replace dark fills and dark text with pure white/pearl canvas (#FFFFFF/#F8FAFC) and medium slate text (#64748B).');
  }

  for (const f of findings) {
    if (f.rule === 'CLICHE-01') {
      remediationHints.push(`Eliminate AI clichés and buzzwords: ${f.evidence}`);
    } else if (f.rule === 'BURST-01') {
      remediationHints.push('Juxtapose punchy assertions with multi-clause analytical sentences to increase sentence burstiness.');
    } else if (f.rule === 'META-01') {
      remediationHints.push(`Scrub automated generator metadata tag (${f.evidence}).`);
    } else if (f.rule === 'FMT-01') {
      remediationHints.push(`Format spreadsheet formulas in UPPERCASE (e.g. SUM, AVERAGE): ${f.evidence}`);
    }
  }

  return {
    passed,
    score: overallScore,
    zerogpt_risk_score: zeroGptScore,
    watermark_detected: hasWatermark,
    dark_theme_detected: hasDarkTheme,
    file_path: resolved,
    target: path.basename(resolved),
    format: ext.replace('.', ''),
    label: detectorResult.label || (passed ? 'HUMAN_WRITTEN' : 'AI_DETECTED'),
    verdict: passed ? 'PASS (Strict < 3% Quality Gate)' : 'FAIL (Exceeds 3% Gate Threshold)',
    findings,
    remediation_hints: remediationHints,
    stats: detectorResult.stats || {}
  };
}

/**
 * Discovers document deliverable artifacts inside a task directory or given file list.
 *
 * @param {string} taskDir - Path to task directory
 * @param {Array<string>} specificFiles - Optional array of specific created/modified files
 * @returns {Array<string>} Array of absolute file paths to evaluate
 */
function discoverDeliverables(taskDir, specificFiles = null) {
  const candidates = new Set();

  if (Array.isArray(specificFiles) && specificFiles.length > 0) {
    for (const f of specificFiles) {
      if (typeof f === 'string' && f.trim()) {
        const resolved = path.isAbsolute(f) ? f : (taskDir ? path.resolve(taskDir, f) : path.resolve(f));
        if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
          candidates.add(resolved);
        }
      }
    }
  }

  if (taskDir && fs.existsSync(taskDir) && fs.statSync(taskDir).isDirectory()) {
    // Check standard workflow documentation output: final_docs.md
    const finalDocs = path.join(taskDir, 'final_docs.md');
    if (fs.existsSync(finalDocs)) candidates.add(finalDocs);

    // Check all files in task dir matching doc extensions
    try {
      const entries = fs.readdirSync(taskDir);
      for (const entry of entries) {
        if (entry === 'prompt.md' || entry === 'plan.md' || entry === 'delegate.md') continue;
        const ext = path.extname(entry).toLowerCase();
        if (DOC_EXTENSIONS.has(ext)) {
          const fullPath = path.join(taskDir, entry);
          if (fs.statSync(fullPath).isFile()) {
            candidates.add(fullPath);
          }
        }
      }
    } catch (_) { /* ignore readdir errors */ }
  }

  return Array.from(candidates);
}

/**
 * Runs the complete Quality Gate evaluation for Tokubetsu-Jonin deliverables.
 *
 * @param {string} taskDir - Task directory path
 * @param {object} workflowStatus - Workflow status object from status.json
 * @param {Array<string>} filesList - Optional explicit list of generated files
 * @returns {object} Quality Gate verdict and diagnostics
 */
function evaluateDeliverablesGate(taskDir, workflowStatus = {}, filesList = null) {
  const filesToDiscover = filesList || (Array.isArray(workflowStatus.deliverables) ? workflowStatus.deliverables : null);
  const deliverables = discoverDeliverables(taskDir, filesToDiscover);
  const previousAttempts = Math.max(
    workflowStatus.document_attempts || 0,
    workflowStatus.document_retry_count || 0
  );
  const currentAttempts = previousAttempts + 1;
  const maxAttempts = MAX_GATE_ATTEMPTS;

  if (deliverables.length === 0) {
    return {
      passed: false,
      status: 'blocked',
      gate_status: 'blocked',
      attempts: currentAttempts,
      max_attempts: maxAttempts,
      evaluated_files: [],
      failed_files: [],
      error: 'No document deliverables found to evaluate in task directory.',
      feedback: 'No deliverables found. Tokubetsu-Jonin must generate final_docs.md or requested document artifacts (.docx, .pdf, .pptx, .xlsx, .md).'
    };
  }

  const evaluatedFiles = [];
  const failedFiles = [];
  const remediationDirectives = [];

  for (const file of deliverables) {
    const res = evaluateDeliverable(file);
    evaluatedFiles.push(res);
    if (!res.passed) {
      failedFiles.push(res);
      remediationDirectives.push(`File "${res.target}":\n` + res.remediation_hints.map(h => `  - ${h}`).join('\n'));
    }
  }

  const allPassed = (failedFiles.length === 0);

  if (allPassed) {
    const result = {
      passed: true,
      status: 'approved',
      gate_status: 'approved',
      attempts: currentAttempts,
      max_attempts: maxAttempts,
      evaluated_files: evaluatedFiles,
      failed_files: [],
      error: null,
      feedback: `All ${evaluatedFiles.length} deliverable(s) passed the strict < 3.0% AI detection quality gate.`
    };
    workflowStatus.document_gate = result;
    return result;
  }

  // Not passed: check if retry budget is exhausted
  const isExhausted = previousAttempts >= maxAttempts || currentAttempts > maxAttempts;
  const fontDirectives = (
    '\n\nMandatory Konoha Font System Directives:\n' +
    '- Cover: Inter Display / Inter Bold\n' +
    '- Headings: Inter SemiBold / Inter Bold\n' +
    '- Content / Body: Inter Regular (~10.5–11 pt for A4)\n' +
    '- Footer / Metadata: Inter Regular / Medium (~8–9 pt, neutral #64748B)\n' +
    '- Technical / Code: JetBrains Mono\n' +
    '- Cover Layout: Reference chromatic mesh card (assets/cover-reference.jpg), 0 dark fills\n'
  );
  const feedbackMessage = (isExhausted
    ? `Tokubetsu-Jonin Quality Gate EXHAUSTED after ${previousAttempts}/${maxAttempts} attempts.\nBlockers:\n` + remediationDirectives.join('\n')
    : `Tokubetsu-Jonin Quality Gate FAILED (Attempt ${currentAttempts}/${maxAttempts}). Regeneration required.\nDiagnostic Directives:\n` + remediationDirectives.join('\n')) + fontDirectives;

  if (isExhausted) {
    workflowStatus.phase = 'failed';
  }
  workflowStatus.document_attempts = currentAttempts;
  workflowStatus.document_retry_count = currentAttempts;

  const result = {
    passed: false,
    status: isExhausted ? 'failed' : 'regenerate',
    gate_status: isExhausted ? 'exhausted' : 'regenerate',
    attempts: currentAttempts,
    max_attempts: maxAttempts,
    evaluated_files: evaluatedFiles,
    failed_files: failedFiles,
    error: isExhausted ? 'Retry budget exhausted without meeting < 3.0% threshold' : 'Deliverables failed AI threshold (< 3.0%)',
    feedback: feedbackMessage
  };
  workflowStatus.document_gate = result;
  return result;
}

const THRESHOLDS = {
  MAX_SCORE: GATE_THRESHOLD,
  MAX_ZEROGPT_RISK: GATE_THRESHOLD,
  MAX_RETRIES: MAX_GATE_ATTEMPTS
};

module.exports = {
  MAX_GATE_ATTEMPTS,
  GATE_THRESHOLD,
  THRESHOLDS,
  DOC_EXTENSIONS,
  evaluateDeliverable,
  discoverDeliverables,
  evaluateDeliverablesGate
};
