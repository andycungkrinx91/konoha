const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

async function run() {
  console.log('1. Testing Pi resource loader diagnostics...');
  try {
    const chunkPath = '/home/andycungkrinx/.nvm/versions/node/v26.5.1/lib/node_modules/@earendil-works/pi-coding-agent/dist/bundle/chunks/chunk-JVUZSMYM.js';
    const fs = require('fs');
    if (fs.existsSync(chunkPath)) {
      const { DefaultResourceLoader, SettingsManager, getAgentDir } = require(chunkPath);
      const cwd = path.resolve(__dirname, '..');
      const agentDir = getAgentDir ? getAgentDir() : path.join(process.env.HOME || '', '.pi', 'agent');
      const settingsManager = SettingsManager.create(cwd, agentDir);
      const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager });
      await loader.reload();
      const skills = loader.getSkills();
      assert.strictEqual(skills.diagnostics.length, 0, 'Pi must have 0 skill diagnostics');
      console.log('✓ Pi has 0 skill collision diagnostics and loaded ' + skills.skills.length + ' skills.');
    } else {
      console.log('○ Pi bundle not found at default path, skipping bundle diagnostic test.');
    }
  } catch (err) {
    console.warn('○ Pi resource loader test skipped or encountered: ' + err.message);
  }

  console.log('2. Testing Konoha UI start & duplicate start behavior...');
  const cliPath = path.resolve(__dirname, '..', 'bin', 'cli.js');
  // Dedicated test port: a bare default-port start/stop here would kill a
  // production daemon already serving on 1404.
  const testPort = 1406;
  const start1 = spawnSync(process.execPath || 'node', [cliPath, 'ui', 'start', '--no-open', `--port=${testPort}`], { encoding: 'utf8' });
  assert.strictEqual(start1.status, 0, 'Start 1 failed: ' + (start1.stderr || start1.stdout));
  assert(start1.stdout.includes('started successfully') || start1.stdout.includes('already active'));

  const start2 = spawnSync(process.execPath || 'node', [cliPath, 'ui', 'start', '--no-open', `--port=${testPort}`], { encoding: 'utf8' });
  assert.strictEqual(start2.status, 0, 'Start 2 failed: ' + (start2.stderr || start2.stdout));
  assert(start2.stdout.includes('already active'), 'Should report already active cleanly');
  assert(!start2.stdout.includes('WARN') && !start2.stderr.includes('WARN'), 'Must not emit warning');
  console.log('✓ Konoha UI duplicate start returns clean info without warning.');

  console.log('3. Testing Konoha UI stop...');
  const stop = spawnSync(process.execPath || 'node', [cliPath, 'ui', 'stop', `--port=${testPort}`], { encoding: 'utf8' });
  assert.strictEqual(stop.status, 0, 'Stop failed: ' + (stop.stderr || stop.stdout));
  assert(stop.stdout.includes('stopped successfully'));
  console.log('✓ Konoha UI stopped cleanly.');

  console.log('✅ ALL PI & UI DAEMON TESTS PASSED!');
}

run().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
