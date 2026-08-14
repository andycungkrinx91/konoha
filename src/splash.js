const figlet = require('figlet');

async function runSplashScreen() {
  if (process.env.NO_ANIMATE === '1' || process.argv.includes('--no-animate') || process.env.CI === 'true') {
    return;
  }

  const logo = figlet.textSync('KONOHA', { font: 'Slant' });
  process.stdout.write(`${logo}\n`);
  process.stdout.write('  Konoha MCP Tools Orchestrator · skills, tools, and client integrations\n\n');
}

module.exports = { runSplashScreen };
