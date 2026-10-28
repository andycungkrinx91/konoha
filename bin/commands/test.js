"use strict";

/**
 * bin/commands/test.js — MCP Server & Database Verification Tests.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const { SERVER_PATH, DB_PATH, FILE_TOOLS_MCP_PATH, SRC_DIR } = require("../lib/paths");
const { C, log, info, error, success, header } = require("../lib/format");
const { fileExists } = require("../lib/prompt");


function cmdTestHelp() {
  log(`
${C.cyan}konoha test${C.reset} — Perform verification tests on the MCP server and skill database

${C.bold}USAGE${C.reset}
  konoha test

${C.bold}EXAMPLES${C.reset}
  konoha test
`);
}

function buildTestCases() {
  const buildFromSourceReq = JSON.stringify({
    jsonrpc: "2.0",
    id: 8,
    method: "tools/call",
    params: {
      name: "build_from_source",
      arguments: { name: "test_build", source_dir: 'src', framework: "nextjs" }
    }
  });

  const tests = [
    { name: 'Initialize', req: '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' },
    { name: 'List Tools', req: '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' },
    { name: 'Find Skill (genin-skill)', req: '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"find_skill","arguments":{"keyword":"genin-skill","agent":"genin"}}}' },
    { name: 'Find Skill (security)', req: '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"find_skill","arguments":{"keyword":"security","agent":"kage"}}}' },
    { name: 'List Skills', req: '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"list_skills","arguments":{"agent":"chunin"}}}' },
    { name: 'Get Skill (jonin-skill)', req: '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"get_skill","arguments":{"name":"jonin-skill","agent":"jonin"}}}' },
    { name: 'Get Skill (konoha)', req: '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"get_skill","arguments":{"name":"konoha","agent":"kage"}}}' },
    { name: 'Build from Source', req: buildFromSourceReq },
    { name: 'Build from Text', req: '{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"build_from_text","arguments":{"name":"test_build","description":"a dummy storefront","framework":"nextjs"}}}' }
  ];

  if (fileExists(FILE_TOOLS_MCP_PATH)) {
    const fileToolsInit = JSON.stringify({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: { rootPath: path.join(SRC_DIR, '..') }
    });
    let rpcId = 8;
    const addFileToolTest = (name, toolName, args) => {
      const payload = { jsonrpc: '2.0', id: rpcId++, method: toolName ? 'tools/call' : 'tools/list' };
      payload.params = toolName ? { name: toolName, arguments: args || {} } : {};
      tests.push({ name, req: JSON.stringify(payload), useNode: true, init: fileToolsInit });
    };

    addFileToolTest('File Tools List');
    addFileToolTest('Read File Head', 'read_file_head', { path: 'src/search_policy.js', max_lines: 5 });
    addFileToolTest('Read File Range', 'read_file_range', { path: 'src/search_policy.js', start_line: 1, end_line: 5 });
    const grepToolName = ['token', 'efficient', 'grep'].join('_');
    addFileToolTest('Token Efficient Grep', grepToolName, { pattern: 'search_policy', dir: 'src' });
    addFileToolTest('Get File Structure', 'get_file_structure', { path: 'src/file_tools_router.js' });
    addFileToolTest('Find Files Clean', 'find_files_clean', { pattern: '*.py', dir: 'src/file_tools' });
  }

  return tests;
}

function runTestProcess(test) {
  const inputParts = [];
  if (test.init) {
    inputParts.push(test.init);
  } else if (!test.useNode && test.name !== 'Initialize') {
    inputParts.push('{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}');
  }
  inputParts.push(test.req);
  const input = inputParts.join('\n');

  const testEnv = Object.assign({}, process.env, { KONOHA_DAEMON: 'false' });
  const targetPath = test.useNode ? FILE_TOOLS_MCP_PATH : SERVER_PATH;
  const timeout = test.useNode ? 60000 : 30000;
  return spawnSync(process.execPath, [targetPath], {
    input,
    encoding: 'utf-8',
    timeout,
    env: testEnv,
    cwd: path.join(SRC_DIR, '..')
  });
}

function printTestDetails(testName, response) {
  try {
    const content = JSON.parse(response.result.content[0].text);
    if (testName === 'Find Skill (security)') {
      info(`  Found ${content.found} results for "security"`);
      (content.results || []).forEach(r => log(`  ${C.dim}→ ${r.name} (${r.type})${C.reset}`));
    } else if (testName === 'List Skills') {
      info(`  Total indexed: ${content.total} entries`);
    } else if (testName === 'Get Skill (anbu-skill)') {
      info(`  Retrieved skill: ${content.name} (${content.byte_size} bytes)`);
    }
  } catch (_) { /* non-fatal */ }
}

function evaluateTestResult(test, run) {
  if (run.status !== 0) {
    const errText = run.error ? run.error.message + (run.stderr ? '\n' + run.stderr : '') : (run.stderr || `Exit ${run.status}`);
    error(`${test.name}: FAILED - ${errText}`);
    return false;
  }
  const lines = run.stdout.trim().split('\n').filter(Boolean);
  const response = JSON.parse(lines[lines.length - 1]);
  if (response.error) {
    error(`${test.name}: ${response.error.message}`);
    return false;
  }

  let toolError = null;
  try {
    const content = JSON.parse(response.result.content[0].text);
    if (content.error) toolError = content.error;
  } catch (_) { /* non-fatal */ }

  if (toolError) {
    error(`${test.name}: FAILED - ${toolError}`);
    return false;
  }

  success(`${test.name}: OK`);
  printTestDetails(test.name, response);
  return true;
}

async function cmdTest(args = []) {
  if (args && (args.includes('help') || args.includes('--help') || args.includes('-h'))) {
    cmdTestHelp();
    return;
  }
  header('🧪 Testing Konoha MCP Server');

  if (!fileExists(SERVER_PATH)) {
    error('Server not installed. Run "konoha init" first.');
    process.exit(1);
  }

  if (!fileExists(DB_PATH)) {
    error('Database not found. Run "konoha migrate" first.');
    process.exit(1);
  }

  const tests = buildTestCases();
  let allPassed = true;

  for (const test of tests) {
    try {
      const run = runTestProcess(test);
      if (!evaluateTestResult(test, run)) allPassed = false;
    } catch (e) {
      error(`${test.name}: FAILED - ${e.message}`);
      allPassed = false;
    }
  }

  // Run comprehensive JavaScript test suites (tests/run_all.js)
  log('');
  header('🧪 Running Full Konoha JavaScript Test Suites');
  try {
    const runAllPath = path.resolve(__dirname, '..', '..', 'tests', 'run_all.js');
    if (fs.existsSync(runAllPath)) {
      const runTest = spawnSync(process.execPath, [runAllPath], { stdio: 'inherit' });
      if (runTest.status !== 0) {
        error('Full test suite: FAILED');
        allPassed = false;
      } else {
        success('Full test suite: PASSED');
      }
    }
  } catch (e) {
    error(`Failed running JavaScript test suites: ${e.message}`);
    allPassed = false;
  }

  log('');
  if (allPassed) {
    success('All tests passed! 🎉');
  } else {
    error('Some tests failed. Check the output above.');
    process.exit(1);
  }
}



module.exports = {
  cmdTest,
  cmdTestHelp,
};
