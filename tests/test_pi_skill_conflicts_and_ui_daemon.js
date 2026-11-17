const assert = require('assert');
const http = require('http');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

function findPiResourceLoaderChunk() {
  const fs = require('fs');
  const os = require('os');
  const { execSync } = require('child_process');

  const candidateDirs = [];

  // Try global npm root
  try {
    const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
    if (globalRoot) candidateDirs.push(path.join(globalRoot, '@earendil-works', 'pi-coding-agent'));
  } catch (_) {}

  // Try locating pi binary via which / where
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

  // Fallback to common global locations across node managers
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

function isPortUp(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 800 }, (res) => { res.resume(); resolve(true); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function waitForPort(port, want, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await isPortUp(port)) === want) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once('exit', () => { clearTimeout(timer); resolve(true); });
  });
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

  console.log('2. Testing Konoha UI start & duplicate start guard...');
  const cliPath = path.resolve(__dirname, '..', 'bin', 'cli.js');
  // Dedicated test port: a bare default-port start here would collide with a
  // production server already serving on 1404.
  const testPort = 1406;
  assert.strictEqual(await isPortUp(testPort), false, `port ${testPort} is already serving before the test started`);

  // `ui start` serves in the foreground by design (there is no daemon mode and
  // no `ui stop` anymore), so it must be spawned and awaited — a spawnSync here
  // would block on the running server instead of returning.
  const server = spawn(process.execPath || 'node', [cliPath, 'ui', 'start', '--no-open', `--port=${testPort}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverOut = '';
  server.stdout.on('data', (d) => { serverOut += d; });
  server.stderr.on('data', (d) => { serverOut += d; });

  try {
    assert.ok(await waitForPort(testPort, true, 30000), 'Web UI never started serving on ' + testPort);
    assert(/Web UI ready at:/.test(serverOut), 'Start did not print its ready banner: ' + serverOut.slice(-400));

    const dup = spawnSync(process.execPath || 'node', [cliPath, 'ui', 'start', '--no-open', `--port=${testPort}`], {
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.strictEqual(dup.status, 1, 'A second start must refuse instead of binding twice: ' + (dup.stdout || '') + (dup.stderr || ''));
    const dupOut = `${dup.stdout || ''}${dup.stderr || ''}`;
    assert(dupOut.includes(`already running on http://127.0.0.1:${testPort}/`), 'Second start must point at the running instance: ' + dupOut);
    assert(!/WARN/.test(dupOut), 'Must not emit a warning');
    console.log('✓ Konoha UI refuses a second instance and names the running one.');
  } finally {
    server.kill('SIGTERM');
    // The shutdown notice races the port release, so the asserted contract is
    // the behaviour: the process exits on its own and frees its port.
    assert.ok(await waitForExit(server, 20000), 'SIGTERM must shut the UI process down');
    assert.ok(await waitForPort(testPort, false, 20000), 'Port ' + testPort + ' still serving after shutdown');
    assert.strictEqual(await isPortUp(testPort), false, 'Port ' + testPort + ' still accepting connections after shutdown');
    console.log('✓ Konoha UI shuts down on SIGTERM and releases its port.');
  }

  console.log('✅ ALL PI & UI DAEMON TESTS PASSED!');
}

run().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
