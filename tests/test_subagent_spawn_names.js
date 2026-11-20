#!/usr/bin/env node
// DB isolation: spawn directives read the agent roster.
require('./helpers/isolate_db');

'use strict';

/**
 * tests/test_subagent_spawn_names.js — regression for agent-name canonicalization.
 *
 * The spawn directive names an agent that a client must resolve to a deployed
 * profile file (`<name>.md` / `<name>.toml`). A sanitizer that strips `_` instead
 * of mapping it to `-` turned `tokubetsu_jonin` into `tokubetsujonin`, which no
 * profile answers to, so every native spawn for that agent failed silently and
 * the CLI fallback failed the same way.
 */

const assert = require('assert');
const { getDeployableAgentNames, normalizeAgentName } = require('../src/canonical_agents');
const {
  CLIENT_SPAWN,
  SPAWNABLE_SUBAGENTS,
  buildSpawnDirective,
  buildParallelSpawnDirective,
  buildAdvisorStartupDirective
} = require('../src/mcp/lazy_subagent');

let passed = 0;

function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok ${name}`);
}

const CLIENTS = Object.keys(CLIENT_SPAWN);
const DEPLOYABLE = getDeployableAgentNames();
const MCP_STYLE_NAMES = DEPLOYABLE.map((name) => name.replace(/-/g, '_'));

function cliAgentToken(directive) {
  const match = directive.match(/run-agent[^\n]*?--agent ([A-Za-z0-9_-]+)/);
  return match ? match[1] : null;
}

function run() {
  console.log('Subagent spawn name resolution');

  check('underscore MCP names normalize to the hyphenated profile names', () => {
    assert.strictEqual(normalizeAgentName('tokubetsu_jonin'), 'tokubetsu-jonin');
    assert.strictEqual(normalizeAgentName('mcp_tokubetsu_jonin'), 'mcp-tokubetsu-jonin');
    assert.ok(DEPLOYABLE.includes(normalizeAgentName('tokubetsu_jonin')));
  });

  check('every underscore roster name resolves to a deployable agent', () => {
    for (const name of MCP_STYLE_NAMES) {
      assert.ok(
        DEPLOYABLE.includes(normalizeAgentName(name)),
        `${name} normalizes to ${normalizeAgentName(name)}, which is not deployable`
      );
    }
  });

  check('no directive ever emits the collapsed token', () => {
    for (const client of CLIENTS) {
      for (const name of [...DEPLOYABLE, ...MCP_STYLE_NAMES]) {
        const directive = buildSpawnDirective({ client, agent: name, prompt: 'do the thing' });
        assert.ok(
          !directive.includes('tokubetsujonin'),
          `${client} directive for ${name} collapsed tokubetsu-jonin`
        );
      }
    }
  });

  check('native spawn names match the deployed profile for every client', () => {
    for (const client of CLIENTS) {
      const desc = CLIENT_SPAWN[client];
      if (!desc || !desc.tool) continue;
      for (const name of DEPLOYABLE) {
        // sannin routes to kage by design: it is the router, not a worker.
        const expected = name === 'sannin' ? 'kage' : name;
        const directive = buildSpawnDirective({ client, agent: name, prompt: 'x' });
        const nativeCall = directive.split('(CLI fallback:')[0];
        assert.ok(
          nativeCall.includes(expected),
          `${client}/${name}: native call omits ${expected}: ${nativeCall}`
        );
        assert.ok(!directive.includes('tokubetsujonin'), `${client}/${name}: collapsed token in directive`);
      }
    }
  });

  check('CLI fallback always names a deployable agent', () => {
    for (const client of CLIENTS) {
      for (const name of [...DEPLOYABLE, ...MCP_STYLE_NAMES]) {
        const token = cliAgentToken(buildSpawnDirective({ client, agent: name, prompt: 'x' }));
        if (token === null) continue;
        assert.ok(
          DEPLOYABLE.includes(normalizeAgentName(token)),
          `${client}/${name}: CLI fallback used --agent ${token}, which is not deployable`
        );
      }
    }
  });

  check('spawnable subagents are a subset of the deployable roster', () => {
    for (const name of SPAWNABLE_SUBAGENTS) {
      assert.ok(DEPLOYABLE.includes(name), `${name} is spawnable but not deployable`);
    }
  });

  check('parallel wave names are canonical too', () => {
    const directive = buildParallelSpawnDirective({
      client: 'omp',
      dispatches: [
        { agent: 'tokubetsu_jonin', task: 'write the docs' },
        { agent: 'anbu', task: 'fix the bug' }
      ]
    });
    assert.ok(!directive.includes('tokubetsujonin'), 'parallel directive collapsed tokubetsu-jonin');
    assert.ok(directive.includes('tokubetsu-jonin'));
    const parallelCli = directive.match(/--agents ([A-Za-z0-9_,-]+)/);
    assert.ok(parallelCli, 'parallel CLI fallback present');
    for (const token of parallelCli[1].split(',')) {
      assert.ok(DEPLOYABLE.includes(normalizeAgentName(token)), `parallel fallback agent ${token} is not deployable`);
    }
  });

  check('advisor startup directive targets the advisor profile', () => {
    for (const client of CLIENTS) {
      const directive = buildAdvisorStartupDirective({ client });
      const token = cliAgentToken(directive.cli_fallback || '');
      assert.strictEqual(token, 'advisor');
      assert.ok(DEPLOYABLE.includes(token), 'advisor must be deployable');
    }
  });

  console.log(`\n${passed} checks passed`);
}

try {
  run();
} catch (err) {
  console.error(`\nFAILED: ${err.message}`);
  console.error(err.stack.split('\n').slice(1, 4).join('\n'));
  process.exit(1);
}
