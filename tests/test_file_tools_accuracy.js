'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { readFileRange } = require('../src/file_tools/read_file_range');
const { readFileHead } = require('../src/file_tools/read_file_head');
const { getFileStructure } = require('../src/file_tools/get_file_structure');

async function testFileToolsAccuracy() {
  console.log('Running test_file_tools_accuracy...');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'accuracy_test_'));

  try {
    const fixtureLines = [];
    for (let i = 1; i <= 300; i++) {
      fixtureLines.push(`line_${i}_content_marker_${i * 7}`);
    }
    const fixturePath = path.join(tmpDir, 'test_fixture.txt');
    fs.writeFileSync(fixturePath, fixtureLines.join('\n') + '\n', 'utf8');

    const read1 = readFileRange({
      path: fixturePath,
      start_line: 42,
      end_line: 42,
      workspace: tmpDir
    });
    assert.strictEqual(read1.line_count, 1, 'Single line read should return 1 line');
    assert(read1.text.includes('line_42_content_marker_294'), 'Should contain exact line 42 content');
    console.log('✓ Exact single-line retrieval verified');

    const readAliases = readFileRange({
      path: fixturePath,
      start: 50,
      end: 55,
      workspace: tmpDir
    });
    assert.strictEqual(readAliases.line_count, 6, 'start/end aliases should return 6 lines');
    assert(readAliases.text.includes('line_50_content_marker_350'), 'Should contain line 50');
    assert(readAliases.text.includes('line_55_content_marker_385'), 'Should contain line 55');
    console.log('✓ start/end argument aliases verified');

    const readRangeArray = readFileRange({
      path: fixturePath,
      range: [100, 105],
      workspace: tmpDir
    });
    assert.strictEqual(readRangeArray.line_count, 6, 'range: [100, 105] should return 6 lines');
    console.log('✓ Array range [start, end] parameter verified');

    const readHeadAliases = readFileHead({
      path: fixturePath,
      limit: 10,
      workspace: tmpDir
    });
    assert.strictEqual(readHeadAliases.line_count, 10, 'readFileHead limit alias should return 10 lines');
    assert.strictEqual(readHeadAliases.returned_range[0], 1, 'First line must be 1');
    assert.strictEqual(readHeadAliases.returned_range[1], 10, 'Tenth line must be 10');
    console.log('✓ readFileHead limit alias verified');

    const jsFixture = `
export class ServiceManager {
  async startService(port) {
    return true;
  }
}

export function helperFunction(a, b) {
  return a + b;
}

const arrowHandler = async (req, res) => {
  res.end();
};
`;
    const jsPath = path.join(tmpDir, 'service.js');
    fs.writeFileSync(jsPath, jsFixture.trim(), 'utf8');

    const jsStruct = getFileStructure({ path: jsPath, workspace: tmpDir });
    assert(Array.isArray(jsStruct.symbols), 'symbols must be an array');
    const symbolNames = jsStruct.symbols.map(s => s.name);
    assert(symbolNames.some(n => n.includes('class ServiceManager')), 'Must detect class ServiceManager');
    assert(symbolNames.some(n => n.includes('startService')), 'Must detect method startService');
    assert(symbolNames.some(n => n.includes('helperFunction')), 'Must detect helperFunction');
    assert(symbolNames.some(n => n.includes('arrowHandler')), 'Must detect arrowHandler');
    console.log('✓ JavaScript/TypeScript symbol extraction accuracy verified');

    const goFixture = `
package main

type ServerConfig struct {
    Port int
}

func (s *Server) Start() error {
    return nil
}

func main() {
}
`;
    const goPath = path.join(tmpDir, 'main.go');
    fs.writeFileSync(goPath, goFixture.trim(), 'utf8');

    const goStruct = getFileStructure({ path: goPath, workspace: tmpDir });
    const goNames = goStruct.symbols.map(s => s.name);
    assert(goNames.some(n => n.includes('type ServerConfig struct')), 'Must detect type ServerConfig struct');
    assert(goNames.some(n => n.includes('Start')), 'Must detect method Start');
    assert(goNames.some(n => n.includes('main')), 'Must detect func main');
    console.log('✓ Go symbol extraction accuracy verified');

    console.log('All test_file_tools_accuracy checks passed with 100% precision!');
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

if (require.main === module) {
  testFileToolsAccuracy().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { testFileToolsAccuracy };
