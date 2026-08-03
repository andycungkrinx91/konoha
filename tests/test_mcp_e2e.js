const path = require('path');
const os = require('os');
const router = require(path.join(os.homedir(), '.konoha', 'file_tools_router.js'));
const fs = require('fs');

async function testAll() {
  console.log("=== Testing Konoha MCP Router Handlers ===");
  const tools = router.TOOL_HANDLERS;
  let passed = 0;
  let failed = 0;

  function assertTool(name, payload, validator) {
    try {
      console.log(`\nTesting [${name}]...`);
      const handler = tools[name];
      if (!handler) throw new Error(`Handler ${name} not found`);
      const result = handler(payload);
      if (result.error) throw new Error(result.error);
      validator(result);
      console.log(`✅ [${name}] Passed`);
      passed++;
    } catch (err) {
      console.error(`❌ [${name}] Failed: ${err.message}`);
      failed++;
    }
  }

  const testFile = path.join(__dirname, '../src/server.py');
  const testDir = path.join(__dirname, '../src');
  const dummyTaskDir = path.join(__dirname, '../tmp/dummy_task_dir');
  if (!fs.existsSync(dummyTaskDir)) {
    fs.mkdirSync(dummyTaskDir, { recursive: true });
    fs.writeFileSync(path.join(dummyTaskDir, 'delegate.md'), 'Build an empty svelte site.');
  }

  const universalPayload = {
    file_path: testFile,
    path: testFile,
    dir: testDir,
    lines: 10,
    start_line: 1,
    end_line: 10,
    query: 'build',
    pattern: 'build',
    task_dir: dummyTaskDir,
    name: 'sannin-skill',
    keyword: 'build',
    description: 'dummy desc',
    framework: 'nuxt',
    source_dir: testDir
  };

  const skipList = [];

  for (const toolName of Object.keys(tools)) {
    if (skipList.includes(toolName)) continue;
    assertTool(toolName, universalPayload, (res) => {
      // If a tool returns a graceful user-facing error message (like missing file, or json error), it still means the tool did not CRASH (which is a pass for ENOBUFS/runtime checks).
      // We only fail if res is strictly null/undefined or if it threw an uncaught JS/Python exception.
      if (!res) throw new Error("Empty response");
    });
  }

  console.log(`\n=== Test Complete: ${passed} Passed, ${failed} Failed ===`);
}

testAll().catch(console.error);
