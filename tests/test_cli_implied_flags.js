const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

test("CLI and README document that embed implies --rebuild-embeddings and reinstall implies --force", () => {
  const root = path.resolve(__dirname, "..");
  const helpOut = execFileSync(process.execPath, [path.join(root, "bin/cli.js"), "--help"], { encoding: "utf8" });
  const migrateHelpOut = execFileSync(process.execPath, [path.join(root, "bin/cli.js"), "migrate", "--help"], { encoding: "utf8" });
  const initHelpOut = execFileSync(process.execPath, [path.join(root, "bin/cli.js"), "init", "--help"], { encoding: "utf8" });
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");

  // Help output checks
  assert.match(helpOut + migrateHelpOut, /embed.*implies.*--rebuild-embeddings/i, "help must document that embed implies --rebuild-embeddings");
  assert.match(helpOut + initHelpOut, /reinstall.*implies.*--force/i, "help must document that reinstall implies --force");

  // README checks
  assert.match(readme, /embed.*implies.*--rebuild-embeddings/i, "README must document that embed implies --rebuild-embeddings");
  assert.match(readme, /reinstall.*implies.*--force/i, "README must document that reinstall implies --force");
});
