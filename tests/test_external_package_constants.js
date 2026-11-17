const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const { AISLOP_PACKAGE } = require("../src/uvx_runtime");

test("AISLOP_PACKAGE is exported from uvx_runtime and no bare literals remain in production code", () => {
  assert.strictEqual(AISLOP_PACKAGE, "aislop@latest");

  const root = path.resolve(__dirname, "..");
  const prodDirs = ["src", "bin"];
  const bareSembleLiteral = /semble\[mcp\]==0\.6\.2/g;
  const bareAislopLiteral = /aislop@0\.18\.1/g;

  for (const dir of prodDirs) {
    const fullDir = path.join(root, dir);
    function scanDir(d) {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const fullPath = path.join(d, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath);
        } else if (entry.isFile() && (entry.name.endsWith(".js") || entry.name.endsWith(".json"))) {
          const content = fs.readFileSync(fullPath, "utf8");
          const smMatch = content.match(bareSembleLiteral);
          assert.strictEqual(smMatch, null, "File " + path.relative(root, fullPath) + " contains bare semble literal: " + (smMatch || []).join(", "));
          const aiMatch = content.match(bareAislopLiteral);
          assert.strictEqual(aiMatch, null, "File " + path.relative(root, fullPath) + " contains bare aislop literal: " + (aiMatch || []).join(", "));
        }
      }
    }
    scanDir(fullDir);
  }
});
