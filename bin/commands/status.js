'use strict';

/**
 * bin/commands/status.js — Installation Health, Database Metrics & Integration Status.
 *
 * Reports:
 * - Core runtime files (server.js, migrate.js, konoha.db, mcp_config.json)
 * - SQLite database metrics (total skills, FTS index, size)
 * - Web UI daemon process status and bound port
 * - Client integrations (Antigravity, Cursor, Claude Code, Command Code, OpenCode, Codex)
 * - Scanned skills directories
 */

const fs = require('fs');
const path = require('path');

const {
  HOME,
  SKILLS_DB_DIR,
  SERVER_PATH,
  MIGRATE_PATH,
  DB_PATH,
  MCP_CONFIG_PATH,
  GEMINI_MD_PATH,
  AGENTS_MD_PATH
} = require('../lib/paths');

const {
  C,
  log,
  warn,
  success,
  header,
  drawLogo,
  applyGradient,
  CHIDORI_THEME,
  LEAF_THEME,
  NINJA_THEME,
  sectionTitle,
  drawIntegrationRow,
  drawTable,
  gradientStatusCell,
  computeTableWidths,
  RASENGAN_THEME
} = require('../lib/format');

const { fileExists } = require('../lib/prompt');
const { detectSkillsDirs } = require('../lib/runtime');

const agentManager = require('../../src/agent_manager');
const cursorManager = require('../../src/cursor_manager');
const mcpClientsManager = require('../../src/mcp_clients_manager');
const opencodeManager = require('../../src/opencode_manager');
const codexManager = require('../../src/codex_manager');
const piManager = require('../../src/pi_manager');
const ompManager = require('../../src/omp_manager');
const antigravityManager = require('../../src/antigravity_manager');

function cmdStatusHelp() {
  log(`
${C.cyan}konoha status${C.reset} — Check installation health, database size, and loaded skills

${C.bold}USAGE${C.reset}
  konoha status

${C.bold}EXAMPLES${C.reset}
  konoha status
`);
}


async function cmdStatus(args = []) {
  if (args && (args.includes('help') || args.includes('--help') || args.includes('-h'))) {
    cmdStatusHelp();
    return;
  }
  drawLogo(false); // Static logo
  
  header('📋 Konoha MCP Status');

  // Check Node.js runtime
  const nodeVersion = process.version;
  const nodeInfo = `${nodeVersion} (${process.execPath})`;

  // Check files
  const checks = [
    { label: 'Server File', path: SERVER_PATH },
    { label: 'Migration Script', path: MIGRATE_PATH },
    { label: 'Database File', path: DB_PATH },
    { label: 'MCP Configuration', path: MCP_CONFIG_PATH },
    { label: 'GEMINI Instructions', path: GEMINI_MD_PATH },
    { label: 'AGENTS Definition', path: AGENTS_MD_PATH },
  ];

  sectionTitle('Environment & Files:', LEAF_THEME);
  const envHeaders = ['Resource / Path', 'Status', 'Size', 'Location'];
  const envAligns = ['left', 'left', 'right', 'left'];
  const envRows = [];
  const envRowColors = [];

  // Node.js Status Row
  envRows.push(['Node.js', 'ACTIVE', '-', nodeInfo]);
  envRowColors.push(['', '', '', '']);

  // File rows
  checks.forEach(check => {
    if (fileExists(check.path)) {
      const stats = fs.statSync(check.path);
      const sizeStr = `${(stats.size / 1024).toFixed(1)} KB`;
      const displayPath = check.path.replace(HOME, '~');
      envRows.push([check.label, 'EXISTS', sizeStr, displayPath]);
      envRowColors.push(['', '', '', '']);
    } else {
      envRows.push([check.label, 'MISSING', '-', check.path]);
      envRowColors.push(['', '', '', '']);
    }
  });

  const envWidths = computeTableWidths(envHeaders, envRows, {
    minWidths: [14, 8, 8, 36],
    maxWidths: [24, 10, 12, 64]
  });
  drawTable(envHeaders, envWidths, envAligns, envRows, envRowColors, LEAF_THEME, {
    columnFormatters: [
      (cell) => applyGradient(cell.trimEnd(), NINJA_THEME, 0.9) + cell.slice(cell.trimEnd().length),
      gradientStatusCell,
      (cell) => applyGradient(cell, CHIDORI_THEME, 0.8),
      (cell) => applyGradient(cell, CHIDORI_THEME, 0.7)
    ]
  });

  // Check MCP configs
  sectionTitle('MCP Integrations:', RASENGAN_THEME);

  const agyStatus = antigravityManager.getAntigravityStatus();
  const cursorStatus = cursorManager.getCursorStatus();
  const claudeStatus = mcpClientsManager.getClaudeCodeStatus();
  const cmdStatus = mcpClientsManager.getCommandCodeStatus();
  const openCodeStatus = opencodeManager.getOpenCodeStatus();
  const codexStatus = codexManager.getCodexStatus();

  log(`  ${C.bold}${applyGradient('1. 🔌 MCP Clients Configuration', RASENGAN_THEME)}${C.reset}`);
  log(`  Auto-setup bridges Konoha directly into IDE and CLI configuration files.\n`);

    const printClientStatus = (name, configPath, isHealthy, mcpConfigExists, isInstalled = true) => {
    if (!isInstalled) {
      log(`  ${C.dim}•${C.reset} ${C.bold}${name}${C.reset} ${C.dim}(SKIPPED — client not installed)${C.reset}`);
      log(`     Config Path: ${C.dim}Not applicable${C.reset}`);
      log('');
      return;
    }
    const mark = isHealthy ? `${C.green}✔${C.reset}` : `${C.red}✖${C.reset}`;
    log(`  ${mark} ${C.bold}${name}${C.reset}`);
    log(`     Config Path: ${mcpConfigExists ? C.dim + configPath + C.reset : C.yellow + 'Not found/Not configured' + C.reset}`);
    if (mcpConfigExists) {
      log(`     Status:      ${isHealthy ? C.green + 'Healthy (Konoha MCP Registered)' + C.reset : C.red + 'Missing Konoha MCP' + C.reset}`);
      if (isHealthy) {
        log(`     Command:     ${C.dim}cmd: node ${path.join(SKILLS_DB_DIR, 'file_tools_launcher.js')}${C.reset}`);
      }
    }
    log('');
  };

  printClientStatus('Antigravity IDE / CLI', '~/.gemini/config/mcp_config.json', agyStatus.mcpSkillsDb && agyStatus.mcpSemble, agyStatus.mcpConfigExists);
  printClientStatus('Cursor IDE / CLI', '~/.cursor/mcp.json', cursorStatus.mcpKonoha && cursorStatus.mcpSemble, cursorStatus.mcpGlobal, cursorManager.isCursorInstalled());
  printClientStatus('Claude Code CLI', '~/.claude.json', claudeStatus.mcpKonoha && claudeStatus.mcpSemble, claudeStatus.globalConfig, claudeStatus.installed);
  printClientStatus('OpenCode IDE', '~/.config/opencode/opencode.json', openCodeStatus.mcpKonoha && openCodeStatus.mcpSemble, openCodeStatus.configExists, openCodeStatus.installed);
  printClientStatus('Command Code CLI', '~/.commandcode/mcp.json', cmdStatus.mcpKonoha && cmdStatus.mcpSemble, cmdStatus.globalConfig, cmdStatus.installed);
  printClientStatus('Codex IDE / CLI', '~/.codex/config.toml', codexStatus.mcpKonoha && codexStatus.mcpSemble, codexStatus.configExists, codexStatus.installed);
  const piStatus = piManager.getPiStatus();
  printClientStatus('Pi (pi.dev)', '~/.pi/agent/mcp.json', piStatus.mcpKonoha && piStatus.adapterInstalled && piStatus.rtkRuleDeployed, piStatus.adapterInstalled, piStatus.installed);
  const ompStatus = ompManager.getOmpStatus();
  printClientStatus('OMP Agent', '~/.omp/agent/mcp.json', ompStatus.mcpKonoha && ompStatus.mcpSemble, ompStatus.configExists, ompStatus.installed);

  // Antigravity IDE/CLI integrations
  sectionTitle('Antigravity IDE/CLI Integrations:', NINJA_THEME);
  drawIntegrationRow(
    '~/.gemini/config/mcp_config.json',
    agyStatus.mcpSkillsDb && agyStatus.mcpSemble,
    agyStatus.mcpConfigExists ? 'konoha + semble' : 'not configured',
    NINJA_THEME
  );
  drawIntegrationRow(
    'Antigravity MCP schemas',
    agyStatus.schemasCount >= 7,
    `${agyStatus.schemasCount} in ~/.gemini/antigravity-cli/mcp/konoha/`,
    NINJA_THEME
  );
  drawIntegrationRow(
    'Sanitize Hook config',
    agyStatus.hasHooks,
    agyStatus.hasHooks ? 'sanitize hooks active' : 'hooks missing',
    NINJA_THEME
  );
  drawIntegrationRow(
    'RTK (Token Killer)',
    agyStatus.rtkInstalled,
    agyStatus.rtkInstalled
      ? 'rtk binary available — rules deployed to antigravity-cli/ide'
      : 'RTK not installed (auto-install failed — manual: cargo install --git https://github.com/rtk-ai/rtk)',
    NINJA_THEME
  );

  // Cursor IDE/CLI integrations
  if (cursorManager.isCursorInstalled()) {
  sectionTitle('Cursor IDE/CLI Integrations:', NINJA_THEME);
  drawIntegrationRow(
    '~/.cursor/mcp.json',
    cursorStatus.mcpSkillsDb && cursorStatus.mcpSemble,
    cursorStatus.mcpGlobal ? 'konoha + semble' : 'not configured',
    NINJA_THEME
  );
  drawIntegrationRow(
    'Cursor skills',
    cursorStatus.skillsGlobal > 0,
    `${cursorStatus.skillsGlobal} indexed from ~/.agents/skills/; Cursor uses Konoha MCP content`,
    NINJA_THEME
  );
  drawIntegrationRow(
    'CLI permissions',
    cursorStatus.cliPermissions,
    cursorStatus.cliPermissions ? 'MCP auto-allow configured' : 'run konoha init',
    NINJA_THEME
  );
  drawIntegrationRow(
    'sessionStart hook',
    cursorStatus.hooks,
    cursorStatus.hooks ? 'auto-bootstrap on session' : 'not registered',
    NINJA_THEME
  );
  drawIntegrationRow(
    'RTK (Token Killer)',
    cursorStatus.rtkInstalled && cursorStatus.rtkRuleDeployed,
    cursorStatus.rtkInstalled
      ? (cursorStatus.rtkRuleDeployed ? 'rtk rule deployed to ~/.cursor/rules/' : 'rtk rule not deployed')
      : 'RTK not installed (auto-install failed — manual: cargo install --git https://github.com/rtk-ai/rtk)',
    NINJA_THEME
  );
  } else {
    log(`\n  ${applyGradient('Cursor:', CHIDORI_THEME, 0.85)} ${applyGradient('not installed — skipped', CHIDORI_THEME, 0.6)}`);
  }

  // Claude Code integration (auto-configured when `claude` CLI is installed)
  if (claudeStatus.installed) {
    sectionTitle('Claude Code Integrations:', NINJA_THEME);
    const claudeOk = claudeStatus.mcpSkillsDb && claudeStatus.mcpSemble && claudeStatus.permissionsAllowed;
    drawIntegrationRow(
      '~/.claude.json',
      claudeOk,
      claudeStatus.permissionsAllowed ? 'konoha + semble' : 'konoha + semble (permissions missing)',
      NINJA_THEME
    );
    drawIntegrationRow(
      'RTK (Token Killer)',
      claudeStatus.rtkInstalled && claudeStatus.rtkRuleDeployed,
      claudeStatus.rtkInstalled
        ? (claudeStatus.rtkRuleDeployed ? 'rtk rule deployed to ~/.claude/rules/' : 'rtk rule not deployed')
        : 'RTK not installed (auto-install failed — manual: cargo install --git https://github.com/rtk-ai/rtk)',
      NINJA_THEME
    );

  } else {
    log(`\n  ${applyGradient('Claude Code:', CHIDORI_THEME, 0.85)} ${applyGradient('not installed (template: docs/templates/claude-code.mcp.json)', CHIDORI_THEME, 0.6)}`);
  }

  // OpenCode integration (auto-configured when `opencode` CLI is installed)
  const openCodeDetails = opencodeManager.getOpenCodeStatus();
  if (openCodeDetails.installed) {
    sectionTitle('OpenCode Integrations:', NINJA_THEME);
    const openCodeOk = openCodeDetails.mcpKonoha && openCodeDetails.mcpSemble;
    drawIntegrationRow(
      openCodeDetails.configPath || '~/.config/opencode/opencode.json',
      openCodeOk,
      'konoha + semble',
      NINJA_THEME
    );
    drawIntegrationRow(
      'RTK (Token Killer)',
      openCodeDetails.rtkRuleDeployed,
      openCodeDetails.rtkRuleDeployed ? 'rtk rule deployed to ~/.config/opencode/rules/' : 'rtk rule not deployed',
      NINJA_THEME
    );
  } else {
    log(`\n  ${applyGradient('OpenCode:', CHIDORI_THEME, 0.85)} ${applyGradient('not installed (see https://opencode.ai)', CHIDORI_THEME, 0.6)}`);
  }

  // Command Code integration
  const cmdCodeStatus = mcpClientsManager.getCommandCodeStatus();
  if (cmdCodeStatus.installed) {
    sectionTitle('Command Code Integrations:', NINJA_THEME);
    const cmdCodeOk = cmdCodeStatus.mcpKonoha && cmdCodeStatus.mcpSemble;
    drawIntegrationRow(
      '~/.commandcode/mcp.json',
      cmdCodeOk,
      'konoha + semble',
      NINJA_THEME
    );
    drawIntegrationRow(
      'RTK (Token Killer)',
      cmdCodeStatus.rtkRuleDeployed,
      cmdCodeStatus.rtkRuleDeployed ? 'rtk rule deployed to ~/.commandcode/rules/' : 'rtk rule not deployed',
      NINJA_THEME
    );
  } else {
    log(`\n  ${applyGradient('Command Code:', CHIDORI_THEME, 0.85)} ${applyGradient('not installed', CHIDORI_THEME, 0.6)}`);
  }

  // Codex integration
  const codexDetails = codexManager.getCodexStatus();
  if (codexDetails.installed) {
    sectionTitle('Codex Integrations:', NINJA_THEME);
    const codexOk = codexDetails.mcpKonoha && codexDetails.mcpSemble;
    drawIntegrationRow(
      codexDetails.configPath || '~/.codex/config.toml',
      codexOk,
      'konoha + semble',
      NINJA_THEME
    );
    drawIntegrationRow(
      'RTK (Token Killer)',
      codexDetails.rtkRuleDeployed,
      codexDetails.rtkRuleDeployed ? 'rtk rule deployed to ~/.codex/rules/' : 'rtk rule not deployed',
      NINJA_THEME
    );
  } else {
    log(`\n  ${applyGradient('Codex:', CHIDORI_THEME, 0.85)} ${applyGradient('not installed', CHIDORI_THEME, 0.6)}`);
  }

  // Pi integration
  const piDetails = piManager.getPiStatus();
  if (piDetails.installed) {
    sectionTitle('Pi (pi.dev) Integrations:', NINJA_THEME);
    const piOk = piDetails.mcpKonoha && piDetails.mcpSemble;
    drawIntegrationRow(
      piDetails.configPath || '~/.pi/agent/mcp.json',
      piOk,
      'konoha + semble',
      NINJA_THEME
    );
  } else {
    log(`\n  ${applyGradient('Pi (pi.dev):', CHIDORI_THEME, 0.85)} ${applyGradient('not installed', CHIDORI_THEME, 0.6)}`);
  }

  // OMP integration
  const ompDetails = ompManager.getOmpStatus();
  if (ompDetails.installed) {
    sectionTitle('OMP Integrations:', NINJA_THEME);
    const ompOk = ompDetails.mcpKonoha && ompDetails.mcpSemble;
    drawIntegrationRow(
      ompDetails.configPath || '~/.omp/agent/mcp.json',
      ompOk,
      'konoha + semble',
      NINJA_THEME
    );
    drawIntegrationRow(
      'Konoha Contract',
      ompDetails.contractDeployed,
      ompDetails.contractDeployed ? 'contract deployed to ~/.omp/agent/AGENTS.md' : 'contract not deployed',
      NINJA_THEME
    );
  } else {
    log(`\n  ${applyGradient('OMP:', CHIDORI_THEME, 0.85)} ${applyGradient('not installed', CHIDORI_THEME, 0.6)}`);
  }

  // Check instructions patterns
  if (fileExists(GEMINI_MD_PATH)) {
    try {
      const content = fs.readFileSync(GEMINI_MD_PATH, 'utf-8');
      const hasSkillsDb = content.includes('find_skill');
      drawIntegrationRow(
        'GEMINI.md instructions',
        hasSkillsDb,
        hasSkillsDb ? 'skills-db active' : 'not found',
        LEAF_THEME
      );
    } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }

  // Subagents list
  sectionTitle('Subagents (Naruto Ninja Ranks):', NINJA_THEME);
  const agents = agentManager.loadAgents(false, true);
  const iconMap = {
    'genin': '🍃',
    'chunin': '📜',
    'jonin': '🛡️',
    'anbu': '👥',
    'tokubetsu-jonin': '🎯',
    'kage': '🌀'
  };

  const subHeaders = [
    'Rank / Name',
    'Skills Configuration'
  ];
  const subAligns = ['left', 'left'];
  const subRows = [];
  const subRowColors = [];

  agents.forEach(a => {
    const icon = a.icon || iconMap[a.name] || '👤';
    const displayName = `${icon} ${a.name.charAt(0).toUpperCase() + a.name.slice(1)}`;
    const activeSkills = a.skills && a.skills.length > 0
      ? (a.skills.length > 6 ? `${a.skills.slice(0, 6).join(', ')} (+${a.skills.length - 6} more)` : a.skills.join(', '))
      : 'None';

    subRows.push([displayName, activeSkills]);
    subRowColors.push(['', '']);
  });

  const subWidths = computeTableWidths(subHeaders, subRows, {
    minWidths: [18, 24],
    maxWidths: [24, 48]
  });
  drawTable(subHeaders, subWidths, subAligns, subRows, subRowColors, NINJA_THEME, {
    columnFormatters: [
      (cell) => applyGradient(cell.trimEnd(), NINJA_THEME, 0.92) + cell.slice(cell.trimEnd().length),
      (cell) => applyGradient(cell, CHIDORI_THEME, 0.85)
    ]
  });

  // Database stats
  sectionTitle('Database Stats:', LEAF_THEME);
  if (fileExists(DB_PATH)) {
    try {
      const { getDbStats } = require('../../src/db_stats');
      const stats = getDbStats(DB_PATH);
      if (stats.error) {
        log(`    ${C.yellow}⚠${C.reset} Database error: ${stats.error}`);
      } else {
        success('SQLite FTS5 database is healthy:');
        const statRows = [
          ['Total Entries', String(stats.total)],
          ['Unique Skills', String(stats.skills)],
          ['Reference Files', String(stats.refs)],
          ['Indexed size', `${(stats.bytes / 1024).toFixed(1)} KB`]
        ];
        const statHeaders = ['Metric', 'Value'];
        const statWidths = computeTableWidths(statHeaders, statRows, { minWidths: [16, 12] });
        drawTable(statHeaders, statWidths, ['left', 'left'], statRows, [], LEAF_THEME, {
          columnFormatters: [
            (cell) => applyGradient(cell, CHIDORI_THEME, 0.85),
            (cell) => applyGradient(cell, LEAF_THEME, 0.95)
          ]
        });
      }
    } catch {
      log(`    ${C.yellow}⚠${C.reset} Could not read database stats.`);
    }
  } else {
    log(`    ${C.yellow}⚠${C.reset} Database not found. Run "konoha init" to build database.`);
  }

  // Skills directories
  sectionTitle('Skills Directories:', LEAF_THEME);
  const skillsDirs = detectSkillsDirs();
  if (skillsDirs.length > 0) {
    const dirRows = skillsDirs.map(s => [s.path.replace(HOME, '~'), `${s.count} skills`]);
    const dirHeaders = ['Path', 'Count'];
    const dirWidths = computeTableWidths(dirHeaders, dirRows, { minWidths: [24, 10] });
    drawTable(dirHeaders, dirWidths, ['left', 'left'], dirRows, [], LEAF_THEME, {
      columnFormatters: [
        (cell) => applyGradient(cell, CHIDORI_THEME, 0.8),
        (cell) => applyGradient(cell, LEAF_THEME, 0.95)
      ]
    });
  } else {
    warn('No skills directories found');
  }

  log('');
}


module.exports = {
  cmdStatus,
  cmdStatusHelp,
};
