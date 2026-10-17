'use strict';

/**
 * src/omp_manager.js — OMP Agent client integration for Konoha.
 *
 * Configures Konoha MCP servers, workflow contracts, and RTK rules for OMP.
 * OMP agent configuration lives under ~/.omp/agent/ (mcp.json, AGENTS.md).
 * In projects, local skills live under .omp/skills/.
 */

const fs = require('fs');
const path = require('path');

const {
  OMP_DIR,
  OMP_AGENT_DIR,
  OMP_MCP_CONFIG,
  OMP_AGENTS_MD,
  OMP_SKILLS,
  FILE_TOOLS_LAUNCHER_JS,
  SERVER_PATH
} = require('../bin/lib/paths');

const {
  fileExists,
  ensureDir,
  isCommandAvailable,
  fileExistsCached,
  isRtkInstalled
} = require('./platform_utils');

const { SEMBLE_PACKAGE, AISLOP_PACKAGE } = require('./semble_manager');
const { buildMainAgentContract, buildManagedContract } = require('./agent_contract');

const KONOHA_SERVER_KEYS = ['konoha', 'semble', 'aislop'];
const CONTRACT_START_MARKER = '<!-- KONOHA-CONTRACT-START -->';
const CONTRACT_END_MARKER = '<!-- KONOHA-CONTRACT-END -->';
const OMP_MANDATE_HEADING = '## Konoha Workflow Mandate (OMP) — MANDATORY';

function isOmpInstalled() {
  return (
    isCommandAvailable('omp') ||
    fileExistsCached(OMP_DIR) ||
    fileExistsCached(OMP_AGENT_DIR) ||
    fileExistsCached(OMP_MCP_CONFIG) ||
    fileExistsCached(OMP_AGENTS_MD)
  );
}

function getOmpConfigPath() {
  if (fileExists(OMP_MCP_CONFIG)) return OMP_MCP_CONFIG;
  const legacyConfig = path.join(OMP_DIR, 'mcp.json');
  if (fileExists(legacyConfig)) return legacyConfig;
  return OMP_MCP_CONFIG;
}

function getOmpAgentsMdPath() {
  return OMP_AGENTS_MD;
}

function readJsonSafe(filePath) {
  try {
    if (!fileExists(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (_) {
    return null;
  }
}

function writeJsonAtomic(filePath, data) {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.tmp.${Date.now()}`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  fs.renameSync(tempPath, filePath);
}

function buildOmpWorkflowAddendum() {
  return `
## Konoha Workflow Mandate (OMP) — MANDATORY

- **Route through the village, never free-run**: for any non-trivial task, start from the \`konoha\` MCP tool \`sannin\` (task triage + \`get_resolved_task_dir\`) and follow the delegate.md phases — explore with \`genin\`, plan with \`kage\`, execute with \`jonin\`/\`anbu\`/\`chunin\`, document with \`tokubetsu-jonin\`, review with \`kage\`. Do NOT decompose and execute multi-step engineering work yourself.
- **Step 0: Classify request — ALWAYS FIRST (Branch A vs Branch B)**:
  - **Website build intent** (build/create/scaffold/generate/make + website/web app/landing page/UI/frontend/site/e-commerce/storefront/portfolio/dashboard/app, OR framework-specific like "next.js project"/"svelte app"/"nuxt site") → **BRANCH B (Website Scaffolding)**.
  - **Design mockups provided** (source-image-design, mockup images, figma) → **BRANCH B** with \`konoha.build_from_source\`.
  - **Everything else** → **BRANCH A** (standard multi-agent workflow above).
- **BRANCH B: Website Scaffolding Pipeline (SKIP standard pipeline)**:
  - Call \`konoha.build_from_text(name, description, framework, taste_dials?)\` or \`konoha.build_from_source(name, source_dir, framework, taste_dials?)\` FIRST before writing any code or scaffolding.
  - Write \`delegate.md\` with the returned directives as constraints and call \`konoha.jonin\` directly — DO NOT call Chunin, Genin, or Kage.
  - Jonin implements the complete working website with an inline \`README.md\` and executes validation commands cleanly. DO NOT delegate to \`tokubetsu-jonin\` or other subagents unless technical documentation was explicitly requested by the user.
- **Mandatory Default Konoha Design & Layout Invariants (Text-Based Builds ONLY)**:
  - **Header Logo on Far LEFT**: Brand logo MUST always be placed on the far LEFT of the navigation header with nav links adjacent/centered and action buttons on the right. Never center or push logo right.
  - **Mobile View Invariant (NO Hamburger Menu Toggle in Header)**: In mobile view (\`lg:hidden\`), **NEVER show a top menu toggle / hamburger button in the header**. Mobile navigation is powered exclusively by the fixed bottom Mobile Dock!
  - **Archetype-Adaptive Mobile Dock**: Fixed bottom mobile navigation dock on mobile viewports (\`lg:hidden\`) with quick one-tap links adapted dynamically to the website archetype (e.g. *E-commerce*: Home, Shop, Themes, Wishlist, Cart; *Portfolio*: Home, Projects, Case Studies, About, Contact; *Dashboard*: Overview, Analytics, Users, Settings; *SaaS*: Home, Features, Pricing, Contact).
  - **Dashboard & Admin Left Sidebar Invariant**: For Admin, Dashboard, and Infra builds, implement a fixed Left Sidebar on desktop (\`lg:flex\`) with brand logo at top-left, menu items with badges, and user profile badge. In mobile view (\`lg:hidden\`), navigation is seamlessly handled by the Mobile Dock with zero broken header menu toggles.
  - **Floating Bottom-Left Theme Switcher Popup**: In both desktop and mobile viewports, the interactive 10-Theme Light-Mode Switcher button is positioned floating in the **bottom-left corner** (\`fixed bottom-6 left-6 z-50\`, like a customer chat/FAB button) that opens the 10-theme selection popup modal with dynamic CSS variables and localStorage persistence. Pure Light Mode is first-class (zero dark mode enforcement).
  - **Hero Banner Carousel**: Homepage hero MUST implement an interactive banner carousel with a minimum of 4 high-definition slides, 5000ms autoplay with hover pause, previous/next controls, and thumbnails/dots.
  - **Taste-Skill Prettification**: Combine with Taste-Skill for visual enrichments (editorial typography, negative space, subtle 3D hover tilt, glassmorphism, zero emoji policy in UI controls) without altering the default Konoha design.
  - **Standard Framework Scaffolding via pnpm**: Always use token-safe, non-interactive flags wrapped with rtk: Next.js (\`rtk pnpm create next-app@latest <project-name> --typescript --tailwind --eslint --app --src-dir --no-turbopack --import-alias "@/*" --use-pnpm --silent\`), Nuxt (\`rtk pnpm dlx nuxi@latest init <project-name> --packageManager pnpm --gitInit false\`), Angular (\`rtk pnpm dlx @angular/cli@latest new <project-name> --package-manager=pnpm --style=scss --routing=true --ssr=false --skip-tests=true --skip-git=true\`), SvelteKit (\`rtk pnpm dlx sv create <project-name> --template minimal --types ts --no-add-ons --install pnpm\`). Always install packages with \`rtk pnpm add <packages> --silent\` to suppress verbose installation logs.
  - **Mandatory package.json Scripts Invariant**: Across all 4 supported frameworks (Next.js, SvelteKit, Nuxt, Angular), every generated or scaffolded project's \`package.json\` MUST always define working scripts for \`"lint"\` (\`pnpm run lint\`), \`"build"\` (\`pnpm run build\`), and \`"start"\` (\`pnpm run start\`) (plus \`"check"\` for SvelteKit). All three commands must execute cleanly without missing script errors.
  - **Zero Errors & Zero Warnings**: Do not claim completion until every configured framework validation command (\`pnpm run build\`, \`pnpm run lint\`, \`pnpm run check\` for SvelteKit) passes cleanly with 0 errors and 0 warnings.
- **Skills via Konoha MCP first**: use \`konoha.find_skill\` / \`konoha.get_skill\` instead of the native \`/skill:\` mirrors. The project \`.agents/skills/\` entries are pre-seeded mirrors of the same skills; duplicate-skill warnings are automatically filtered by konoha-blocker; prefer the Konoha MCP path.
- **Code search via Semble**: use \`semble.search\` / \`semble.find_related\` with the absolute repository path — never native grep/glob/find for codebase discovery.
- **Bounded file tools**: use \`konoha.read_file_head\`, \`read_file_range\`, \`file_info\`, \`get_file_structure\`, \`find_files_clean\`, \`token_efficient_grep\` instead of native read/grep when scanning the repository.
- **Workflow artifacts** (\`prompt.md\`, \`plan.md\`, \`result.md\`, \`delegate.md\`, \`findings.md\`) live in the task directory returned by \`konoha.get_resolved_task_dir\` — never in the workspace root.
- **Delivery gate**: never claim completion without validation evidence (\`0 errors and 0 warnings\`). Kage review (\`confidence >= 98\`, \`ai_slop_findings = 0\`, \`ai_slop_clean = true\`) is mandatory before final delivery.
- **Base personality: High Effort + Instruct Style**: Strictly zero conversational filler (no "hmmmm", "let me", "wait - but"), lead with direct action, ADHD-friendly structured formatting, zero hallucination, and strictly no lies.
- **Review token hygiene & strict changed-files scoping (NEVER BURN TOKENS)**: Across all clients (Pi, Antigravity, Cursor, Claude Code, OpenCode, CommandCode, Codex, OMP), agents MUST NEVER execute unscoped full-repository scans (\`aislop_scan\` without target path or \`aislop scan\` without \`--changes\` or specific file arguments). Unscoped full-repo scans evaluate thousands of files, dump giant multi-megabyte payloads, and exhaust agent token context. When invoking \`aislop_scan\` or executing CLI scans, ALWAYS pass specific changed file paths or use \`--changes\` to ensure bounded, token-efficient execution. NEVER dump raw full-repo scan output into conversation context; summarize counts and key findings only (score, error count, rule IDs) or use \`get_slop_findings(compact: true)\`. Single-file edits, isolated bug fixes, or routine configuration changes must NEVER trigger repository-wide slop refactoring loops. Only verify the specific files modified.
`;
}

function buildOmpManagedContract() {
  const base = buildMainAgentContract('omp');
  const idx = base.lastIndexOf(CONTRACT_END_MARKER);
  if (idx === -1) return `${base}\n${buildOmpWorkflowAddendum()}`;
  return `${base.slice(0, idx)}${buildOmpWorkflowAddendum()}\n${base.slice(idx)}`;
}

function buildOmpMcpServers(options = {}) {
  const nodeCmd = options.nodeCmd || process.execPath || 'node';
  const launcherPath = options.launcherPath || (fileExists(FILE_TOOLS_LAUNCHER_JS) ? FILE_TOOLS_LAUNCHER_JS : SERVER_PATH);
  const uvxCmd = options.uvxCmd || 'uvx';

  return {
    konoha: {
      command: nodeCmd,
      args: [launcherPath],
      env: {
        ACTIVE_CLIENT: 'omp',
        KONOHA_CLIENT: 'omp',
        KONOHA_SEMANTIC_SEARCH: '1'
      }
    },
    semble: {
      command: uvxCmd,
      args: [
        '--from',
        SEMBLE_PACKAGE,
        'semble',
        '--content',
        'all'
      ]
    },
    aislop: {
      command: 'npx',
      args: [
        '-y',
        '-p',
        AISLOP_PACKAGE,
        'aislop-mcp'
      ]
    }
  };
}

function registerOmpMcp(options = {}) {
  const configPath = options.configPath || getOmpConfigPath();
  const silent = options.silent !== false;

  try {
    const existing = readJsonSafe(configPath) || {};
    if (!existing.mcpServers || typeof existing.mcpServers !== 'object') {
      existing.mcpServers = {};
    }

    const servers = buildOmpMcpServers(options);
    Object.assign(existing.mcpServers, servers);

    writeJsonAtomic(configPath, existing);
    if (!silent) process.stderr.write(`✓ Registered Konoha MCP servers in OMP: ${configPath}\n`);
    return { ok: true, configPath };
  } catch (err) {
    if (!silent) console.warn(`⚠ Could not register OMP MCP config: ${err.message}`);
    return { ok: false, reason: 'omp-mcp-registration-failed', error: err.message };
  }
}

function deployOmpContract(options = {}) {
  const targetFile = options.targetFile || OMP_AGENTS_MD;
  const silent = options.silent !== false;

  try {
    ensureDir(path.dirname(targetFile));
    const existing = fileExists(targetFile) ? fs.readFileSync(targetFile, 'utf-8') : '';
    const managed = buildManagedContract(existing, buildOmpManagedContract());
    if (managed === existing) {
      return { ok: true, changed: false };
    }
    fs.writeFileSync(targetFile, managed, 'utf-8');
    if (!silent) process.stderr.write(`✓ Konoha contract deployed to OMP: ${targetFile}\n`);
    return { ok: true, changed: true };
  } catch (err) {
    if (!silent) console.warn(`⚠ OMP contract deployment failed: ${err.message}`);
    return { ok: false, reason: 'omp-contract-deploy-failed', error: err.message };
  }
}

function deployOmpRtkRule(options = {}) {
  const silent = options.silent !== false;
  const targetDir = options.targetDir || path.join(OMP_DIR, 'rules');
  const targetFile = path.join(targetDir, 'rtk.md');

  if (!isRtkInstalled()) {
    return { ok: false, reason: 'rtk-not-installed' };
  }

  try {
    ensureDir(targetDir);
    const sourceRtk = path.join(__dirname, 'templates', 'rules', 'rtk.md');
    if (fileExists(sourceRtk)) {
      fs.copyFileSync(sourceRtk, targetFile);
    } else {
      const content = '# RTK Mandatory Rule\n\nALWAYS prefix command execution with `rtk`.\n';
      fs.writeFileSync(targetFile, content, 'utf-8');
    }
    if (!silent) process.stderr.write(`✓ RTK rule deployed to OMP: ${targetFile}\n`);
    return { ok: true, targetFile };
  } catch (err) {
    if (!silent) console.warn(`⚠ OMP RTK rule deployment failed: ${err.message}`);
    return { ok: false, reason: 'omp-rtk-deploy-failed', error: err.message };
  }
}

function ensureOmpSetup(options = {}) {
  const silent = options.silent !== false;
  ensureDir(OMP_AGENT_DIR);

  const mcpResult = registerOmpMcp({ ...options, silent });
  const contractResult = deployOmpContract({ ...options, silent });
  const rtkResult = deployOmpRtkRule({ ...options, silent });

  return {
    ok: mcpResult.ok && contractResult.ok,
    mcp: mcpResult,
    contract: contractResult,
    rtk: rtkResult
  };
}

function removeOmpConfig(silent = true) {
  const configPath = getOmpConfigPath();
  if (!fileExists(configPath)) return true;

  try {
    const config = readJsonSafe(configPath);
    if (!config || !config.mcpServers) return true;

    for (const key of KONOHA_SERVER_KEYS) {
      delete config.mcpServers[key];
    }

    writeJsonAtomic(configPath, config);
    if (!silent) process.stderr.write(`✓ Removed Konoha MCP servers from OMP: ${configPath}\n`);
    return true;
  } catch (err) {
    if (!silent) console.warn(`⚠ Could not remove OMP MCP config: ${err.message}`);
    return false;
  }
}

function removeOmpContract(silent = true) {
  if (!fileExists(OMP_AGENTS_MD)) return true;

  try {
    const content = fs.readFileSync(OMP_AGENTS_MD, 'utf-8');
    const startIdx = content.indexOf(CONTRACT_START_MARKER);
    const endIdx = content.indexOf(CONTRACT_END_MARKER);
    if (startIdx === -1 || endIdx === -1) return true;

    const before = content.slice(0, startIdx);
    const after = content.slice(endIdx + CONTRACT_END_MARKER.length);
    const cleaned = (before + after).replace(/^\n+/, '').replace(/\n{3,}/g, '\n\n');

    if (cleaned.trim()) {
      fs.writeFileSync(OMP_AGENTS_MD, cleaned, 'utf-8');
    } else {
      fs.unlinkSync(OMP_AGENTS_MD);
    }
    if (!silent) process.stderr.write(`✓ Konoha contract removed from OMP global context\n`);
    return true;
  } catch (err) {
    if (!silent) console.warn(`⚠ Could not remove OMP contract: ${err.message}`);
    return false;
  }
}

function getOmpStatus() {
  const installed = isOmpInstalled();
  const configPath = getOmpConfigPath();
  let mcpKonoha = false;
  let mcpSemble = false;
  let mcpAislop = false;
  let contractDeployed = false;
  let rtkRuleDeployed = false;

  if (fileExists(configPath)) {
    const config = readJsonSafe(configPath);
    if (config && config.mcpServers) {
      mcpKonoha = !!config.mcpServers['konoha'];
      mcpSemble = !!config.mcpServers['semble'];
      mcpAislop = !!config.mcpServers['aislop'];
    }
  }

  if (fileExists(OMP_AGENTS_MD)) {
    try {
      const text = fs.readFileSync(OMP_AGENTS_MD, 'utf-8');
      contractDeployed = text.includes(CONTRACT_START_MARKER) && text.includes(OMP_MANDATE_HEADING);
    } catch (_err) {
      /* ignore unreadable file */
    }
  }

  const rtkRuleFile = path.join(OMP_DIR, 'rules', 'rtk.md');
  rtkRuleDeployed = fileExists(rtkRuleFile) || contractDeployed;

  return {
    installed,
    configured: mcpKonoha,
    configExists: fileExists(configPath),
    mcpKonoha,
    mcpSemble,
    mcpAislop,
    contractDeployed,
    rtkRuleDeployed,
    configPath
  };
}

module.exports = {
  OMP_DIR,
  OMP_AGENT_DIR,
  OMP_MCP_CONFIG,
  OMP_AGENTS_MD,
  OMP_SKILLS,
  isOmpInstalled,
  getOmpConfigPath,
  getOmpAgentsMdPath,
  buildOmpWorkflowAddendum,
  buildOmpManagedContract,
  buildOmpMcpServers,
  registerOmpMcp,
  deployOmpContract,
  deployOmpRtkRule,
  ensureOmpSetup,
  removeOmpConfig,
  removeOmpContract,
  getOmpStatus
};
