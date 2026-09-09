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
const os = require('os');
const { spawnSync } = require('child_process');
const deployUtils = require('./deploy_utils');
const { buildMainAgentContract, buildManagedContract } = require('./agent_contract');

const HOME = os.homedir();
const PI_AGENT_DIR = path.join(HOME, '.pi', 'agent');
const PI_SETTINGS = path.join(PI_AGENT_DIR, 'settings.json');
const PI_MCP_CONFIG = path.join(PI_AGENT_DIR, 'mcp.json');
const PI_ADAPTER_PACKAGE = 'npm:pi-mcp-adapter';

const KONOHA_SERVER_KEYS = ['konoha', 'semble', 'aislop'];

const PI_AGENTS_MD = path.join(PI_AGENT_DIR, 'AGENTS.md');
const PI_RTK_EXTENSION = path.join(PI_AGENT_DIR, 'extensions', 'rtk.ts');
const PI_BLOCKER_EXTENSION = path.join(PI_AGENT_DIR, 'extensions', 'konoha-blocker.ts');
const RTK_BLOCK_START = '<!-- KONOHA-RTK-START -->';
const RTK_BLOCK_END = '<!-- KONOHA-RTK-END -->';

/**
 * Pi-specific workflow mandate: without this, Pi only sees its native
 * /skill: mirrors of the konoha skills and executes multi-step work itself,
 * never touching the sannin/kage workflow. Deployed into ~/.pi/agent/AGENTS.md
 * (Pi's global context file) as a Konoha-managed block.
 */
function buildPiWorkflowAddendum() {
  return `

## Konoha Workflow Mandate (Pi) — MANDATORY

- **Route through the village, never free-run**: for any non-trivial task, start from the \`konoha\` MCP tool \`sannin\` (task triage + \`get_resolved_task_dir\`) and follow the delegate.md phases — explore with \`genin\`, plan with \`kage\`, execute with \`jonin\`/\`anbu\`/\`chunin\`, document with \`tokubetsu-jonin\`, review with \`kage\`. Do NOT decompose and execute multi-step engineering work yourself.
- **Skills via Konoha MCP first**: use \`konoha.find_skill\` / \`konoha.get_skill\` instead of the native \`/skill:\` mirrors. The project \`.agents/skills/\` entries are pre-seeded mirrors of the same skills — the duplicate-skill warnings at startup are expected and always resolved project-first; prefer the Konoha MCP path.
- **Code search via Semble**: use \`semble.search\` / \`semble.find_related\` with the absolute repository path — never native grep/glob/find for codebase discovery.
- **Bounded file tools**: use \`konoha.read_file_head\`, \`read_file_range\`, \`file_info\`, \`get_file_structure\`, \`find_files_clean\`, \`token_efficient_grep\` instead of native read/grep when scanning the repository.
- **Workflow artifacts** (\`prompt.md\`, \`plan.md\`, \`result.md\`, \`delegate.md\`, \`findings.md\`) live in the task directory returned by \`konoha.get_resolved_task_dir\` — never in the workspace root.
- **Delivery gate**: never claim completion without validation evidence (\`0 errors and 0 warnings\`). Kage review (\`confidence >= 97\`, \`ai_slop_findings = 0\`, \`ai_slop_clean = true\`) is mandatory before final delivery.
`;
}

/**
 * Deploys the Konoha runtime contract + Pi workflow mandate into
 * ~/.pi/agent/AGENTS.md (Pi's global context file) using managed markers.
 */
function deployPiContract(silent = true) {
  try {
    ensureDirSafe(PI_AGENT_DIR);
    const existing = fileExists(PI_AGENTS_MD) ? fs.readFileSync(PI_AGENTS_MD, 'utf-8') : '';
    const managed = buildManagedContract(existing, buildMainAgentContract('pi') + buildPiWorkflowAddendum());
    if (managed === existing) {
      return { ok: true, changed: false };
    }
    fs.writeFileSync(PI_AGENTS_MD, managed, 'utf-8');
    if (!silent) console.log(`✓ Konoha runtime contract deployed to Pi: ${PI_AGENTS_MD}`);
    return { ok: true, changed: true };
  } catch (err) {
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
    if (!silent) console.log(`✓ Konoha contract removed from Pi global context`);
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
      timeout: 30000
    });
    if (res.status !== 0) {
      const detail = ((res.stderr || '') + (res.stdout || '')).trim().split('\n').pop();
      if (!silent) console.warn(`⚠ rtk init --agent pi failed: ${detail || 'exit ' + res.status}`);
      return { ok: false, reason: 'pi-rtk-init-failed', error: detail };
    }
    cleanupLegacyRtkAgentsBlock();
    if (!silent) console.log(`✓ RTK Pi extension installed: ${PI_RTK_EXTENSION}`);
    return { ok: true, changed: true, path: PI_RTK_EXTENSION };
  } catch (err) {
    if (!silent) console.warn(`⚠ Pi RTK deployment failed: ${err.message}`);
    return { ok: false, reason: 'pi-rtk-deploy-failed', error: err.message };
  }
}

function cleanupLegacyRtkAgentsBlock() {
  if (!fileExists(PI_AGENTS_MD)) return;
  try {
    const content = fs.readFileSync(PI_AGENTS_MD, 'utf-8');
    const startIndex = content.indexOf(RTK_BLOCK_START);
    const endIndex = content.indexOf(RTK_BLOCK_END);
    if (startIndex === -1 || endIndex === -1) return;
    const before = content.slice(0, startIndex);
    const after = content.slice(endIndex + RTK_BLOCK_END.length);
    const cleaned = (before + after).replace(/^\n+/, '').replace(/\n{3,}/g, '\n\n');
    if (cleaned.trim()) {
      fs.writeFileSync(PI_AGENTS_MD, cleaned, 'utf-8');
    } else {
      fs.unlinkSync(PI_AGENTS_MD);
    }
  } catch (_) {}
}

/**
 * Removes RTK artifacts from Pi: the official rtk.ts extension and any legacy
 * AGENTS.md instruction block from earlier konoha versions.
 */
function removePiRtkRule(silent = true) {
  let removed = false;
  if (fileExists(PI_RTK_EXTENSION)) {
    try {
      const rtkCmd = getRtkCommandSafe();
      if (rtkCmd) {
        const res = spawnSync(rtkCmd, ['init', '-g', '--agent', 'pi', '--uninstall'], {
          encoding: 'utf-8', timeout: 30000
        });
        if (res.status === 0) removed = true;
      }
    } catch (_) {}
  }
  if (fileExists(PI_RTK_EXTENSION)) {
    try { fs.unlinkSync(PI_RTK_EXTENSION); removed = true; } catch (_) {}
  }
  if (fileExists(PI_AGENTS_MD)) {
    try {
      const content = fs.readFileSync(PI_AGENTS_MD, 'utf-8');
      const startIndex = content.indexOf(RTK_BLOCK_START);
      const endIndex = content.indexOf(RTK_BLOCK_END);
      if (startIndex !== -1 && endIndex !== -1) {
        const before = content.slice(0, startIndex);
        const after = content.slice(endIndex + RTK_BLOCK_END.length);
        const cleaned = (before + after).replace(/^\n+/, '').replace(/\n{3,}/g, '\n\n');
        if (cleaned.trim()) {
          fs.writeFileSync(PI_AGENTS_MD, cleaned, 'utf-8');
        } else {
          fs.unlinkSync(PI_AGENTS_MD);
        }
        removed = true;
      }
    } catch (_) {}
  }
  if (removed && !silent) console.log(`✓ RTK artifacts removed from Pi`);
  return true;
}

/**
 * Builds the konoha-blocker.ts extension source. The extension subscribes to
 * the `tool_call` event and blocks Pi's native `read` tool, pointing the agent
 * at the konoha MCP bounded file tools / semble instead — mirroring the
 * PreToolUse native blockers deployed for Claude Code and Command Code.
 * Style mirrors rtk.ts (type-only imports + local type guard) so the
 * extension stays cheap to load.
 */
function buildPiBlockerExtensionSource() {
  return [
    '// Konoha native-tool blocker for Pi (auto-managed by konoha pi_manager).',
    '// Blocks the native read tool to enforce the konoha MCP bounded file tools.',
    '// Removal: run konoha uninstall for Pi, or delete this file.',
    'import type { ExtensionAPI, ToolCallEvent } from "@earendil-works/pi-coding-agent";',
    '',
    'const REASON =',
    '  "MANDATORY RULE VIOLATION: Using the built-in/native read tool is STRICTLY FORBIDDEN! " +',
    '  "You MUST use the konoha MCP bounded file tools " +',
    '  "(read_file_head, read_file_range, file_info, get_file_structure, find_files_clean, token_efficient_grep) " +',
    '  "or the semble MCP (search / find_related) for codebase reading and search instead.";',
    '',
    'function isReadToolCallEvent(event: ToolCallEvent): boolean {',
    '  return event.toolName === "read";',
    '}',
    '',
    'export default function konohaBlocker(pi: ExtensionAPI) {',
    '  pi.on("tool_call", (event) => {',
    '    if (isReadToolCallEvent(event)) {',
    '      return { block: true, reason: REASON };',
    '    }',
    '    return undefined;',
    '  });',
    '}',
    ''
  ].join('\n');
}

/**
 * Deploys the konoha-blocker.ts extension into ~/.pi/agent/extensions/.
 * Pi auto-loads every file in that directory at startup (same mechanism as
 * rtk.ts), so no settings registration is needed. Idempotent: rewrites only
 * when the on-disk source differs. Note: pi loads extensions at startup
 * only — a running pi session must be restarted to pick this up.
 */
function deployPiBlockerExtension(silent = true) {
  try {
    ensureDirSafe(path.join(PI_AGENT_DIR, 'extensions'));
    const source = buildPiBlockerExtensionSource();
    const existing = fileExists(PI_BLOCKER_EXTENSION) ? fs.readFileSync(PI_BLOCKER_EXTENSION, 'utf-8') : null;
    if (existing === source) {
      return { ok: true, changed: false, path: PI_BLOCKER_EXTENSION };
    }
    fs.writeFileSync(PI_BLOCKER_EXTENSION, source, 'utf-8');
    if (!silent) console.log(`✓ Konoha native-tool blocker extension deployed to Pi: ${PI_BLOCKER_EXTENSION}`);
    return { ok: true, changed: true, path: PI_BLOCKER_EXTENSION };
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
    if (!silent) console.log(`✓ Konoha blocker extension removed from Pi`);
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
    const cmd = process.platform === 'win32' ? 'pi.cmd' : 'pi';
    const res = spawnSync(cmd, ['--version'], { encoding: 'utf-8', timeout: 8000, shell: process.platform === 'win32' });
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

/**
 * Ensures the pi-mcp-adapter package is listed in Pi settings so the MCP
 * config is actually loaded. Never removes user packages.
 */
function ensureAdapterPackage(silent = true) {
  if (!fileExists(PI_SETTINGS)) {
    return { ok: false, reason: 'pi-settings-missing' };
  }
  const settings = readJsonSafe(PI_SETTINGS);
  if (!settings || typeof settings !== 'object') {
    // Corrupt settings: back up before any modification attempt
    try {
      fs.copyFileSync(PI_SETTINGS, PI_SETTINGS + '.corrupt-' + Date.now());
      if (!silent) {
        console.warn(`⚠ ${PI_SETTINGS} was invalid JSON — backed up to ${PI_SETTINGS}.corrupt-*`);
      }
    } catch (_) {}
    return { ok: false, reason: 'pi-settings-corrupt' };
  }
  if (!Array.isArray(settings.packages)) settings.packages = [];
  const present = settings.packages.some((pkg) => {
    const source = typeof pkg === 'string' ? pkg : (pkg && pkg.source);
    return typeof source === 'string' && source.split('#')[0] === PI_ADAPTER_PACKAGE;
  });
  if (present) {
    return { ok: true, changed: false };
  }
  settings.packages.push(PI_ADAPTER_PACKAGE);
  try {
    fs.writeFileSync(PI_SETTINGS, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
    if (!silent) console.log(`  ✓ pi-mcp-adapter added to Pi packages (${PI_SETTINGS})`);
    return { ok: true, changed: true };
  } catch (err) {
    return { ok: false, reason: 'pi-settings-write-failed', error: err.message };
  }
}

/**
 * Merges Konoha MCP server entries into the Pi-owned global override
 * (~/.pi/agent/mcp.json). Existing user servers are preserved.
 */
function registerPiMcp(pythonCmd, serverPath, uvxCmd, silent = true) {
  try {
    ensureDirSafe(PI_AGENT_DIR);
    let config = {};
    if (fileExists(PI_MCP_CONFIG)) {
      const parsed = readJsonSafe(PI_MCP_CONFIG);
      if (parsed && typeof parsed === 'object') {
        config = parsed;
      } else {
        // Corrupt config: back it up so user servers are recoverable
        try {
          fs.copyFileSync(PI_MCP_CONFIG, PI_MCP_CONFIG + '.corrupt-' + Date.now());
          if (!silent) console.warn(`⚠ ${PI_MCP_CONFIG} was invalid JSON — backed up to ${PI_MCP_CONFIG}.corrupt-*`);
        } catch (_) {}
        config = {};
      }
    }
    if (!config.mcpServers || typeof config.mcpServers !== 'object') config.mcpServers = {};

    const uvxAvailable = (() => {
      try {
        const res = spawnSync(uvxCmd || 'uvx', ['--version'], { encoding: 'utf-8', timeout: 5000, shell: process.platform === 'win32' });
        return res.status === 0;
      } catch (_) {
        return false;
      }
    })();

    config.mcpServers['konoha'] = {
      command: process.execPath || 'node',
      // Match the other clients: the konoha entry serves ALL 39 tools through
      // the file-tools launcher (which bootstraps node + workspace jail),
      // not the orchestrator-only server.js
      args: [fileExists(deployUtils.FILE_TOOLS_LAUNCHER_JS) ? deployUtils.FILE_TOOLS_LAUNCHER_JS : deployUtils.FILE_TOOLS_MCP_PATH],
      env: {
        ACTIVE_CLIENT: 'pi',
        KONOHA_CLIENT: 'pi',
        KONOHA_SEMANTIC_SEARCH: '1'
      }
    };
    if (uvxAvailable) {
      config.mcpServers['semble'] = {
        command: uvxCmd || 'uvx',
        args: ['--from', 'semble[mcp]@latest', 'semble', '--content', 'all']
      };
    }
    config.mcpServers['aislop'] = {
      command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
      args: ['-y', '-p', 'aislop', 'aislop-mcp']
    };

    fs.writeFileSync(PI_MCP_CONFIG, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    if (!silent) console.log(`✓ Pi MCP servers registered: ${PI_MCP_CONFIG}`);
    return { ok: true };
  } catch (err) {
    if (!silent) console.warn(`⚠ Pi MCP registration failed: ${err.message}`);
    return { ok: false, reason: 'pi-mcp-registration-failed', error: err.message };
  }
}

/**
 * Removes only Konoha-owned server entries from the Pi MCP config.
 * User-configured servers are never touched.
 */
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
    if (removed && !silent) console.log(`✓ Konoha MCP servers removed from Pi config: ${PI_MCP_CONFIG}`);
    return true;
  } catch (err) {
    if (!silent) console.warn(`⚠ Could not update Pi MCP config: ${err.message}`);
    return false;
  }
}

/**
 * Full setup: adapter package + MCP server registration.
 * Mirrors the option contract of the other client managers.
 */
function ensurePiSetup(options = {}) {
  const {
    pythonCmd = null,
    serverPath = null,
    uvxCmd = null,
    silent = true
  } = options;

  if (!isPiInstalled()) {
    return { ok: false, reason: 'pi-not-installed' };
  }
  if (!fileExists(PI_AGENT_DIR)) {
    // pi installed on PATH but never launched — create the agent dir so the
    // config lands in the documented location
    try {
      fs.mkdirSync(PI_AGENT_DIR, { recursive: true });
    } catch (err) {
      return { ok: false, reason: 'pi-agent-dir-unavailable', error: err.message };
    }
  }
  if (!fileExists(PI_SETTINGS)) {
    // Fresh install: pi creates settings.json on first launch; seed a minimal one
    try {
      fs.writeFileSync(PI_SETTINGS, JSON.stringify({ packages: [PI_ADAPTER_PACKAGE] }, null, 2) + '\n', 'utf-8');
    } catch (err) {
      return { ok: false, reason: 'pi-settings-unavailable', error: err.message };
    }
  }
  const adapter = ensureAdapterPackage(silent);
  if (!adapter.ok) {
    return adapter;
  }
  const registration = registerPiMcp(pythonCmd, serverPath, uvxCmd, silent);
  if (!registration.ok) {
    return registration;
  }
  const rtk = deployPiRtkRule(silent);
  const contract = deployPiContract(silent);
  const blocker = deployPiBlockerExtension(silent);
  return {
    ok: true,
    changed: !!(adapter.changed || contract.changed || blocker.changed),
    rtkDeployed: !!rtk.ok,
    contractDeployed: !!contract.ok,
    blockerDeployed: !!blocker.ok
  };
}

function getPiStatus() {
  const installed = isPiInstalled();
  let mcpKonoha = false;
  let mcpSemble = false;
  let mcpAislop = false;
  let adapterInstalled = false;
  let rtkRuleDeployed = false;
  let contractDeployed = false;
  let blockerDeployed = false;
  if (fileExists(PI_MCP_CONFIG)) {
    const config = readJsonSafe(PI_MCP_CONFIG);
    if (config && config.mcpServers) {
      mcpKonoha = !!config.mcpServers['konoha'];
      mcpSemble = !!config.mcpServers['semble'];
      mcpAislop = !!config.mcpServers['aislop'];
    }
  }
  if (fileExists(PI_SETTINGS)) {
    const settings = readJsonSafe(PI_SETTINGS);
    if (settings && Array.isArray(settings.packages)) {
      adapterInstalled = settings.packages.some((pkg) => {
        const source = typeof pkg === 'string' ? pkg : (pkg && pkg.source);
        return typeof source === 'string' && source.split('#')[0] === PI_ADAPTER_PACKAGE;
      });
    }
  }
  if (fileExists(PI_RTK_EXTENSION)) {
    rtkRuleDeployed = true;
  } else if (fileExists(PI_AGENTS_MD)) {
    try {
      const agents = fs.readFileSync(PI_AGENTS_MD, 'utf-8');
      rtkRuleDeployed = agents.includes(RTK_BLOCK_START);
    } catch (_) {}
  }
  if (fileExists(PI_BLOCKER_EXTENSION)) {
    blockerDeployed = true;
  }
  if (fileExists(PI_AGENTS_MD)) {
    try {
      contractDeployed = fs.readFileSync(PI_AGENTS_MD, 'utf-8').includes('<!-- KONOHA-CONTRACT-START -->');
    } catch (_) {}
  }
  return {
    installed,
    mcpKonoha,
    mcpSemble,
    mcpAislop,
    configured: mcpKonoha,
    adapterInstalled,
    rtkRuleDeployed,
    contractDeployed,
    blockerDeployed,
    configPath: PI_MCP_CONFIG
  };
}

function ensureDirSafe(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (_) {}
}

module.exports = {
  PI_AGENT_DIR,
  PI_SETTINGS,
  PI_MCP_CONFIG,
  PI_AGENTS_MD,
  PI_RTK_EXTENSION,
  PI_ADAPTER_PACKAGE,
  isPiInstalled,
  ensurePiSetup,
  ensureAdapterPackage,
  registerPiMcp,
  deployPiRtkRule,
  deployPiContract,
  deployPiBlockerExtension,
  removePiBlockerExtension,
  removePiContract,
  removePiRtkRule,
  removePiMcp,
  removePiConfig: removePiMcp,
  getPiStatus
};
