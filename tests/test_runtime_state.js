#!/usr/bin/env node
"use strict";

/**
 * tests/test_runtime_state.js — Regression test for runtime_state getter/setter contract (PLAN_REFACTOR.md §2).
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const runtimeStatePath = path.join(ROOT, "src", "mcp", "runtime_state.js");

async function run() {
  console.log("Running test_runtime_state tests...");

  // 1. Assert file exists
  assert.ok(fs.existsSync(runtimeStatePath), "src/mcp/runtime_state.js must exist");

  const runtimeState = require(runtimeStatePath);

  // 2. Assert WORKSPACE_ROOT and ACTIVE_CLIENT are NOT exported by value
  assert.strictEqual(
    runtimeState.WORKSPACE_ROOT,
    undefined,
    "CRITICAL: WORKSPACE_ROOT must NEVER be exported by value from runtime_state.js"
  );
  assert.strictEqual(
    runtimeState.ACTIVE_CLIENT,
    undefined,
    "CRITICAL: ACTIVE_CLIENT must NEVER be exported by value from runtime_state.js"
  );

  // 3. Verify getters and setters function correctly and dynamically
  const origRoot = runtimeState.getWorkspaceRoot();
  const origClient = runtimeState.getActiveClient();

  try {
    const testDir = path.join(ROOT, "tests");
    runtimeState.setWorkspaceRoot(testDir);
    assert.strictEqual(runtimeState.getWorkspaceRoot(), testDir, "getWorkspaceRoot must return newly set value");
    assert.ok(runtimeState.isPathVisible(path.join(testDir, "test_file.js")), "isPathVisible must dynamically recognize new workspace root");

    runtimeState.setActiveClient("test-client-suite");
    assert.strictEqual(runtimeState.getActiveClient(), "test-client-suite", "getActiveClient must return newly set value");

    const tmpPath = runtimeState.konohaTmp("test-client-suite", "sess-123");
    assert.ok(tmpPath.includes("test-client-suite"), "konohaTmp must format path with client");
    assert.ok(tmpPath.includes("sess-123"), "konohaTmp must format path with session ID");
  } finally {
    runtimeState.setWorkspaceRoot(origRoot);
    runtimeState.setActiveClient(origClient);
  }

  // 4. Section 2.3 Grep Gate: Scan src/mcp/ for forbidden destructuring of WORKSPACE_ROOT or ACTIVE_CLIENT
  const mcpDir = path.join(ROOT, "src", "mcp");
  if (fs.existsSync(mcpDir)) {
    const files = fs.readdirSync(mcpDir).filter(f => f.endsWith(".js"));
    const violations = [];
    for (const f of files) {
      const code = fs.readFileSync(path.join(mcpDir, f), "utf8");
      if (code.includes("runtime_state") && (code.includes("{ WORKSPACE_ROOT") || code.includes("{ ACTIVE_CLIENT") || code.includes("WORKSPACE_ROOT,") || code.includes("ACTIVE_CLIENT,"))) {
        violations.push(f);
      }
    }
    assert.strictEqual(
      violations.length,
      0,
      "CI GREP GATE FAILED: The following modules in src/mcp destructured WORKSPACE_ROOT or ACTIVE_CLIENT directly: " + violations.join(", ")
    );
  }

  console.log("✓ All runtime_state contract tests passed cleanly.");
}

if (require.main === module) {
  run().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { run };
