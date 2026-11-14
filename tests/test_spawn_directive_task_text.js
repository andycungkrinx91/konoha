'use strict';

/**
 * The spawn directive is the only thing standing between a routed delegation and
 * a subagent that actually receives its task. These assertions pin the task text
 * to every client descriptor, because a placeholder that reads as valid syntax
 * fails silently inside the harness.
 */

const assert = require('assert');
const { CLIENT_SPAWN, buildSpawnDirective, buildParallelSpawnDirective } = require('../src/mcp/lazy_subagent');

const TASK = 'Fix the auth middleware: token expiry check uses < not <=, and keep the quoted case.';
const QUOTED_TASK = 'Keep the "quoted" case and a\nnewline intact.';

function runTests() {
  const clientKeys = Object.keys(CLIENT_SPAWN);

  for (const client of clientKeys) {
    const directive = buildSpawnDirective({ client, agent: 'anbu', prompt: TASK });
    assert.ok(directive.includes(TASK), `${client}: spawn directive must carry the task text verbatim`);
    assert.ok(!directive.includes('…'), `${client}: spawn directive must not emit a placeholder task`);
    assert.ok(directive.includes('anbu'), `${client}: spawn directive must name the target agent`);

    // Quotes and newlines are JSON-encoded so they cannot terminate the argument early.
    const quoted = buildSpawnDirective({ client, agent: 'anbu', prompt: QUOTED_TASK });
    assert.ok(quoted.includes(JSON.stringify(QUOTED_TASK)), `${client}: task must be JSON-encoded into the call`);
  }

  for (const client of clientKeys) {
    const worktreeDirective = buildSpawnDirective({
      client, agent: 'jonin', prompt: TASK, worktreePath: '/tmp/wt-1'
    });
    assert.ok(worktreeDirective.includes(TASK), `${client}: worktree spawn must still carry the task`);
    assert.ok(worktreeDirective.includes('/tmp/wt-1'), `${client}: worktree spawn must still carry the worktree path`);
  }

  const cliOnly = buildSpawnDirective({ client: 'unknown-client', agent: 'anbu', prompt: TASK });
  assert.ok(cliOnly.includes(TASK), 'CLI fallback must carry the task text');

  // Pi has no native subagent tool, so it must not be promised one.
  assert.strictEqual(CLIENT_SPAWN.pi, undefined, 'Pi must not advertise a spawn tool it does not have');
  const piDirective = buildSpawnDirective({ client: 'pi', agent: 'anbu', prompt: TASK });
  assert.ok(!piDirective.includes('task(agent='), 'Pi directive must not name a non-existent task tool');
  assert.ok(piDirective.includes('run-agent'), 'Pi must fall back to the CLI runner');

  const parallel = buildParallelSpawnDirective({
    client: 'claude',
    projectPath: '/tmp/project',
    dispatches: [
      { agent: 'anbu', task: 'Backend slice: fix the expiry comparison.', domain: 'backend' },
      { agent: 'jonin', task: 'Frontend slice: render the token banner.', domain: 'frontend' }
    ]
  });
  assert.ok(parallel.includes('Backend slice: fix the expiry comparison.'), 'parallel wave must carry dispatch 1 task');
  assert.ok(parallel.includes('Frontend slice: render the token banner.'), 'parallel wave must carry dispatch 2 task');
  assert.ok(!parallel.includes('…'), 'parallel wave must not emit a placeholder task');

  const oversized = 'x'.repeat(5000);
  const bounded = buildSpawnDirective({ client: 'claude', agent: 'anbu', prompt: oversized });
  assert.ok(bounded.length < 3000, 'oversized task must be bounded so the prompt ceiling still holds');

  console.log('✓ spawn directives carry task text across all clients');
}

runTests();
