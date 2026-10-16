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

  const tempTestDir = '';
  const buildFromSourceDir = 'src';
  const buildFromSourceReq = JSON.stringify({
    jsonrpc: "2.0",
    id: 8,
    method: "tools/call",
    params: {
      name: "build_from_source",
      arguments: {
        name: "test_build",
        source_dir: buildFromSourceDir,
        framework: "nextjs"
      }
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
      if (toolName) {
        payload.params = { name: toolName, arguments: args || {} };
      } else {
        payload.params = {};
      }
      tests.push({
        name,
        req: JSON.stringify(payload),
        useNode: true,
        init: fileToolsInit
      });
    };

    addFileToolTest('File Tools List');
    addFileToolTest('Read File Head', 'read_file_head', { path: 'src/search_policy.js', max_lines: 5 });
    addFileToolTest('Read File Range', 'read_file_range', { path: 'src/search_policy.js', start_line: 1, end_line: 5 });
    const grepToolName = ['token', 'efficient', 'grep'].join('_');
    addFileToolTest('Token Efficient Grep', grepToolName, { pattern: 'search_policy', dir: 'src' });
    addFileToolTest('Get File Structure', 'get_file_structure', { path: 'src/file_tools_router.js' });
    addFileToolTest('Find Files Clean', 'find_files_clean', { pattern: '*.py', dir: 'src/file_tools' });
  }

  let allPassed = true;

  try {
    for (const test of tests) {
      try {
        const inputParts = [];
        if (test.init) {
          inputParts.push(test.init);
        } else if (!test.useNode && test.name !== 'Initialize') {
          inputParts.push('{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}');
        }
        inputParts.push(test.req);
        const input = inputParts.join('\n');

        const testEnv = Object.assign({}, process.env);
        for (const k of Object.keys(testEnv)) {
          if (k.toUpperCase() === 'KONOHA_DAEMON') {
            delete testEnv[k];
          }
        }
        testEnv.KONOHA_DAEMON = 'false';

        const run = test.useNode
          ? spawnSync(process.execPath, [FILE_TOOLS_MCP_PATH], {
              input,
              encoding: 'utf-8',
              timeout: 60000,
              env: testEnv,
              cwd: path.join(SRC_DIR, '..')
            })
          : spawnSync(process.execPath, [SERVER_PATH], {
              input,
              encoding: 'utf-8',
              timeout: 30000,
              env: testEnv,
              cwd: path.join(SRC_DIR, '..')
            });
        if (run.status !== 0) {
          if (run.error) {
            throw new Error(run.error.message + (run.stderr ? '\n' + run.stderr : ''));
          }
          throw new Error(run.stderr || `Execution failed with exit code ${run.status}`);
        }
        const lines = run.stdout.trim().split('\n').filter(Boolean);
        const response = JSON.parse(lines[lines.length - 1]);
        if (response.error) {
          error(`${test.name}: ${response.error.message}`);
          allPassed = false;
        } else {
          // Parse tool content response to check for tool-level errors
          let toolError = null;
          try {
            const content = JSON.parse(response.result.content[0].text);
            if (content.error) {
              toolError = content.error;
            }
          } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }

          if (toolError) {
            error(`${test.name}: FAILED - ${toolError}`);
            allPassed = false;
          } else {
            success(`${test.name}: OK`);

            // Show extra info for specific tests
            if (test.name === 'Find Skill (security)') {
              try {
                const content = JSON.parse(response.result.content[0].text);
                info(`  Found ${content.found} results for "security"`);
                if (content.results) {
                  content.results.forEach(r => {
                    log(`  ${C.dim}→ ${r.name} (${r.type})${C.reset}`);
                  });
                }
              } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
            }

            if (test.name === 'List Skills') {
              try {
                const content = JSON.parse(response.result.content[0].text);
                info(`  Total indexed: ${content.total} entries`);
              } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
            }

            if (test.name === 'Get Skill (anbu-skill)') {
              try {
                const content = JSON.parse(response.result.content[0].text);
                info(`  Retrieved skill: ${content.name} (${content.byte_size} bytes)`);
              } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
            }
          }
        }
      } catch (e) {
        error(`${test.name}: FAILED - ${e.message}`);
        allPassed = false;
      }
    }
  } finally {
    if (tempTestDir) {
      try {
        fs.rmSync(tempTestDir, { recursive: true, force: true });
      } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
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
