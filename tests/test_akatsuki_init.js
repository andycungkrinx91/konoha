const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  initLab,
  installToolset,
  listCustomTools,
  addTool,
  removeTool,
  listKaliTools
} = require('../src/workflow/akatsuki/init.js');
const { getConnection, setupSchema } = require('../src/db.js');
const { seedKaliTools } = require('../src/db_schema.js');
const { _executeToolInternal } = require('../src/mcp/tool_dispatch.js');
const { TOOL_HANDLERS } = require('../src/file_tools_router.js');

async function runAkatsukiInitTests() {
  console.log('Running test_akatsuki_init test suite...');

  // 1. Verify listKaliTools against SQLite database
  const tmpDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'akatsuki_init_test_'));
  const testDbPath = path.join(tmpDbDir, 'test_konoha.db');

  try {
    const conn = getConnection(testDbPath);
    setupSchema(conn);
    seedKaliTools(conn);

    // Count tools in SQLite
    const row = conn.prepare('SELECT COUNT(*) as count FROM kali_tools').get();
    assert.ok(row.count >= 360, `Kali tools table must contain at least 360 cataloged tools (found ${row.count})`);

    // List all (limit 400)
    const allTools = listKaliTools({}, conn);
    assert.ok(allTools.length >= 360, `listKaliTools without filters should return all cataloged tools (found ${allTools.length})`);

    // Check structure of individual entry
    const nmap = allTools.find((t) => t.slug === 'nmap');
    assert.ok(nmap, 'nmap must be in kali catalog');
    assert.ok(nmap.id && typeof nmap.id === 'string', 'Every tool must have a unique string id');
    assert.equal(nmap.slug, 'nmap');
    assert.equal(nmap.package, 'nmap');
    assert.ok(nmap.category, 'Category must be defined');

    // Search filter
    const searchRes = listKaliTools({ search: 'sqlmap' }, conn);
    assert.ok(searchRes.length >= 1, 'Search for sqlmap should return at least 1 result');
    assert.equal(searchRes[0].slug, 'sqlmap');

    // Category filter
    const reconTools = listKaliTools({ category: 'information-gathering' }, conn);
    assert.ok(reconTools.length > 10, 'Information-gathering category should have multiple tools');
    for (const tool of reconTools) {
      assert.equal(tool.category, 'information-gathering');
    }

    // Limit filter
    const limited = listKaliTools({ limit: 5 }, conn);
    assert.equal(limited.length, 5, 'Limit option should restrict result count');

    conn.close();
    console.log('  ✓ Kali tools catalog in SQLite (360 tools, search, category, limit)');

    // 2. Mock engine test for initLab
    const commandsRun = [];
    const mockRunner = (cmd, args) => {
      commandsRun.push({ cmd, args });
      return { status: 0, stdout: '/usr/bin/' + cmd, stderr: '' };
    };

    const mockOpts = {
      runner: mockRunner,
      mockProvisionResult: { ok: true, status: 'running', network_isolated: true, engine: 'docker' },
      mockLabStatus: { running: true, exists: true, network_isolated: true, details: 'mocked' },
      mockInstallResult: { ok: true, tools_installed: ['nmap', 'sqlmap', 'httpx'], profile: 'standard' }
    };

    // Init Docker only
    const resDocker = initLab({ engines: 'docker' }, mockOpts);
    assert.equal(resDocker.ok, true);
    assert.ok(resDocker.engines.some(e => e.engine === 'docker' && e.ok));
    console.log('  ✓ initLab with mode: docker');

    // Init LXC only
    const resLxc = initLab({ engines: 'lxc' }, mockOpts);
    assert.equal(resLxc.ok, true);
    assert.ok(resLxc.engines.some(e => e.engine === 'lxc' && e.ok));
    console.log('  ✓ initLab with mode: lxc');

    // Init both
    const resBoth = initLab({ engines: 'both' }, mockOpts);
    assert.equal(resBoth.ok, true);
    assert.ok(resBoth.engines.some(e => e.engine === 'docker'));
    assert.ok(resBoth.engines.some(e => e.engine === 'lxc'));
    console.log('  ✓ initLab with mode: both');

    // Init auto when both available -> provisions both
    const resAuto = initLab({ engines: 'auto' }, {
      ...mockOpts,
      platform: 'linux'
    });
    assert.equal(resAuto.ok, true);
    assert.ok(resAuto.engines.length >= 1);
    console.log('  ✓ initLab with mode: auto provisioning available engines');

    // Init auto on Windows platform -> resolves docker
    const resDockerWin = initLab({ engines: 'auto' }, {
      ...mockOpts,
      platform: 'win32'
    });
    assert.equal(resDockerWin.ok, true);
    assert.equal(resDockerWin.engines[0].engine, 'docker');
    console.log('  ✓ initLab with mode: auto on win32 selects docker');

    // 3. Custom tools management
    const testCustomDir = path.join(tmpDbDir, 'custom_tools_env');
    const customConfigPath = path.join(testCustomDir, 'custom_tools.json');
    process.env.KONOHA_CUSTOM_TOOLS_PATH = customConfigPath;

    // Initially empty
    const initialTools = listCustomTools();
    assert.deepEqual(initialTools, {});

    // Add a custom tool
    const addRes = addTool({
      id: 'custom_fuzzer',
      binary_candidates: ['fuzzer_bin'],
      allowed_operations: ['frame_fuzzing', 'state_machine_probe'],
      required_scope: 'local_or_dev',
      timeout_ms: 15000,
      cleanup_steps: ['pkill -f fuzzer_bin || true']
    });
    assert.equal(addRes.ok, true);
    assert.equal(addRes.tool.id, 'custom_fuzzer');

    // List custom tools
    const listRes = listCustomTools();
    assert.ok(listRes.custom_fuzzer);
    assert.equal(listRes.custom_fuzzer.id, 'custom_fuzzer');

    // Verify registry picks up custom tool via KONOHA_CUSTOM_TOOLS_PATH
    const { listSupportedTools, getToolProfile } = require('../src/workflow/akatsuki/tool_registry.js');
    const supportedWithCustom = listSupportedTools({ includeCustom: true });
    assert.ok(supportedWithCustom.some(t => t.id === 'custom_fuzzer'), 'listSupportedTools must include custom_fuzzer');
    const profileCustom = getToolProfile('custom_fuzzer');
    assert.ok(profileCustom, 'getToolProfile must resolve custom_fuzzer via custom tools path');
    assert.equal(profileCustom.id, 'custom_fuzzer');

    // Remove custom tool
    const rmRes = removeTool('custom_fuzzer');
    assert.equal(rmRes.ok, true);
    assert.equal(rmRes.removed, true);
    assert.deepEqual(listCustomTools(), {});
    delete process.env.KONOHA_CUSTOM_TOOLS_PATH;
    console.log('  ✓ Custom tools lifecycle: add, list, remove');

    // 4. installToolset validation
    const installRes = installToolset('docker', 'akatsuki-lab', 'standard', {
      runner: mockRunner,
      mockInstallResult: { ok: true, tools_installed: ['nmap', 'sqlmap', 'httpx'], profile: 'standard' }
    });
    assert.ok(installRes.ok);
    assert.equal(installRes.tools_installed.length, 3);
    console.log('  ✓ installToolset translates catalog and custom tools to container package installs');

    // 5. MCP tool dispatch validation
    const mcpCatalogRaw = _executeToolInternal('akatsuki_init', { action: 'list_tools', query: 'sqlmap' });
    const mcpCatalogRes = JSON.parse(mcpCatalogRaw);
    assert.equal(mcpCatalogRes.status, 'ok');
    assert.ok(mcpCatalogRes.count >= 1);
    assert.ok(mcpCatalogRes.tools[0].id);

    const mcpStatusRaw = _executeToolInternal('akatsuki_init', { action: 'status' });
    const mcpStatusRes = JSON.parse(mcpStatusRaw);
    assert.equal(mcpStatusRes.status, 'ok');
    assert.ok(mcpStatusRes.detected_engines);

    // Verify TOOL_HANDLERS mapping
    assert.ok(TOOL_HANDLERS.akatsuki_init, 'TOOL_HANDLERS must include akatsuki_init');
    console.log('  ✓ MCP dispatch and tool handler for akatsuki_init verified');

    console.log('\nAll test_akatsuki_init tests passed successfully!');
  } finally {
    fs.rmSync(tmpDbDir, { recursive: true, force: true });
  }
}

runAkatsukiInitTests().catch((err) => {
  console.error('Test failure:', err);
  process.exit(1);
});
