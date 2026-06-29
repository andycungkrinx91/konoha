// Measure each command's total runtime
const { execSync } = require('child_process');

const cmds = [
  ['agent status', 'node bin/cli.js agent status'],
  ['doctor', 'node bin/cli.js doctor'],
  ['models', 'node bin/cli.js models'],
  ['version', 'node bin/cli.js version'],
  ['help', 'node bin/cli.js help'],
  ['skill list', 'node bin/cli.js skill list'],
  ['status', 'node bin/cli.js status'],
];

for (const [name, cmd] of cmds) {
  const t0 = Date.now();
  try {
    execSync(cmd, { stdio: 'pipe', timeout: 60000 });
  } catch(e) {}
  const ms = Date.now() - t0;
  console.log(`${name.padEnd(20)} ${ms.toString().padStart(5)}ms`);
}
