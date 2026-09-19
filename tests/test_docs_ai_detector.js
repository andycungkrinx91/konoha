#!/usr/bin/env node
'use strict';

/**
 * tests/test_docs_ai_detector.js — Verifies Document AI-Fingerprint Detector (src/docs_ai_detector.js)
 * and its MCP tool integration (docs_ai_detector).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const { detectDocsAi } = require('../src/docs_ai_detector');
const { runDocsAiDetectorSync } = require('../src/mcp/docs_ai_detector');
const { executeToolSync } = require('../src/mcp/tool_dispatch');

let passed = 0;
let failed = 0;

function check(name, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('\n📄 Testing Document AI Detector (src/docs_ai_detector.js)...');

// 1. Production DOCX deliverable audit
const docxPath = path.resolve(__dirname, '..', 'docs', 'KONOHA-OVERVIEW.docx');
if (fs.existsSync(docxPath)) {
  const resDocx = detectDocsAi(docxPath);
  check('DOCX deliverable achieves score 0 (100% human)', resDocx.score === 0, `score=${resDocx.score}`);
  check('DOCX deliverable has label HUMAN_WRITTEN', resDocx.label === 'HUMAN_WRITTEN', resDocx.label);
  check('DOCX deliverable has zero watermarks', resDocx.watermark_detected === false);
  check('DOCX deliverable has 0 findings', resDocx.findings.length === 0, JSON.stringify(resDocx.findings));
}

// 2. Production PDF deliverable audit
const pdfPath = path.resolve(__dirname, '..', 'docs', 'KONOHA-OVERVIEW.pdf');
if (fs.existsSync(pdfPath)) {
  const resPdf = detectDocsAi(pdfPath);
  check('PDF deliverable achieves score 0 (100% human)', resPdf.score === 0, `score=${resPdf.score}`);
  check('PDF deliverable has label HUMAN_WRITTEN', resPdf.label === 'HUMAN_WRITTEN', resPdf.label);
  check('PDF deliverable has zero watermarks', resPdf.watermark_detected === false);
  check('PDF deliverable has 0 findings', resPdf.findings.length === 0, JSON.stringify(resPdf.findings));
}

// 3. Cliché & Buzzword Detection
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-docs-test-'));
const slopTextFile = path.join(tmpDir, 'ai_slop_sample.txt');
fs.writeFileSync(
  slopTextFile,
  'In conclusion, we must delve into the tapestry of the dynamic landscape to leverage seamless solutions and foster innovation across the realm. Furthermore, it is important to note that this is paramount.',
  'utf8'
);
const resSlop = detectDocsAi(slopTextFile);
check('Detects AI clichés in text document', resSlop.score > 0 && resSlop.findings.some((f) => f.rule === 'CLICHE-01'));

// 4. Clean human text document
const humanTextFile = path.join(tmpDir, 'human_sample.md');
fs.writeFileSync(
  humanTextFile,
  '# System Architecture\n\nPostgreSQL handles persistence. Redis handles session cache. The gateway routes requests on port 8080.\n\nLatency dropped to 12ms p99.',
  'utf8'
);
const resHuman = detectDocsAi(humanTextFile);
check('Clean human text scores 0', resHuman.score === 0);
check('Clean human text label is HUMAN_WRITTEN', resHuman.label === 'HUMAN_WRITTEN');

// 5. MCP Tool Wrapper Tests
const targetDoc = fs.existsSync(docxPath) ? docxPath : humanTextFile;
const mcpResStr = runDocsAiDetectorSync(targetDoc);
const mcpRes = JSON.parse(mcpResStr);
check('runDocsAiDetectorSync returns valid JSON with score 0', mcpRes.score === 0);

// 6. Tool Dispatch Router Integration
const dispatchResStr = executeToolSync('docs_ai_detector', { file_path: targetDoc });
const dispatchRes = JSON.parse(dispatchResStr);
check('executeToolSync(docs_ai_detector) returns score 0', dispatchRes.score === 0);

// 7. Error Handling for missing/invalid file
const errRes = detectDocsAi('/path/to/nonexistent/file.docx');
check('Handles nonexistent file gracefully', errRes.error && errRes.error.includes('File not found'));

const unsuppRes = detectDocsAi(__filename);
check('Handles unsupported extension gracefully', unsuppRes.error && unsuppRes.error.includes('Unsupported document format'));

// Cleanup
try {
  fs.rmSync(tmpDir, { recursive: true, force: true });
} catch (_) {}

console.log(`\nDocument AI Detector: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) process.exit(1);
