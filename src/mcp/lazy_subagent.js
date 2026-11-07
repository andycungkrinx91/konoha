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
  cursor:      { tool: 'Task', args: (d) => `Task(subagent_type="${d.agent}", description="Execute ${d.agent} task", prompt="…")` },
  claude:      { tool: 'Task',  args: (d) => `Task(subagent_type="${d.agent}", description="Execute ${d.agent} task", prompt="…")` },
  commandcode: { tool: 'Task',  args: (d) => `Task(subagent_type="${d.agent}", description="Execute ${d.agent} task", prompt="…")` },
  opencode:    { tool: 'task',  args: (d) => `task(subagent_type="${d.agent}", description="Execute ${d.agent} task", prompt="…")` },
  codex:       { tool: 'spawn_agent', args: (d) => `spawn_agent(agent="${d.agent}", task="…")` },
  pi:          { tool: 'task',  args: (d) => `task(agent="${d.agent}", prompt="…")` },
  antigravity: { tool: 'invoke_subagent', args: (d) => `invoke_subagent({ TypeName: "self", Role: "${d.agent} specialist", Prompt: "…"${d.worktreePath ? ', Workspace: "share"' : ''} })` },
  agy:         { tool: 'invoke_subagent', args: (d) => `invoke_subagent({ TypeName: "self", Role: "${d.agent} specialist", Prompt: "…"${d.worktreePath ? ', Workspace: "share"' : ''} })` }
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

function buildSpawnDirective({ client, agent, skills, projectPath, prompt, taskDir, worktreePath } = {}) {
  const desc = resolveSpawnDescriptor(client);
  const rawAgent = String(agent || 'subagent').replace(/^mcp_/, '');
  const targetAgent = rawAgent === 'sannin' ? 'kage' : rawAgent;
  const cliFallback = `rtk node ~/.konoha/bin/cli.js run-agent --agent ${targetAgent}${worktreePath ? ` --cwd "${worktreePath}"` : ''} --task "…"`;

  if (desc && desc.tool && typeof desc.args === 'function') {
    const callStr = desc.args({ client, agent: targetAgent, skills, projectPath, prompt, taskDir, worktreePath });
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
