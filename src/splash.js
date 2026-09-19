let figlet = null;
try {
  figlet = require('figlet');
} catch (_) { /* optional best-effort fallback */ }

async function runSplashScreen() {
  if (process.env.NO_ANIMATE === '1' || process.argv.includes('--no-animate') || process.env.CI === 'true') {
    return;
  }

  if (figlet && typeof figlet.textSync === 'function') {
    try {
      const logo = figlet.textSync('KONOHA', { font: 'Slant' });
      process.stdout.write(`${logo}\n`);
      process.stdout.write('  Konoha MCP Tools Orchestrator · skills, tools, and client integrations\n\n');
      return;
    } catch (_) { /* fallback below */ }
  }

  process.stdout.write('  🍃 KONOHA MCP Tools Orchestrator · skills, tools, and client integrations\n\n');
}

module.exports = { runSplashScreen };
