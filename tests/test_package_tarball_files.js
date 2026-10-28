const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

test("package.json files array excludes docs/ and preserves bin/cli.js, apps/web/build, src/templates/skills", () => {
  const root = path.resolve(__dirname, "..");
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

  // Check files array
  assert.ok(Array.isArray(pkg.files), "package.json must have files array");
  assert.strictEqual(pkg.files.includes("docs/"), false, "package.json files array must not include docs/");

  // Check repository field
  assert.ok(pkg.repository, "package.json must have repository field");
  assert.ok(pkg.repository.url, "repository.url must be set");

  // Check dry-run pack output
  const packOut = execSync("npm pack --dry-run 2>&1", { cwd: root, encoding: "utf8" });
  const docsMatches = packOut.split("\n").filter(l => l.includes(" docs/"));
  assert.strictEqual(docsMatches.length, 0, "npm pack must include 0 docs/ paths");

  // Check preserved files
  assert.ok(packOut.includes("bin/cli.js"), "npm pack must preserve bin/cli.js");
  assert.ok(packOut.includes("apps/web/build"), "npm pack must preserve apps/web/build");
  assert.ok(packOut.includes("src/templates/skills"), "npm pack must preserve src/templates/skills");
});
