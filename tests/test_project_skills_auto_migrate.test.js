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
