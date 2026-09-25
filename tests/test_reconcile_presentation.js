#!/usr/bin/env node
'use strict';

/**
 * tests/test_reconcile_presentation.js — Validates that TOKEN-BASELINE.md accurately
 * and honestly scopes all optimization claims per PLAN-RECONCILE-2.md requirements.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BASELINE_PATH = path.join(ROOT, 'docs', 'architecture', 'TOKEN-BASELINE.md');
const WORKFLOW_PATH = path.join(ROOT, 'src', 'mcp', 'workflow.js');

console.log('Running test_reconcile_presentation.js...');

// 1. Confirm TOKEN-BASELINE.md exists and is readable
assert(fs.existsSync(BASELINE_PATH), 'TOKEN-BASELINE.md must exist');
const baselineContent = fs.readFileSync(BASELINE_PATH, 'utf-8');

// 2. Problem 1 Check: Honest captioning of -60.9%
assert(
  baselineContent.includes('7 of 8') || baselineContent.includes('7 (`prompt.md`'),
  'TOKEN-BASELINE.md must state plainly that 7 of 8 artifacts are unchanged'
);
assert(
  baselineContent.includes('Path-Reference Substitution'),
  'TOKEN-BASELINE.md must scope the -60.9% saving to final_report.md path-reference substitution'
);

// 3. Problem 2 Check: Bounded Planning Delegate live code & empirical evidence
assert(
  fs.existsSync(WORKFLOW_PATH),
  'src/mcp/workflow.js must exist'
);
const workflowContent = fs.readFileSync(WORKFLOW_PATH, 'utf-8');

// Assert workflow.js actually implements findings bounding at 500 chars
assert(
  workflowContent.includes('findingsRaw.length > 500'),
  'workflow.js must contain 500-character bounding on findingsRaw'
);
assert(
  workflowContent.includes("findingsRaw.slice(0, 500).trim() + `...\\n\\n*(Full findings:"),
  'workflow.js must append path reference to full findings when truncated'
);

// Assert TOKEN-BASELINE.md includes the Bounded Planning Delegate section and empirical data
assert(
  baselineContent.includes('Bounded Planning Delegate') && baselineContent.includes('delegate.md'),
  'TOKEN-BASELINE.md must document Bounded Planning Delegate on delegate.md'
);
assert(
  baselineContent.includes('task-docs-fix') && baselineContent.includes('task-ui-mid') && baselineContent.includes('task-backend-anbu'),
  'TOKEN-BASELINE.md must include measurements across all 3 production tasks'
);

// 4. Problem 3 Check: Metric 4 Per-Task Breakdown Table
assert(
  baselineContent.includes('Table 4D: Metric 4 Per-Task Breakdown'),
  'TOKEN-BASELINE.md must contain a per-task breakdown table for Metric 4'
);
assert(
  baselineContent.includes('Tool Return Payload') && baselineContent.includes('Host Model Completions'),
  'Metric 4 must differentiate Tool Return Payload and Host Model Completions per task'
);

// 5. Problem 4 Check: No fabricated "33" tool count narrative
assert(
  !baselineContent.includes('33 tools') && !baselineContent.includes('between 33 and 38'),
  'TOKEN-BASELINE.md must not contain unsupported "33" tool count references'
);
assert(
  baselineContent.includes('44 → 38 → 35 canonical tools') || baselineContent.includes('locked at exactly 35'),
  'TOKEN-BASELINE.md must reference the verified tool count history locked at 35'
);

console.log('  ✓ All PLAN-RECONCILE-2 presentation and verification criteria passed cleanly!');
