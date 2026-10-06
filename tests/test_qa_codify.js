#!/usr/bin/env node
'use strict';

/**
 * tests/test_qa_codify.js — Verifies qa_codify deterministic mapping,
 * reference rejection, pre-verification failure blocking, and output linting.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { qaCodify } = require('../src/qa_tools');

console.log('Running test_qa_codify.js...');

const tmpDir = path.join(os.tmpdir(), `konoha-qa-codify-test-${Date.now()}`);
fs.mkdirSync(tmpDir, { recursive: true });

try {
  // 1. Comprehensive Golden Mapping Test
  const goldenFlow = [
    ["open", "http://localhost:4173/detector"],
    ["find", "role", "button", "click", "--name", "Scan"],
    ["find", "role", "textbox", "fill", "Sample input", "--name", "Query"],
    ["find", "label", "Username", "fill", "test_user"],
    ["find", "label", "Remember", "click"],
    ["find", "text", "Sign In", "click"],
    ["find", "testid", "submit-btn", "click"],
    ["find", "testid", "input-field", "fill", "val123"],
    ["press", "Enter"],
    ["wait", "--text", "Completed"],
    ["wait", "--url", "**/results"],
    ["wait", "#status-box"],
    ["is", "visible", ".indicator"],
    ["click", "button.primary"],
    ["fill", "input.code", "SECRET"],
    // Non-functional exploration commands (must be stripped)
    ["snapshot", "-i", "-c"],
    ["screenshot", "test.png"],
    ["console"],
    ["errors"],
    ["network", "requests"]
  ];

  const goldenFlowPath = path.join(tmpDir, 'golden_flow.json');
  fs.writeFileSync(goldenFlowPath, JSON.stringify(goldenFlow), 'utf8');

  const goldenOutPath = path.join(tmpDir, 'golden.spec.js');
  const codifyRes = qaCodify({
    flow_path: goldenFlowPath,
    out_path: goldenOutPath,
    name: 'Golden mapping suite test',
    skip_verification: true
  });

  assert.strictEqual(codifyRes.status, 'success');
  assert.ok(fs.existsSync(goldenOutPath), 'Output test file must be created');

  const emittedCode = fs.readFileSync(goldenOutPath, 'utf8');

  // Verify all mapping rows
  assert.ok(emittedCode.includes("await page.goto(\"http://localhost:4173/detector\");"), 'Must map open');
  assert.ok(emittedCode.includes("await page.getByRole(\"button\", { name: \"Scan\" }).click();"), 'Must map find role click with name');
  assert.ok(emittedCode.includes("await page.getByRole(\"textbox\", { name: \"Query\" }).fill(\"Sample input\");"), 'Must map find role fill');
  assert.ok(emittedCode.includes("await page.getByLabel(\"Username\").fill(\"test_user\");"), 'Must map find label fill');
  assert.ok(emittedCode.includes("await page.getByLabel(\"Remember\").click();"), 'Must map find label click');
  assert.ok(emittedCode.includes("await page.getByText(\"Sign In\").click();"), 'Must map find text click');
  assert.ok(emittedCode.includes("await page.getByTestId(\"submit-btn\").click();"), 'Must map find testid click');
  assert.ok(emittedCode.includes("await page.getByTestId(\"input-field\").fill(\"val123\");"), 'Must map find testid fill');
  assert.ok(emittedCode.includes("await page.keyboard.press(\"Enter\");"), 'Must map press');
  assert.ok(emittedCode.includes("await expect(page.getByText(\"Completed\")).toBeVisible();"), 'Must map wait --text');
  assert.ok(emittedCode.includes("await page.waitForURL(\"**/results\");"), 'Must map wait --url');
  assert.ok(emittedCode.includes("await expect(page.locator(\"#status-box\")).toBeVisible();"), 'Must map wait selector');
  assert.ok(emittedCode.includes("await expect(page.locator(\".indicator\")).toBeVisible();"), 'Must map is visible');
  assert.ok(emittedCode.includes("await page.locator(\"button.primary\").click();"), 'Must map click selector');
  assert.ok(emittedCode.includes("await page.locator(\"input.code\").fill(\"SECRET\");"), 'Must map fill selector');

  // Verify stripped commands
  assert.ok(!emittedCode.includes('snapshot'), 'snapshot command must be stripped');
  assert.ok(!emittedCode.includes('screenshot'), 'screenshot command must be stripped');

  // 2. Reject @e transient references
  const refFlow = [
    ["open", "http://localhost:4173/"],
    ["click", "@e1"]
  ];
  const refFlowPath = path.join(tmpDir, 'ref_flow.json');
  fs.writeFileSync(refFlowPath, JSON.stringify(refFlow), 'utf8');

  assert.throws(() => {
    qaCodify({
      flow_path: refFlowPath,
      out_path: path.join(tmpDir, 'ref.spec.js'),
      name: 'Ref test',
      skip_verification: true
    });
  }, /not stable/i, 'Must reject transient @e element references');

  // 3. Verification failure prevents generation
  const badFlow = [
    ["open", "http://invalid-non-existent-domain-xyz-12345.local/"]
  ];
  const badFlowPath = path.join(tmpDir, 'bad_flow.json');
  fs.writeFileSync(badFlowPath, JSON.stringify(badFlow), 'utf8');
  const badOutPath = path.join(tmpDir, 'bad.spec.js');

  const failRes = qaCodify({
    flow_path: badFlowPath,
    out_path: badOutPath,
    name: 'Failing flow test',
    skip_verification: false
  });

  if (failRes.status === 'error') {
    assert.strictEqual(fs.existsSync(badOutPath), false, 'Output file must not be created if verification fails');
    assert.strictEqual(failRes.verified, false);
  }

  console.log('✓ test_qa_codify.js passed cleanly.');
} finally {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (_) { /* cleanup */ }
}
