const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { SEMBLE_PACKAGE } = require("../src/semble_manager");

function extractMcpTable(content) {
  const marker = "## Available MCP Tools";
  const start = content.indexOf(marker);
  if (start === -1) return "";
  const lines = content.slice(start).split("\n");
  const tableLines = lines.filter(l => l.trim().startsWith("|"));
  return tableLines.join("\n").split("\\\`").join("`");
}

test("Available MCP Tools table has zero cloudrun rows and maintains strict parity between agent_manager and AGENTS.md template", () => {
  const root = path.resolve(__dirname, "..");
  const agentManagerPath = path.join(root, "src/agent_manager.js");
  const templatePath = path.join(root, "src/templates/AGENTS.md");

  const amContent = fs.readFileSync(agentManagerPath, "utf8");
  const tmContent = fs.readFileSync(templatePath, "utf8");

  // Must not have cloudrun or cloud-run in either file
  assert.doesNotMatch(amContent, /cloudrun|cloud-run/i, "src/agent_manager.js must not contain cloudrun hint");
  assert.doesNotMatch(tmContent, /cloudrun|cloud-run/i, "src/templates/AGENTS.md must not contain cloudrun hint");

  // Both tables must have identical rows
  const amTable = extractMcpTable(amContent).replace(/\${SEMBLE_PACKAGE}/g, SEMBLE_PACKAGE);
  const tmTable = extractMcpTable(tmContent);

  assert.strictEqual(amTable, tmTable, "Available MCP Tools table must maintain strict parity between agent_manager.js and templates/AGENTS.md");
  assert.ok(amTable.includes("semble"), "table must include semble");
  assert.ok(amTable.includes("konoha"), "table must include konoha");
});
