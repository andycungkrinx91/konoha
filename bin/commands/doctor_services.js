'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const agentManager = require('../../src/agent_manager');
const { fileExists } = require('../../src/platform_utils');
const {
  HOME,
  DB_PATH,
  DEFAULT_SKILLS_DIRS,
  MCP_CONFIG_PATH,
  GEMINI_MD_PATH,
  FILE_TOOLS_MCP_PATH,
  UI_PORT
} = require('../lib/paths');
const { updateGeminiMd, detectSkillsDirs, detectCustomSkills, syncTemplateSkills } = require('../lib/runtime_lifecycle');
const { registerHooks, registerMcp } = require('../lib/runtime_mcp');
const { AISLOP_PACKAGE } = require('../../src/uvx_runtime');
const { confirmPrompt } = require('../lib/prompt');
const { createEmbedProgress } = require('../lib/embed_progress');
const { checkPortActive, getServiceStatus } = require('../lib/ui_commands');

async function executeMigrationRun(skillsDirs) {
  const migrate = require('../../src/migrate');
  const progress = createEmbedProgress('Doctor embeddings');
  const attempt = async (opts) => {
    try {
      return await migrate.runMigration({ ...opts, onProgress: progress.onProgress });
    } catch (err) {
      return { ok: false, reason: err.message || 'migration failed' };
    }
  };

  let result = null;
  for (const s of skillsDirs) {
    const skills = detectCustomSkills(s.path);
    if (skills.length === 0) continue;
    result = await attempt({ skillsDir: s.path, skills, rebuildEmbeddings: true });
    if (result && result.ok !== false) break;
  }
  if (!result || result.ok === false) {
    result = await attempt({ rebuildEmbeddings: true });
  }

  // Settle once, after every attempt: settling inside the loop would print a
  // diagnosis for a directory whose failure a later attempt recovered from.
  if (!result || result.ok === false) {
    // Not an embedding failure, so no embed diagnosis: the caller records FAILED
    // on the database row and the reason belongs there.
    progress.abort((result && result.reason) || 'migration failed');
    return false;
  }
  // The caller only asks "was the database created?". Embedding is an
  // enhancement on top of it: an offline machine with no cached model still has
  // a working FTS5 database, so a failed embed fails the bar and is reported by
  // `checkEmbeddingHealth`, but must not turn this into a FAILED database.
  const embed = result.embed;
  if (embed && embed.ok === false && embed.failure) {
    progress.fail(embed.failure);
  } else if (embed && embed.ok && !embed.skipped) {
    progress.succeed(`${embed.chunksIndexed || 0} chunks embedded`);
  } else {
    progress.succeed('migration complete');
  }
  return true;
}

function readSchemaVersion() {
  const Database = require('../../src/sqlite_driver');
  const conn = new Database(DB_PATH, { readOnly: true });
  try {
    return Object.values(conn.prepare('PRAGMA user_version').get())[0];
  } finally {
    conn.close();
  }
}

async function checkDatabaseAndMigrations(context) {
  if (fileExists(DB_PATH)) {
    const { CURRENT_SCHEMA_VERSION } = require('../../src/db_schema');
    const appVersion = require('../../package.json').version;
    let detail = `schema ${CURRENT_SCHEMA_VERSION}, app ${appVersion}`;
    try {
      const actual = readSchemaVersion();
      if (actual !== CURRENT_SCHEMA_VERSION) {
        detail = `schema ${actual} (expected ${CURRENT_SCHEMA_VERSION}), app ${appVersion} — run konoha migrate`;
        context.record('Database File (konoha.db)', 'WARN', detail);
        return;
      }
    } catch (err) {
      detail += ` (schema unreadable: ${err.message})`;
    }
    context.record('Database File (konoha.db)', 'HEALTHY', detail);
    return;
  }

  let skillsDirs = detectSkillsDirs();
  if (skillsDirs.length === 0) {
    syncTemplateSkills();
    skillsDirs = detectSkillsDirs();
  }
  const migrationSuccess = await executeMigrationRun(skillsDirs);

  if (migrationSuccess && fileExists(DB_PATH)) {
    context.record('Database File (konoha.db)', 'REPAIRED', 'Re-created and indexed skills');
    context.incrementRepairs();
  } else {
    context.record('Database File (konoha.db)', 'FAILED', 'Failed to create database via migration script');
    context.markError();
  }
}

function verifyMcpConfigContent(config, nodeCmd) {
  const expectedAislopArgs = ['-y', '-p', AISLOP_PACKAGE, 'aislop-mcp'];
  const servers = config.mcpServers || {};
  const aislopOk = servers['aislop'] && JSON.stringify(servers['aislop'].args || []) === JSON.stringify(expectedAislopArgs);
  const konohaServer = servers['konoha'];
  const konohaOk = konohaServer &&
    konohaServer.args &&
    (konohaServer.args[0] === FILE_TOOLS_MCP_PATH || konohaServer.args[0] === path.join(HOME, '.konoha', 'file_tools_launcher.js')) &&
    (konohaServer.command === nodeCmd || konohaServer.command === 'node');
  return Boolean(konohaOk && aislopOk);
}

function checkMcpConfiguration(context) {
  let mcpHealthy = false;
  if (fileExists(MCP_CONFIG_PATH)) {
    try {
      const config = JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, 'utf-8'));
      mcpHealthy = verifyMcpConfigContent(config, process.execPath);
    } catch { /* intentional fallback */ }
  }

  if (mcpHealthy) {
    context.record('MCP Config (mcp_config.json)', 'HEALTHY', 'konoha and aislop are active');
    return;
  }

  try {
    registerMcp();
    context.record('MCP Config (mcp_config.json)', 'REPAIRED', 'Registered konoha and aislop in config');
    context.incrementRepairs();
  } catch (e) {
    context.record('MCP Config (mcp_config.json)', 'FAILED', `Error: ${e.message}`);
    context.markError();
  }
}

function checkGeminiAndAgentsConfig(context) {
  checkMcpConfiguration(context);

  let geminiHealthy = false;
  if (fileExists(GEMINI_MD_PATH)) {
    try {
      const content = fs.readFileSync(GEMINI_MD_PATH, 'utf-8');
      if (content.includes('find_skill')) geminiHealthy = true;
    } catch { /* intentional fallback */ }
  }

  if (geminiHealthy) {
    context.record('GEMINI Instructions (GEMINI.md)', 'HEALTHY', 'Instructions are active');
  } else {
    try {
      updateGeminiMd();
      context.record('GEMINI Instructions (GEMINI.md)', 'REPAIRED', 'GEMINI.md instructions restored');
      context.incrementRepairs();
    } catch (e) {
      context.record('GEMINI Instructions (GEMINI.md)', 'FAILED', `Error: ${e.message}`);
      context.markError();
    }
  }

  const USER_AGENTS_YAML_PATH = path.join(HOME, '.agents', 'agents.yaml');
  let agentsHealthy = false;
  if (fileExists(USER_AGENTS_YAML_PATH)) {
    try {
      const content = fs.readFileSync(USER_AGENTS_YAML_PATH, 'utf-8');
      if (content.includes('name:') || content.includes('genin')) agentsHealthy = true;
    } catch { /* intentional fallback */ }
  }

  if (agentsHealthy) {
    context.record('AGENTS Definition (agents.yaml)', 'HEALTHY', 'Ninja ranks are active');
  } else {
    try {
      agentManager.loadAgents();
      context.record('AGENTS Definition (agents.yaml)', 'REPAIRED', 'agents.yaml configurations restored');
      context.incrementRepairs();
    } catch (e) {
      context.record('AGENTS Definition (agents.yaml)', 'FAILED', `Error: ${e.message}`);
      context.markError();
    }
  }
}

function inspectPromptHooksStatus() {
  const HOOKS_CONFIG_PATH = path.join(HOME, '.gemini', 'config', 'hooks.json');
  if (!fileExists(HOOKS_CONFIG_PATH)) return { promptOk: false, sanitizeOk: false };
  try {
    const config = JSON.parse(fs.readFileSync(HOOKS_CONFIG_PATH, 'utf-8'));
    let promptOk = false;
    let sanitizeOk = false;
    if (config['konoha-prompt-hook']?.PreInvocation) {
      const hooks = config['konoha-prompt-hook'].PreInvocation;
      const hasPrompt = hooks.some(h => h.command && h.command.includes('prompt_hook.js'));
      const hasSubagent = hooks.some(h => h.command && h.command.includes('antigravity_subagent_hook.js'));
      if (hasPrompt && hasSubagent) promptOk = true;
    }
    if (config['konoha-tool-sanitize']?.PreToolUse) {
      sanitizeOk = config['konoha-tool-sanitize'].PreToolUse.some(
        entry => entry.hooks && entry.hooks.some(h => h.command && h.command.includes('antigravity_tool_sanitize_hook.js'))
      );
    }
    return { promptOk, sanitizeOk };
  } catch {
    return { promptOk: false, sanitizeOk: false };
  }
}

async function promptForHookRegistration(globalSpinner) {
  const isNonInteractive = process.argv.includes('--yes') || process.argv.includes('-y') || process.env.CI === 'true';
  if (isNonInteractive) return true;
  globalSpinner.stop();
  try {
    const allow = await confirmPrompt('Allow registering prompt-saver hook in ~/.gemini/config/hooks.json?', true);
    globalSpinner.start('Running environment diagnostics...');
    return allow;
  } catch {
    globalSpinner.start('Running environment diagnostics...');
    return false;
  }
}

async function checkPromptHookConfig(context, globalSpinner) {
  const { promptOk, sanitizeOk } = inspectPromptHooksStatus();
  if (promptOk && sanitizeOk) {
    context.record('Prompt Hook Config (hooks.json)', 'HEALTHY', 'subagent + prompt + sanitize hooks registered');
    return;
  }

  const allowHooks = await promptForHookRegistration(globalSpinner);
  if (allowHooks) {
    try {
      registerHooks(true, true);
      context.record('Prompt Hook Config (hooks.json)', 'REPAIRED', 'Registered subagent + prompt hooks in hooks.json');
      context.incrementRepairs();
    } catch (e) {
      context.record('Prompt Hook Config (hooks.json)', 'FAILED', `Error: ${e.message}`);
      context.markError();
    }
  } else {
    context.record('Prompt Hook Config (hooks.json)', 'WARNING', 'Prompt hook is not registered (user declined)');
  }
}

function restoreKageAntislopSkill(context) {
  try {
    const agents = agentManager.loadAgents(true, true);
    const kage = agents.find(a => a.name === 'kage');
    if (!kage) return false;
    if (!Array.isArray(kage.skills)) kage.skills = [];
    if (!kage.skills.includes('antislop')) kage.skills.push('antislop');
    agentManager.saveAgents(agents);
    const dbAgents = require('../../src/db_agents');
    dbAgents.bulkImportAgents(agents, DB_PATH);
    context.incrementRepairs();
    context.record('Anti-Slop Gate (Kage)', 'REPAIRED', 'Restored and registered anti-slop skill for Kage reviewer');
    return true;
  } catch {
    return false;
  }
}

function checkAntiSlopGate(conn, context) {
  let hasAntislopInDb = false;
  try {
    const row = conn.prepare("SELECT 1 FROM skills WHERE name = 'antislop' OR name = 'kage-skill/antislop' OR name LIKE '%antislop%' LIMIT 1").get();
    hasAntislopInDb = Boolean(row);
  } catch { /* intentional fallback */ }

  let kageSkills = '';
  try {
    const kageRow = conn.prepare("SELECT skills FROM agents WHERE name = 'kage'").get();
    kageSkills = (kageRow && kageRow.skills) ? kageRow.skills.toLowerCase() : '';
  } catch { /* intentional fallback */ }

  let hasAntislopSkill = kageSkills.includes('antislop') || kageSkills.includes('anti-slop') || kageSkills.includes('aislop') || (kageSkills.includes('kage-skill') && hasAntislopInDb);

  if (!hasAntislopSkill) {
    hasAntislopSkill = restoreKageAntislopSkill(context);
  }

  if (hasAntislopSkill) {
    context.record('Anti-Slop Gate (Kage)', 'HEALTHY', 'Anti-slop skill loaded for Kage reviewer');
    return;
  }
  context.record('Anti-Slop Gate (Kage)', 'WARNING', 'anti-slop skill not installed for kage (falls back to core zero-slop checks)');
}

function checkCrossProviderReview(conn, context) {
  const enabledBridges = conn.prepare('SELECT count(*) as count FROM bridges WHERE enabled = 1').get();
  const bridgeCount = enabledBridges ? enabledBridges.count : 0;
  if (bridgeCount < 2) {
    context.record('Cross-Provider Review Setup', 'INFO', `${bridgeCount} bridge(s) enabled. Cross-provider review falls back to same-provider if configured.`);
  } else {
    context.record('Cross-Provider Review Setup', 'HEALTHY', `${bridgeCount} bridges enabled for independent second-opinion reviews`);
  }
}

function inspectGovernanceConn(conn, context) {
  try {
    const dbModule = require('../../src/db');
    dbModule.setupSchema(conn);
    checkCrossProviderReview(conn, context);
    checkAntiSlopGate(conn, context);
  } finally {
    try { conn.close(); } catch (_) { /* intentional fallback */ }
  }
}

function checkDatabaseGovernance(context) {
  try {
    const dbModule = require('../../src/db');
    const conn = dbModule.getConnection(DB_PATH);
    inspectGovernanceConn(conn, context);
  } catch (_) { /* intentional fallback */ }
}

async function checkWebUiDaemon(context) {
  try {
    const uiActive = await checkPortActive(UI_PORT);
    const svc = await getServiceStatus();
    if (uiActive) {
      context.record(`Konoha Web UI (http://127.0.0.1:${UI_PORT}/)`, 'HEALTHY', `Daemon is active${svc.installed ? ` (${svc.type} service ${svc.active ? 'active' : 'inactive'})` : ''}`);
    } else {
      context.record(`Konoha Web UI (http://127.0.0.1:${UI_PORT}/)`, 'WARNING', 'Web UI not running (run: konoha ui start or konoha service install)');
    }
  } catch (_) { /* intentional fallback */ }
}

/**
 * Embedding health: is semantic search usable, and how much of the corpus has
 * vectors? Reports the same cause/remedy schema as `konoha init` when it is not.
 *
 * A vector-less install still works (FTS5), so this is WARNING, not FAILED.
 */
function checkEmbeddingHealth(context) {
  const { isSemanticSearchEnabled, SEMANTIC_SEARCH_ENV } = require('../../src/hf_cache_resolver');
  const { formatEmbedFailure, classifyEmbedFailure } = require('../../src/embed_diagnostics');

  if (!isSemanticSearchEnabled()) {
    const failure = classifyEmbedFailure({ message: `semantic embedding requested while ${SEMANTIC_SEARCH_ENV} disabled` });
    context.record(
      'Vector Embeddings (semantic search)',
      'WARNING',
      `disabled via ${SEMANTIC_SEARCH_ENV}. Fix: ${failure.fixes[0]}`
    );
    return;
  }

  let conn;
  try {
    const Database = require('../../src/sqlite_driver');
    conn = new Database(DB_PATH, { readOnly: true });
    const total = conn.prepare(
      "SELECT COUNT(*) n FROM skills s WHERE length(coalesce(s.content,'')) > 0"
    ).get().n;
    // A skill with a chunk row but a NULL vector is not embedded. Counting
    // chunk existence reported a half-embedded corpus as HEALTHY.
    const missing = conn.prepare(
      `SELECT COUNT(*) n FROM skills s WHERE length(coalesce(s.content,'')) > 0
         AND NOT EXISTS (SELECT 1 FROM skill_chunks k
                          WHERE k.skill_name = s.name AND k.embedding IS NOT NULL)`
    ).get().n;
    const vectors = conn.prepare('SELECT COUNT(*) n FROM skill_chunks WHERE embedding IS NOT NULL').get().n;

    if (total === 0) {
      context.record('Vector Embeddings (semantic search)', 'INFO', 'no skill content to embed yet');
    } else if (missing === 0) {
      context.record('Vector Embeddings (semantic search)', 'HEALTHY', `${vectors} chunk vectors, ${total} skills covered`);
    } else {
      context.record(
        'Vector Embeddings (semantic search)',
        'WARNING',
        `${missing}/${total} skills unembedded. Fix: konoha migrate --rebuild-embeddings`
      );
    }
  } catch (err) {
    // Unreadable database or missing vector table: explain, do not crash.
    const lines = formatEmbedFailure(classifyEmbedFailure(err));
    context.record('Vector Embeddings (semantic search)', 'WARNING', lines.join(' ').slice(0, 240));
  } finally {
    try { if (conn) conn.close(); } catch (_) { /* ignore */ }
  }
}

async function checkGovernanceAndServices(context) {
  checkDatabaseGovernance(context);
  checkEmbeddingHealth(context);
  await checkWebUiDaemon(context);
}

/**
 * VPS preflight: the checks a hosting provider's scanner and a fresh box care
 * about. Every row is PASS/FAIL; any FAIL marks the run errored.
 *
 * @param {object} context doctor context (record/markError)
 */
async function checkVpsPreflight(context) {

  const cyberPack = require('../../src/cyber_pack');

  const major = parseInt(process.version.slice(1).split('.')[0], 10);
  context.record('VPS: Node.js', major >= 24 ? 'PASS' : 'FAIL', `${process.version} (need >= 24)`);
  if (major < 24) context.markError();

  const pnpm = spawnSync('pnpm', ['--version'], { encoding: 'utf8' });
  const pnpmOk = pnpm.status === 0;
  context.record('VPS: pnpm', pnpmOk ? 'PASS' : 'FAIL', pnpmOk ? pnpm.stdout.trim() : 'pnpm not found on PATH');
  if (!pnpmOk) context.markError();

  let freeGb = 0;
  try {
    const stat = fs.statfsSync(HOME);
    freeGb = (stat.bavail * stat.bsize) / 1024 ** 3;
  } catch (_) { /* statfs unsupported */ }
  const diskOk = freeGb >= 2;
  context.record('VPS: Disk', diskOk ? 'PASS' : 'FAIL', `${freeGb.toFixed(1)} GiB free at ${HOME} (need >= 2)`);
  if (!diskOk) context.markError();

  let writable = false;
  try {
    fs.accessSync(HOME, fs.constants.W_OK);
    writable = true;
  } catch (_) { /* not writable */ }
  context.record('VPS: ~/.konoha writable', writable ? 'PASS' : 'FAIL', HOME);
  if (!writable) context.markError();

  let state = 'absent';
  let rows = 0;
  try {
    const db = require('../../src/db');
    const conn = db.getConnection(null, false);
    try {
      const status = cyberPack.status(conn);
      state = status.state;
      rows = status.rows;
    } finally {
      conn.close();
    }
  } catch (_) { /* DB absent: treat as clean */ }
  const packClean = state !== 'opted-in' && rows === 0;
  context.record('VPS: Cyber pack absent', packClean ? 'PASS' : 'FAIL', `state ${state}, ${rows} indexed rows`);
  if (!packClean) context.markError();

  // Skills deploy into client dirs (~/.omp/agent/skills, ~/.claude/skills, ...),
  // not ~/.konoha/skills. Any client dir carrying the skill counts as present.
  const skillPresent = (name) => {
    for (const dir of DEFAULT_SKILLS_DIRS) {
      if (fileExists(path.join(dir, name, 'SKILL.md'))) return path.join(dir, name, 'SKILL.md');
    }
    return null;
  };

  const anbuSkill = skillPresent('anbu-skill');
  context.record('VPS: ANBU skill present', anbuSkill ? 'PASS' : 'FAIL', anbuSkill || 'anbu-skill/SKILL.md not found in any client skills dir');
  if (!anbuSkill) context.markError();

  const akatsukiSkill = skillPresent('akatsuki-skill');
  context.record('VPS: Akatsuki blue-team gates', akatsukiSkill ? 'PASS' : 'FAIL', akatsukiSkill || 'akatsuki-skill/SKILL.md not found in any client skills dir');
  if (!akatsukiSkill) context.markError();

  const ports = [UI_PORT, UI_PORT + 1];
  // checkPortActive resolves a Promise: filtering on it directly made every port
  // look busy, so the preflight failed on any host.
  const probes = await Promise.all(ports.map((port) => checkPortActive(port)));
  const busy = ports.filter((_, i) => probes[i]);
  context.record('VPS: Ports free', busy.length === 0 ? 'PASS' : 'FAIL', busy.length ? `in use: ${busy.join(', ')}` : ports.join(', '));
  if (busy.length > 0) context.markError();
}

module.exports = {
  checkDatabaseAndMigrations,
  checkEmbeddingHealth,
  checkGeminiAndAgentsConfig,
  checkPromptHookConfig,
  checkGovernanceAndServices,
  checkVpsPreflight
};
