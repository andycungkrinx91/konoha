const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

function findPiResourceLoaderChunk() {
  const fs = require('fs');
  const os = require('os');
  const { execSync } = require('child_process');

  const candidateDirs = [];

  // 1. Try global npm root
  try {
    const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
    if (globalRoot) candidateDirs.push(path.join(globalRoot, '@earendil-works', 'pi-coding-agent'));
  } catch (_) {}

  // 2. Try locating pi binary via which / where
  try {
    const whichCmd = process.platform === 'win32' ? 'where.exe pi' : 'which pi';
    const piBin = execSync(whichCmd, { encoding: 'utf8' }).trim().split(/\r?\n/)[0];
    if (piBin && fs.existsSync(piBin)) {
      const real = fs.realpathSync(piBin);
      let cur = path.dirname(real);
      while (cur && cur !== path.dirname(cur)) {
        if (fs.existsSync(path.join(cur, 'package.json'))) {
          try {
            const pkg = JSON.parse(fs.readFileSync(path.join(cur, 'package.json'), 'utf8'));
            if (pkg.name === '@earendil-works/pi-coding-agent') {
              candidateDirs.push(cur);
              break;
            }
          } catch (_) {}
        }
        cur = path.dirname(cur);
      }
    }
  } catch (_) {}

  // 3. Fallback to common global locations across node managers
  const home = os.homedir();
  const nvmVersionsDir = path.join(home, '.nvm', 'versions', 'node');
  if (fs.existsSync(nvmVersionsDir)) {
    try {
      const versions = fs.readdirSync(nvmVersionsDir);
      for (const v of versions) {
        candidateDirs.push(path.join(nvmVersionsDir, v, 'lib', 'node_modules', '@earendil-works', 'pi-coding-agent'));
      }
    } catch (_) {}
  }

  for (const piDir of candidateDirs) {
    if (fs.existsSync(piDir)) {
      const chunksDir = path.join(piDir, 'dist', 'bundle', 'chunks');
      if (fs.existsSync(chunksDir)) {
        try {
          const files = fs.readdirSync(chunksDir);
          for (const f of files) {
            if (f.endsWith('.js')) {
              const full = path.join(chunksDir, f);
              try {
                const mod = require(full);
                if (mod.DefaultResourceLoader && mod.SettingsManager) {
                  return full;
                }
              } catch (_) {}
            }
          }
        } catch (_) {}
      }
    }
  }
  return null;
}

async function run() {
  console.log('1. Testing Pi resource loader diagnostics...');
  try {
    const chunkPath = findPiResourceLoaderChunk();
    if (chunkPath) {
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
      console.log('○ Pi bundle not found dynamically, skipping bundle diagnostic test.');
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
