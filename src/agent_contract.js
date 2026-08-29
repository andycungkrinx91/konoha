'use strict';

const CONTRACT_VERSION = '2.0.0-cross-client-1';
const CONTRACT_START = '<!-- KONOHA-CONTRACT-START -->';
const CONTRACT_END = '<!-- KONOHA-CONTRACT-END -->';

const CLIENT_LABELS = {
  antigravity: 'Antigravity IDE/CLI',
  cursor: 'Cursor IDE/CLI',
  claude: 'Claude Code',
  opencode: 'OpenCode',
  commandcode: 'Command Code'
};

function buildAgentContract(options = {}) {
  const client = options.client || 'konoha';
  const role = options.role || 'main agent';
  const clientLabel = CLIENT_LABELS[client] || client;
  const roleLabel = role === 'subagent' ? 'official Konoha subagent' : role;

  return `${CONTRACT_START}
## Konoha runtime contract (${CONTRACT_VERSION})

You are the ${roleLabel} running through ${clientLabel}. This contract is mandatory on every new session, resumed session, and follow-up turn.

- **Konoha is mandatory**: use the \`konoha\` MCP for skill discovery, skill loading, and bounded file operations. Use \`konoha.find_skill\` before work and load the matching skill with \`konoha.get_skill\`.
- **Semble is mandatory**: use the \`semble\` MCP tools \`search\` and \`find_related\` for all project codebase discovery and search. Always pass the absolute repository path. Do not replace Semble with native grep, glob, find, or IDE search.
- **RTK is mandatory for commands**: prefix shell/command execution with \`rtk\` when the binary is installed. If RTK is unavailable, report the warning and use the client’s approved fallback without silently claiming RTK was used.
- **Test directory discovery & reuse**: ALWAYS explore the codebase first (\`get_file_structure\` or \`find_files_clean\`) to discover existing test folders (\`tests/\`, \`test/\`, \`spec/\`). NEVER create duplicate test folders (e.g. creating \`test/\` when \`tests/\` exists).
- **Kage Reviewer 90% minimum confidence & Standard Delivery Report**: Before final delivery, Kage must review all tasks, validation evidence, and security compliance. A minimum **90% confidence** is required. If confidence < 90%, delivery is strictly BLOCKED and tasks must be re-delegated for remediation. Every final response and delivery report MUST include the standardized **Kage Reviewer Confidence Gate Report** (Box header with status and confidence %, breakdown table covering \`Verification Category\`, \`Target\`, \`Evaluated Result\`, \`Category Confidence\`, and \`Status\`, followed by the overall confidence verdict).
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
};
