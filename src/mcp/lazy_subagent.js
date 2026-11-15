'use strict';

const { isReadOnlyAgent } = require('../agent_file_safety');
const { hasPiSubagentSupport } = require('../pi_manager');

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

const SUPERVISOR_SUBAGENTS = Object.freeze(['advisor']);

function isSpawnableAdvisor(agentName) {
  if (!agentName || typeof agentName !== 'string') return false;
  const norm = agentName.toLowerCase().trim().replace(/^mcp_/, '').replace(/_/g, '-');
  return SUPERVISOR_SUBAGENTS.includes(norm);
}

// The directive is embedded in a prompt whose ceiling the caller reserves room
// for (PROMPT_CEILING_BYTES in memory_subagent_runner.js), so the task text is
// bounded here instead of being allowed to grow the directive without limit.
const SPAWN_TASK_EXCERPT_BYTES = 1200;

function truncateSpawnTask(raw) {
  const buf = Buffer.from(raw, 'utf8');
  if (buf.length <= SPAWN_TASK_EXCERPT_BYTES) return raw;
  const cut = buf.subarray(0, SPAWN_TASK_EXCERPT_BYTES).toString('utf8').replace(/�$/, '');
  return `${cut}\n[task truncated at ${SPAWN_TASK_EXCERPT_BYTES} bytes; the full task is in the delegation envelope]`;
}

/**
 * The task argument, JSON-encoded so quotes and newlines survive any harness
 * syntax. The worktree rides in the task text because only two of the nine
 * harnesses accept a working-directory argument.
 */
function spawnTaskArg(prompt, worktreePath) {
  const raw = typeof prompt === 'string' ? prompt.trim() : '';
  const body = raw ? truncateSpawnTask(raw) : '(no task text supplied by the dispatcher)';
  return JSON.stringify(worktreePath ? `${body}\n[worktree: ${worktreePath}]` : body);
}

const CLIENT_SPAWN = {
  omp: {
    tool: 'task',
    headlessBin: 'omp',
    args: (d) => `task(context=${d.taskArg}, tasks=[{name:"${d.agent}", task:${d.taskArg}, agent:"${d.agent}"${d.worktreePath ? `, cwd:"${d.worktreePath}"` : ''}}])`
  },
  cursor: {
    tool: 'Task',
    headlessBin: 'cursor-agent',
    args: (d) => `Task(subagent_type="${d.agent}", description="Execute ${d.agent} task", prompt=${d.taskArg})`
  },
  claude: {
    tool: 'Agent',
    headlessBin: 'claude',
    args: (d) => `Agent(subagent_type="${d.agent}", description="Execute ${d.agent} task", prompt=${d.taskArg})`
  },
  commandcode: {
    tool: 'Task',
    headlessBin: 'command-code',
    args: (d) => `Task(subagent_type="${d.agent}", description="Execute ${d.agent} task", prompt=${d.taskArg})`
  },
  opencode: {
    tool: 'task',
    headlessBin: 'opencode',
    args: (d) => `task(subagent_type="${d.agent}", description="Execute ${d.agent} task", prompt=${d.taskArg})`
  },
  codex: {
    tool: 'spawn_agent',
    headlessBin: 'codex',
    args: (d) => `spawn_agent(agent_type="${d.agent}", message=${d.taskArg})`
  },
  antigravity: {
    tool: 'invoke_subagent',
    headlessBin: 'agy',
    args: (d) => {
      const readOnly = isReadOnlyAgent(d.agent);
      const ws = !readOnly && d.worktreePath ? 'share' : 'inherit';
      return `invoke_subagent({ TypeName: "${d.agent}", Role: "${d.agent} specialist", Prompt: ${d.taskArg}, Workspace: "${ws}" })`;
    }
  },
  agy: {
    tool: 'invoke_subagent',
    headlessBin: 'agy',
    args: (d) => {
      const readOnly = isReadOnlyAgent(d.agent);
      const ws = !readOnly && d.worktreePath ? 'share' : 'inherit';
      return `invoke_subagent({ TypeName: "${d.agent}", Role: "${d.agent} specialist", Prompt: ${d.taskArg}, Workspace: "${ws}" })`;
    }
  }
};

function buildUnsupportedSpawnPayload(client, reason) {
  return {
    ok: false,
    supported: false,
    error_code: 'UNSUPPORTED_NATIVE_SPAWN',
    client: client || 'unknown',
    error: reason,
    action: client === 'pi' || client === 'pi-dev' || client === 'pi.dev'
      ? 'Install the `pi-subagents` extension (`~/.pi/agent/extensions/subagent` or `pi-subagents` package) or run through a harness with native subagent support.'
      : 'Use a supported client harness (claude, cursor, codex, opencode, commandcode, omp, antigravity).'
  };
}

function resolveSpawnDescriptor(client, options = {}) {
  if (!client || typeof client !== 'string') {
    return {
      supported: false,
      client: null,
      tool: null,
      generic: true,
      error_code: 'UNSUPPORTED_NATIVE_SPAWN',
      error: 'No client harness specified; native subagent spawning capability cannot be verified.'
    };
  }
  const key = client.toLowerCase().trim();
  const canonical = key === 'claudecode' ? 'claude' : key;
  if (CLIENT_SPAWN[canonical]) {
    return { supported: true, client: canonical, ...CLIENT_SPAWN[canonical] };
  }
  if (canonical === 'universal' || canonical === 'cli') {
    return {
      supported: true,
      client: canonical,
      tool: 'run-agent',
      generic: true,
      headlessBin: 'konoha',
      args: (d) => `rtk node ~/.konoha/bin/cli.js run-agent --agent ${_safeAgentToken(d.agent)}${d.worktreePath ? ` --cwd ${_shellQuotePosix(d.worktreePath)}` : ''} --task ${d.taskArg}`
    };
  }
  if (canonical === 'pi' || canonical === 'pi-dev' || canonical === 'pi.dev') {
    const hasExtension = options.piSubagentSupported === true
      || (!('piSubagentSupported' in options) && hasPiSubagentSupport(options));
    if (hasExtension) {
      return {
        supported: true,
        client: 'pi',
        tool: 'subagent',
        headlessBin: 'pi',
        args: (d) => `subagent(agent="${d.agent}", task=${d.taskArg})`
      };
    }
    return {
      supported: false,
      client: 'pi',
      tool: null,
      generic: false,
      error_code: 'UNSUPPORTED_NATIVE_SPAWN',
      error: 'Pi has no built-in native subagent tool without the `pi-subagents` extension installed.'
    };
  }
  return {
    supported: false,
    client: key,
    tool: null,
    generic: true,
    error_code: 'UNSUPPORTED_NATIVE_SPAWN',
    error: `Client harness "${client}" does not support native subagent spawning.`
  };
}

function _shellQuotePosix(value) {
  return `'${String(value ?? '').replace(/'/g, "'\\''")}'`;
}

function _safeAgentToken(raw) {
  const cleaned = String(raw || 'subagent').replace(/^mcp_/, '').toLowerCase().trim().replace(/[^a-z0-9-]/g, '');
  return cleaned || 'subagent';
}

function buildSpawnDirective({ client, agent, skills, projectPath, prompt, taskDir, worktreePath, worktree, piSubagentSupported, home, agentDir, settingsPath } = {}) {
  const resolvedWt = worktreePath || (worktree && worktree.worktree_path) || null;
  const resolveOpts = {};
  if (typeof piSubagentSupported === 'boolean') resolveOpts.piSubagentSupported = piSubagentSupported;
  if (home) resolveOpts.home = home;
  if (agentDir) resolveOpts.agentDir = agentDir;
  if (settingsPath) resolveOpts.settingsPath = settingsPath;
  const desc = resolveSpawnDescriptor(client, resolveOpts);
  const rawAgent = _safeAgentToken(agent);
  const targetAgent = rawAgent === 'sannin' ? 'kage' : rawAgent;
  const taskArg = spawnTaskArg(prompt, resolvedWt);
  const cliBase = `rtk node ~/.konoha/bin/cli.js run-agent --agent ${targetAgent}${resolvedWt ? ` --cwd ${_shellQuotePosix(resolvedWt)}` : ''}`;

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

  if (desc && desc.supported && desc.tool && typeof desc.args === 'function') {
    const callStr = desc.args({ client, agent: targetAgent, skills: skillsForTarget, projectPath, prompt, taskArg, taskDir, worktreePath: resolvedWt });
    return [
      '## Spawn (mandatory)',
      `Spawn \`${targetAgent}\` via \`${callStr}\` (CLI fallback: \`${cliBase}\`). Report via \`konoha.report_from_agent\`.`
    ].join('\n');
  }
  return JSON.stringify(
    buildUnsupportedSpawnPayload(client, (desc && desc.error) || `Unsupported harness "${client || 'unknown'}" for native spawning.`)
  );
}

function buildParallelSpawnDirective({ client, dispatches = [], taskDir = null, projectPath = null, piSubagentSupported, home, agentDir, settingsPath } = {}) {
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

  const resolveOpts = {};
  if (typeof piSubagentSupported === 'boolean') resolveOpts.piSubagentSupported = piSubagentSupported;
  if (home) resolveOpts.home = home;
  if (agentDir) resolveOpts.agentDir = agentDir;
  if (settingsPath) resolveOpts.settingsPath = settingsPath;

  const desc = resolveSpawnDescriptor(client, resolveOpts);
  if (!desc || !desc.supported || !desc.tool || typeof desc.args !== 'function') {
    return JSON.stringify(
      buildUnsupportedSpawnPayload(client, (desc && desc.error) || `Unsupported harness "${client || 'unknown'}" for native parallel spawning.`)
    );
  }

  const agentNames = validDispatches.map(d => _safeAgentToken((d.agent || d.name || '').replace(/_/g, '-')));
  const cliParallel = `rtk node ~/.konoha/bin/cli.js run-agent --parallel --agents ${agentNames.join(',')}${taskDir ? ` --task-dir ${_shellQuotePosix(taskDir)}` : ''}`;

  const lines = [
    '## Parallel Spawn Wave (mandatory concurrent execution)',
    `Launch all ${validDispatches.length} independent worker subagents CONCURRENTLY in this turn (do NOT run them sequentially; @sannin acts strictly as router):`
  ];

  for (const d of validDispatches) {
    const ag = String(d.agent || d.name).replace(/^mcp_/, '').replace(/_/g, '-');
    const wtPath = d.worktree_path || (d.worktree && d.worktree.worktree_path) || null;
    const taskArg = spawnTaskArg(d.task || d.prompt || '', wtPath);
    const callStr = desc.args({ client, agent: ag, projectPath, prompt: d.task || d.prompt || '', taskArg, worktreePath: wtPath });
    lines.push(`- **@${ag}** (${d.domain || d.phase || 'slice'}): \`${callStr}\`${wtPath ? ` [Worktree: \`${wtPath}\`]` : ''}`);
  }

  lines.push(`- **CLI Parallel Batch Fallback**: \`${cliParallel}\``);
  lines.push('Wait for all parallel branches to complete and report via `konoha.report_from_agent` before advancing the fan-in barrier.');
  return lines.join('\n');
}

function buildAdvisorStartupDirective({
  client,
  projectPath = null,
  taskDir = null,
  piSubagentSupported,
  home,
  agentDir,
  settingsPath
} = {}) {
  const { buildClientSteerCall } = require('../workflow/kage-reviewer/advisor_steering');
  const resolveOpts = {};
  if (typeof piSubagentSupported === 'boolean') resolveOpts.piSubagentSupported = piSubagentSupported;
  if (home) resolveOpts.home = home;
  if (agentDir) resolveOpts.agentDir = agentDir;
  if (settingsPath) resolveOpts.settingsPath = settingsPath;

  const desc = resolveSpawnDescriptor(client, resolveOpts);
  const advisorPrompt = 'Idle turn-0 @advisor: watch Plan/TODO/Goals; steer drift.';
  const taskArg = spawnTaskArg(advisorPrompt, null);
  const cliFallback = 'rtk node ~/.konoha/bin/cli.js run-agent --agent advisor --idle';
  const sampleSteer = buildClientSteerCall({
    client: client || 'universal',
    targetAgent: '<drifting-agent>',
    directive: '[ADVISOR STEER] Realign with Plan/TODO/Goals.',
    piSubagentSupported: resolveOpts.piSubagentSupported
  });

  if (desc && desc.supported && desc.tool && typeof desc.args === 'function') {
    const isUniversalCli = desc.client === 'universal' || desc.client === 'cli';
    const callStr = isUniversalCli
      ? cliFallback
      : desc.args({
          client,
          agent: 'advisor',
          skills: [],
          projectPath,
          prompt: advisorPrompt,
          taskArg,
          taskDir,
          worktreePath: null
        });
    return {
      agent: 'advisor',
      state: 'idle',
      mode: 'realtime-idle',
      started_from_beginning: true,
      review_scope: 'all_agents',
      watch_targets: ['plan', 'todo', 'goals'],
      supported_native: true,
      client: desc.client,
      tool: desc.tool,
      spawn_call: callStr,
      cli_fallback: cliFallback,
      steer_protocol: sampleSteer,
      directive: `## @advisor (idle, turn 0)\nStart \`@advisor\`: \`${callStr}\` (steer: \`${sampleSteer.tool}\`).`
    };
  }

  return {
    agent: 'advisor',
    state: 'idle',
    mode: 'realtime-idle',
    started_from_beginning: true,
    review_scope: 'all_agents',
    watch_targets: ['plan', 'todo', 'goals'],
    supported_native: false,
    client: client || 'unknown',
    tool: null,
    spawn_call: null,
    cli_fallback: cliFallback,
    steer_protocol: sampleSteer,
    directive: `## @advisor (idle, turn 0)\nStart \`@advisor\`: \`${cliFallback}\` (steer: \`${sampleSteer.tool}\`).`
  };
}

function buildDirectSteerDirective(options = {}) {
  const { buildClientSteerCall } = require('../workflow/kage-reviewer/advisor_steering');
  return buildClientSteerCall(options);
}

module.exports = {
  SPAWNABLE_SUBAGENTS,
  SUPERVISOR_SUBAGENTS,
  isSpawnableSubagent,
  isSpawnableAdvisor,
  CLIENT_SPAWN,
  buildUnsupportedSpawnPayload,
  resolveSpawnDescriptor,
  buildSpawnDirective,
  buildParallelSpawnDirective,
  buildAdvisorStartupDirective,
  buildDirectSteerDirective
};
