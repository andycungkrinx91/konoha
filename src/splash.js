const ASCII_LOGO = [
  '    __ ______  _   ______  __  _____ ',
  '   / //_/ __ \\/ | / / __ \\/ / / /   |',
  '  / ,< / / / /  |/ / / / / /_/ / /| |',
  ' / /| / /_/ / /|  / /_/ / __  / ___ |',
  '/_/ |_\\____/_/ |_/\\____/_/ /_/_/  |_|',
  ''
].join('\n');

async function runSplashScreen() {
  if (process.env.NO_ANIMATE === '1' || process.argv.includes('--no-animate') || process.env.CI === 'true') {
    return;
  }

  process.stdout.write(`${ASCII_LOGO}\n`);
  process.stdout.write('  Konoha MCP Tools Orchestrator · skills, tools, and client integrations\n\n');
}

module.exports = { runSplashScreen };
