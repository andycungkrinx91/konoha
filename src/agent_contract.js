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
