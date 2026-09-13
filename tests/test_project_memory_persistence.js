#!/usr/bin/env node
'use strict';
require('./helpers/isolate_db');

/**
 * tests/test_project_memory_persistence.js — E2E Unit & Integration tests for Project-Scoped Memory.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const personaMemory = require('../src/persona_memory');
const db = require('../src/db');

async function run() {
  console.log('Running test_project_memory_persistence tests...');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj_mem_'));
  const testDbPath = path.join(tmpDir, 'test_skills.db');
  personaMemory.DB_PATH = testDbPath;
  db.DB_PATH = testDbPath;

  const projectA = path.join(tmpDir, 'project_a');
  const projectB = path.join(tmpDir, 'project_b');
  fs.mkdirSync(projectA, { recursive: true });
  fs.mkdirSync(projectB, { recursive: true });

  // Mock package.json for projectA (Next.js + Tailwind v4)
  fs.writeFileSync(path.join(projectA, 'package.json'), JSON.stringify({
    name: 'frontend-app-a',
    dependencies: {
      next: '16.0.0',
      react: '^19.0.0',
      tailwindcss: '^4.0.0',
      '@tailwindcss/postcss': '^4.0.0'
    }
  }));
  fs.writeFileSync(path.join(projectA, 'pnpm-lock.yaml'), '# pnpm lockfile');

  // Mock package.json for projectB (SvelteKit + UnoCSS)
  fs.writeFileSync(path.join(projectB, 'package.json'), JSON.stringify({
    name: 'svelte-app-b',
    dependencies: {
      '@sveltejs/kit': '^2.0.0',
      svelte: '^5.0.0',
      unocss: '^0.58.0'
    }
  }));

  try {
    // 1. Stack detection
    const stackA = personaMemory.detectProjectStack(projectA);
    assert.strictEqual(stackA.project_name, 'frontend-app-a');
    assert.ok(stackA.framework.includes('Next.js'));
    assert.strictEqual(stackA.package_manager, 'pnpm');
    assert.ok(stackA.styling.includes('Tailwind CSS v4'));

    const stackB = personaMemory.detectProjectStack(projectB);
    assert.strictEqual(stackB.project_name, 'svelte-app-b');
    assert.strictEqual(stackB.framework, 'SvelteKit');
    assert.strictEqual(stackB.styling, 'UnoCSS');
    console.log('✓ Project stack detection passed');

    // 2. Project-scoped memory isolation
    const memA = personaMemory.saveMemory({
      agentName: 'jonin',
      title: 'Project A Design Decision',
      content: 'Project A uses Emerald theme and Geist font for headlines.',
      memoryType: 'architecture',
      projectPath: projectA,
      dbPath: testDbPath
    });
    assert.ok(memA);

    const memB = personaMemory.saveMemory({
      agentName: 'jonin',
      title: 'Project B Design Decision',
      content: 'Project B uses Ruby Red theme with Satoshi typography.',
      memoryType: 'architecture',
      projectPath: projectB,
      dbPath: testDbPath
    });
    assert.ok(memB);

    const resultsA = personaMemory.queryMemories({
      agentName: 'jonin',
      query: 'theme and font typography',
      projectPath: projectA,
      dbPath: testDbPath
    });
    assert.ok(resultsA.length >= 1);
    assert.strictEqual(resultsA[0].id, memA);
    assert.ok(resultsA[0].content.includes('Emerald'));
    assert.ok(!resultsA.some(r => r.content.includes('Ruby Red')));

    const resultsB = personaMemory.queryMemories({
      agentName: 'jonin',
      query: 'theme and font typography',
      projectPath: projectB,
      dbPath: testDbPath
    });
    assert.ok(resultsB.length >= 1);
    assert.strictEqual(resultsB[0].id, memB);
    assert.ok(resultsB[0].content.includes('Ruby Red'));
    console.log('✓ Project-scoped memory isolation passed');

    // 3. Project context formatting
    personaMemory.saveOrUpdateProject(projectA, null, 'High performance e-commerce showroom', testDbPath);
    const profile = personaMemory.getProjectProfile(projectA, testDbPath);
    assert.ok(profile);
    assert.strictEqual(profile.framework, 'Next.js (16.0.0)');

    personaMemory.saveMemory({
      agentName: 'kage',
      content: 'Always use server actions for checkout mutation',
      title: 'Checkout rule',
      projectPath: projectA,
      dbPath: testDbPath
    });
    const mems = personaMemory.listMemories({ projectPath: projectA, dbPath: testDbPath });

    const promptBlock = personaMemory.formatProjectContextForPrompt(profile, mems);
    assert.ok(promptBlock.includes('Persistent Project Context'));
    assert.ok(promptBlock.includes('frontend-app-a'));
    assert.ok(promptBlock.includes('Tailwind CSS v4'));
    assert.ok(promptBlock.includes('server actions'));
    console.log('✓ Project context formatting passed');

    // 4. All agents receive project context memory
    const allAgents = ['sannin', 'genin', 'kage', 'chunin', 'anbu', 'jonin', 'tokubetsu-jonin'];
    personaMemory.saveOrUpdateProject(projectA, null, '', testDbPath);
    const profileAll = personaMemory.getProjectProfile(projectA, testDbPath);
    assert.ok(profileAll);

    for (const agent of allAgents) {
      personaMemory.saveMemory({
        agentName: agent,
        content: `${agent} verified stack invariant for project A`,
        title: `${agent} invariant`,
        projectPath: projectA,
        dbPath: testDbPath
      });
      const agentMems = personaMemory.queryMemories({
        agentName: agent,
        projectPath: projectA,
        dbPath: testDbPath
      });
      assert.ok(agentMems.length >= 1);
      const block = personaMemory.formatProjectContextForPrompt(profileAll, agentMems, 2, true);
      assert.ok(block.includes('Project Context Memory'));
      assert.ok(block.includes('Next.js'));
      assert.ok(block.includes('pnpm'));
    }
    console.log('✓ All agents receive project context memory passed');

    console.log('\nAll test_project_memory_persistence tests passed!');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  run().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { run };
