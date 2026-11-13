const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// `pnpm pack` is what publishes (see .github/workflows/publish.yml), and it is
// also the only packer that reads a pnpm symlink tree once bundleDependencies is
// set: `npm pack` aborts there with "Exit handler never called", which is an npm
// defect, not a packaging failure. Assert against the tool that ships.
test("pnpm pack excludes docs/ and preserves bin/cli.js, apps/web/build, src/templates/skills, bundled cfb", () => {
  const root = path.resolve(__dirname, "..");
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

  assert.ok(Array.isArray(pkg.files), "package.json must have files array");
  assert.strictEqual(pkg.files.includes("docs/"), false, "package.json files array must not include docs/");
  assert.ok(pkg.repository && pkg.repository.url, "repository.url must be set");

  const out = execSync("pnpm pack --dry-run --json", {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  const packed = JSON.parse(out);
  const paths = packed.files.map((f) => f.path);

  assert.strictEqual(
    paths.filter((p) => p.startsWith("docs/")).length,
    0,
    "tarball must contain 0 docs/ paths"
  );

  for (const required of ["bin/cli.js", "apps/web/build", "src/templates/skills"]) {
    assert.ok(paths.some((p) => p.startsWith(required)), `tarball must preserve ${required}`);
  }

  // The patched cfb only reaches users inside the tarball: without it, or with
  // the upstream Sh33tJ5 payload, XLSX output regresses on every install.
  assert.ok(paths.some((p) => p.startsWith("node_modules/cfb/")), "tarball must bundle cfb");
  assert.strictEqual(
    paths.some((p) => p.includes("Sh33tJ5")),
    false,
    "bundled cfb must be the patched build"
  );
});