'use strict';

// Agent-file generation and ownership-safe deployment, split out of
// claude_code.js to keep that module under the 700-line cap.

const fs = require('fs');
const path = require('path');
const {
  fileExists,
  ensureDir
} = require('../platform_utils');
const {
  buildCodeSearchPolicyCompact,
  buildFileToolsPolicyCompact
} = require('../search_policy');
const { buildSubagentContract } = require('../agent_contract');
const {
  HOME,
  validateAgentName,
  buildSubagentToolGrants,
  assertNoWildcardGrants
} = require('./common');

function adaptInstructionsForClaudeCode(instructions) {
  if (!instructions) return '';
  return instructions
    .replace(/Always set RequestFeedback:\s*false\s+and\s+UserFacing:\s*false\s+in\s+ArtifactMetadata\s+when\s+writing\s+files\.?\s*/gi, '')
    .replace(/view_file/g, 'Read')
    .replace(/write_to_file/g, 'Write')
    .replace(/replace_file_content/g, 'Edit')
    .replace(/run_command/g, 'Bash')
    .replace(/(?:skills-db|konoha)\.find_skill/g, 'mcp__konoha__find_skill')
    .replace(/(?:skills-db|konoha)\.get_skill/g, 'mcp__konoha__get_skill')
    .replace(/(?:skills-db|konoha)\.list_skills/g, 'mcp__konoha__list_skills')
    .replace(/(?:skills-db|konoha)\.optimize_report/g, 'mcp__konoha__optimize_report')
    .replace(/(?:skills-db|konoha)\.build_from_source/g, 'mcp__konoha__build_from_source')
    .replace(/(?:skills-db|konoha)\.build_from_text/g, 'mcp__konoha__build_from_text')
    .replace(/(?:skills-db|konoha)\.get_resolved_task_dir/g, 'mcp__konoha__get_resolved_task_dir')
    .replace(/(?:skills-db|konoha)\.migrate_skills/g, 'mcp__konoha__migrate_skills')
    .replace(/(?:skills-db|konoha)\.web_search/g, 'mcp__konoha__web_search')
    .replace(/(?:skills-db|konoha)\.sannin/g, 'mcp__konoha__sannin')
    .replace(/(?:skills-db|konoha)\.kage/g, 'mcp__konoha__kage')
    .replace(/(?:skills-db|konoha)\.jonin/g, 'mcp__konoha__jonin')
    .replace(/(?:skills-db|konoha)\.anbu/g, 'mcp__konoha__anbu')
    .replace(/(?:skills-db|konoha)\.chunin/g, 'mcp__konoha__chunin')
    .replace(/(?:skills-db|konoha)\.tokubetsu_jonin/g, 'mcp__konoha__tokubetsu_jonin')
    .replace(/(?:skills-db|konoha)\.genin/g, 'mcp__konoha__genin')
    .replace(/(?:skills-db|konoha)\.akatsuki/g, 'mcp__konoha__akatsuki')
    .replace(/(?<!mcp__konoha__)\boptimize_report\b/g, 'mcp__konoha__optimize_report')
    .replace(/(?<!mcp__konoha__)\bkage\b(?!-)/g, 'mcp__konoha__kage')
    .replace(/(?<!mcp__konoha__)\bjonin\b(?!-)/g, 'mcp__konoha__jonin')
    .replace(/(?<!mcp__konoha__)\banbu\b(?!-)/g, 'mcp__konoha__anbu')
    .replace(/(?<!mcp__konoha__)\bchunin\b(?!-)/g, 'mcp__konoha__chunin')
    .replace(/(?<!mcp__konoha__)\bgenin\b(?!-)/g, 'mcp__konoha__genin')
    .replace(/(?<!mcp__konoha__)\bakatsuki\b(?!-)/g, 'mcp__konoha__akatsuki')
    .replace(/(?<!mcp__konoha__)\btokubetsu_jonin\b(?!-)/g, 'mcp__konoha__tokubetsu_jonin')
    .replace(/(?<!mcp__konoha__)\bsannin\b(?!-)/g, 'mcp__konoha__sannin')
    .replace(/(?<!mcp__konoha__)\bfind_skill\b/g, 'mcp__konoha__find_skill')
    .replace(/(?<!mcp__konoha__)\bget_skill\b/g, 'mcp__konoha__get_skill')
    .replace(/(?<!mcp__konoha__)\blist_skills\b/g, 'mcp__konoha__list_skills')
    .replace(/(?<!mcp__konoha__)\bread_file_head\b/g, 'mcp__konoha__read_file_head')
    .replace(/(?<!mcp__konoha__)\bread_file_range\b/g, 'mcp__konoha__read_file_range')
    .replace(/(?<!mcp__konoha__)\bfile_info\b/g, 'mcp__konoha__file_info')
    .replace(/(?<!mcp__konoha__)\btoken_efficient_grep\b/g, 'mcp__konoha__token_efficient_grep')
    .replace(/(?<!mcp__konoha__)\bget_file_structure\b/g, 'mcp__konoha__get_file_structure')
    .replace(/(?<!mcp__konoha__)\bfind_files_clean\b/g, 'mcp__konoha__find_files_clean')
    // Native Grep/Glob stay allowed for the main agent, so subagents get them
    // too — but the bare words are routed at the bounded Konoha tools so the
    // anti-grep invariant is not weakened.
    .replace(/(?<!mcp__konoha__)\bGrep\b/g, 'mcp__konoha__token_efficient_grep')
    .replace(/(?<!mcp__konoha__)\bGlob\b/g, 'mcp__konoha__find_files_clean')
    .trim();
}

function generateClaudeCodeSubagent(agent) {
  const DEFAULT_ROLE_DESCRIPTIONS = {
    'sannin': 'Sannin router agent for task triage, subagent selection, and orchestration',
    'genin': 'Scout for read-only codebase exploration, symbol search, and dependency mapping',
    'kage': 'Village Leader for architecture decisions, deep code analysis, and security audits',
    'chunin': 'Intel Ninja for web research, documentation lookup, and evidence synthesis',
    'jonin': 'Elite builder for premium UI/frontend across 4 frameworks with Tailwind v4',
    'anbu': 'Backend, DevOps, and bug-fixing specialist for APIs, databases, and infrastructure deployment',
    'tokubetsu-jonin': 'Scribe for technical documentation, API specs, runbooks, and reports',
    'akatsuki': 'Red-Team and Blue-Team security specialist for authorized penetration testing, defensive audits, and final security gate',
    'yamanaka': 'Generative 3D and spatial specialist for Three.js/Manifold synthesis, live Blender editing, and PBR asset delivery'
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
    const skillList = agent.skills.map(s => `"${s}"`).join(', ');
    const loadingInstruction = `MANDATORY FIRST ACTION before writing code: Call mcp__konoha__use_skills({ skills: [${skillList}] }) or mcp__konoha__get_skill to load your assigned domain guidelines into context. NEVER skip loading your assigned skills.`;
    const logPattern = /Log:\s*(['"])(.*?)\1\.\s*/i;
    const logMatch = instructions.match(logPattern);
    if (logMatch) {
      const insertIndex = logMatch.index + logMatch[0].length;
      instructions = instructions.slice(0, insertIndex) + `${loadingInstruction} ` + instructions.slice(insertIndex);
    } else {
      instructions = `${loadingInstruction} ` + instructions;
    }
  }

  instructions = `${instructions}\n\n${buildSubagentContract('claude')}`;
  const codeSearchLine = buildCodeSearchPolicyCompact();
  const fileToolsLine = buildFileToolsPolicyCompact();
  const body = adaptInstructionsForClaudeCode(`${instructions}\n\n${codeSearchLine}\n${fileToolsLine}\n`);

  const toolGrants = buildSubagentToolGrants('claude');
  assertNoWildcardGrants(toolGrants, `claude code subagent ${agent.name} allowed-tools`);

  const frontmatter = [
    '---',
    `name: ${agent.name}`,
    `description: "${description.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`,
    // Ownership marker. `_deployClaudeCodeAgents` refuses to overwrite a file
    // without it and `_cleanMcpAgentFiles` refuses to delete one without it, so
    // a hand-written agent in ~/.claude/agents survives install and uninstall.
    'generated_by: konoha',
    'allowed-tools:',
    ...toolGrants.map(t => `  - ${t}`),
    '---',
    ''
  ];

  return frontmatter.join('\n') + body;
}

const AGENT_OWNERSHIP_MARKER = 'generated_by: konoha';

/** True when a file's YAML frontmatter carries the Konoha ownership marker. */
function isKonohaOwnedAgentFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    if (!content.startsWith('---')) return false;
    const end = content.indexOf('\n---', 3);
    const frontmatter = end === -1 ? content : content.slice(0, end);
    return frontmatter.split('\n').some((line) => line.trim() === AGENT_OWNERSHIP_MARKER);
  } catch (_) {
    return false;
  }
}

function _cleanMcpAgentFiles(dir) {
  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      if (!file.startsWith('mcp_') || !file.endsWith('.md')) continue;
      const full = path.join(dir, file);
      // Only remove what Konoha wrote. A user's own mcp_*.md is theirs.
      if (!isKonohaOwnedAgentFile(full)) continue;
      fs.unlinkSync(full);
    }
  } catch (_) { /* ignore */ }
}

/** True for a real agent whose name is safe to use as a file name here. */
function _isDeployableAgent(agent, agentsDir) {
  if (!agent || !agent.name) return false;
  if (!validateAgentName(agent.name, agentsDir)) return false;
  return !agent.name.startsWith('mcp_') && !agent.name.startsWith('cli-test-');
}

/** True when an existing file belongs to someone else and differs from ours. */
function _needsConflictParking(targetPath, mdContent) {
  if (!fileExists(targetPath) || isKonohaOwnedAgentFile(targetPath)) return false;
  return fs.readFileSync(targetPath, 'utf8') !== mdContent;
}

/**
 * Keeps a foreign agent definition in place, backs it up once, and leaves
 * Konoha's version beside it so the caller can report the conflict.
 */
function _parkConflictingAgent(targetPath, mdContent, agentName) {
  const backupPath = `${targetPath}.konoha-backup`;
  if (!fileExists(backupPath)) {
    try { fs.copyFileSync(targetPath, backupPath); } catch (_) { /* best effort */ }
  }
  const proposed = `${targetPath}.konoha-proposed`;
  fs.writeFileSync(proposed, mdContent);
  return { agent: agentName, path: targetPath, proposed };
}

function _reportAgentConflicts(conflicts) {
  for (const c of conflicts) {
    process.stderr.write(`! Kept existing ${c.path}; Konoha's version written to ${c.proposed}\n`);
  }
}

function _deployClaudeCodeAgents(agents, options = {}) {
  if (!agents || !agents.length) return;
  const claudeAgentsDir = (options && options.home ? path.join(options.home, ".claude", "agents") : path.join(HOME, ".claude", "agents"));
  ensureDir(claudeAgentsDir);
  const conflicts = [];
  for (const agent of agents) {
    if (!_isDeployableAgent(agent, claudeAgentsDir)) continue;
    const mdContent = generateClaudeCodeSubagent(agent);
    const targetPath = path.join(claudeAgentsDir, agent.name + ".md");
    if (_needsConflictParking(targetPath, mdContent)) {
      conflicts.push(_parkConflictingAgent(targetPath, mdContent, agent.name));
      continue;
    }
    fs.writeFileSync(targetPath, mdContent);
  }
  _cleanMcpAgentFiles(claudeAgentsDir);
  if (conflicts.length > 0 && options.silent !== true) _reportAgentConflicts(conflicts);
  return conflicts;
}

module.exports = {
  adaptInstructionsForClaudeCode,
  generateClaudeCodeSubagent,
  AGENT_OWNERSHIP_MARKER,
  isKonohaOwnedAgentFile,
  _cleanMcpAgentFiles,
  _isDeployableAgent,
  _needsConflictParking,
  _parkConflictingAgent,
  _reportAgentConflicts,
  _deployClaudeCodeAgents
};