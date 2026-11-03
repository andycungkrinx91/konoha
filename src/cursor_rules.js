'use strict';

const {
  buildSubagentContract,
  buildManagedContract,
  buildLightweightContract,
} = require('./agent_contract');
const {
  buildSembleSearchPolicyCompact,
  buildFileToolsPolicyCompact,
} = require('./search_policy');

const CURSOR_FALLBACK_MODEL = 'inherit';

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
  instructions = instructions.replace(/\bBefore work:\s*find_skill\([^)]*\)(?:\.\s*find_skill\([^)]*\))*\.?\s*/gi, '');

  if (agent.skills && agent.skills.length > 0) {
    const skillList = agent.skills.map(s => `"${s}"`).join(', ');
    const loadingInstruction = `MANDATORY FIRST ACTION before writing code: Call konoha.use_skills({ skills: [${skillList}] }) or konoha.get_skill to load your assigned domain guidelines into context. NEVER skip loading your assigned skills.`;
    const logPattern = /Log:\s*(['"])(.*?)\1\.\s*/i;
    const logMatch = instructions.match(logPattern);
    if (logMatch) {
      const insertIndex = logMatch.index + logMatch[0].length;
      instructions = instructions.slice(0, insertIndex) + `${loadingInstruction} ` + instructions.slice(insertIndex);
    } else {
      instructions = `${loadingInstruction} ` + instructions;
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
}

function generateCursorRule(agents, ruleContent = null) {
  if (ruleContent) {
    const managed = buildManagedContract(ruleContent, buildLightweightContract({ client: 'cursor' }));
    return `---\ndescription: Konoha rules\nalwaysApply: true\n---\n\n` + managed;
  }
  const roster = (agents || []).map(a => {
    const title = a.name === 'anbu' ? 'Backend, DevOps & Security' : (a.title || 'Specialist');
    return `- **@${a.name}**: ${title}`;
  }).join('\n');

  const contractText = buildLightweightContract({ client: 'cursor' });

  const body = `---
description: Konoha rules
alwaysApply: true
---

# Cursor — Agent Rules

## Team Roster
${roster}

## Safety Guardrails
NEVER run destructive commands (\`rm -rf\`, \`DROP\`, \`git reset\`) or view secrets (\`.env*\`).\n\n`;

  return buildManagedContract(body, contractText);
}

module.exports = {
  adaptInstructionsForCursor,
  resolveCursorModel,
  generateCursorSubagent,
  generateCursorRule,
  CURSOR_FALLBACK_MODEL
};
