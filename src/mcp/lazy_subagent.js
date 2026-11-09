'use strict';

const SPAWNABLE_SUBAGENTS = Object.freeze([
  'genin',
  'kage',
  'chunin',
  'jonin',
  'anbu',
  'tokubetsu-jonin',
  'akatsuki',
  'yamanaka'
]);

function isSpawnableSubagent(agentName) {
  if (!agentName || typeof agentName !== 'string') return false;
  const norm = agentName.toLowerCase().trim().replace(/^mcp_/, '').replace(/_/g, '-');
  return norm !== 'sannin' && SPAWNABLE_SUBAGENTS.includes(norm);
}

const CLIENT_SPAWN = {
  omp:         { tool: 'task', args: (d) => `task(context="…", tasks=[{name:"${d.agent}", task:"…", agent:"${d.agent}"${d.worktreePath ? `, cwd:"${d.worktreePath}"` : ''}}])` },
  cursor:      { tool: 'Task', args: (d) => `Task(subagent_type="${d.agent}", description="Execute ${d.agent} task", prompt="…${d.worktreePath ? ` [worktree: ${d.worktreePath}]` : ''}")` },
  claude:      { tool: 'Task',  args: (d) => `Task(subagent_type="${d.agent}", description="Execute ${d.agent} task", prompt="…${d.worktreePath ? ` [worktree: ${d.worktreePath}]` : ''}")` },
  commandcode: { tool: 'Task',  args: (d) => `Task(subagent_type="${d.agent}", description="Execute ${d.agent} task", prompt="…${d.worktreePath ? ` [worktree: ${d.worktreePath}]` : ''}")` },
  opencode:    { tool: 'task',  args: (d) => `task(subagent_type="${d.agent}", description="Execute ${d.agent} task", prompt="…${d.worktreePath ? ` [worktree: ${d.worktreePath}]` : ''}")` },
  codex:       { tool: 'spawn_agent', args: (d) => `spawn_agent(agent="${d.agent}", task="…${d.worktreePath ? ` [worktree: ${d.worktreePath}]` : ''}")` },
  pi:          { tool: 'task',  args: (d) => `task(agent="${d.agent}", prompt="…${d.worktreePath ? ` [worktree: ${d.worktreePath}]` : ''}")` },
  antigravity: { tool: 'invoke_subagent', args: (d) => `invoke_subagent({ TypeName: "self", Role: "${d.agent} specialist", Prompt: "…${d.worktreePath ? ` [worktree: ${d.worktreePath}]` : ''}"${d.worktreePath ? ', Workspace: "share"' : ''} })` },
  agy:         { tool: 'invoke_subagent', args: (d) => `invoke_subagent({ TypeName: "self", Role: "${d.agent} specialist", Prompt: "…${d.worktreePath ? ` [worktree: ${d.worktreePath}]` : ''}"${d.worktreePath ? ', Workspace: "share"' : ''} })` }
};

function resolveSpawnDescriptor(client) {
  if (!client || typeof client !== 'string') {
    return { tool: null, generic: true };
  }
  const key = client.toLowerCase().trim();
  if (CLIENT_SPAWN[key]) {
    return CLIENT_SPAWN[key];
  }
  if (key === 'claudecode') return CLIENT_SPAWN.claude;
  return { tool: null, generic: true };
}

function buildSpawnDirective({ client, agent, skills, projectPath, prompt, taskDir, worktreePath, worktree } = {}) {
  const resolvedWt = worktreePath || (worktree && worktree.worktree_path) || null;
  const desc = resolveSpawnDescriptor(client);
  const rawAgent = String(agent || 'subagent').replace(/^mcp_/, '');
  const targetAgent = rawAgent === 'sannin' ? 'kage' : rawAgent;
  const cliFallback = `rtk node ~/.konoha/bin/cli.js run-agent --agent ${targetAgent}${resolvedWt ? ` --cwd "${resolvedWt}"` : ''} --task "…"`;

  // Red skills are @akatsuki-only: a spawn for any other agent never carries them.
  const skillAuthz = require('../skill_authorization');
  const requestedSkills = Array.isArray(skills) ? skills : (skills ? [skills] : []);
  const skillsForTarget = requestedSkills.filter(
    (s) => skillAuthz.authorizeSkillAccess({ skillName: s, agentName: targetAgent }).authorized
  );
  const deniedSkills = requestedSkills.filter((s) => !skillsForTarget.includes(s));

  if (deniedSkills.length > 0) {
    return JSON.stringify(
      require('../skill_authorization').authorizationDeniedResult(
        {
          identity: targetAgent,
          reason: `Delegation to @${targetAgent} requested red skill(s) ${deniedSkills.map((s) => `"${s}"`).join(', ')}; red skills may only be delegated to @akatsuki.`
        },
        deniedSkills[0]
      )
    );
  }

  if (desc && desc.tool && typeof desc.args === 'function') {
    const callStr = desc.args({ client, agent: targetAgent, skills: skillsForTarget, projectPath, prompt, taskDir, worktreePath: resolvedWt });
    return [
      '## Spawn (mandatory)',
      `Spawn a background subagent named \`${targetAgent}\` with \`${callStr}\` (CLI fallback: \`${cliFallback}\`).`,
      'Wait for its structured report via `konoha.report_from_agent`.'
    ].join('\n');
  }
  return [
    '## Spawn (mandatory)',
    `Launch subagent via CLI runner: \`${cliFallback}\` and consume its report.`
  ].join('\n');
}

function buildParallelSpawnDirective({ client, dispatches = [], taskDir = null, projectPath = null } = {}) {
  if (!Array.isArray(dispatches) || dispatches.length === 0) return '';
  const validDispatches = dispatches.filter(d => {
    const ag = String(d.agent || d.name || '').replace(/^mcp_/, '');
    return ag && ag !== 'sannin';
  });
  if (validDispatches.length === 0) return '';

  const skillAuthz = require('../skill_authorization');
  for (const d of validDispatches) {
    const ag = String(d.agent || d.name).replace(/^mcp_/, '').replace(/_/g, '-');
    const requested = Array.isArray(d.skills) ? d.skills : (d.skills ? [d.skills] : []);
    const denied = requested.filter((s) => !skillAuthz.authorizeSkillAccess({ skillName: s, agentName: ag }).authorized);
    if (denied.length > 0) {
      return JSON.stringify(
        skillAuthz.authorizationDeniedResult(
          {
            identity: ag,
            reason: `Parallel delegation to @${ag} requested red skill(s) ${denied.map((s) => `"${s}"`).join(', ')}; red skills may only be delegated to @akatsuki.`
          },
          denied[0]
        )
      );
    }
  }

  const desc = resolveSpawnDescriptor(client);
  const agentNames = validDispatches.map(d => String(d.agent || d.name).replace(/^mcp_/, '').replace(/_/g, '-'));
  const cliParallel = `rtk node ~/.konoha/bin/cli.js run-agent --parallel --agents ${agentNames.join(',')}${taskDir ? ` --task-dir "${taskDir}"` : ''}`;

  const lines = [
    '## Parallel Spawn Wave (mandatory concurrent execution)',
    `Launch all ${validDispatches.length} independent worker subagents CONCURRENTLY in this turn (do NOT run them sequentially; @sannin acts strictly as router):`
  ];

  for (const d of validDispatches) {
    const ag = String(d.agent || d.name).replace(/^mcp_/, '').replace(/_/g, '-');
    const wtPath = d.worktree_path || (d.worktree && d.worktree.worktree_path) || null;
    const callStr = (desc && desc.tool && typeof desc.args === 'function')
      ? desc.args({ client, agent: ag, projectPath, worktreePath: wtPath })
      : `rtk node ~/.konoha/bin/cli.js run-agent --agent ${ag}${wtPath ? ` --cwd "${wtPath}"` : ''} --task "…"`;
    lines.push(`- **@${ag}** (${d.domain || d.phase || 'slice'}): \`${callStr}\`${wtPath ? ` [Worktree: \`${wtPath}\`]` : ''}`);
  }

  lines.push(`- **CLI Parallel Batch Fallback**: \`${cliParallel}\``);
  lines.push('Wait for all parallel branches to complete and report via `konoha.report_from_agent` before advancing the fan-in barrier.');
  return lines.join('\n');
}

module.exports = {
  SPAWNABLE_SUBAGENTS,
  isSpawnableSubagent,
  CLIENT_SPAWN,
  resolveSpawnDescriptor,
  buildSpawnDirective,
  buildParallelSpawnDirective
};
