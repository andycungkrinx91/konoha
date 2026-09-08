#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../src/db');
const server = require('../src/server');
const personaMemory = require('../src/persona_memory');

async function run() {
  console.log('Running test_taste_skill_jonin tests...');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taste_skill_'));
  const dbPath = path.join(tmpDir, 'test_skills.db');
  const projectDir = path.join(tmpDir, 'frontend_repo');
  fs.mkdirSync(projectDir, { recursive: true });

  const prevDbPath = db.DB_PATH;
  const prevServerDb = server.DB_PATH;
  const prevPersonaDb = personaMemory.DB_PATH;
  const prevWorkspace = server.WORKSPACE_ROOT;

  try {
    db.DB_PATH = dbPath;
    server.DB_PATH = dbPath;
    server.WORKSPACE_ROOT = tmpDir;
    personaMemory.DB_PATH = dbPath;

    const conn = db.getConnection(dbPath);
    conn.prepare(`
      CREATE TABLE IF NOT EXISTS agents (
        name TEXT PRIMARY KEY,
        title TEXT,
        purpose TEXT,
        skills TEXT,
        constraints_text TEXT,
        instructions TEXT,
        model_tier TEXT
      )
    `).run();

    conn.prepare(`
      CREATE TABLE IF NOT EXISTS skills (
        name TEXT PRIMARY KEY,
        skill_name TEXT,
        description TEXT,
        content TEXT,
        type TEXT
      )
    `).run();

    conn.prepare(`
      INSERT OR REPLACE INTO agents (name, title, purpose, skills, constraints_text, instructions, model_tier)
      VALUES ('jonin', 'Jonin UI Master', 'Frontend implementation', '[]', 'Light mode only', 'Build clean UI', 'Pro')
    `).run();

    for (const s of [
      'jonin-skill/taste-skill-frontend-expert',
      'jonin-skill/nextjs-code-expert',
      'jonin-skill/svelte-code-expert',
      'jonin-skill/nuxt-code-expert',
      'jonin-skill/angular-code-expert',
      'jonin-skill/build-directives-manifest',
      'jonin-skill/design-token-manifest',
      'jonin-skill/source-fidelity-directives'
    ]) {
      conn.prepare("INSERT OR REPLACE INTO skills (name, skill_name, description, content, type) VALUES (?, ?, ?, ?, 'reference')")
        .run(s, s, s, `# Content for ${s}`);
    }
    conn.close();

    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({
      name: 'luxury-ecommerce',
      dependencies: {
        next: '16.0.0',
        tailwindcss: '^4.0.0'
      }
    }, null, 2));

    // 1. Directives presence
    const res1 = JSON.parse(server.runMcpAgent('jonin', 'Scaffold a high-converting hero section', null, null, null, null, projectDir));
    const instr1 = res1.instructions;
    assert.ok(instr1.includes('Taste-Skill Design Engine Directives'));
    assert.ok(instr1.includes('Geist'));
    assert.ok(instr1.includes('Cabinet Grotesk'));
    assert.ok(instr1.includes('py-24'));
    assert.ok(instr1.includes('grid-cols-12'));
    assert.ok(instr1.includes('min-h-[100dvh]'));
    assert.ok(instr1.toLowerCase().includes('zero emojis'));
    console.log('✓ Directives presence passed');

    // 2. Custom taste dials
    server.SESSION_TURNS.clear();
    const res2 = JSON.parse(server.runMcpAgent('jonin', 'Build custom editorial portfolio grid', null, null, null, { design_variance: 10, motion_intensity: 9, visual_density: 4 }, projectDir));
    const instr2 = res2.instructions;
    assert.ok(instr2.includes('DESIGN_VARIANCE=10/10'));
    assert.ok(instr2.includes('MOTION_INTENSITY=9/10'));
    assert.ok(instr2.includes('VISUAL_DENSITY=4/10'));
    console.log('✓ Custom taste dials passed');

    // 3. build_from_text all frameworks
    const frameworks = ['nextjs', 'sveltekit', 'nuxt', 'angular'];
    for (const fw of frameworks) {
      const res = JSON.parse(server.buildFromText(`luxury-showcase-${fw}`, `A luxury showcase in ${fw}`, fw));
      assert.strictEqual(res.status, 'success');
      assert.ok(res.required_skills.includes('jonin-skill/taste-skill-frontend-expert'));
      const directivesStr = res.directives.join(' ');
      assert.ok(directivesStr.includes('Taste-Skill'));
      assert.ok(directivesStr.includes('reduced-motion'));
      assert.ok(directivesStr.includes('framework-native'));
      assert.ok(res.design_tokens);
      assert.strictEqual(res.design_tokens.perspective, '1200px');
      assert.strictEqual(res.design_tokens.tilt_max, '12deg');
      assert.strictEqual(res.design_tokens.hero_autoplay, '6000ms');
      assert.ok(res.taste_skill_audits.includes('em_dash'));
    }
    console.log('✓ build_from_text all frameworks passed');

    // 4. build_from_source all frameworks
    const sourceDir = path.join(tmpDir, 'mockups');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'design.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"></svg>');

    for (const fw of frameworks) {
      const res = JSON.parse(server.buildFromSource(`luxury-source-${fw}`, sourceDir, fw));
      assert.strictEqual(res.status, 'success');
      assert.ok(res.required_skills.includes('jonin-skill/taste-skill-frontend-expert'));
    }
    console.log('✓ build_from_source all frameworks passed');

    // 5. Invalid dials rejected
    const resInvalid = JSON.parse(server.buildFromText('invalid-dials', 'Test invalid dials', 'nextjs', null, { design_variance: 99 }));
    assert.ok(resInvalid.error);
    console.log('✓ Invalid dials rejected passed');

    console.log('\nAll test_taste_skill_jonin passed cleanly!');
  } finally {
    db.DB_PATH = prevDbPath;
    server.DB_PATH = prevServerDb;
    server.WORKSPACE_ROOT = prevWorkspace;
    personaMemory.DB_PATH = prevPersonaDb;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
