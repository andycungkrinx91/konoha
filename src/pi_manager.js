const { buildPiBlockerExtensionSource } = require('./pi_blocker_template');
/**
 * src/pi_manager.js — Pi (pi.dev) coding agent client integration.
 *
 * Pi stores its agent config under ~/.pi/agent/. MCP servers are provided by
 * the `pi-mcp-adapter` extension package, which reads standard `mcpServers`
 * objects from (in precedence order): ~/.config/mcp/mcp.json,
 * ~/.agents/mcp.json, ~/.agents/mcp/mcp.json, <Pi agent dir>/mcp.json,
 * .mcp.json (project), .pi/mcp.json (project override).
 *
 * Konoha writes ONLY to the Pi-owned global override (~/.pi/agent/mcp.json)
 * so it never clobbers shared or project configs, and merges by server key.
 */

const fs = require('fs');
const path = require('path');
const { AISLOP_PACKAGE } = require('./uvx_runtime');
const os = require('os');
const { spawnSync } = require('child_process');
const deployUtils = require('./deploy_utils');
const { buildMainAgentContract, buildManagedContract } = require('./agent_contract');

const HOME = process.env.HOME || process.env.USERPROFILE || os.homedir();
const PI_AGENT_DIR = path.join(HOME, '.pi', 'agent');
const PI_SETTINGS = path.join(PI_AGENT_DIR, 'settings.json');
const PI_MCP_CONFIG = path.join(PI_AGENT_DIR, 'mcp.json');
const PI_ADAPTER_PACKAGE = 'npm:pi-mcp-adapter';

const KONOHA_SERVER_KEYS = ['konoha', 'aislop'];

const PI_AGENTS_MD = path.join(PI_AGENT_DIR, 'AGENTS.md');
const PI_RTK_EXTENSION = path.join(PI_AGENT_DIR, 'extensions', 'rtk.ts');
const PI_BLOCKER_EXTENSION = path.join(PI_AGENT_DIR, 'extensions', 'konoha-blocker.ts');
const PI_SUBAGENT_EXTENSION_DIR = path.join(PI_AGENT_DIR, 'extensions', 'subagent');
const PI_SUBAGENTS_EXT_DIR = path.join(PI_AGENT_DIR, 'extensions', 'pi-subagents');
const RTK_BLOCK_START = '<!-- KONOHA-RTK-START -->';
const RTK_BLOCK_END = '<!-- KONOHA-RTK-END -->';
const CONTRACT_END_MARKER = '<!-- KONOHA-CONTRACT-END -->';
const PI_MANDATE_HEADING_RE = /^## Konoha Workflow Mandate \(Pi\)/;

/**
 * Strips every '## Konoha Workflow Mandate (Pi)' section from the file body.
 * Legacy deploys appended the addendum AFTER the managed markers, so each
 * redeploy left the previous copy behind — production showed 166 stale
 * copies (~410KB) burning ~100K tokens in every Pi session. The canonical
 * addendum now lives INSIDE the managed block, so any heading found in the
 * raw body is stale duplication and must be removed.
 */
function stripStalePiMandates(text) {
  let out = String(text || '');
  // Fast path: remove exact copies of the current addendum text (the format
  // legacy deploys appended after the markers).
  const exact = buildPiWorkflowAddendum();
  let prev = null;
  while (prev !== out) {
    prev = out;
    out = out.split(exact).join('');
  }
  // Fallback for legacy-format variants: drop each mandate section, where a
  // section ends at the next heading, marker, or the first line that is not
  // mandate-shaped (blank or a '- ' bullet) — user prose survives.
  const lines = out.split('\n');
  const kept = [];
  let skipping = false;
  for (const line of lines) {
    if (PI_MANDATE_HEADING_RE.test(line)) {
      skipping = true;
      continue;
    }
    if (skipping) {
      if (PI_MANDATE_HEADING_RE.test(line)) {
        continue;
      }
      if (line.startsWith('## ') || line.startsWith('<!-- KONOHA-')) {
        skipping = false;
        kept.push(line);
        continue;
      }
      if (line.trim() === '' || line.trim().startsWith('- ') || line.trim().startsWith('* ')) continue;
      skipping = false;
      kept.push(line);
      continue;
    }
    kept.push(line);
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n');
}

/**
 * Pi-specific workflow mandate: without this, Pi only sees its native
 * /skill: mirrors of the konoha skills and executes multi-step work itself,
 * never touching the sannin/kage workflow. Deployed into ~/.pi/agent/AGENTS.md
 * (Pi's global context file) as a Konoha-managed block.
 */
function buildPiWorkflowAddendum() {
  return `

## Konoha Workflow Mandate (Pi) — MANDATORY

- **Route through the village, never free-run**: for any non-trivial task, start from the \`konoha\` MCP tool \`sannin\` (task triage + \`get_resolved_task_dir\`) and follow the structured phases — explore with \`genin\`, plan with \`kage\`, execute with \`jonin\`/\`anbu\`/\`chunin\`, secure with \`akatsuki\`, build 3D assets with \`yamanaka\`, document with \`tokubetsu-jonin\`, review with \`kage\`. Do NOT decompose and execute multi-step engineering work yourself.
- **Always-on idle @advisor from turn 0**: start \`@advisor\` immediately via \`advisor_spawn_directive\` (or \`rtk konoha run-agent --agent advisor --idle --execute\`) in idle supervision mode (0 tokens when compliant). \`@advisor\` reviews all agent work against the plan, TODOs, and goals and delivers \`[ADVISOR STEER]\` directly whenever drift occurs.
- **Step 0: Classify request — ALWAYS FIRST (Branch A vs Branch B)**:
  - **Website build intent** (build/create/scaffold/generate/make + website/web app/landing page/UI/frontend/site/e-commerce/storefront/portfolio/dashboard/app, OR framework-specific like "next.js project"/"svelte app"/"nuxt site") → **BRANCH B (Website Scaffolding)**.
  - **Design mockups provided** (source-image-design, mockup images, figma) → **BRANCH B** with \`konoha.build_from_source\`.
  - **Everything else** → **BRANCH A** (standard multi-agent workflow above).
- **BRANCH B: Website Scaffolding Pipeline (SKIP standard pipeline)**:
  - Call \`konoha.build_from_text(name, description, framework, taste_dials?)\` or \`konoha.build_from_source(name, source_dir, framework, taste_dials?)\` FIRST before writing any code or scaffolding.
  - Pass the returned directives directly as structured tool constraints and call \`konoha.jonin\` directly — DO NOT call Chunin, Genin, or Kage.
  - Jonin implements the complete working website with an inline \`README.md\` and executes validation commands cleanly. DO NOT delegate to \`tokubetsu-jonin\` or other subagents unless technical documentation was explicitly requested by the user.
  - **Project-Specific Design Mandate**: Derive art direction, information architecture, navigation pattern, theme strategy, motion language, and component composition from a 9-field design brief authored from the request itself. No house template: no mandatory bottom dock, no mandatory theme switcher, no mandatory hero carousel, no commerce sections unless the request requires commerce. Apply the Anti-Template Gate before delivery.
  - **Craft Polish**: Enrich the brief-derived direction with editorial typography, negative space, justified hover/motion treatment, and a zero-emoji policy in UI controls — without overriding the design brief.
  - Framework scaffolding commands and the \`package.json\` scripts invariant (\`lint\`, \`build\`, \`start\`, plus \`check\` for SvelteKit) live in \`jonin-skill\`; load it before scaffolding.
  - **Zero Errors & Zero Warnings**: do not claim completion until the framework's \`build\`, \`lint\`, and \`check\` commands pass cleanly with 0 errors and 0 warnings.
- **Skills via Konoha MCP first**: use \`konoha.find_skill\` / \`konoha.get_skill\` instead of the native \`/skill:\` mirrors. The project \`.agents/skills/\` entries are pre-seeded mirrors of the same skills; duplicate-skill warnings are automatically filtered by konoha-blocker; prefer the Konoha MCP path.
- **Code search via native code intelligence**: use \`konoha.code_search\` / \`code_symbol\` / \`code_impact\` (SQLite FTS5 index over the repository) instead of native grep/glob/find for codebase discovery.
- **Bounded file tools**: use \`konoha.read_file_head\`, \`read_file_range\`, \`file_info\`, \`get_file_structure\`, \`find_files_clean\`, \`token_efficient_grep\` instead of native read/grep when scanning the repository.
- **Workflow artifacts** (\`plan.md\`, \`findings.md\`, \`final_docs.md\`, \`kage_review.json\`) live in the task directory returned by \`konoha.get_resolved_task_dir\` — never in the workspace root.
- **Delivery gate**: never claim completion without validation evidence (\`0 errors and 0 warnings\`). Kage review (\`confidence >= 98\`, \`ai_slop_findings = 0\`, \`ai_slop_clean = true\`) is mandatory before final delivery.
- **Base personality: High Effort + Instruct Style**: Strictly zero conversational filler (no "hmmmm", "let me", "wait - but"), lead with direct action, ADHD-friendly structured formatting, zero hallucination, and strictly no lies.
- **Review token hygiene & strict changed-files scoping (NEVER BURN TOKENS)**: never run an unscoped full-repository scan (\`aislop_scan\` without a target path, or \`aislop scan\` without \`--changes\` or explicit file arguments). Report counts and rule IDs only; never dump raw scan output into context. Single-file edits, isolated fixes, and routine configuration changes never trigger a repository-wide slop refactoring loop.
`;
}

function buildPiManagedContract() {
  // The addendum is inserted BEFORE the closing marker so the entire block
  // (contract + Pi mandate) is managed: redeployment replaces it atomically
  // instead of appending a fresh copy outside the markers.
  const base = buildMainAgentContract('pi');
  const idx = base.lastIndexOf(CONTRACT_END_MARKER);
  return base.slice(0, idx) + buildPiWorkflowAddendum() + '\n' + base.slice(idx);
}

/**
 * Deploys the Konoha runtime contract + Pi workflow mandate into
 * ~/.pi/agent/AGENTS.md (Pi's global context file) using managed markers.
 */
/**
 * Writes one Pi agent profile per deployable agent.
 *
 * Pi used to receive the advisor profile only, so `subagent(agent="chunin")` had no
 * definition to resolve and every delegation failed with UNSUPPORTED_NATIVE_SPAWN even
 * with pi-subagents installed. Tools are written as a YAML sequence: pi-subagents reads
 * `tools: read, grep, find, ls` as a single tool name and then rejects the launch.
 *
 * @returns {string[]} agent names written
 */
function deployPiAgentProfiles(piAgentsDir, options = {}) {
  const silent = options.silent !== false;
  const { getDeployableAgents } = require('./canonical_agents');
  const { buildSubagentContract } = require('./agent_contract');
  const { writeAgentFileSafe, AGENT_OWNERSHIP_MARKER, getRoleDescription } = require('./agent_file_safety');
  const { buildPiSubagentToolGrants } = require('./mcp_clients/common');
  const written = [];
  for (const agent of getDeployableAgents()) {
    const grants = buildPiSubagentToolGrants(agent);
    const description = String(getRoleDescription(agent) || '').replace(/"/g, '\\"').replace(/\n/g, ' ');
    const frontmatter = [
      '---',
      `name: ${agent.name}`,
      `description: "${description}"`,
      AGENT_OWNERSHIP_MARKER,
      'tools:',
      ...grants.map((t) => `  - ${t}`),
      '---',
      ''
    ].join('\n');
    const body = `${agent.instructions}\n\n${buildSubagentContract('pi')}\n`;
    writeAgentFileSafe(path.join(piAgentsDir, `${agent.name}.md`), frontmatter + body, agent.name, { silent });
    written.push(agent.name);
  }
  return written;
}

function deployPiContract(silent = true, targetFile = null, options = {}) {
  const opts = typeof targetFile === "object" && targetFile !== null ? targetFile : options;
  const explicitTarget = typeof targetFile === "string" ? targetFile : (opts && opts.targetFile);
  try {
    const destFile = explicitTarget || (opts && opts.home ? path.join(opts.home, ".pi", "agent", "AGENTS.md") : ((module.exports && module.exports.PI_AGENTS_MD) || PI_AGENTS_MD));
    ensureDirSafe(path.dirname(destFile));
    const existing = fileExists(destFile) ? fs.readFileSync(destFile, 'utf-8') : '';
    const sanitized = stripStalePiMandates(existing);
    const managed = buildManagedContract(sanitized, buildPiManagedContract());
    if (managed === existing) {
      return { ok: true, changed: false };
    }
    if (fileExists(destFile)) {
      const backupMgr = require('./config_backup_manager');
      backupMgr.ensureBackupBeforeModify(destFile, { client: 'pi', scope: 'global', ...opts });
    }
    fs.writeFileSync(destFile, managed, 'utf-8');
    if (!silent) process.stderr.write(`✓ Konoha runtime contract deployed to Pi: ${destFile}\n`);
    return { ok: true, changed: true };
  } catch (err) {
    if (err && /backup/i.test(err.message)) throw err;
    if (!silent) console.warn(`⚠ Pi contract deployment failed: ${err.message}`);
    return { ok: false, reason: 'pi-contract-deploy-failed', error: err.message };
  }
}

/**
 * Removes the Konoha-managed contract block from ~/.pi/agent/AGENTS.md.
 */
function removePiContract(silent = true) {
  if (!fileExists(PI_AGENTS_MD)) return true;
  try {
    const content = fs.readFileSync(PI_AGENTS_MD, 'utf-8');
    const startIndex = content.indexOf('<!-- KONOHA-CONTRACT-START -->');
    const endIndex = content.indexOf('<!-- KONOHA-CONTRACT-END -->');
    if (startIndex === -1 || endIndex === -1) return true;
    const before = content.slice(0, startIndex);
    const after = content.slice(endIndex + '<!-- KONOHA-CONTRACT-END -->'.length);
    const cleaned = (before + after).replace(/^\n+/, '').replace(/\n{3,}/g, '\n\n');
    if (cleaned.trim()) {
      fs.writeFileSync(PI_AGENTS_MD, cleaned, 'utf-8');
    } else {
      fs.unlinkSync(PI_AGENTS_MD);
    }
    if (!silent) process.stderr.write(`✓ Konoha contract removed from Pi global context\n`);
    return true;
  } catch (err) {
    if (!silent) console.warn(`⚠ Could not remove Pi contract: ${err.message}`);
    return false;
  }
}

function getRtkCommandSafe() {
  try {
    const { getRtkCommand } = require('./platform_utils');
    return getRtkCommand();
  } catch (_) {
    return null;
  }
}

/**
 * Deploys RTK for Pi using the official integration (`rtk init -g --agent pi`),
 * which installs the rtk.ts TypeScript extension into ~/.pi/agent/extensions/.
 * The extension intercepts tool_call and rewrites shell commands transparently.
 * A legacy AGENTS.md instruction block (from an earlier konoha version) is
 * cleaned up so instructions and the hook don't double-apply.
 */
function deployPiRtkRule(silent = true) {
  const rtkCmd = getRtkCommandSafe();
  if (!rtkCmd) {
    return { ok: false, reason: 'rtk-not-installed' };
  }
  try {
    ensureDirSafe(PI_AGENT_DIR);
    const res = spawnSync(rtkCmd, ['init', '-g', '--agent', 'pi', '--auto-patch'], {
      encoding: 'utf-8',
      timeout: 30000,
      windowsHide: true
    });
    if (res.status !== 0) {
      const detail = ((res.stderr || '') + (res.stdout || '')).trim().split('\n').pop();
      if (!silent) console.warn(`⚠ rtk init --agent pi failed: ${detail || 'exit ' + res.status}`);
      return { ok: false, reason: 'pi-rtk-init-failed', error: detail };
    }
    cleanupLegacyRtkAgentsBlock();
    if (!silent) process.stderr.write(`✓ RTK Pi extension installed: ${PI_RTK_EXTENSION}\n`);
    return { ok: true, changed: true, path: PI_RTK_EXTENSION };
  } catch (err) {
    if (!silent) console.warn(`⚠ Pi RTK deployment failed: ${err.message}`);
    return { ok: false, reason: 'pi-rtk-deploy-failed', error: err.message };
  }
}

function _cleanPiAgentsMdRtkBlock() {
  if (!fileExists(PI_AGENTS_MD)) return false;
  try {
    const content = fs.readFileSync(PI_AGENTS_MD, 'utf-8');
    const startIndex = content.indexOf(RTK_BLOCK_START);
    const endIndex = content.indexOf(RTK_BLOCK_END);
    if (startIndex === -1 || endIndex === -1) return false;
    const before = content.slice(0, startIndex);
    const after = content.slice(endIndex + RTK_BLOCK_END.length);
    const cleaned = (before + after).replace(/^\n+/, '').replace(/\n{3,}/g, '\n\n');
    if (cleaned.trim()) {
      fs.writeFileSync(PI_AGENTS_MD, cleaned, 'utf-8');
    } else {
      fs.unlinkSync(PI_AGENTS_MD);
    }
    return true;
  } catch (_) { return false; }
}

const cleanupLegacyRtkAgentsBlock = _cleanPiAgentsMdRtkBlock;

function _uninstallPiRtkExtension() {
  if (!fileExists(PI_RTK_EXTENSION)) return false;
  try {
    const rtkCmd = getRtkCommandSafe();
    if (rtkCmd) {
      const res = spawnSync(rtkCmd, ['init', '-g', '--agent', 'pi', '--uninstall'], {
        encoding: 'utf-8', timeout: 30000, windowsHide: true
      });
      return res.status === 0;
    }
  } catch (_) { /* intentional best-effort fallback */ }
  return false;
}

/**
 * Removes RTK artifacts from Pi: the official rtk.ts extension and any legacy
 * AGENTS.md instruction block from earlier konoha versions.
 */
function removePiRtkRule(silent = true) {
  let removed = _uninstallPiRtkExtension();
  if (fileExists(PI_RTK_EXTENSION)) {
    try { fs.unlinkSync(PI_RTK_EXTENSION); removed = true; } catch (_) { /* intentional best-effort fallback */ }
  }
  if (_cleanPiAgentsMdRtkBlock()) {
    removed = true;
  }
  if (removed && !silent) process.stderr.write(`✓ RTK artifacts removed from Pi\n`);
  return true;
}

/**
 * Builds the konoha-blocker.ts extension source. The extension subscribes to
 * the `tool_call` event and blocks Pi's native `read` tool, pointing the agent
 * at the konoha MCP bounded file tools instead — mirroring the
 * PreToolUse native blockers deployed for Claude Code and Command Code.
 * Style mirrors rtk.ts (type-only imports + local type guard) so the
 * extension stays cheap to load.
 */
function deployPiBlockerExtension(silent = true, options = {}) {
  const opts = typeof silent === "object" && silent !== null ? silent : options;
  const isSilent = typeof silent === "boolean" ? silent : (opts.silent !== false);
  const targetExtDir = (opts && opts.home ? path.join(opts.home, ".pi", "agent", "extensions") : path.join(PI_AGENT_DIR, "extensions"));
  const targetExtFile = path.join(targetExtDir, "konoha-blocker.ts");
  try {
    ensureDirSafe(targetExtDir);
    const source = buildPiBlockerExtensionSource();
    const existing = fileExists(targetExtFile) ? fs.readFileSync(targetExtFile, "utf-8") : null;
    if (existing === source) {
      return { ok: true, changed: false, path: targetExtFile };
    }
    fs.writeFileSync(targetExtFile, source, "utf-8");
    if (!isSilent) process.stderr.write(`✓ Konoha native-tool blocker extension deployed to Pi: ${targetExtFile}\n`);
    return { ok: true, changed: true, path: targetExtFile };
  } catch (err) {
    if (!silent) console.warn(`⚠ Pi blocker extension deployment failed: ${err.message}`);
    return { ok: false, reason: 'pi-blocker-deploy-failed', error: err.message };
  }
}

/**
 * Removes the konoha-blocker.ts extension from ~/.pi/agent/extensions/.
 */
function removePiBlockerExtension(silent = true) {
  if (!fileExists(PI_BLOCKER_EXTENSION)) return true;
  try {
    fs.unlinkSync(PI_BLOCKER_EXTENSION);
    if (!silent) process.stderr.write(`✓ Konoha blocker extension removed from Pi\n`);
    return true;
  } catch (err) {
    if (!silent) console.warn(`⚠ Could not remove Pi blocker extension: ${err.message}`);
    return false;
  }
}

function fileExists(p) {
  try {
    return fs.existsSync(p);
  } catch (_) {
    return false;
  }
}

function isPiInstalled() {
  if (fileExists(path.join(HOME, '.pi', 'agent'))) return true;
  try {
    const res = process.platform === 'win32'
      ? spawnSync('pi.cmd --version', { encoding: 'utf-8', timeout: 8000, shell: true, windowsHide: true })
      : spawnSync('pi', ['--version'], { encoding: 'utf-8', timeout: 8000 });
    return res.status === 0;
  } catch (_) {
    return false;
  }
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (_) {
    return null;
  }
}

function _handleCorruptPiSettings(settingsPath, isSilent) {
  try {
    fs.copyFileSync(settingsPath, settingsPath + '.corrupt-' + Date.now());
    if (!isSilent) console.warn(`⚠ ${settingsPath} was invalid JSON — backed up to ${settingsPath}.corrupt-*`);
  } catch (_) { /* intentional best-effort fallback */ }
  return { ok: false, reason: 'pi-settings-corrupt' };
}

function _isAdapterPackagePresent(packages) {
  if (!Array.isArray(packages)) return false;
  return packages.some((pkg) => {
    const source = typeof pkg === 'string' ? pkg : (pkg && pkg.source);
    return typeof source === 'string' && source.split('#')[0] === PI_ADAPTER_PACKAGE;
  });
}

function _writePiAdapterPackage(settingsPath, settings, backupMgr, opts, isSilent) {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
    try {
      backupMgr.recordOwnership(settingsPath, {
        client: 'pi',
        scope: 'global',
        format: 'json',
        ownedArrayItems: { packages: [PI_ADAPTER_PACKAGE] }
      }, opts);
    } catch (_) { /* best-effort */ }
    if (!isSilent) process.stderr.write(`  ✓ pi-mcp-adapter added to Pi packages (${settingsPath})\n`);
    return { ok: true, changed: true };
  } catch (err) {
    return { ok: false, reason: 'pi-settings-write-failed', error: err.message };
  }
}

/**
 * Ensures the pi-mcp-adapter package is listed in Pi settings so the MCP
 * config is actually loaded. Never removes user packages.
 */
function ensureAdapterPackage(silent = true, options = {}) {
  const opts = typeof silent === 'object' && silent !== null ? silent : options;
  const isSilent = typeof silent === 'boolean' ? silent : (opts.silent !== false);
  const settingsPath = (opts && opts.settingsPath) || (opts && opts.home ? path.join(opts.home, '.pi', 'agent', 'settings.json') : PI_SETTINGS);
  if (!fileExists(settingsPath)) {
    return { ok: false, reason: 'pi-settings-missing' };
  }
  const backupMgr = require('./config_backup_manager');
  backupMgr.ensureBackupBeforeModify(settingsPath, { client: 'pi', scope: 'global', ...opts });

  const settings = readJsonSafe(settingsPath);
  if (!settings || typeof settings !== 'object') {
    return _handleCorruptPiSettings(settingsPath, isSilent);
  }
  if (!Array.isArray(settings.packages)) settings.packages = [];
  if (_isAdapterPackagePresent(settings.packages)) {
    return { ok: true, changed: false };
  }
  settings.packages.push(PI_ADAPTER_PACKAGE);
  return _writePiAdapterPackage(settingsPath, settings, backupMgr, opts, isSilent);
}

/**
 * Merges Konoha MCP server entries into the Pi-owned global override
 * (~/.pi/agent/mcp.json). Existing user servers are preserved.
 */
function registerPiMcp(pythonCmd, serverPath, silentOrOptions = true) {
  const silent = typeof silentOrOptions === 'boolean' ? silentOrOptions : (silentOrOptions.silent !== false);
  const options = typeof silentOrOptions === 'object' && silentOrOptions !== null ? silentOrOptions : {};
  const targetDir = options.agentDir || (options.home ? path.join(options.home, '.pi', 'agent') : PI_AGENT_DIR);
  const targetMcp = options.configPath || (options.home ? path.join(targetDir, 'mcp.json') : PI_MCP_CONFIG);

  try {
    ensureDirSafe(targetDir);
    const config = fileExists(targetMcp) ? (readJsonSafe(targetMcp) || {}) : {};
    if (!config.mcpServers || typeof config.mcpServers !== 'object') config.mcpServers = {};

    const isWin = process.platform === 'win32';

    // Match the other clients: the konoha entry serves all 56 canonical tools through
    // the file-tools launcher (which bootstraps node + workspace jail)
    config.mcpServers['konoha'] = {
      command: process.execPath || 'node',
      args: [fileExists(deployUtils.FILE_TOOLS_LAUNCHER_JS) ? deployUtils.FILE_TOOLS_LAUNCHER_JS : deployUtils.FILE_TOOLS_MCP_PATH],
      env: { ACTIVE_CLIENT: 'pi', KONOHA_CLIENT: 'pi', KONOHA_SEMANTIC_SEARCH: '1' }
    };
    delete config.mcpServers['semble'];
    config.mcpServers['aislop'] = { command: isWin ? 'npx.cmd' : 'npx', args: ['-y', '-p', AISLOP_PACKAGE, 'aislop-mcp'] };

    const backupMgr = require('./config_backup_manager');
    if (fileExists(targetMcp)) {
      backupMgr.ensureBackupBeforeModify(targetMcp, { client: 'pi', scope: 'global', ...options });
    }
    try {
      backupMgr.recordOwnership(targetMcp, {
        client: 'pi',
        scope: 'global',
        format: 'json',
        ownedKeys: ['mcpServers.konoha', 'mcpServers.aislop']
      }, options);
    } catch (_) { /* best-effort */ }

    fs.writeFileSync(targetMcp, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    if (!silent) process.stderr.write(`✓ Pi MCP servers registered: ${targetMcp}\n`);
    return { ok: true, configPath: targetMcp };
  } catch (err) {
    if (err && /backup/i.test(err.message)) throw err;
    if (!silent) console.warn(`⚠ Pi MCP registration failed: ${err.message}`);
    return { ok: false, reason: 'pi-mcp-registration-failed', error: err.message };
  }
}

function removePiMcp(silent = true) {
  if (!fileExists(PI_MCP_CONFIG)) return true;
  const config = readJsonSafe(PI_MCP_CONFIG);
  if (!config || typeof config !== 'object' || !config.mcpServers) return true;
  let removed = false;
  for (const key of KONOHA_SERVER_KEYS) {
    if (config.mcpServers[key]) {
      delete config.mcpServers[key];
      removed = true;
    }
  }
  try {
    fs.writeFileSync(PI_MCP_CONFIG, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    if (removed && !silent) process.stderr.write(`✓ Konoha MCP servers removed from Pi config: ${PI_MCP_CONFIG}\n`);
    return true;
  } catch (err) {
    if (!silent) console.warn(`⚠ Could not update Pi MCP config: ${err.message}`);
    return false;
  }
}

function ensurePiSetup(options = {}) {
  const {
    pythonCmd = null,
    serverPath = null,
    silent = true,
    force = false,
    skipDetection = false
  } = options;

  if (!force && !skipDetection && !isPiInstalled()) {
    return { ok: false, reason: 'pi-not-installed' };
  }
  const agentDir = options.agentDir || (options.home ? path.join(options.home, '.pi', 'agent') : PI_AGENT_DIR);
  const settingsPath = options.settingsPath || (options.home ? path.join(agentDir, 'settings.json') : PI_SETTINGS);
  ensureDirSafe(agentDir);

  if (!fileExists(settingsPath)) {
    try {
      fs.writeFileSync(settingsPath, JSON.stringify({ packages: [PI_ADAPTER_PACKAGE] }, null, 2) + '\n', 'utf-8');
    } catch (err) {
      return { ok: false, reason: 'pi-settings-unavailable', error: err.message };
    }
  }
  const adapter = ensureAdapterPackage(silent, { ...options, settingsPath });
  const registration = registerPiMcp(pythonCmd, serverPath, { ...options, silent });
  if (!registration.ok) return registration;
  const rtk = deployPiRtkRule(silent);
  const contract = deployPiContract(silent, null, options);
  const blocker = deployPiBlockerExtension(silent, options);
  const piAgentsDir = path.join(agentDir, 'agents');
  ensureDirSafe(piAgentsDir);
  const deployedAgents = deployPiAgentProfiles(piAgentsDir, { silent });

  const projectRoot = options.projectRoot || null;
  const projMcp = projectRoot ? path.join(projectRoot, '.pi', 'mcp.json') : null;
  if (projMcp && (options.appendProject || (options.deployProject && fileExists(projMcp)))) {
    registerPiMcp(pythonCmd, serverPath, {
      ...options,
      agentDir: path.join(projectRoot, '.pi'),
      configPath: projMcp,
      silent
    });
  }

  return {
    ok: true,
    changed: !!(adapter.changed || contract.changed || blocker.changed),
    agentsDeployed: deployedAgents,
    rtkDeployed: !!rtk.ok,
    contractDeployed: !!contract.ok,
    blockerDeployed: !!blocker.ok
  };
}

function hasPiSubagentSupport(options = {}) {
  const agentDir = options.agentDir || (options.home ? path.join(options.home, '.pi', 'agent') : PI_AGENT_DIR);
  const settingsPath = options.settingsPath || path.join(agentDir, 'settings.json');
  const extCandidates = [
    path.join(agentDir, 'extensions', 'subagent'),
    path.join(agentDir, 'extensions', 'pi-subagents'),
    path.join(agentDir, 'extensions', 'subagent.ts'),
    path.join(agentDir, 'extensions', 'subagent.js')
  ];
  if (extCandidates.some((p) => fileExists(p))) {
    return true;
  }
  const settings = readJsonSafe(settingsPath);
  if (settings && Array.isArray(settings.packages)) {
    return settings.packages.some((pkg) => {
      const source = typeof pkg === 'string' ? pkg : (pkg && pkg.source);
      return typeof source === 'string' && /pi-subagents/i.test(source);
    });
  }
  return false;
}

function _readPiMcpServerFlags() {
  if (!fileExists(PI_MCP_CONFIG)) return { mcpKonoha: false, mcpAislop: false };
  const config = readJsonSafe(PI_MCP_CONFIG);
  const servers = config && config.mcpServers;
  return {
    mcpKonoha: Boolean(servers && servers['konoha']),
    mcpAislop: Boolean(servers && servers['aislop'])
  };
}

function _isPiAdapterPackageInstalled() {
  if (!fileExists(PI_SETTINGS)) return false;
  const settings = readJsonSafe(PI_SETTINGS);
  if (!settings || !Array.isArray(settings.packages)) return false;
  return settings.packages.some((pkg) => {
    const source = typeof pkg === 'string' ? pkg : (pkg && pkg.source);
    return typeof source === 'string' && source.split('#')[0] === PI_ADAPTER_PACKAGE;
  });
}

function _readPiAgentsContent() {
  if (!fileExists(PI_AGENTS_MD)) return '';
  try {
    return fs.readFileSync(PI_AGENTS_MD, 'utf-8');
  } catch (_) {
    return '';
  }
}

/**
 * Agent profile names present in a Pi agents directory, without the extension.
 *
 * @returns {string[]} sorted names, empty when the directory is absent
 */
function readPiAgentProfileNames(agentsDir) {
  try {
    return fs.readdirSync(agentsDir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.slice(0, -3))
      .sort();
  } catch (_) { /* absent directory: no profiles deployed yet */
    return [];
  }
}

function getPiStatus(options = {}) {
  const installed = isPiInstalled();
  const { mcpKonoha, mcpAislop } = _readPiMcpServerFlags();
  const adapterInstalled = _isPiAdapterPackageInstalled();
  const subagentExtensionInstalled = hasPiSubagentSupport(options);
  const blockerDeployed = fileExists(PI_BLOCKER_EXTENSION);
  const agentsContent = _readPiAgentsContent();
  const rtkRuleDeployed = fileExists(PI_RTK_EXTENSION) || agentsContent.includes(RTK_BLOCK_START);
  const contractDeployed = agentsContent.includes('<!-- KONOHA-CONTRACT-START -->');
  const agentDir = options.agentDir || (options.home ? path.join(options.home, '.pi', 'agent') : PI_AGENT_DIR);
  const agentProfiles = readPiAgentProfileNames(path.join(agentDir, 'agents'));
  const missingAgentProfiles = require('./canonical_agents')
    .getDeployableAgentNames()
    .filter((name) => !agentProfiles.includes(name));

  return {
    installed,
    mcpKonoha,
    mcpAislop,
    configured: mcpKonoha,
    adapterInstalled,
    rtkRuleDeployed,
    contractDeployed,
    blockerDeployed,
    subagentExtensionInstalled,
    // A subagent extension alone cannot spawn anything: the harness also needs a
    // profile per agent, which is what this field makes visible.
    agentProfiles,
    missingAgentProfiles,
    agentRosterComplete: missingAgentProfiles.length === 0,
    configPath: PI_MCP_CONFIG
  };
}

function ensureDirSafe(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
}

module.exports = {
  PI_AGENT_DIR,
  PI_SETTINGS,
  PI_MCP_CONFIG,
  PI_AGENTS_MD,
  PI_RTK_EXTENSION,
  PI_SUBAGENT_EXTENSION_DIR,
  PI_SUBAGENTS_EXT_DIR,
  PI_ADAPTER_PACKAGE,
  buildPiBlockerExtensionSource,
  buildPiWorkflowAddendum,
  isPiInstalled,
  hasPiSubagentSupport,
  ensurePiSetup,
  ensureAdapterPackage,
  registerPiMcp,
  deployPiRtkRule,
  deployPiContract,
  deployPiAgentProfiles,
  readPiAgentProfileNames,
  stripStalePiMandates,
  deployPiBlockerExtension,
  removePiBlockerExtension,
  removePiContract,
  removePiRtkRule,
  removePiMcp,
  removePiConfig: removePiMcp,
  getPiStatus
};
