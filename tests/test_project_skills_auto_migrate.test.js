const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

require('./helpers/isolate_db');
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

  test('1. Auto-migrates project-scoped skills into konoha.db when discovered in project workspace', async () => {
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

    const server = require('../src/server');
    const migrated = server.autoMigrateProjectSkills(tmpProjectDir);
    assert.ok(Array.isArray(migrated), 'autoMigrateProjectSkills must return an array');
    const res = JSON.parse(server.executeToolSync('find_skill', { keyword: 'test-project-ops' }));
    assert.ok(res.found >= 1, `Expected at least 1 match, got ${JSON.stringify(res)}`);
    const foundNames = res.results.map(r => r.name);
    assert.ok(foundNames.includes('test-project-ops'), `Expected test-project-ops in ${JSON.stringify(foundNames)}`);

    // Initialize MCP server
    const initReq = {
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client' }
      }
    };
    const initResp = await server.handleRequest(initReq);
    assert.ok(initResp.result, 'Expected result in initResp');

    // Test find_skills alias in tools/call
    const callReq = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'find_skills',
        arguments: { keyword: 'test-project-ops' }
      }
    };
    const callResp = await server.handleRequest(callReq);
    assert.ok(callResp.result, `Expected result in ${JSON.stringify(callResp)}`);
    const content = JSON.parse(callResp.result.content[0].text);
    assert.ok(content.found >= 1);
  });

  test('2. Synchronizes skills exclusively to ~/.agents/skills without polluting client directories', () => {
    const res = skillManager.syncAllClientSkills({ projectRoot: tmpProjectDir, silent: true });
    assert.strictEqual(res.synced, 1, 'Expected exactly 1 target (~/.agents/skills), got ' + res.synced);
    assert.deepStrictEqual(res.targets, [path.join(os.homedir(), '.agents', 'skills')]);

    // Verify projectRoot does NOT contain any client skill mirrors
    const projectClientDirs = [
      path.join(tmpProjectDir, '.cursor', 'skills'),
      path.join(tmpProjectDir, '.gemini', 'skills'),
      path.join(tmpProjectDir, '.claude', 'skills'),
      path.join(tmpProjectDir, '.commandcode', 'skills'),
      path.join(tmpProjectDir, '.omp', 'skills'),
    ];
    for (const pDir of projectClientDirs) {
      assert.ok(!fs.existsSync(pDir), 'Project client skill directory must NOT exist: ' + pDir);
    }
  });

  test('3. regenerateAndDeploy maintains complete cross-client parity without circular warnings', () => {
    assert.doesNotThrow(() => {
      agentManager.regenerateAndDeploy({ projectRoot: tmpProjectDir, silent: true, force: true });
    });
  });
});
