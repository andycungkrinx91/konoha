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

  // npm rejects a tarball the registry cannot store: konoha-mcp@2.2.22 died with
  // `413 Payload Too Large` because `files: ["assets/"]` packs from disk, so six
  // alternate ONNX exports (3.2 GB) left behind by a dtype experiment rode along.
  // They are inert regardless: resolveCacheSearchDirs() only inspects the
  // package-local transformers cache and the hub cache, never assets/models.
  assert.strictEqual(
    paths.filter((p) => p.startsWith("assets/models/")).length,
    0,
    "tarball must not ship the ONNX weights under assets/models"
  );

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

  // No patched package may ship a browser bundle. `pptxgenjs/dist/pptxgen.bundle.js` and
  // `jszip/dist/*.js` are webpack/Browserify builds whose `setImmediate` polyfill is
  // `new Function(""+e)`; Konoha loads `dist/pptxgen.cjs.js` and `jszip/lib/index.js`
  // only. A stale node_modules after a patch edit re-ships them, so assert the packed
  // artifact rather than trusting the patch file.
  for (const dead of [
    "node_modules/pptxgenjs/dist/pptxgen.bundle.js",
    "node_modules/pptxgenjs/dist/pptxgen.bundle.js.map",
    "node_modules/xlsx-populate/browser/",
    "node_modules/xlsx-populate/examples/",
    "node_modules/jszip/dist/",
  ]) {
    assert.strictEqual(
      paths.filter((p) => p.startsWith(dead)).length,
      0,
      `tarball must not ship ${dead}: dead weight carrying an eval sink`
    );
  }

  // Apache-2.0 §4(d): a NOTICE that exists in the source must ship with every
  // distribution. The tarball redistributes every bundleDependency plus its transitive
  // closure, so NOTICE must attribute each one and each must carry its own license
  // file, or the distribution reads as relicensing them under Konoha's Apache-2.0.
  assert.ok(paths.includes("NOTICE"), "tarball must ship NOTICE");
  assert.ok(paths.includes("LICENSE"), "tarball must ship LICENSE");
  const notice = fs.readFileSync(path.join(root, "NOTICE"), "utf8");
  const redistributed = [
    "@types/node", "adler-32", "cfb", "crc-32", "image-size", "immediate",
    "inherits", "jszip", "lie", "pako", "pptxgenjs", "readable-stream",
    "safe-buffer", "sax", "setimmediate", "string_decoder", "undici-types",
    "util-deprecate", "xlsx-populate",
  ];
  for (const pkg of redistributed) {
    assert.ok(notice.includes(pkg), `NOTICE must attribute redistributed package ${pkg}`);
    assert.ok(
      paths.some((p) => p.startsWith(`node_modules/${pkg}/`) && /^licen[cs]e/i.test(p.slice(p.lastIndexOf("/") + 1))),
      `node_modules/${pkg} must ship its own license file`
    );
  }
  for (const license of ["Apache-2.0", "MIT", "ISC", "BlueOak-1.0.0"]) {
    assert.ok(notice.includes(license), `NOTICE must name the ${license} license it redistributes under`);
  }
});