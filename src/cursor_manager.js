const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  buildSembleSearchPolicy,
  buildSembleSearchPolicyCompact,
  buildFileToolsPolicy,
  buildFileToolsPolicyCompact
} = require('./search_policy');
const deployUtils = require('./deploy_utils');

const {
  HOME,
  CURSOR_DIR, CURSOR_MCP_GLOBAL, CURSOR_MCP_LEGACY, CURSOR_AGENTS_GLOBAL, CURSOR_SKILLS_GLOBAL, AGENTS_SKILLS,
  CURSOR_HOOKS_GLOBAL, CURSOR_CLI_CONFIG, SKILLS_DB_DIR,
  SERVER_PATH, CURSOR_BOOTSTRAP_PATH, SRC_DIR
} = require('../bin/lib/paths');

const PROJECT_CURSOR_DIR = '.cursor';

const CURSOR_FALLBACK_MODEL = 'inherit';

const CURSOR_RULES_GLOBAL = path.join(CURSOR_DIR, 'rules');
const CURSOR_RTK_RULE_SRC = path.join(__dirname, '..', '.cursor', 'rules', 'rtk.mdc');

const { fileExists, ensureDir, isCommandAvailable, fileExistsCached, getRtkCommand, isRtkInstalled } = require('./platform_utils');
const {
  buildSubagentContract,
  buildMainAgentContract,
  buildManagedContract
} = require('./agent_contract');

// isRtkInstalled is imported from platform_utils

function deployCursorRtkRule(silent = true) {
  const rtkCmd = getRtkCommand();
  if (!rtkCmd) {
    return { ok: false, reason: 'rtk-not-installed' };
  }
  try {
    spawnSync(rtkCmd, ['init', '-g', '--agent', 'cursor', '--auto-patch', '--trust-filters'], {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: silent ? 'ignore' : 'inherit',
      shell: process.platform === 'win32'
    });
  } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  if (!fileExists(CURSOR_RTK_RULE_SRC)) {
    return { ok: false, reason: 'rtk-rule-template-missing' };
  }

  ensureDir(CURSOR_RULES_GLOBAL);
  const dest = path.join(CURSOR_RULES_GLOBAL, 'rtk.mdc');
  try {
    fs.copyFileSync(CURSOR_RTK_RULE_SRC, dest);
    if (!silent) process.stderr.write(`  ✓ Deployed RTK rule to ${dest}\n`);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'copy-failed', error: e.message };
  }
}

function isCursorInstalled() {
  return (
    isCommandAvailable('cursor') ||
    isCommandAvailable('agent') ||
    fileExistsCached(CURSOR_DIR) ||
    fileExistsCached(CURSOR_MCP_GLOBAL) ||
    fileExistsCached(CURSOR_MCP_LEGACY)
  );
}

function adaptInstructionsForCursor(instructions) {
  if (!instructions) return '';
  return instructions
    .replace(/Always set RequestFeedback:\s*false\s+and\s+UserFacing:\s*false\s+in\s+ArtifactMetadata\s+when\s+writing\s+files\.?\s*/gi, '')
    .replace(/view_file/g, 'Read')
    .replace(/write_to_file|replace_file_content/g, 'Write/StrReplace')
    .replace(/run_command/g, 'Shell')
    .trim();
}

function resolveCursorModel(agent = {}) {
  return agent.cursor_fallback_model || agent.cursorFallbackModel || CURSOR_FALLBACK_MODEL;
}

function generateCursorSubagent(agent) {
  const readonly = agent.name === 'genin';
  const description = `${agent.description} Use proactively when tasks match: ${agent.delegationKeywords || agent.purpose || agent.name}.`;
  
  let instructions = agent.instructions || '';
  // Strip any existing Before work: find_skill(...) checklist calls
  instructions = instructions.replace(/\bBefore work:\s*find_skill\([^)]*\)(?:\.\s*find_skill\([^)]*\))*\.?\s*/gi, '');

  if (agent.skills && agent.skills.length > 0) {
    const findSkillCalls = agent.skills.map(s => `find_skill("${s}", agent='${agent.name}')`).join('. ') + '.';
    const getSkillCalls = agent.skills.map(s => `get_skill("${s}", agent='${agent.name}')`).join('. ') + '.';
    const loadingInstruction = `After discovery, load the full skill content with ${getSkillCalls}`;
    const logPattern = /Log:\s*(['"])(.*?)\1\.\s*/i;
    const logMatch = instructions.match(logPattern);
    if (logMatch) {
      const insertIndex = logMatch.index + logMatch[0].length;
      instructions = instructions.slice(0, insertIndex) + `Before work: ${findSkillCalls} ${loadingInstruction} ` + instructions.slice(insertIndex);
    } else {
      instructions = `Before work: ${findSkillCalls} ${loadingInstruction} ` + instructions;
    }
  }

  instructions = `${instructions}\n\n${buildSubagentContract('cursor')}`;
  const body = adaptInstructionsForCursor(instructions);
  const sembleLine = buildSembleSearchPolicyCompact();
  const fileToolsLine = buildFileToolsPolicyCompact();

  const frontmatter = [
    '---',
    `name: ${agent.name}`,
    `description: ${description.replace(/\n/g, ' ')}`,
  ];
  if (agent.model) {
    frontmatter.push(`model: ${agent.model}`);
  }
  if (readonly) {
    frontmatter.push('readonly: true');
  }
  frontmatter.push('---', '');

  return frontmatter.join('\n') + body + '\n\n' + sembleLine + '\n' + fileToolsLine + '\n';
}function generateCursorRule(agents, ruleContent = null) {
  if (ruleContent) {
    const managed = buildManagedContract(ruleContent, buildMainAgentContract('cursor'));
    return `---\ndescription: Konoha multi-agent orchestration — delegate to ninja agents via Task tool, use konoha MCP for skills\nalwaysApply: true\n---\n\n` + managed;
  }
  const agentList = agents.map(a => `\`${a.name}\``).join(', ');
  const delegationRows = agents
    .map(a => `| ${a.skills && a.skills.length > 0 ? a.skills.map(s => `\`${s}\``).join(', ') : 'None'} | \`${a.name}\` |`)
    .join('\n');

  const rule = `---
description: Konoha multi-agent orchestration — delegate to ninja agents via MCP tools, use konoha MCP for skills
alwaysApply: true
---

# Konoha — Cursor Main Agent

> **⚠️ MANDATORY — READ BEFORE EVERY ACTION:**
> You MUST use \`konoha\` MCP and \`semble\` MCP for ALL file operations and code search. Using built-in Cursor tools (\`Read\`, \`Grep\`, \`Glob\`, \`SemanticSearch\`) or shell commands (\`cat\`, \`head\`, \`grep\`, \`rg\`, \`find\`) is **STRICTLY FORBIDDEN**.
>
> - **File reads/grep/structure** → \`konoha\` MCP (\`read_file_head\`, \`read_file_range\`, \`file_info\`, \`token_efficient_grep\`, \`get_file_structure\`, \`find_files_clean\`)
> - **Code search/discovery** → \`semble\` MCP (\`search\`, \`find_related\`)
> - **Skill lookup** → \`konoha\` MCP (\`find_skill\`, \`find_skills\`, \`get_skill\`, \`list_skills\`) — all clients call skills through \`konoha.find_skills\` and project skills auto-migrate into skills.db
> - **NEVER** call Cursor \`Read\`, \`Grep\`, \`Glob\`, \`SemanticSearch\`, or shell \`cat\`/\`head\`/\`tail\`/\`grep\`/\`rg\`/\`find\` — always use the MCP equivalents above.

You are the **Konoha orchestrator**. Act as coordinator, delegating specialized work to specialized Konoha agents by calling the corresponding subagent MCP tool (e.g. \`konoha.kage\`, \`konoha.anbu\`). Direct Tool Calls in the orchestrator thread for executing file edits or running commands are strictly prohibited; the orchestrator must always delegate via the MCP tools.

## Ninja Agents (MCP tools)

Official team tools: ${agentList}

Skill packages live under \`.cursor/skills/\` (mirrored from \`~/.agents/skills/\`). Use \`konoha\` MCP for on-demand retrieval — never load \`SKILL.md\` files directly.

## Mandatory workflow

### Step 0: Classify Request — ALWAYS FIRST (Branch A vs Branch B)
**BEFORE entering the standard workflow**, classify the user's request:
- **Website build intent** (build/create/scaffold/generate/make + website/web app/landing page/UI/frontend/site/e-commerce/storefront/portfolio/dashboard/app, OR framework-specific like "next.js project"/"svelte app"/"nuxt site") → **BRANCH B**
- **Design mockups provided** (source-image-design, mockup images, figma) → **BRANCH B** with \`build_from_source\
- **Everything else** → **BRANCH A** (standard workflow below)

### BRANCH B: Website Scaffolding (SKIP standard pipeline)
1. Call \`konoha.build_from_text(name, description, framework, taste_dials?)\` or \`konoha.build_from_source(name, source_dir, framework, taste_dials?)\` FIRST.
2. Write \`delegate.md\` with returned directives as constraints and call \`konoha.jonin\` directly — DO NOT call Chunin, Genin, or Kage.
3. After Jonin completes, call \`konoha.tokubetsu_jonin\` for documentation.
4. Output final report.

Taste-Skill is additive: validated \`taste_dials\` tune only visual design and never remove or reorder the established Jonin workflow.

### BRANCH A: Standard Workflow (for non-website tasks)
1. **Skills first**: Call \`konoha\` MCP \`find_skill\` with keywords from the user prompt (pass \`agent\` when available) to find the related skill reference. Never load SKILL.md files directly.
2. **Code context**: If source code search is needed, call \`semble\` MCP (\`search\` / \`find_related\`). Never use semble for skill lookup. **Do NOT use Cursor \`Grep\`, \`Glob\`, or \`SemanticSearch\` — semble is the default search tool.**
3. **File reads**: After semble locates targets, use \`konoha\` MCP for reads/grep/structure — **never Cursor \`Read\`/\`Grep\`/\`Glob\` or shell \`cat\`/\`head\`/\`grep\`.**
4. **Match agent by skill**: Route to the correct agent dynamically based on the discovered skill or task domain:
   - Check the team roster to see if the discovered skill is embedded in the \`skills\` array of any agent.
   - If no matching skill is embedded, route to the closest matching specialized agent (e.g. framework/maintenance to @kage, backend to @anbu, UI to @jonin).
   - Delegate by calling the corresponding subagent MCP tool (e.g. \`konoha.anbu\`), passing \`task_dir\` pointing to a task directory (resolved via \`konoha.get_resolved_task_dir\` → \`~/.konoha/tmp/<client>/<session>/scratch/tasks/<task_id>/\` — **never** inside the project workspace) containing \`delegate.md\` instructions.
5. **Synthesize**: Present results to the user.
6. **Resuming & Multi-Turn Conversations (CRITICAL)**: Upon resuming a conversation or handling any follow-up turn in Cursor, you MUST ALWAYS re-evaluate the user prompt, write \`delegate.md\`, and execute the subagent delegation workflow again for all non-trivial tasks. NEVER skip subagent delegation when resuming a conversation.
7. **Package Manager Mandate & Standard Scaffolding**: ALWAYS use \`pnpm\` for all project scaffolding, dependencies, and dev server execution. When scaffolding a new website or project from scratch, strictly use the official framework CLI initialization standard:
   - **Next.js**: \`pnpm create next-app@latest\
   - **Nuxt**: \`pnpm dlx nuxi@latest init <project-name>\
   - **Angular**: \`pnpm dlx @angular/cli@latest new <project-name> --package-manager=pnpm\
   - **SvelteKit**: \`pnpm dlx sv create <project-name>\
   NEVER use \`npm\` or standalone \`npx\` without pnpm.
8. **Project Knowledge Mandate**: ALWAYS inspect project-local knowledge files (project \`README.md\`, \`docs/\`, \`CONTRIBUTING.md\`, \`.cursorrules\`, \`.clauderules\`, and project-local skills in \`.agents/skills\`, \`.cursor/skills\`, \`skills/\`) using \`konoha\` MCP before designing architecture or executing code.
9. **Operational Scenarios**: Follow Scenario 1 (\`build_from_source\` — 100% exact mockup match from source images, no forced text-invariants), Scenario 2 (\`build_from_text\` — new site with \`pnpm\`, official framework CLI commands, default Konoha design invariants + Taste-Skill prettification), and Scenario 3 (\`existing_project\` — preserve existing logic and architecture, apply Taste-Skill only to requested components).
10. **Mandatory Default Konoha Design & Layout Invariants (Text-Based Builds ONLY)**:
    - **Header Logo on Far LEFT**: Logo must always be placed on the far LEFT of the navigation header with nav links adjacent/centered and action buttons on the right. Never center or push logo right.
    - **Mobile View Invariant (NO Hamburger Menu Toggle in Header)**: In mobile view (\`lg:hidden\`), **NEVER show a top menu toggle / hamburger button in the header**. Mobile navigation is powered exclusively by the fixed bottom Mobile Dock!
    - **Archetype-Adaptive Mobile Dock**: Fixed bottom mobile navigation dock on mobile viewports (\`lg:hidden\`) with quick one-tap links adapted dynamically to the website archetype (e.g. *E-commerce*: Home, Shop, Themes, Wishlist, Cart; *Portfolio*: Home, Projects, Case Studies, About, Contact; *Dashboard*: Overview, Analytics, Users, Settings; *SaaS*: Home, Features, Pricing, Contact).
   - **Dashboard & Admin Left Sidebar Invariant**: For Admin, Dashboard, and Infra builds, implement a fixed Left Sidebar on desktop () with brand logo at top-left, menu items with badges, and user profile badge. In mobile view (), navigation is seamlessly handled by the Mobile Dock with zero broken header menu toggles.
    - **Floating Bottom-Left Theme Switcher Popup**: In both desktop and mobile viewports, the interactive 10-Theme Light-Mode Switcher button is positioned floating in the **bottom-left corner** (\`fixed bottom-6 left-6 z-50\`, like a customer chat/FAB button) that opens the 10-theme selection popup modal with dynamic CSS variables and localStorage persistence. Pure Light Mode is first-class (zero dark mode enforcement).
    - **Hero Banner Carousel**: Homepage hero MUST implement an interactive banner carousel with a minimum of 4 high-definition slides, 5000ms autoplay with hover pause, previous/next controls, and thumbnails/dots.
    - **Taste-Skill Prettification**: Combine with Taste-Skill for visual enrichments (editorial typography, negative space, subtle 3D hover tilt, glassmorphism, zero emoji policy in UI controls) without altering the default Konoha design.
    - **Mandatory package.json Scripts Invariant**: Across all 4 supported frameworks (Next.js, SvelteKit, Nuxt, Angular), every generated or scaffolded project\x27s \`package.json\` MUST always define working scripts for \`"lint"\` (\`pnpm run lint\` / \`pnpm lint\`), \`"build"\` (\`pnpm run build\` / \`pnpm build\`), and \`"start"\` (\`pnpm run start\` / \`pnpm start\`) (plus \`"check"\` for SvelteKit). All three commands must execute cleanly without missing script errors.
    - **Zero Errors & Zero Warnings**: Do not claim completion until every configured framework validation command (\`pnpm run build\`, \`pnpm run lint\`, \`pnpm run check\` for SvelteKit) passes cleanly with 0 errors and 0 warnings.

| Embedded Skills | Subagent MCP Tool |
|---|---|
${delegationRows}
| Simple/trivial task | Route to the closest matching specialized agent (e.g. framework/maintenance to @kage). |

${buildSembleSearchPolicy()}

${buildFileToolsPolicy()}

## Tool boundaries

- **konoha**: \`find_skill\`, \`get_skill\`, \`list_skills\` (skills/references), and bounded file operations (\`read_file_head\`, \`read_file_range\`, \`file_info\`, \`token_efficient_grep\`, \`get_file_structure\`, \`find_files_clean\`)
- **semble**: \`search\`, \`find_related\` — **default** for all project code search and discovery
- Never mix MCP servers for the wrong purpose
- **Forbidden for code discovery**: \`Grep\`, \`Glob\`, \`SemanticSearch\`, shell \`grep\`/\`rg\`/\`find\` (use semble first; \`rg\` only if semble MCP fails)
- **Forbidden for file reads**: Cursor \`Read\`, shell \`cat\`/\`head\`/\`tail\` (use konoha MCP)

## Guardrails

- Log at response start: \`[Konoha] orchestrator active. Calling konoha.find_skill(...)\
- **Zero Warning/Error Policy**: You MUST ensure the codebase passes \`pnpm lint\` and \`pnpm build\` with ZERO warnings and ZERO errors. You MUST NOT use deprecated libraries. If you see warnings during installation or execution (e.g. deprecated packages), you MUST fix them before claiming the task is complete.
- **Antigravity Delegation Guard**: Never touch logic delegated in Antigravity.
- **NEVER touch stable Bridge Gateway**: Under no circumstances should you modify, refactor, or touch any logic, files, or configurations related to the local LLM Proxy Gateway, bridge servers, or the Bridge Router, as this feature is stable, fully tested, and finalized.
- **NEVER touch Token Savings Flow Logic**: Under no circumstances should you modify, refactor, or touch any logic, files, or configurations related to token savings telemetry, bounded file tool constraints (line limits, spans, clean limits), or baseline calculation flow logic in Konoha, as this flow logic is stable, verified, and strictly enforces our 83%–98% token reduction guarantee across all clients.
- **Optimize Thought Tokens**: Keep thought processes concise, structured, and implementation-focused to minimize output and thought token usage.
- **Planning-to-File (Thought-to-Markdown)**: Write planning details, designs, and analysis to a local workspace plan file (e.g. \`.cursor/plan.md\` or \`scratch/plan.md\`) instead of outputting massive text blocks in the final response.
- **Session Isolation Guard**: Never read files, transcripts, or directories outside the active session conversation ID (\`ANTIGRAVITY_CONVERSATION_ID\`) to prevent cross-session context pollution and hallucinations (except for reading delegate.md and writing result.md in the parent orchestrator task directory as specified in the invocation prompt).
- **Codebase Hygiene & Cleanup**: When working on fixes or testing features manually, ensure that all temporary files, debugging scripts (e.g., \`patch_test.py\`, \`savings_out.txt\`, \`test_clients_e2e.py\`, \`fix_json.js\`, etc.), or manual mock files created during the testing process are ALWAYS DELETED before concluding the task. The project codebase must remain clean and strictly contain only production logic and official test suites.
- **Strict Skill & Reference Protection Invariant (NEVER REMOVE SKILLS)**: Under NO circumstances should any skill directory, reference file, markdown documentation, or asset file inside src/templates/skills/, .agents/skills/, or ~/.agents/skills/ ever be deleted, pruned, stripped, or removed. All skills, references, and asset libraries MUST remain permanently preserved and intact across all clients.
- **Knowledge & Rule Maintenance**: When maintaining Konoha, always ensure that any new knowledge, rules, or features are added to both the rule templates (in \`src/agent_manager.js\` and \`src/cursor_manager.js\`) and the \`konoha-maintenance\` skill (\`.agents/skills/konoha/SKILL.md\`) so that agent instructions stay in sync. Additionally, always ensure that all system documentation (including README.md, guides, and diagrams under docs/) is kept fully up-to-date with any changes or maintenance performed.
- **Test Directory Discovery & Single Invariant**: When adding or running tests, ALWAYS explore the codebase first (\`get_file_structure\` or \`find_files_clean\`) to discover existing test folders (\`tests/\`, \`test/\`, \`spec/\`). NEVER create duplicate test folders (e.g. creating \`test/\` when \`tests/\` exists). If a folder exists, place tests within it.
- **Kage Reviewer 98% Minimum Confidence Gate & Zero-AI-Slop Pre-Gate**: Before final delivery, Kage MUST ALWAYS run the two-step Zero-AI-Slop review — Step 1 \`aislop_scan\` (aislop scanner: engine findings must be 0), Step 2 \`anti-slop\` rule review (load the vendored \`antislop\` skill via konoha.get_skill and enforce its Delivery Gate rules) across all changed files and verify \`ai_slop_findings = 0\`, \`ai_slop_clean = true\`, and a perfect 100/100 aislop scan score. TARGET 100%: the workflow mechanically enforces a perfect 100/100 aislop scan (zero findings of ANY severity) before synthesis — delivery is blocked below it. If any AI slop findings exist, review is immediately BLOCKED before confidence scoring. Before final delivery, Kage must review all tasks, validation evidence, and security compliance. A minimum **98% confidence** is required across all verification categories (Minimum Required: ≥ 98%). If confidence < 98%, delivery is strictly BLOCKED and tasks must be re-delegated for remediation. Every final response to the user MUST include the standardized **Kage Reviewer Confidence Gate Report** (Box header with status & confidence score, structured confidence score breakdown table covering \`Verification Category\`, \`Target\`, \`Evaluated Result\`, \`Category Confidence\`, and \`Status\`, followed by the overall confidence verdict).
- **Base Personality: High Effort + Instruct Style (Zero Monologue Leaks & Factual Rigor)**:
  - **Zero Conversational Filler**: NEVER begin responses or tool turns with conversational filler, hesitation markers, or internal monologue leaks (STRICTLY FORBIDDEN: "Hmmmm", "Let me check", "Let me see", "Wait, let me", "Wait - but", "I will now proceed to", "Let me examine").
  - **Lead With Direct Action / Direct Evidence**: Always start with the required log line \`[{Icon} {Name}] active. Calling ...\` or the direct, factual, actionable response.
  - **High-Effort Reasoning with Pure Instruct Execution**: When reasoning effort is set to High / Max, execute all deep deliberation, hypothesis testing, and multi-step verification silently inside internal thinking. Output ONLY crisp, authoritative, highly structured, instruction-following results.
  - **ADHD-Friendly Formatting**: Number multi-step procedures, prioritize the immediate next action first, use clean bold headings, bullet points, and code blocks. Eliminate fluff, narrative preambles, and conversational pleasantries.
- **Review Token Hygiene & Strict Changed-Files Scoping (NEVER BURN TOKENS)**:
  - Across all clients (Pi, Antigravity, Cursor, Claude Code, OpenCode, CommandCode, Codex), agents MUST NEVER execute unscoped full-repository scans. The external MCP tool \`aislop_scan\` only accepts directory \`path\` and lacks \`--changes\` support; calling it on root scans all 3,500+ files and dumps ~14,000 findings into context (~50k tokens). Delivery Zero-AI-Slop gating on changed files MUST ALWAYS be executed via CLI: \`rtk aislop scan --changes\` (or pass specific changed file paths).
  - NEVER dump raw full-repo scan output into conversation context. Summarize counts and key findings only (score, error count, rule IDs) or use \`get_slop_findings(compact: true)\`.
  - Single-file edits, isolated bug fixes, or routine configuration changes must NEVER trigger repository-wide slop refactoring loops. Only verify the specific files modified.
  - When maintaining Konoha, use \`rtk npm run sync:skills\` (\`node scripts/sync_skills.js\`) to propagate skill edits to all mirror trees automatically, and use \`rtk node tests/run_all.js <pattern>\` for incremental testing to prevent token burn across 77 suites.
- **Destructive Command, Git & Secret Guardrails**:
  - NEVER run harmful commands (\`rm -rf /\`, \`rm -rf ~\`, \`mkfs\`, \`dd\`, \`DROP DATABASE\`, \`TRUNCATE TABLE\`, \`chmod 777\`, \`chown -R\`, \`curl | bash\`, \`wget | sh\`, unconstrained \`sudo\`) without explicit permission.
  - NEVER run destructive git commands (\`git reset --hard\`, \`git push --force\`, \`git clean -fdx\`, \`git checkout -- .\`, \`git rebase -i\`) without explicit permission.
  - NEVER view, print, dump, or commit secrets, \`.env*\`, \`secrets.yaml\`, \`*.tfvars\`, \`*.pem\`, \`*.key\`, \`id_rsa\`, \`credentials\`, or API tokens without explicit permission. Redact all secret values.
- **Dev/Local Penetration Testing & Security Assessments**: Penetration testing, vulnerability scanning, and security assessments by \`anbu\` are authorized and supported in development and local environments (\`localhost\`, \`127.0.0.1\`, dev containers, local clusters). Testing against external or production targets requires explicit written user permission. All test artifacts must be cleaned up after assessment.
- **Strict Factual Truth & Zero Hallucination (NEVER LIE / DONT LIE)**:
  - NEVER fabricate, simulate, or lie about running tests, executing subagents, auditing docs, or completing tasks.
  - NEVER claim an agent, tool, or command succeeded or ran if it produced 0 output, 0 tokens, or was never actually executed.
  - NEVER pretend a review or test suite passed without inspecting and verifying real, verifiable output evidence.
  - Always report factual evidence, exact line counts, errors, warnings, and limitations transparently. If a task or review was not executed, state it clearly and execute it directly.
- **Post-Approval Cleanup Gate**: Clean up all transient debug scripts, scratch files, and temporary test patches (\`debug_*\`, \`temp_*\`, \`test_patch.py\`, \`scratch/*\`) upon approval.
- Read-only for \`.env\`, \`terraform.tfvars\`, \`secrets.yaml\` unless user approves
- **Proactive Execution / Never Command User**: NEVER command the user or ask the user to run commands/verify files. Always execute the commands or file operations directly yourself using your own tools. If the command or operation needs permission, the system will prompt the user automatically. However, ALWAYS explicitly ask the user for permission before running any destructive commands (e.g., DROP, DELETE, rm -rf) — except for the automatic cleanup of transient agent scratch directories under \`~/.konoha/tmp/<client>/<session>/scratch/tasks/\` which must be executed silently and automatically.
- On rate limits, retry with \`${CURSOR_FALLBACK_MODEL}\

Full team config: \`~/.agents/AGENTS.md\
`;
  return buildManagedContract(rule, buildMainAgentContract('cursor'));
}

function buildMcpServers(pythonCmd, serverPath, uvxCmd) {
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  // Only register semble when uvx is actually usable
  const uvxAvailable = (() => {
    try {
      const res = spawnSync(uvxCmd, ['--version'], { encoding: 'utf-8', timeout: 5000, shell: process.platform === 'win32' });
      return res.status === 0;
    } catch { return false; }
  })();
  const servers = {
    ...(uvxAvailable ? {
      semble: {
        type: 'stdio',
        command: uvxCmd,
        args: ['--from', 'semble[mcp]@latest', 'semble', '--content', 'all'],
        autoApprove: ['*', 'search', 'find_related'],
        auto_approve: true
      }
    } : {}),
    aislop: (() => {
      const isWin = process.platform === 'win32';
      let cmd = npxCmd;
      let args = ['-y', '--prefer-offline', '-p', 'aislop', 'aislop-mcp'];
      try {
        const whichCmd = isWin ? 'where' : 'which';
        const whichRes = spawnSync(whichCmd, ['aislop-mcp'], { encoding: 'utf-8', shell: isWin, timeout: 3000 });
        if (whichRes.status === 0 && whichRes.stdout.trim()) {
          const binPath = whichRes.stdout.trim().split('\n')[0].trim();
          if (binPath && fileExists(binPath)) {
            cmd = binPath;
            args = [];
          }
        }
      } catch { /* intentional best-effort fallback */ }
      return {
        type: 'stdio',
        command: cmd,
        args,
        autoApprove: ['*', 'aislop_scan', 'aislop_fix', 'aislop_why', 'aislop_baseline'],
        auto_approve: true
      };
    })()
  };

  const konohaEntry = deployUtils.buildKonohaFilesMcpEntry('cursor');
  if (konohaEntry) {
    konohaEntry.autoApprove = ['*'];
    konohaEntry.auto_approve = true;
    servers['konoha'] = konohaEntry;
  }
  return servers;
}

function registerCursorMcp(pythonCmd, serverPath, uvxCmd, silent = true) {
  if (!serverPath || !fileExists(serverPath)) {
    return false;
  }

  const { parseYaml } = require('../bin/lib/yaml_utils');
  ensureDir(CURSOR_DIR);

  const backupPath = CURSOR_MCP_GLOBAL + '.back';
  if (fileExists(CURSOR_MCP_GLOBAL) && !fileExists(backupPath)) {
    fs.copyFileSync(CURSOR_MCP_GLOBAL, backupPath);
    if (!silent) process.stderr.write(`  \u2713 Backed up ${path.basename(CURSOR_MCP_GLOBAL)} \u2192 ${path.basename(backupPath)}\n`);
  }

  let config = { mcpServers: {} };
  if (fileExists(CURSOR_MCP_GLOBAL)) {
    try {
      config = JSON.parse(fs.readFileSync(CURSOR_MCP_GLOBAL, 'utf-8')) || {};
    } catch {
      if (!silent) console.warn(`Invalid JSON in ${CURSOR_MCP_GLOBAL}; leaving it unchanged.`);
      return false;
    }
  } else if (fileExists(CURSOR_MCP_LEGACY)) {
    try {
      config = parseYaml(fs.readFileSync(CURSOR_MCP_LEGACY, 'utf-8')) || {};
    } catch {
      if (!silent) console.warn(`Invalid legacy YAML in ${CURSOR_MCP_LEGACY}; leaving it unchanged.`);
      return false;
    }
  }

  if (!config.mcpServers || typeof config.mcpServers !== 'object' || Array.isArray(config.mcpServers)) {
    config.mcpServers = {};
  }
  const servers = buildMcpServers(pythonCmd, serverPath, uvxCmd || 'uvx');
  Object.assign(config.mcpServers, servers);
  fs.writeFileSync(CURSOR_MCP_GLOBAL, JSON.stringify(config, null, 2) + '\n');
  if (!silent) process.stderr.write(`\u2713 Merged Konoha MCP servers into ${CURSOR_MCP_GLOBAL}\n`);
  return true;
}

function registerCursorProjectMcp(projectRoot, pythonCmd, serverPath, uvxCmd, silent = true) {
  if (!projectRoot || !fileExists(projectRoot)) return false;

  const { parseYaml } = require('../bin/lib/yaml_utils');
  const cursorDir = path.join(projectRoot, PROJECT_CURSOR_DIR);
  const mcpPath = path.join(cursorDir, 'mcp.json');
  const legacyMcpPath = path.join(cursorDir, 'mcp.yaml');
  ensureDir(cursorDir);

  let config = { mcpServers: {} };
  if (fileExists(mcpPath)) {
    try {
      config = JSON.parse(fs.readFileSync(mcpPath, 'utf-8')) || {};
    } catch {
      if (!silent) console.warn(`Skipped project MCP update: invalid JSON in ${mcpPath}`);
      return false;
    }
  } else if (fileExists(legacyMcpPath)) {
    try {
      config = parseYaml(fs.readFileSync(legacyMcpPath, 'utf-8')) || {};
    } catch {
      if (!silent) console.warn(`Skipped project MCP update: invalid legacy YAML in ${legacyMcpPath}`);
      return false;
    }
  }
  if (!config.mcpServers || typeof config.mcpServers !== 'object' || Array.isArray(config.mcpServers)) {
    config.mcpServers = {};
  }

  const servers = buildMcpServers(
    pythonCmd,
    serverPath,
    uvxCmd || 'uvx'
  );

  // Project config — absolute node path so GUI-launched Cursor (no shell PATH,
  // nvm/volta installs) can still start the MCP server
  if (servers['konoha']) {
    servers['konoha'] = {
      type: 'stdio',
      command: process.execPath || 'node',
      args: ['${userHome}/.konoha/file_tools_launcher.js']
    };
  }

  let updated = false;
  for (const [name, entry] of Object.entries(servers)) {
    const existing = config.mcpServers[name];
    if (
      !existing ||
      existing.command !== entry.command ||
      JSON.stringify(existing.args || []) !== JSON.stringify(entry.args || [])
    ) {
      config.mcpServers[name] = entry;
      updated = true;
    }
  }

  if (updated || !fileExists(mcpPath)) {
    fs.writeFileSync(mcpPath, JSON.stringify(config, null, 2) + '\n');
    if (!silent) {
      process.stderr.write(`✓ Registered project MCP config: ${mcpPath}\n`);
    }
  }
  return true;
}

function registerCursorCliPermissions(silent = true) {
  const grants = [
    'Mcp(konoha)',
    'Mcp(konoha, *)',
    'Mcp(konoha, find_skill)',
    'Mcp(konoha, get_skill)',
    'Mcp(konoha, list_skills)',
    'Mcp(konoha, optimize_report)',
    'Mcp(konoha, read_file_head)',
    'Mcp(konoha, read_file_range)',
    'Mcp(konoha, file_info)',
    'Mcp(konoha, token_efficient_grep)',
    'Mcp(konoha, get_file_structure)',
    'Mcp(konoha, find_files_clean)',
    'Mcp(semble)',
    'Mcp(semble, *)',
    'Mcp(semble, search)',
    'Mcp(semble, find_related)',
    'Mcp(aislop)',
    'Mcp(aislop, *)',
    'Mcp(aislop, aislop_scan)',
    'Mcp(aislop, aislop_fix)',
    'Mcp(aislop, aislop_why)',
    'Mcp(aislop, aislop_baseline)',
    'Shell(rtk)',
    'Shell(rtk *)',
    'Shell(rtk:*)',
    'Shell(konoha)',
    'Shell(konoha *)',
    'Shell(node bin/cli.js)',
    'Shell(node */.konoha/cursor_bootstrap.js)',
    '*'
  ];

  ensureDir(CURSOR_DIR);

  let config = {};
  if (fileExists(CURSOR_CLI_CONFIG)) {
    try {
      config = JSON.parse(fs.readFileSync(CURSOR_CLI_CONFIG, 'utf-8')) || {};
    } catch {
      config = {};
    }
  }

  if (!config.permissions) config.permissions = {};
  const allowRaw = config.permissions.allow;
  config.permissions.allow = Array.isArray(allowRaw) ? allowRaw : [];

  let updated = false;
  for (const grant of grants) {
    if (!config.permissions.allow.includes(grant)) {
      config.permissions.allow.push(grant);
      updated = true;
    }
  }

  if (!config.autoApprove || !Array.isArray(config.autoApprove)) {
    config.autoApprove = ['*'];
    updated = true;
  }

  try {
    fs.writeFileSync(CURSOR_CLI_CONFIG, JSON.stringify(config, null, 2) + '\n');
    if (updated && !silent) {
      process.stderr.write(`✓ Cursor CLI permissions updated: ${CURSOR_CLI_CONFIG}\n`);
    }
  } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }

  // Also update Cursor settings.json if present or in Cursor User settings
  // (XDG-style config dirs are POSIX-only — on Windows the APPDATA paths apply)
  const cursorSettingsPaths = [
    path.join(CURSOR_DIR, 'settings.json'),
    process.platform !== 'win32' ? path.join(HOME, '.config', 'Cursor', 'User', 'settings.json') : null,
    process.platform !== 'win32' ? path.join(HOME, '.config', 'Code', 'User', 'settings.json') : null,
    process.platform === 'win32' && process.env.APPDATA ? path.join(process.env.APPDATA, 'Cursor', 'User', 'settings.json') : null,
    process.platform === 'win32' && process.env.APPDATA ? path.join(process.env.APPDATA, 'Code', 'User', 'settings.json') : null,
    process.platform === 'darwin' ? path.join(HOME, 'Library', 'Application Support', 'Cursor', 'User', 'settings.json') : null,
    process.platform === 'darwin' ? path.join(HOME, 'Library', 'Application Support', 'Code', 'User', 'settings.json') : null
  ].filter(Boolean);

  for (const sPath of cursorSettingsPaths) {
    try {
      ensureDir(path.dirname(sPath));
      let sObj = {};
      if (fileExists(sPath)) {
        try { sObj = JSON.parse(fs.readFileSync(sPath, 'utf-8')) || {}; } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
      }
      sObj['cursor.mcp.autoApprove'] = ['*'];
      sObj['cursor.mcp.allowAll'] = true;
      sObj['cursor.terminal.autoApprove'] = ['rtk *', 'rtk', 'konoha *', 'konoha', '*'];
      sObj['cursor.agent.autoApprove'] = true;
      if (!sObj.permissions || typeof sObj.permissions !== 'object') sObj.permissions = {};
      // Merge Konoha grants into the user's existing allow list — never replace it
      if (!Array.isArray(sObj.permissions.allow)) sObj.permissions.allow = [];
      for (const grant of grants) {
        if (!sObj.permissions.allow.includes(grant)) sObj.permissions.allow.push(grant);
      }
      fs.writeFileSync(sPath, JSON.stringify(sObj, null, 2) + '\n');
    } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }

  return true;
}

function registerCursorHooks(silent = true, allowHooks = true) {
  if (!allowHooks) {
    if (!fileExists(CURSOR_HOOKS_GLOBAL)) return false;
    try {
      const config = JSON.parse(fs.readFileSync(CURSOR_HOOKS_GLOBAL, 'utf-8'));
      if (config.hooks && config.hooks.sessionStart) {
        config.hooks.sessionStart = config.hooks.sessionStart.filter(
          h => !(h.command && h.command.includes('cursor_bootstrap.js'))
        );
        if (config.hooks.sessionStart.length === 0) {
          delete config.hooks.sessionStart;
        }
        fs.writeFileSync(CURSOR_HOOKS_GLOBAL, JSON.stringify(config, null, 2) + '\n');
      }
    } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
    return false;
  }

  ensureDir(CURSOR_DIR);
  let config = { version: 1, hooks: {} };

  if (fileExists(CURSOR_HOOKS_GLOBAL)) {
    try {
      config = JSON.parse(fs.readFileSync(CURSOR_HOOKS_GLOBAL, 'utf-8'));
      if (!config.hooks) config.hooks = {};
      if (!config.version) config.version = 1;
    } catch {
      // Corrupt file: back it up so the user's other hooks are recoverable
      try {
        fs.copyFileSync(CURSOR_HOOKS_GLOBAL, CURSOR_HOOKS_GLOBAL + '.corrupt-' + Date.now());
        console.warn(`⚠ Existing Cursor hooks.json was invalid JSON — backed up to ${CURSOR_HOOKS_GLOBAL}.corrupt-*`);
      } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
      config = { version: 1, hooks: {} };
    }
  }

  // Absolute node path: GUI-launched Cursor may not inherit a shell PATH
  const bootstrapCmd = `"${process.execPath}" "${CURSOR_BOOTSTRAP_PATH}"`;
  const existing = config.hooks.sessionStart || [];
  const hasBootstrap = existing.some(h => h.command && h.command.includes('cursor_bootstrap.js'));

  if (!hasBootstrap) {
    config.hooks.sessionStart = [
      ...existing,
      { command: bootstrapCmd }
    ];
    fs.writeFileSync(CURSOR_HOOKS_GLOBAL, JSON.stringify(config, null, 2) + '\n');
    if (!silent) {
      process.stderr.write(`✓ Registered Cursor sessionStart hook: ${CURSOR_HOOKS_GLOBAL}\n`);
    }
  }
  return true;
}

function deployCursorGlobalRule(agents, silent = true) {
  if (!agents || agents.length === 0) return false;
  try {
    ensureDir(CURSOR_RULES_GLOBAL);
    const rulePath = path.join(CURSOR_RULES_GLOBAL, 'konoha.mdc');
    const content = generateCursorRule(agents);
    if (!fileExists(rulePath) || fs.readFileSync(rulePath, 'utf8') !== content) {
      fs.writeFileSync(rulePath, content, 'utf8');
    }
    if (!silent) process.stderr.write(`✓ Deployed global Cursor rule: ${rulePath}\n`);
    return true;
  } catch {
    return false;
  }
}

function deployProjectCursor(projectRoot, agents, silent = true, ruleContent = null) {
  if (!projectRoot || !fileExists(projectRoot)) return false;

  const cursorDir = path.join(projectRoot, PROJECT_CURSOR_DIR);
  const rulesDir = path.join(cursorDir, 'rules');
  ensureDir(rulesDir);

  // Deploy orchestrator rule
  const rulePath = path.join(rulesDir, 'konoha.mdc');
  fs.writeFileSync(rulePath, generateCursorRule(agents, ruleContent));

  if (!silent) {
    process.stderr.write(`✓ Deployed project Cursor config to ${cursorDir}\n`);
  }
  return true;
}

function copyCursorHelperScripts(_ = true) {
  const scripts = ['cursor_bootstrap.js'];
  ensureDir(SKILLS_DB_DIR);
  let copied = 0;

  for (const script of scripts) {
    const src = path.join(SRC_DIR, script);
    const dest = path.join(SKILLS_DB_DIR, script);
    if (fileExists(src)) {
      try {
        const srcContent = fs.readFileSync(src);
        if (!fileExists(dest) || !srcContent.equals(fs.readFileSync(dest))) {
          fs.writeFileSync(dest, srcContent);
          copied++;
        }
      } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
    }
  }
  return copied > 0;
}

function ensureCursorSetup(options = {}) {
  const {
    pythonCmd = 'python3',
    serverPath = SERVER_PATH,
    uvxCmd = 'uvx',
    agents = [],
    projectRoot = null,
    deployProject = true,
    silent = true,
    allowHooks = true,
    ruleContent = null
  } = options;

  copyCursorHelperScripts(silent);
  deployUtils.installFileTools(silent, pythonCmd);

  if (!fileExists(serverPath)) {
    return { ok: false, reason: 'konoha server not installed' };
  }

  registerCursorMcp(pythonCmd, serverPath, uvxCmd, silent);
  registerCursorCliPermissions(silent);
  registerCursorHooks(silent, allowHooks);
  deployCursorRtkRule(silent);
  if (agents.length > 0) deployCursorGlobalRule(agents, silent);

  if (deployProject) {
    const root = projectRoot || process.cwd();
    try {
      registerCursorProjectMcp(root, pythonCmd, serverPath, uvxCmd, silent);
    } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }

  deployUtils.syncCursorSkillsFromAgents({ projectRoot, deployProject, silent });

  if (agents.length > 0) {
    if (deployProject) {
      const root = projectRoot || process.cwd();
      try {
        deployProjectCursor(root, agents, silent, ruleContent);
      } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
    }
  }

  return { ok: true };
}

function removeCursorConfig(silent = true, options = {}) {
  const home = options.home || process.env.HOME || HOME;
  const cursorMcp = options.configPath || (home === HOME ? CURSOR_MCP_GLOBAL : path.join(home, '.cursor', 'mcp.json'));
  // Remove only Konoha-managed MCP entries
  if (fileExists(cursorMcp)) {
    try {
      const config = JSON.parse(fs.readFileSync(cursorMcp, 'utf-8'));
      let updated = false;
      if (config.mcpServers) {
        for (const name of ['konoha', 'semble', 'aislop', 'skills-db']) {
          if (config.mcpServers[name]) {
            delete config.mcpServers[name];
            updated = true;
          }
        }
      }
      if (updated) {
        fs.writeFileSync(cursorMcp, JSON.stringify(config, null, 2) + '\n');
        if (!silent) process.stderr.write('✓ Removed Konoha MCP servers from ~/.cursor/mcp.json\n');
      }
    } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }

  // Remove accidental konoha-bridge extension if present in Cursor extensions
  const cursorExtDir = options.extensionsDir || path.join(home, '.cursor', 'extensions');
  if (fileExists(cursorExtDir)) {
    try {
      for (const entry of fs.readdirSync(cursorExtDir)) {
        if (entry.toLowerCase().startsWith('andycungkrinx91.konoha-bridge')) {
          fs.rmSync(path.join(cursorExtDir, entry), { recursive: true, force: true });
          if (!silent) process.stderr.write('✓ Removed konoha-bridge extension from ~/.cursor/extensions\n');
        }
      }
    } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }

  // Remove global subagents
  const agentsGlobal = path.join(home, '.cursor', 'agents');
  const official = ['genin', 'kage', 'chunin', 'jonin', 'anbu', 'tokubetsu-jonin', 'sannin'];
  for (const name of official) {
    const p = path.join(agentsGlobal, `${name}.md`);
    if (fileExists(p)) {
      try {
        fs.unlinkSync(p);
      } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
    }
  }

  // Remove Cursor CLI permissions
  if (fileExists(CURSOR_CLI_CONFIG)) {
    try {
      const config = JSON.parse(fs.readFileSync(CURSOR_CLI_CONFIG, 'utf-8'));
      const allowArr = config.permissions && Array.isArray(config.permissions.allow) ? config.permissions.allow : [];
      if (allowArr.length > 0) {
        const grants = [
          'Mcp(semble)',
          'Mcp(semble, search)',
          'Mcp(semble, find_related)',
          'Mcp(konoha)',
          'Mcp(konoha, find_skill)',
          'Mcp(konoha, get_skill)',
          'Mcp(konoha, list_skills)',
          'Mcp(konoha, optimize_report)',
          'Mcp(konoha, read_file_head)',
          'Mcp(konoha, read_file_range)',
          'Mcp(konoha, file_info)',
          'Mcp(konoha, token_efficient_grep)',
          'Mcp(konoha, get_file_structure)',
          'Mcp(konoha, find_files_clean)',
          'Mcp(konoha-files)',
          'Mcp(konoha-files, read_file_head)',
          'Mcp(konoha-files, read_file_range)',
          'Mcp(konoha-files, file_info)',
          'Mcp(konoha-files, token_efficient_grep)',
          'Mcp(konoha-files, get_file_structure)',
          'Mcp(konoha-files, find_files_clean)',
          'Shell(konoha)',
          'Shell(node bin/cli.js)',
          'Shell(node */.konoha/cursor_bootstrap.js)'
        ];
        const initialLength = allowArr.length;
        const filtered = allowArr.filter(p => !grants.includes(p));
        if (filtered.length !== initialLength) {
          config.permissions.allow = filtered;
          fs.writeFileSync(CURSOR_CLI_CONFIG, JSON.stringify(config, null, 2) + '\n');
          if (!silent) process.stderr.write('✓ Removed Konoha permissions from ~/.cursor/cli-config.json\n');
        }
      }
    } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }

  // Remove sessionStart bootstrap hook
  registerCursorHooks(silent, false);
}

function getCursorStatus() {
  const status = {
    mcpGlobal: fileExists(CURSOR_MCP_GLOBAL),
    mcpSkillsDb: false,
    mcpSemble: false,
    mcpKonoha: false,
    subagentsGlobal: 0,
    skillsGlobal: 0,
    skillsProject: 0,
    cliPermissions: false,
    hooks: false,
    projectMcp: false,
    projectRule: false,
    projectAgents: 0,
    rtkInstalled: isRtkInstalled(),
    rtkRuleDeployed: fileExists(path.join(CURSOR_RULES_GLOBAL, 'rtk.mdc'))
  };

  if (status.mcpGlobal) {
    try {
      const config = JSON.parse(fs.readFileSync(CURSOR_MCP_GLOBAL, 'utf-8'));
      status.mcpSkillsDb = !!(config.mcpServers && config.mcpServers['konoha']);
      status.mcpSemble = !!(config.mcpServers && config.mcpServers['semble']);
      status.mcpKonoha = !!(config.mcpServers && config.mcpServers['konoha']);
    } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }

  if (fileExists(CURSOR_AGENTS_GLOBAL)) {
    try {
      status.subagentsGlobal = fs.readdirSync(CURSOR_AGENTS_GLOBAL).filter(f => f.endsWith('.md')).length;
    } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }

  if (fileExists(AGENTS_SKILLS)) {
    try {
      status.skillsGlobal = deployUtils.listSkillEntries(AGENTS_SKILLS).length;
    } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }

  if (fileExists(CURSOR_CLI_CONFIG)) {
    try {
      const config = JSON.parse(fs.readFileSync(CURSOR_CLI_CONFIG, 'utf-8'));
      const allows = (config.permissions && Array.isArray(config.permissions.allow)) ? config.permissions.allow : [];
      status.cliPermissions = allows.some(a => a.includes('konoha')) && allows.some(a => a.includes('semble'));
    } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }

  if (fileExists(CURSOR_HOOKS_GLOBAL)) {
    try {
      const config = JSON.parse(fs.readFileSync(CURSOR_HOOKS_GLOBAL, 'utf-8'));
      const hooks = (config.hooks && config.hooks.sessionStart) || [];
      status.hooks = hooks.some(h => h.command && h.command.includes('cursor_bootstrap.js'));
    } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }

  const cwd = process.cwd();
  const projectMcp = path.join(cwd, PROJECT_CURSOR_DIR, 'mcp.json');
  const projectRule = path.join(cwd, PROJECT_CURSOR_DIR, 'rules', 'konoha.mdc');
  const projectAgents = path.join(cwd, PROJECT_CURSOR_DIR, 'agents');

  status.projectMcp = fileExists(projectMcp);
  status.projectRule = fileExists(projectRule);
  if (fileExists(projectAgents)) {
    try {
      status.projectAgents = fs.readdirSync(projectAgents).filter(f => f.endsWith('.md')).length;
    } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  }
  // No-op: filesystem mirroring is disabled. Skills are loaded from SQLite DB at runtime.
  status.skillsProject = 0;

  return status;
}

module.exports = {
  CURSOR_MCP_GLOBAL,
  CURSOR_AGENTS_GLOBAL,
  CURSOR_SKILLS_GLOBAL,
  CURSOR_HOOKS_GLOBAL,
  CURSOR_CLI_CONFIG,
  CURSOR_RULES_GLOBAL,
  CURSOR_FALLBACK_MODEL,
  resolveCursorModel,
  isCursorInstalled,
  isRtkInstalled,
  generateCursorSubagent,
  generateCursorRule,
  registerCursorMcp,
  registerCursorProjectMcp,
  registerCursorCliPermissions,
  registerCursorHooks,
  deployProjectCursor,
  deployCursorGlobalRule,
  deployCursorRtkRule,
  ensureCursorSetup,
  removeCursorConfig,
  getCursorStatus,
  copyCursorHelperScripts
};
