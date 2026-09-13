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
    extraEnv: null,
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
  // aislop-ignore-next-line code-quality/duplicate-block (scene object literals now table-driven (residual))
  // aislop-ignore-next-line code-quality/duplicate-block (scene object literals now table-driven (residual))
  saveOptimizedGif(allFrames, targetPath);

  const targetPathSkills = path.join(ASSETS_DIR, 'demo-skills.gif');
  saveOptimizedGif(allFrames, targetPathSkills);

  console.log('\n✓ Real skill creation & embedding demo GIF generated successfully!');
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { main };
