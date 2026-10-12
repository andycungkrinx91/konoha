const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { readFileRange } = require("../src/file_tools/read_file_range");
const { readFileHead } = require("../src/file_tools/read_file_head");
const { getFileStructure } = require("../src/file_tools/get_file_structure");

test("Bounded file tools completeness: metadata, 15,000-line fixture reading without gaps/overlaps, and get_file_structure pagination", () => {
  const tmpDir = path.join(os.tmpdir(), "konoha-file-tools-test-" + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });

  // 1. Create a 15,000-line fixture
  const fixturePath = path.join(tmpDir, "giant_fixture.js");
  const lines = [];
  for (let i = 1; i <= 15000; i++) {
    if (i % 30 === 1) {
      lines.push(`function func_${i}() { return ${i}; }`);
    } else {
      lines.push(`  const val_${i} = ${i};`);
    }
  }
  fs.writeFileSync(fixturePath, lines.join("\n"), "utf8");

  // 2. Test reading the entire 15,000-line fixture by following next_range
  let currentStart = 1;
  let currentEnd = 250;
  let collectedLineCount = 0;
  let calls = 0;
  let prevEnd = 0;

  while (currentStart <= 15000) {
    calls++;
    const res = readFileRange({
      path: fixturePath,
      start_line: currentStart,
      end_line: currentEnd,
      workspace: tmpDir
    });

    // Check required completeness fields
    assert.ok("total_lines" in res, "response must include total_lines");
    assert.strictEqual(res.total_lines, 15000, "total_lines must be 15000");
    assert.ok("returned_range" in res, "response must include returned_range");
    assert.ok("complete" in res, "response must include complete");
    assert.ok("next_range" in res, "response must include next_range");
    assert.ok("remaining_lines" in res, "response must include remaining_lines");

    assert.strictEqual(res.returned_range[0], currentStart, "returned_range start must match currentStart");
    assert.strictEqual(res.returned_range[1], currentEnd, "returned_range end must match currentEnd");

    // No gap check: currentStart must be prevEnd + 1
    assert.strictEqual(currentStart, prevEnd + 1, "no gaps between reads");
    prevEnd = currentEnd;

    collectedLineCount += res.line_count;

    if (res.complete) {
      assert.strictEqual(res.next_range, null, "next_range must be null when complete is true");
      assert.strictEqual(res.remaining_lines, 0, "remaining_lines must be 0 when complete");
      break;
    } else {
      assert.ok(Array.isArray(res.next_range), "next_range must be an array when not complete");
      assert.strictEqual(res.next_range[0], currentEnd + 1, "next_range[0] must follow immediately with no gap");
      assert.strictEqual(res.remaining_lines, 15000 - currentEnd, "remaining_lines must equal remaining");
      currentStart = res.next_range[0];
      currentEnd = res.next_range[1];
    }
  }

  assert.strictEqual(collectedLineCount, 15000, "must collect exactly 15,000 lines with zero gap or overlap");
  assert.strictEqual(calls, 60, "must take exactly 60 calls of 250 lines to read 15,000 lines");

  // 3. Test readFileHead metadata
  const headRes = readFileHead({ path: fixturePath, max_lines: 50, workspace: tmpDir });
  assert.strictEqual(headRes.total_lines, 15000);
  assert.deepStrictEqual(headRes.returned_range, [1, 50]);
  assert.strictEqual(headRes.complete, false);
  assert.strictEqual(headRes.remaining_lines, 14950);
  assert.deepStrictEqual(headRes.next_range, [51, 100]);

  // 4. Test getFileStructure pagination & truncation notice
  const structPage1 = getFileStructure({ path: fixturePath, page: 1, limit: 100, workspace: tmpDir });
  assert.ok(structPage1.total_symbols >= 500, "fixture has 500 functions");
  assert.strictEqual(structPage1.page, 1);
  assert.strictEqual(structPage1.complete, false);
  assert.ok(structPage1.truncation_notice, "must include explicit truncation notice");
  assert.match(structPage1.truncation_notice, /truncation notice/i);

  // 5. Check manifest descriptions
  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../src/mcp_tool_manifest.json"), "utf8"));
  const toolNames = ["read_file_range", "get_file_structure", "read_file_head"];
  for (const name of toolNames) {
    const tool = manifest.tools.find(t => t.name === name);
    assert.ok(tool, "manifest must define " + name);
    assert.match(tool.description, /use the outline first for large files/i, name + " description must guide outline usage");
    assert.match(tool.description, /read ranges aligned to symbols/i, name + " description must guide symbol-aligned reads");
    assert.match(tool.description, /never re-read overlapping ranges/i, name + " description must discourage overlapping reads");
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
