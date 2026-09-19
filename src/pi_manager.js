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
const { buildGuardrailCheckerSource } = require('./guardrails');

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
- **Review token hygiene & strict changed-files scoping (NEVER BURN TOKENS)**: Across all clients (Pi, Antigravity, Cursor, Claude Code, OpenCode, CommandCode, Codex), agents MUST NEVER execute unscoped full-repository scans (\`aislop_scan\` without target path or \`aislop scan\` without \`--changes\` or specific file arguments). Unscoped full-repo scans evaluate thousands of files, dump giant multi-megabyte payloads, and exhaust agent token context. When invoking \`aislop_scan\` or executing CLI scans, ALWAYS pass specific changed file paths or use \`--changes\` to ensure bounded, token-efficient execution. NEVER dump raw full-repo scan output into conversation context; summarize counts and key findings only (score, error count, rule IDs) or use \`get_slop_findings(compact: true)\`. Single-file edits, isolated bug fixes, or routine configuration changes must NEVER trigger repository-wide slop refactoring loops. Only verify the specific files modified.
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
function deployPiContract(silent = true, targetFile = null) {
  try {
    const destFile = targetFile || (module.exports && module.exports.PI_AGENTS_MD) || PI_AGENTS_MD;
    ensureDirSafe(path.dirname(destFile));
    const existing = fileExists(destFile) ? fs.readFileSync(destFile, 'utf-8') : '';
    const sanitized = stripStalePiMandates(existing);
    const managed = buildManagedContract(sanitized, buildPiManagedContract());
    if (managed === existing) {
      return { ok: true, changed: false };
    }
    fs.writeFileSync(destFile, managed, 'utf-8');
    if (!silent) process.stderr.write(`✓ Konoha runtime contract deployed to Pi: ${destFile}\n`);
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
      shell: process.platform === 'win32'
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
  } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
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
          encoding: 'utf-8', timeout: 30000, shell: process.platform === 'win32'
        });
        if (res.status === 0) removed = true;
      }
    } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }
  if (fileExists(PI_RTK_EXTENSION)) {
    try { fs.unlinkSync(PI_RTK_EXTENSION); removed = true; } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
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
    } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }
  if (removed && !silent) process.stderr.write(`✓ RTK artifacts removed from Pi\n`);
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
  // Guardrail checker source is embedded as a JSON string literal (double
  // escaping is handled by JSON.stringify) and evaluated with new Function,
  // so regex escapes like \b survive verbatim and the extension needs no
  // runtime dependency on ~/.konoha/guardrails.js.
  const guardrailSource = JSON.stringify(buildGuardrailCheckerSource());
  return [
    '// Konoha native-tool blocker for Pi (auto-managed by konoha pi_manager).',
    '// Blocks the native read tool (bounded file tools / semble instead) and',
    '// enforces the konoha command guardrails on bash tool calls.',
    '// Removal: run konoha uninstall for Pi, or delete this file.',
    'import type { ExtensionAPI, ToolCallEvent } from "@earendil-works/pi-coding-agent";',
    'import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";',
    '',
    '// Silence duplicate/collision skill diagnostics between global and project skill mirrors',
    'try {',
    '  if (typeof DefaultResourceLoader !== "undefined" && DefaultResourceLoader && DefaultResourceLoader.prototype) {',
    '    const proto = DefaultResourceLoader.prototype as any;',
    '    const origGetSkills = proto.getSkills;',
    '    if (typeof origGetSkills === "function") {',
    '      proto.getSkills = function () {',
    '        const res = origGetSkills.apply(this, arguments);',
    '        if (res && Array.isArray(res.diagnostics)) {',
    '          res.diagnostics = res.diagnostics.filter((d: any) => d && d.type !== "collision");',
    '        }',
    '        return res;',
    '      };',
    '    }',
    '    const origUpdateSkills = proto.updateSkillsFromPaths;',
    '    if (typeof origUpdateSkills === "function") {',
    '      proto.updateSkillsFromPaths = function () {',
    '        const res = origUpdateSkills.apply(this, arguments);',
    '        if (Array.isArray(this.skillDiagnostics)) {',
    '          this.skillDiagnostics = this.skillDiagnostics.filter((d: any) => d && d.type !== "collision");',
    '        }',
    '        return res;',
    '      };',
    '    }',
    '  }',
    '} catch (_) { /* best-effort monkeypatch: failure here must never crash the extension */ }',
    '',
    'const REASON =',
    '  "MANDATORY RULE VIOLATION: Using the built-in/native read tool is STRICTLY FORBIDDEN! " +',
    '  "You MUST use the konoha MCP bounded file tools " +',
    '  "(read_file_head, read_file_range, file_info, get_file_structure, find_files_clean, token_efficient_grep) " +',
    '  "or the semble MCP (search / find_related) for codebase reading and search instead.";',
    '',
    'const GUARDRAIL_CHECKER_SOURCE = ' + guardrailSource + ';',
    'const checkCommandGuardrails: (command: string) => { category: string; reason: string } | null =',
    '  new Function(GUARDRAIL_CHECKER_SOURCE + "\\nreturn checkCommandGuardrails;")();',
    '',
    'function isReadToolCallEvent(event: ToolCallEvent): boolean {',
    '  return event.toolName === "read";',
    '}',
    '',
    'function isBashToolCallEvent(event: ToolCallEvent): boolean {',
    '  return event.toolName === "bash" || event.toolName === "bash_command";',
    '}',
    '',
    'function extractBashCommand(event: ToolCallEvent): string | null {',
    '  const input = event.input as Record<string, unknown> | undefined;',
    '  if (!input) return null;',
    '  if (typeof input.command === "string") return input.command;',
    '  if (typeof input.cmd === "string") return input.cmd;',
    '  return null;',
    '}',
    '',
    'export default function konohaBlocker(pi: ExtensionAPI) {',
    '  pi.on("tool_call", (event) => {',
    '    if (isReadToolCallEvent(event)) {',
    '      return { block: true, reason: REASON };',
    '    }',
    '    if (isBashToolCallEvent(event)) {',
    '      const command = extractBashCommand(event);',
    '      const violation = command ? checkCommandGuardrails(command) : null;',
    '      if (violation) {',
    '        return { block: true, reason: violation.reason };',
    '      }',
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
    if (!silent) process.stderr.write(`✓ Konoha native-tool blocker extension deployed to Pi: ${PI_BLOCKER_EXTENSION}\n`);
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
    } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
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
    if (!silent) process.stderr.write(`  ✓ pi-mcp-adapter added to Pi packages (${PI_SETTINGS})\n`);
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
        } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
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
    if (!silent) process.stderr.write(`✓ Pi MCP servers registered: ${PI_MCP_CONFIG}\n`);
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
    if (removed && !silent) process.stderr.write(`✓ Konoha MCP servers removed from Pi config: ${PI_MCP_CONFIG}\n`);
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
    } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }
  if (fileExists(PI_BLOCKER_EXTENSION)) {
    blockerDeployed = true;
  }
  if (fileExists(PI_AGENTS_MD)) {
    try {
      contractDeployed = fs.readFileSync(PI_AGENTS_MD, 'utf-8').includes('<!-- KONOHA-CONTRACT-START -->');
    } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
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
  } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
}

module.exports = {
  PI_AGENT_DIR,
  PI_SETTINGS,
  PI_MCP_CONFIG,
  PI_AGENTS_MD,
  PI_RTK_EXTENSION,
  PI_ADAPTER_PACKAGE,
  buildPiBlockerExtensionSource,
  isPiInstalled,
  ensurePiSetup,
  ensureAdapterPackage,
  registerPiMcp,
  deployPiRtkRule,
  deployPiContract,
  stripStalePiMandates,
  deployPiBlockerExtension,
  removePiBlockerExtension,
  removePiContract,
  removePiRtkRule,
  removePiMcp,
  removePiConfig: removePiMcp,
  getPiStatus
};
