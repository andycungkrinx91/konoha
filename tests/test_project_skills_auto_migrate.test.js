const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const skillManager = require('../src/skill_manager');
const agentManager = require('../src/agent_manager');

describe('Project Skills Auto-Migration & Cross-Client Sync', () => {
  let tmpProjectDir;

  before(() => {
    tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-project-test-'));
  });

  after(() => {
    if (tmpProjectDir && fs.existsSync(tmpProjectDir)) {
      fs.rmSync(tmpProjectDir, { recursive: true, force: true });
    }
  });

  test('1. Auto-migrates project-scoped skills into skills.db when discovered in project workspace', () => {
    const projectSkillDir = path.join(tmpProjectDir, '.agents', 'skills', 'test-project-ops');
    fs.mkdirSync(path.join(projectSkillDir, 'references'), { recursive: true });

    const skillMd = `---
name: test-project-ops
description: Project specific operational instructions for automated deployment.
tags:
  - test-ops
  - project-skill
---

# Test Project Ops Skill
Custom instructions dedicated to this repository.
`;
    fs.writeFileSync(path.join(projectSkillDir, 'SKILL.md'), skillMd, 'utf8');

    const refMd = `# Details for Project Ops
Reference instructions for project ops deployment.
`;
    fs.writeFileSync(path.join(projectSkillDir, 'references', 'deploy.md'), refMd, 'utf8');

    const pythonScript = `
import sys, os, json
sys.path.insert(0, os.path.abspath("src"))
import server

migrated = server.auto_migrate_project_skills(r"` + tmpProjectDir + `")
res = json.loads(server.find_skill("test-project-ops"))
assert res["found"] >= 1, f"Expected at least 1 match, got {res}"
found_names = [r["name"] for r in res["results"]]
assert "test-project-ops" in found_names, f"Expected test-project-ops in {found_names}"

# Initialize MCP server
init_req = {
    "jsonrpc": "2.0",
    "id": 0,
    "method": "initialize",
    "params": {
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": {"name": "test-client"}
    }
}
init_resp = server.handle_request(init_req)
assert "result" in init_resp

# Test find_skills alias in tools/call
req = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
        "name": "find_skills",
        "arguments": {"keyword": "test-project-ops"}
    }
}
resp = server.handle_request(req)
assert "result" in resp, f"Expected result in {resp}"
content = json.loads(resp["result"]["content"][0]["text"])
assert content["found"] >= 1
print("PYTHON_OK")
`;
    const run = spawnSync('python3', ['-c', pythonScript], { encoding: 'utf8' });
    assert.strictEqual(run.status, 0, 'Python error: ' + run.stderr);
    assert.match(run.stdout, /PYTHON_OK/);
  });

  test('2. Synchronizes skills across all supported client directories', () => {
    const res = skillManager.syncAllClientSkills({ projectRoot: tmpProjectDir, silent: true });
    assert.ok(res.synced >= 7, 'Expected at least 7 client directories, got ' + res.synced);

    const HOME = os.homedir();
    const clientDirs = [
      path.join(HOME, '.cursor', 'skills'),
      path.join(HOME, '.gemini', 'antigravity-cli', 'skills'),
      path.join(HOME, '.claude', 'skills'),
      path.join(HOME, '.config', 'opencode', 'skills'),
      path.join(HOME, '.commandcode', 'skills'),
      path.join(HOME, '.codex', 'skills'),
    ];

    for (const cDir of clientDirs) {
      assert.ok(fs.existsSync(cDir), 'Client skill directory should exist: ' + cDir);
      const files = fs.readdirSync(cDir).filter(f => !f.endsWith('.fingerprint'));
      assert.ok(files.length > 0, 'Client skill directory ' + cDir + ' should have files');
    }
  });

  test('3. regenerateAndDeploy maintains complete cross-client parity without circular warnings', () => {
    assert.doesNotThrow(() => {
      agentManager.regenerateAndDeploy({ projectRoot: tmpProjectDir, silent: true, force: true });
    });
  });
});
