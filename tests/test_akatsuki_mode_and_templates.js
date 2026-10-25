#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  setAkatsukiMode,
  getAkatsukiMode,
  setRedTeamEnabled,
  loadAkatsukiConfig
} = require('../src/akatsuki_config');

const {
  getRequiredEngine,
  provisionLab,
  stopLab,
  DEFAULT_LAB_NAME
} = require('../src/akatsuki_lab');

const { getSkill } = require('../src/mcp/skills_retrieval');
const { findSkill } = require('../src/mcp/skills_search');

async function run() {
  console.log('Running test_akatsuki_mode_and_templates...');

  const tmpConfig = path.join(os.tmpdir(), `akatsuki_test_${Date.now()}.json`);
  const origEnv = process.env.KONOHA_AKATSUKI_CONFIG;
  process.env.KONOHA_AKATSUKI_CONFIG = tmpConfig;

  try {
    const defaultMode = getAkatsukiMode();
    assert.ok(defaultMode === 'lxc' || defaultMode === 'docker', 'Default mode must be lxc or docker');

    setAkatsukiMode('docker');
    assert.strictEqual(getAkatsukiMode(), 'docker', 'Mode must be updated to docker');

    setAkatsukiMode('lxc');
    assert.strictEqual(getAkatsukiMode(), 'lxc', 'Mode must be updated to lxc');

    assert.throws(() => {
      setAkatsukiMode('invalid_mode');
    }, /Invalid Akatsuki mode/);

    const lxcConf = path.join(__dirname, '../src/templates/akatsuki_lab/lxc/lab.conf');
    const lxcSetup = path.join(__dirname, '../src/templates/akatsuki_lab/lxc/setup.sh');
    const lxcTeardown = path.join(__dirname, '../src/templates/akatsuki_lab/lxc/teardown.sh');
    assert.ok(fs.existsSync(lxcConf), 'LXC lab.conf template must exist');
    assert.ok(fs.existsSync(lxcSetup), 'LXC setup.sh template must exist');
    assert.ok(fs.existsSync(lxcTeardown), 'LXC teardown.sh template must exist');

    const dockerFile = path.join(__dirname, '../src/templates/akatsuki_lab/docker/Dockerfile');
    const dockerSetup = path.join(__dirname, '../src/templates/akatsuki_lab/docker/setup.sh');
    const dockerTeardown = path.join(__dirname, '../src/templates/akatsuki_lab/docker/teardown.sh');
    assert.ok(fs.existsSync(dockerFile), 'Docker Dockerfile template must exist');
    assert.ok(fs.existsSync(dockerSetup), 'Docker setup.sh template must exist');
    assert.ok(fs.existsSync(dockerTeardown), 'Docker teardown.sh template must exist');

    const mockRunner = (cmd, args) => ({ status: 0, stdout: 'ok', stderr: '' });
    const provMock = provisionLab('akatsuki-lab', 'lxc', {
      mockProvisionResult: { ok: true, status: 'provisioned', lab_name: 'akatsuki-lab', engine: 'lxc' }
    });
    assert.strictEqual(provMock.ok, true);
    assert.strictEqual(provMock.lab_name, 'akatsuki-lab');

    const stopMock = stopLab('akatsuki-lab', 'lxc', {
      mockStopResult: { ok: true, status: 'stopped', lab_name: 'akatsuki-lab', engine: 'lxc' }
    });
    assert.strictEqual(stopMock.ok, true);
    assert.strictEqual(stopMock.status, 'stopped');

    const denied = JSON.parse(getSkill('akatsuki-skill', 'genin'));
    assert.ok(denied.error && denied.error.includes('Access restricted'), 'Non-akatsuki agent must be denied access to offensive skills');

    const deniedSearch = JSON.parse(findSkill('pentest-osint-recon', 5, 'jonin'));
    assert.strictEqual(deniedSearch.found, 0, 'Offensive skills must not be found by non-akatsuki agent');

    const allowed = JSON.parse(getSkill('akatsuki-skill', 'akatsuki'));
    assert.ok(!allowed.error || !allowed.error.includes('Access restricted'), 'Akatsuki agent must be permitted to access akatsuki-skill');

    console.log('✓ All Akatsuki mode, templates, and authorization checks passed!');
  } finally {
    if (origEnv) process.env.KONOHA_AKATSUKI_CONFIG = origEnv;
    else delete process.env.KONOHA_AKATSUKI_CONFIG;
    if (fs.existsSync(tmpConfig)) fs.unlinkSync(tmpConfig);
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
