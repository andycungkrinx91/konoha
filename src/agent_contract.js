'use strict';

const CONTRACT_VERSION = '2.0.0-cross-client-1';
const CONTRACT_START = '<!-- KONOHA-CONTRACT-START -->';
const CONTRACT_END = '<!-- KONOHA-CONTRACT-END -->';

const CLIENT_LABELS = {
  antigravity: 'Antigravity IDE/CLI',
  cursor: 'Cursor IDE/CLI',
  claude: 'Claude Code',
  opencode: 'OpenCode',
  commandcode: 'Command Code',
  codex: 'Codex'
};

function buildAgentContract(options = {}) {
  const client = options.client || 'konoha';
  const role = options.role || 'main agent';
  const clientLabel = CLIENT_LABELS[client] || client;
  const roleLabel = role === 'subagent' ? 'official Konoha subagent' : role;

  return `${CONTRACT_START}
## Konoha runtime contract (${CONTRACT_VERSION})

You are the ${roleLabel} running through ${clientLabel}. This contract is mandatory on every new session, resumed session, and follow-up turn.

- **Konoha is mandatory**: use the \`konoha\` MCP for skill discovery, skill loading, and bounded file operations. All clients call skills through \`konoha.find_skills\` (or \`find_skill\`) to discover global and project skills before work, and load matching content with \`konoha.get_skill\`. When a project contains local skills, the client auto-migrates them into the skills database. Never load raw SKILL.md files directly.
- **Semble is mandatory**: use the \`semble\` MCP tools \`search\` and \`find_related\` for all project codebase discovery and search. Always pass the absolute repository path. Do not replace Semble with native grep, glob, find, or IDE search.
- **RTK is mandatory for commands**: ALWAYS force-run all shell/command executions with \`rtk <command>\` first; prefix shell/command execution with \`rtk\` to filter noisy terminal output and minimize token consumption. When RTK is not installed, fails, or is unsupported for a specific command, immediately fall back to direct shell/bash (\`sh\` / \`bash\`) execution without silently claiming RTK was used.
- **Test directory discovery & reuse**: ALWAYS explore the codebase first (\`get_file_structure\` or \`find_files_clean\`) to discover existing test folders (\`tests/\`, \`test/\`, \`spec/\`). NEVER create duplicate test folders (e.g. creating \`test/\` when \`tests/\` exists).
- **Kage Reviewer 95% minimum confidence & Standard Delivery Report**: Before final delivery, Kage must review all tasks, validation evidence, and security compliance. A minimum **95% confidence** is required. If confidence < 95%, delivery is strictly BLOCKED and tasks must be re-delegated for remediation. Every final response and delivery report MUST include the standardized **Kage Reviewer Confidence Gate Report** (Box header with status and confidence %, breakdown table covering \`Verification Category\`, \`Target\`, \`Evaluated Result\`, \`Category Confidence\`, and \`Status\`, followed by the overall confidence verdict).
- **Destructive command, Git & secret guardrails**:
  - NEVER run harmful commands (\`rm -rf /\`, \`rm -rf ~\`, \`mkfs\`, \`dd\`, \`DROP DATABASE\`, \`TRUNCATE TABLE\`, \`chmod 777\`, \`chown -R\`, \`curl | bash\`, \`wget | sh\`, unconstrained \`sudo\`) without explicit user permission.
  - NEVER run destructive git commands (\`git reset --hard\`, \`git push --force\`, \`git clean -fdx\`, \`git checkout -- .\`, \`git rebase -i\`) without explicit user permission.
  - NEVER view, print, dump, or commit secrets, \`.env*\`, \`secrets.yaml\`, \`*.tfvars\`, \`*.pem\`, \`*.key\`, \`id_rsa\`, \`credentials\`, or API tokens without explicit permission. Redact all secret values.
- **Strict factual truth & zero hallucination (NEVER LIE / DONT LIE)**:
  - NEVER fabricate, simulate, or lie about running tests, executing tools, auditing docs, or completing tasks.
  - NEVER claim an agent, tool, or command succeeded or ran if it produced 0 output, 0 tokens, or was never actually executed.
  - NEVER pretend a review or test suite passed without inspecting and verifying real, verifiable output evidence.
  - Always report factual evidence, exact line counts, errors, warnings, and limitations transparently. If a task or review was not executed, state it clearly and execute it directly.
- **Post-approval cleanup gate**: Clean up all transient debug scripts, scratch files, and temporary test patches (\`debug_*\`, \`temp_*\`, \`test_patch.py\`, \`scratch/*\`) upon approval before concluding work.
- **Delegation remains mandatory**: the main agent coordinates through Konoha subagent tools; each official subagent follows this same Konoha, Semble, and RTK contract directly.
- **Resume safety**: when a session starts or resumes, re-read this contract, re-evaluate the prompt, repeat skill discovery, and restore the Konoha/Semble/RTK workflow before taking action. Never assume a previous turn established these requirements.
- **Tool boundaries**: Konoha handles skills and bounded file I/O; Semble handles code search; RTK wraps shell output. Do not mix their responsibilities.
${CONTRACT_END}`;
}

function buildMainAgentContract(client) {
  return buildAgentContract({ client, role: 'main agent' });
}

function buildSubagentContract(client) {
  return buildAgentContract({ client, role: 'subagent' });
}

function buildManagedContract(existing, contract) {
  const source = String(existing || '');
  const startIndex = source.indexOf(CONTRACT_START);
  const endIndex = source.indexOf(CONTRACT_END);
  if (startIndex !== -1 && endIndex !== -1 && endIndex >= startIndex) {
    return source.slice(0, startIndex) + contract + source.slice(endIndex + CONTRACT_END.length);
  }
  return `${source.trim()}\n\n${contract}\n`;
}

function validateContractText(text) {
  const source = String(text || '');
  const required = [
    ['Konoha MCP', /Konoha is mandatory/i],
    ['Semble MCP', /Semble is mandatory/i],
    ['RTK', /RTK is mandatory/i],
    ['resume handling', /Resume safety/i],
    ['contract markers', new RegExp(`${CONTRACT_START}.*${CONTRACT_END}`, 's')]
  ];
  const missing = required.filter(([, pattern]) => !pattern.test(source)).map(([name]) => name);
  return { ok: missing.length === 0, missing };
}

function buildContractManifest(extra = {}) {
  return {
    contractVersion: CONTRACT_VERSION,
    contractClients: Object.keys(CLIENT_LABELS),
    ...extra,
  };
}

function generateGenericSubagentMd(agent, client = 'generic') {
  const DEFAULT_ROLE_DESCRIPTIONS = {
    'sannin': 'Sannin router agent for task triage, subagent selection, and orchestration',
    'genin': 'Scout for read-only codebase exploration, symbol search, and dependency mapping',
    'kage': 'Village Leader for architecture decisions, deep code analysis, and security audits',
    'chunin': 'Intel Ninja for web research, documentation lookup, and evidence synthesis',
    'jonin': 'Elite builder for premium UI/frontend across 4 frameworks with Tailwind v4',
    'anbu': 'Black Ops for backend dev, bug fixing, DevOps, and infrastructure deployment',
    'tokubetsu-jonin': 'Scribe for technical documentation, API specs, runbooks, and reports'
  };
  const rawDesc = DEFAULT_ROLE_DESCRIPTIONS[agent.name] || agent.description || agent.purpose || agent.role || `${agent.name} ninja agent`;
  const description = `${rawDesc}. Use proactively when tasks match: ${agent.delegationKeywords || agent.purpose || agent.name}.`;

  let instructions = agent.instructions || '';
  instructions = instructions.replace(/\bBefore work:\s*find_skill\([^)]*\)(?:\.\s*find_skill\([^)]*\))*\.?\s*/gi, '');
  instructions = instructions.replace(/If delegate\.md specifies exact reference names,\s*load\s+them\s+via\s+the\s+skills-db\.get_skill\s+tool\.?/gi, '');
  instructions = instructions.replace(/Follow\s+full\s+protocol\s+in\s+~\/\.agents\/AGENTS\.md\.?/gi, '');
  instructions = instructions.trim();
  if (instructions && !instructions.endsWith('.')) {
    instructions += '.';
  }

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

  instructions = `${instructions}\n\n${buildSubagentContract(client)}`;
  const searchLine = 'Search codebase using semble MCP tools (search, find_related). Always pass repo absolute path.';
  const fileToolsLine = 'Read/inspect files using konoha MCP bounded file tools (read_file_head, read_file_range, token_efficient_grep, get_file_structure, find_files_clean).';

  const frontmatter = [
    '---',
    `name: ${agent.name}`,
    `description: "${description.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`,
    'allowed-tools:',
    '  - Write',
    '  - Edit',
    '  - Bash',
    '  - Shell',
    '  - TodoRead',
    '  - TodoWrite',
    '  - WebSearch',
    '  - mcp__semble__*',
    '  - mcp__konoha__*',
    '---',
    ''
  ];

  return frontmatter.join('\n') + instructions + '\n\n' + searchLine + '\n' + fileToolsLine + '\n';
}

module.exports = {
  CONTRACT_VERSION,
  CONTRACT_START,
  CONTRACT_END,
  buildAgentContract,
  buildMainAgentContract,
  buildSubagentContract,
  buildManagedContract,
  validateContractText,
  buildContractManifest,
  generateGenericSubagentMd
};
