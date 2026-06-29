const fs = require('fs');
const instPath = '/home/andycungkrinx/experiment/portofolio/data/konoha/bin/cli_inst.js';
let code = fs.readFileSync(instPath, 'utf-8');

const patches = [
  { find: 'function ensureAutoSetup() { const __T0 = Date.now(); const __mark = (n) => { const m = Date.now() - __T0; process.stderr.write("[T] "+n+" "+m+"ms\\n"); __T0 = Date.now(); };' },
  { find: '  // 1. Ensure the directories exist', replace: '__mark("start"); // 1. Ensure the directories exist' },
  { find: '  // 2. Copy the Python server files', replace: '__mark("dirs"); // 2. Copy the Python server files' },
  { find: '  installFileTools(true); __mark("copy_files");', replace: 'installFileTools(true); __mark("copy_files");' },
  { find: '  // 3 & 4. Configure settings.json permissions', replace: '__mark("install_filetools"); // 3 & 4. Configure settings.json permissions' },
  { find: '  autoInstallKonohaBridgeExtension(true); __mark("autoInstallBridgeExt");', replace: 'autoInstallKonohaBridgeExtension(true); __mark("autoInstallBridgeExt");' },
  { find: '  installUv(true); __mark("installUv");', replace: 'installUv(true); __mark("installUv");' },
  { find: '  registerMcp(python, true); __mark("registerMcp");', replace: 'registerMcp(python, true); __mark("registerMcp");' },
  { find: '  registerHooks(true, true); __mark("registerHooks");', replace: 'registerHooks(true, true); __mark("registerHooks");' },
  { find: '  // 5. Ensure agents.json', replace: '__mark("mcp+hooks"); // 5. Ensure agents.json' },
  { find: '  __mark("agents_json"); agentManager.regenerateAndDeploy({', replace: '__mark("agents_json"); agentManager.regenerateAndDeploy({' },
  { find: '  // 6b. Auto-configure detected MCP clients', replace: '__mark("regenerateDeploy"); // 6b. Auto-configure detected MCP clients' },
  { find: '  // 7. Silently trigger migration', replace: '__mark("cursor_claude_opencode"); // 7. Silently trigger migration' },
  { find: '  __mark("pre_migration_check"); if (!fileExists(DB_PATH)) {', replace: '__mark("pre_migration_check"); if (!fileExists(DB_PATH)) {' },
];

// Fix the __mark function
code = code.replace(
  'const __mark = (n) => { const m = Date.now() - __T0; process.stderr.write("[T] "+n+" "+m+"ms\\n"); __T0 = Date.now(); }',
  'const __mark = (n) => { process.stderr.write("[T] "+n+" "+(Date.now()-__startTime)+"ms\\n"); }'
);

let patched = code;
let miss = 0;
for (const p of patches) {
  if (patched.indexOf(p.find) === -1) { miss++; console.error('MISS:', p.find.slice(0, 60)); }
  // already applied from earlier run, skip
}
console.log('Already instrumented from earlier run.');
console.log('Running test...');