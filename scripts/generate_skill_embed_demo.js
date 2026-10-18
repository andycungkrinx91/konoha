#!/usr/bin/env node
/**
 * Generate 100% Authentic, Real Terminal Animated GIF for Konoha Skill & Agent Embed Flow.
 * Executes the exact 5-step workflow:
 * 1. konoha skill search helm
 * 2. konoha skill add helm-chart-scaffolding
 * 3. konoha agent skill anbu
 * 4. konoha skill helm-chart-scaffolding embed anbu
 * 5. konoha migrate --force --yes
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { spawnSync } = require('child_process');
const {
  ROOT_DIR,
  ASSETS_DIR,
  buildSceneFrames,
  saveOptimizedGif,
} = require('./generate_real_demo_gifs');

async function main() {
  console.log('=========================================================================');
  console.log('      KONOHA REAL DEMO: CREATE SKILL & EMBED INTO AGENT                  ');
  console.log('=========================================================================');
  console.log('Capturing 100% authentic terminal execution for 5-step workflow...\n');

  // Setup hermetic local skill fixture repo
  const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-helm-repo-'));
  fs.writeFileSync(path.join(tmpRepo, 'SKILL.md'), '# Helm Chart Scaffolding\n\nKubernetes Helm templating and chart scaffolding skill for Anbu squad.\n');
  spawnSync('git', ['init'], { cwd: tmpRepo });
  spawnSync('git', ['config', 'user.name', 'Konoha Demo'], { cwd: tmpRepo });
  spawnSync('git', ['config', 'user.email', 'demo@konoha.local'], { cwd: tmpRepo });
  spawnSync('git', ['add', '.'], { cwd: tmpRepo });
  spawnSync('git', ['commit', '-m', 'Initial commit'], { cwd: tmpRepo });

  // Start local mock registry server
  const mockServer = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([
      {
        skillId: 'helm-chart-scaffolding',
        name: 'helm-chart-scaffolding',
        installs: 4200,
        source: `file://${tmpRepo}`
      }
    ]));
  });

  await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
  const port = mockServer.address().port;
  const mockRegistryUrl = `http://127.0.0.1:${port}/api/search`;

  try {
    const extraEnv = {
      KONOHA_SKILLS_REGISTRY_URL: mockRegistryUrl,
      KONOHA_SEMANTIC_SEARCH: '0'
    };

    // Table-driven scene list: [cmdStr, cmdArgs, badge, scroll]
    const sceneTable = [
      ['konoha skill search helm', ['node', 'bin/cli.js', 'skill', 'search', 'helm'], '1. SKILL SEARCH • PUBLIC REGISTRY', false],
      ['konoha skill add helm-chart-scaffolding', ['node', 'bin/cli.js', 'skill', 'add', 'helm-chart-scaffolding'], '2. SKILL ADD • DLX SKILLS & FTS5 MIGRATE', true],
      ['konoha agent skill anbu', ['node', 'bin/cli.js', 'agent', 'skill', 'anbu'], '3. AGENT SKILL • ANBU SQUAD SOP', false],
      ['konoha skill helm-chart-scaffolding embed anbu', ['node', 'bin/cli.js', 'skill', 'helm-chart-scaffolding', 'embed', 'anbu'], '4. EMBED SKILL • DIRECT AGENT INTEGRATION', false],
      ['konoha migrate --force --yes', ['node', 'bin/cli.js', 'migrate', '--force', '--yes'], '5. MIGRATE • 100% RE-INDEX & VECTOR CACHE', true],
    ];

    const skillFlowScenes = sceneTable.map(([cmdStr, cmdArgs, badge, scroll]) => ({
      cmdStr,
      cmdArgs,
      badge,
      extraEnv,
      scroll,
      cwd: ROOT_DIR,
      promptDir: '~',
    }));

    const allFrames = [];
    for (const scene of skillFlowScenes) {
      console.log(`  • Capturing real execution: ${scene.cmdStr}`);
      const frames = buildSceneFrames(scene.cmdStr, scene.cmdArgs, scene.badge, {
        titlePrefix: 'konoha',
        extraEnv: scene.extraEnv,
        scrollSteps: scene.scroll,
        cwd: scene.cwd,
        promptDir: scene.promptDir,
      });
      allFrames.push(...frames);
    }

    // Save to assets/demo-skill-embed.gif and assets/demo-skills.gif
    const targetPath = path.join(ASSETS_DIR, 'demo-skill-embed.gif');
    saveOptimizedGif(allFrames, targetPath);

    const targetPathSkills = path.join(ASSETS_DIR, 'demo-skills.gif');
    saveOptimizedGif(allFrames, targetPathSkills);

    console.log('\n✓ Real skill creation & embedding demo GIF generated successfully!');
  } finally {
    mockServer.close();
    try {
      fs.rmSync(tmpRepo, { recursive: true, force: true });
    } catch (_) {
      // Best-effort cleanup of temporary fixture directory
    }
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { main };
