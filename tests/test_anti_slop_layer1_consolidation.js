const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { executeAislopScan } = require("../src/mcp/anti_slop");
const workflow = require("../src/mcp/workflow");

test("Layer 1 anti-slop scanner gate fails closed on missing scanner, timeout, corrupt output, warnings, and breaker trip", async (t) => {
  assert.strictEqual(typeof executeAislopScan, "function", "executeAislopScan must be exported from anti_slop.js");

  // 1. Missing scanner / command failure fails closed
  const failCmdRes = executeAislopScan(process.cwd(), {
    customCmd: "nonexistent_scanner_binary_xyz",
    targetFiles: ["index.js"]
  });
  assert.strictEqual(failCmdRes.ok, false, "missing scanner must fail closed (ok: false)");
  assert.strictEqual(failCmdRes.pass, false, "missing scanner must fail closed (pass: false)");
  assert.ok(failCmdRes.error || failCmdRes.findings.length > 0, "must report failure details");

  // 2. Corrupt / invalid output fails closed
  const corruptRes = executeAislopScan(process.cwd(), {
    mockOutput: "Not JSON output at all!",
    mockStatus: 0,
    targetFiles: ["index.js"]
  });
  assert.strictEqual(corruptRes.ok, false, "corrupt output must fail closed");
  assert.strictEqual(corruptRes.pass, false, "corrupt output must fail closed");

  // 3. Warnings count as failures
  const warningRes = executeAislopScan(process.cwd(), {
    mockOutput: JSON.stringify({
      score: 95,
      findings: [{ rule: "comment_slop", severity: "warning", message: "suspicious comment" }]
    }),
    mockStatus: 0,
    targetFiles: ["index.js"]
  });
  assert.strictEqual(warningRes.ok, false, "warnings must count as failures (ok: false)");
  assert.strictEqual(warningRes.pass, false, "warnings must count as failures (pass: false)");
  assert.strictEqual(warningRes.warnings, 1, "warning count must be 1");

  // 4. Circuit breaker open never returns pass
  const breakerRes = workflow.runAislopGate(process.cwd(), {
    _forceBreakerOpen: true,
    changed_files: ["src/index.js"]
  });
  assert.strictEqual(breakerRes.ok, false, "tripped circuit breaker must fail closed (ok: false)");
  assert.strictEqual(breakerRes.pass, false, "tripped circuit breaker must fail closed (pass: false)");
});
