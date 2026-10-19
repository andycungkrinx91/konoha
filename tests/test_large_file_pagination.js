// DB isolation: keep test writes out of the production ~/.konoha/konoha.db
require('./helpers/isolate_db');

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { readFileRange } = require('../src/file_tools/read_file_range');

function run() {
  const tmpDir = os.tmpdir();
  const testFile = path.join(tmpDir, `konoha_large_file_test_${Date.now()}.txt`);

  try {
    // 1. Create a 1,500-line test file
    const lineCount = 1500;
    const contentLines = [];
    for (let i = 1; i <= lineCount; i++) {
      contentLines.push(`Line ${i}: function processChunk_${i}() { return ${i * 42}; }`);
    }
    fs.writeFileSync(testFile, contentLines.join('\n') + '\n', 'utf8');

    // 2. Test auto-clamping when span > MAX_SPAN (1500 lines requested) with auto_paginate
    const clampedResult = readFileRange({
      path: testFile,
      start_line: 1,
      end_line: 1500,
      auto_paginate: true,
      workspace: tmpDir
    });

    assert.strictEqual(clampedResult.complete, false);
    assert.strictEqual(clampedResult.has_more, true);
    assert.strictEqual(clampedResult.start_line, 1);
    assert.strictEqual(clampedResult.end_line, 200);
    assert.strictEqual(clampedResult.line_count, 200);
    assert.strictEqual(clampedResult.total_lines, 1500);
    assert.deepStrictEqual(clampedResult.returned_range, [1, 200]);
    assert.deepStrictEqual(clampedResult.next_range, [201, 400]);
    assert.strictEqual(clampedResult.remaining_lines, 1300);
    assert.strictEqual(clampedResult.pagination.is_clamped, true);
    assert.strictEqual(clampedResult.pagination.chunk_size, 200);
    assert.strictEqual(clampedResult.pagination.current_page, 1);
    assert.strictEqual(clampedResult.pagination.total_pages, 8);

    // 2b. Test refusal exception when auto_paginate is false and span > 250
    assert.throws(() => {
      readFileRange({
        path: testFile,
        start_line: 1,
        end_line: 300,
        workspace: tmpDir
      });
    }, /requested span is 300 lines \(max 250\)/);

    // 3. Test pagination looping through all chunks to the end
    let currentStart = 1;
    let chunksRead = 0;
    let totalLinesRead = 0;

    while (currentStart <= lineCount) {
      const res = readFileRange({
        path: testFile,
        start_line: currentStart,
        end_line: currentStart + 199,
        workspace: tmpDir
      });
      chunksRead++;
      totalLinesRead += res.line_count;

      if (res.complete || !res.next_range) {
        break;
      }
      currentStart = res.next_range[0];
    }

    assert.strictEqual(totalLinesRead, lineCount, 'All 1,500 lines must be read cleanly via pagination');
    assert.strictEqual(chunksRead, 8, '1,500 lines in 200-line chunks must take 8 chunks');

    // 4. Test reading beyond line 1000 directly (e.g. lines 1201 to 1350)
    const upperRange = readFileRange({
      path: testFile,
      start_line: 1201,
      end_line: 1350,
      workspace: tmpDir
    });
    assert.strictEqual(upperRange.start_line, 1201);
    assert.strictEqual(upperRange.end_line, 1350);
    assert.strictEqual(upperRange.line_count, 150);
    assert.ok(upperRange.text.includes('1201|Line 1201'));
    assert.ok(upperRange.text.includes('1350|Line 1350'));

    console.log('✓ test_large_file_pagination passed');
  } finally {
    try { fs.rmSync(testFile, { force: true }); } catch (_) {}
  }
}

run();
