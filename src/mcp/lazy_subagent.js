'use strict';

const CLIENT_SPAWN = {
  omp:         { tool: 'task', args: (d) => `task(context="…", tasks=[{name:"${d.agent}", task:"…", agent:"${d.agent}"}])` },
  cursor:      { tool: 'Task', args: (d) => `Task(subagent_type="${d.agent}", description="…", prompt="…")` },
  claude:      { tool: 'Task',  args: (d) => `Task(subagent_type="${d.agent}", description="…", prompt="…")` },
  commandcode: { tool: 'Task',  args: (d) => `Task(subagent_type="${d.agent}", description="…", prompt="…")` },
  opencode:    { tool: 'task',  args: (d) => `task(subagent_type="${d.agent}", prompt="…")` },
  codex:       { tool: 'spawn_agent', args: (d) => `spawn_agent(agent="${d.agent}", task="…")` },
  pi:          { tool: 'task',  args: (d) => `task(agent="${d.agent}", prompt="…")` },
  antigravity: { tool: 'invoke_subagent', args: (d) => `invoke_subagent(agent="${d.agent}", task="…")` },
  agy:         { tool: 'invoke_subagent', args: (d) => `invoke_subagent(agent="${d.agent}", task="…")` }
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

function buildSpawnDirective({ client, agent, skills, projectPath, prompt } = {}) {
  const desc = resolveSpawnDescriptor(client);
  const targetAgent = agent || 'subagent';
  if (desc && desc.tool && typeof desc.args === 'function') {
    const callStr = desc.args({ client, agent: targetAgent, skills, projectPath, prompt });
    return [
      '## Spawn (mandatory)',
      `Spawn a background subagent named \`${targetAgent}\` with \`${callStr}\`.`,
      'Launch it lazily on first use — do not create files or configs. Never execute this task yourself',
      'in the main context; wait for its structured report via `konoha.report_from_agent`.'
    ].join('\n');
  }
  return [
    '## Spawn (mandatory)',
    'This client has no native subagent tool. Launch the subagent through the',
    `Konoha CLI runner: \`node ~/.konoha/bin/cli.js run-agent --agent ${targetAgent} --task "…"\` and consume its report.`
  ].join('\n');
}

module.exports = {
  CLIENT_SPAWN,
  resolveSpawnDescriptor,
  buildSpawnDirective
};
