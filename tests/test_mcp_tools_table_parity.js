const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

test("Available MCP Tools configuration has zero cloudrun rows and maintains lightweight parity", () => {
  const root = path.resolve(__dirname, "..");
  const agentManagerPath = path.join(root, "src/agent_manager.js");
  const templatePath = path.join(root, "src/templates/AGENTS.md");

  const amContent = fs.readFileSync(agentManagerPath, "utf8");
  const tmContent = fs.readFileSync(templatePath, "utf8");

  // Must not have cloudrun or cloud-run in either file
  assert.doesNotMatch(amContent, /cloudrun|cloud-run/i, "src/agent_manager.js must not contain cloudrun hint");
  assert.doesNotMatch(tmContent, /cloudrun|cloud-run/i, "src/templates/AGENTS.md must not contain cloudrun hint");

  // Both must mandate konoha and semble without legacy table bloat
  assert.ok(tmContent.includes("Konoha is mandatory"), "template must mandate konoha");
  assert.ok(tmContent.includes("Semble is mandatory"), "template must mandate semble");
  assert.ok(Buffer.byteLength(tmContent, 'utf8') < 1600, "template must be lightweight (< 1.6KB)");
});
