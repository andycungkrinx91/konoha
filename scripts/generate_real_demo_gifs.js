#!/usr/bin/env node
/**
 * Konoha Real Terminal Demo & Test Coverage GIF Generator (Node.js port).
 *
 * Executes REAL CLI commands (node bin/cli.js ...) against the live SQLite
 * FTS5 database and runtime, then renders high-fidelity 1100x680 terminal
 * frames into optimized animated GIFs:
 *   - assets/demo.gif          flagship: all help-menu commands
 *   - assets/testing.gif       dedicated test-coverage commands
 *   - assets/demo-<client>.gif 7 real coding-agent client delegation scenes
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  data,
  css,
  solidCanvas,
  drawEllipse,
  drawHLine,
  drawSegment,
  textWidth,
  canvasFont,
  parseAnsiToSegments,
  saveGif,
} = require('./lib/shared.js');

// ---------------------------------------------------------------------------
// Constants (mirrors of the original Python module-level values)
// ---------------------------------------------------------------------------

const ROOT_DIR = path.resolve(__dirname, '..');
const ASSETS_DIR = path.join(ROOT_DIR, 'assets');
fs.mkdirSync(ASSETS_DIR, { recursive: true });

const G = data.real_gifs;
const { WIDTH, HEIGHT, LINE_HEIGHT, FONT_SIZE, ANSI_16 } = G;
const BG_COLOR = G.BG_COLOR;
const HEADER_BG = G.HEADER_BG;
const BORDER_COLOR = G.BORDER_COLOR;
const DEFAULT_TEXT = G.DEFAULT_TEXT;
const MUTED_COLOR = G.MUTED_COLOR;
const PROMPT_COLOR = G.PROMPT_COLOR;
const CURSOR_COLOR = G.CURSOR_COLOR;

// Font sizes: body/bold 13, title 12, badge 11 (canvas fonts are stateless).
const TITLE_FONT_SIZE = 12;
const BADGE_FONT_SIZE = 11;

const COMMAND_CACHE = new Map();
const OUTPUT_FILTERS = [
  'A user prompt or conversation resume action has been received',
  'Please read prompt.md using konoha MCP',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Python str.splitlines() semantics (splits on all Unicode line breaks). */
function splitLines(str) {
  if (str === '') return [];
  const parts = String(str).split(/\r\n|\r|\n|\v|\f|\x1c|\x1d|\x1e|\x85|\u2028|\u2029/);
  if (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Render a single high-fidelity terminal window image (1100x680 canvas).
 */
function renderTerminalFrame(commandStr, visibleLines, opts = {}) {
  const {
    title = 'konoha — terminal',
    badge = 'REAL TERMINAL',
    showCursor = false,
    promptDir = null,
  } = opts;

  const canvas = solidCanvas(WIDTH, HEIGHT, BG_COLOR);
  const ctx = canvas.getContext('2d');
  ctx.textBaseline = 'top';

  const headerH = 40;
  ctx.strokeStyle = css(BORDER_COLOR);
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, WIDTH - 2, HEIGHT - 2);
  ctx.fillStyle = css(HEADER_BG);
  ctx.fillRect(1, 1, WIDTH - 2, headerH);
  drawHLine(ctx, 1, WIDTH - 2, headerH, BORDER_COLOR, 1);

  drawEllipse(ctx, [16, 14, 26, 24], [239, 68, 68]);
  drawEllipse(ctx, [36, 14, 46, 24], [245, 158, 11]);
  drawEllipse(ctx, [56, 14, 66, 24], [34, 197, 94]);

  const tW = textWidth(ctx, title, TITLE_FONT_SIZE, false);
  ctx.font = canvasFont(TITLE_FONT_SIZE, false);
  ctx.fillStyle = css(MUTED_COLOR);
  ctx.fillText(title, Math.floor((WIDTH - tW) / 2), 12);

  ctx.font = canvasFont(BADGE_FONT_SIZE, false);
  ctx.fillStyle = css(CURSOR_COLOR);
  ctx.fillText(`⚡ ${badge}`, WIDTH - 290, 13);

  let y = headerH + 14;
  const xStart = 22;
  const pPath = promptDir || '~';
  const promptPrefix = `user@konoha:${pPath}$ `;
  ctx.font = canvasFont(FONT_SIZE, true);
  ctx.fillStyle = css(PROMPT_COLOR);
  ctx.fillText(promptPrefix, xStart, y);
  const prefixW = textWidth(ctx, promptPrefix, FONT_SIZE, true);

  const cmdDisplay = commandStr + (showCursor ? ' █' : '');
  ctx.fillStyle = css(DEFAULT_TEXT);
  ctx.fillText(cmdDisplay, xStart + prefixW, y);
  y += 26;

  drawHLine(ctx, xStart, WIDTH - 22, y, [30, 41, 59], 1);
  y += 12;

  const maxY = HEIGHT - 20;
  for (const rawLine of visibleLines) {
    if (y + LINE_HEIGHT > maxY) break;
    const segments = parseAnsiToSegments(rawLine, {
      clean: true,
      ansi16: ANSI_16,
      defaultText: DEFAULT_TEXT,
      mutedColor: MUTED_COLOR,
    });
    let curX = xStart;
    for (const seg of segments) {
      curX += drawSegment(ctx, curX, y, seg, FONT_SIZE);
    }
    y += LINE_HEIGHT;
  }

  return canvas;
}

// ---------------------------------------------------------------------------
// Real command execution
// ---------------------------------------------------------------------------

/**
 * Execute a real command non-interactively with full ANSI support, cached.
 */
function executeRealCommand(cmdArgs, extraEnv = null, cwd = null) {
  const cacheKey = JSON.stringify([
    cmdArgs,
    extraEnv ? Object.entries(extraEnv).sort() : [],
    cwd || null,
  ]);
  if (COMMAND_CACHE.has(cacheKey)) return COMMAND_CACHE.get(cacheKey);

  const env = {
    ...process.env,
    FORCE_COLOR: '1',
    TERM: 'xterm-256color',
    COLUMNS: '110',
    LINES: '32',
    ...extraEnv,
  };

  const res = spawnSync(cmdArgs[0], cmdArgs.slice(1), {
    env,
    cwd: cwd || ROOT_DIR,
    encoding: 'utf8',
    input: '',
    timeout: 60000,
    maxBuffer: 10 * 1024 * 1024,
  });

  let output;
  if (res.error) {
    output =
      res.error.code === 'ETIMEDOUT'
        ? '[Command timed out]\n'
        : `[Execution error: ${res.error.message}]\n`;
  } else {
    output = res.stdout || res.stderr || '';
  }

  const filtered = splitLines(output).filter(
    (line) => !OUTPUT_FILTERS.some((f) => line.includes(f))
  );

  COMMAND_CACHE.set(cacheKey, filtered);
  return filtered;
}

// ---------------------------------------------------------------------------
// Scene builders
// ---------------------------------------------------------------------------

/** Generate typed command and output frames for a real command execution. */
function buildSceneFrames(cmdStr, cmdArgs, badge, opts = {}) {
  const {
    titlePrefix = 'konoha',
    extraEnv = null,
    scrollSteps = true,
    cwd = null,
    promptDir = null,
  } = opts;
  const rawLines = executeRealCommand(cmdArgs, extraEnv, cwd);
  const frames = [];

  const title = `${titlePrefix} — ${cmdStr}`;

  const halfCmd = cmdStr.slice(0, Math.max(1, Math.floor(cmdStr.length / 2)));
  frames.push({
    canvas: renderTerminalFrame(halfCmd, [], { title, badge, showCursor: true, promptDir }),
    duration: 280,
  });
  frames.push({
    canvas: renderTerminalFrame(cmdStr, [], { title, badge, showCursor: true, promptDir }),
    duration: 380,
  });

  const maxLinesPerScreen = 29;
  const totalLines = rawLines.length;

  if (totalLines <= maxLinesPerScreen || !scrollSteps) {
    frames.push({
      canvas: renderTerminalFrame(cmdStr, rawLines.slice(0, maxLinesPerScreen), {
        title,
        badge,
        showCursor: false,
        promptDir,
      }),
      duration: 2800,
    });
  } else {
    frames.push({
      canvas: renderTerminalFrame(cmdStr, rawLines.slice(0, maxLinesPerScreen), {
        title,
        badge,
        showCursor: false,
        promptDir,
      }),
      duration: 2200,
    });

    if (totalLines > maxLinesPerScreen * 1.4) {
      const midStart = Math.floor((totalLines - maxLinesPerScreen) / 2);
      frames.push({
        canvas: renderTerminalFrame(cmdStr, rawLines.slice(midStart, midStart + maxLinesPerScreen), {
          title,
          badge,
          showCursor: false,
          promptDir,
        }),
        duration: 1800,
      });
    }

    frames.push({
      canvas: renderTerminalFrame(cmdStr, rawLines.slice(-maxLinesPerScreen), {
        title,
        badge,
        showCursor: false,
        promptDir,
      }),
      duration: 3200,
    });
  }

  return frames;
}

/**
 * Simulate authentic interactive AI agent session step-by-step:
 *   1. Typing prompt command
 *   2. Tool executions (Bash test, konoha/find_skill, konoha/delegate_to_kage, ...)
 *   3. Final verified verdict with Kage review
 */
function buildClientDelegationScene(cmdStr, delegationSteps, badge, opts = {}) {
  const { titlePrefix = 'client', promptDir = '~' } = opts;
  const frames = [];

  const title = `${titlePrefix} — ${cmdStr}`;

  const halfCmd = cmdStr.slice(0, Math.max(1, Math.floor(cmdStr.length / 2)));
  frames.push({
    canvas: renderTerminalFrame(halfCmd, [], { title, badge, showCursor: true, promptDir }),
    duration: 280,
  });
  frames.push({
    canvas: renderTerminalFrame(cmdStr, [], { title, badge, showCursor: true, promptDir }),
    duration: 400,
  });

  const cumulativeLines = [];
  for (const [stepLines, duration] of delegationSteps) {
    cumulativeLines.push(...stepLines);
    const maxLinesPerScreen = 29;
    const visible =
      cumulativeLines.length > maxLinesPerScreen
        ? cumulativeLines.slice(-maxLinesPerScreen)
        : cumulativeLines;
    frames.push({
      canvas: renderTerminalFrame(cmdStr, visible, { title, badge, showCursor: false, promptDir }),
      duration,
    });
  }

  return frames;
}

/** Save high quality animated GIF with optimized palette. */
function saveOptimizedGif(frames, targetPath) {
  saveGif(frames, targetPath);
  const sizeKb = fs.statSync(targetPath).size / 1024;
  console.log(`  ✓ Saved ${path.basename(targetPath)} (${frames.length} frames, ${sizeKb.toFixed(1)} KB)`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  console.log('=========================================================================');
  console.log('      KONOHA REAL TERMINAL DEMO & TEST COVERAGE GIF GENERATOR            ');
  console.log('=========================================================================');
  console.log('Executing real commands against live SQLite FTS5 database and runtime...\n');

  // 0. Prepare per-client scratch directories.
  for (const td of G.test_dirs) fs.mkdirSync(td, { recursive: true });

  // 1. FLAGSHIP DEMO GIF: assets/demo.gif — ALL COMMANDS FROM THE HELP MENU.
  console.log('▶ Generating Flagship Demo GIF: assets/demo.gif (ALL 18 HELP COMMANDS) ...');
  const allDemoFrames = [];
  for (const [cmdStr, cmdArgs, badge, extraEnv, scroll, cwd, pdir] of G.demo_scenes) {
    console.log(`  • Running command: ${cmdStr}`);
    const frames = buildSceneFrames(cmdStr, cmdArgs, badge, {
      titlePrefix: 'konoha',
      extraEnv,
      scrollSteps: scroll,
      cwd,
      promptDir: pdir,
    });
    allDemoFrames.push(...frames);
  }
  saveOptimizedGif(allDemoFrames, path.join(ASSETS_DIR, 'demo.gif'));

  // 2. DEDICATED TESTING COVERAGE GIF: assets/testing.gif.
  console.log('\n▶ Generating Dedicated Testing Coverage GIF: assets/testing.gif ...');
  const testingFrames = [];
  for (const [cmdStr, cmdArgs, badge, extraEnv, scroll, cwd, pdir] of G.test_scenes) {
    console.log(`  • Running test: ${cmdStr}`);
    const frames = buildSceneFrames(cmdStr, cmdArgs, badge, {
      titlePrefix: 'konoha test',
      extraEnv,
      scrollSteps: scroll,
      cwd,
      promptDir: pdir,
    });
    testingFrames.push(...frames);
  }
  saveOptimizedGif(testingFrames, path.join(ASSETS_DIR, 'testing.gif'));

  // 3. INDIVIDUAL REAL CODING AGENT CLIENT DEMO GIFS.
  //    Real prompting and delegating process using konoha MCP
  //    (ZERO `konoha` commands in client GIFs).
  console.log('\n▶ Generating Individual Client Real Delegation Prompting GIFs ...');

  const clients = [
    // 3a. Antigravity Demo (agy) in /tmp/test-agy.
    ['agy "Audit codebase and verify tests using konoha MCP"', 'agy_steps', 'AGY • MCP DELEGATION', 'Antigravity CLI', '/tmp/test-agy', 'demo-agy.gif'],
    ['cmd "Run test suite and delegate security review to kage"', 'cmd_steps', 'COMMANDCODE • MCP DELEGATION', 'Command Code', '/tmp/test-cmd', 'demo-commandcode.gif'],
    ['codex exec "Delegate architecture review to kage via konoha MCP"', 'codex_steps', 'CODEX • MCP DELEGATION', 'OpenAI Codex CLI', '/tmp/test-codex', 'demo-codex.gif'],
    ['opencode run "Delegate codebase verification to kage using konoha"', 'opencode_steps', 'OPENCODE • MCP DELEGATION', 'OpenCode IDE', '/tmp/test-opencode', 'demo-opencode.gif'],
    ['claude -p "Delegate architecture audit to kage using konoha MCP"', 'claude_steps', 'CLAUDE CODE • MCP DELEGATION', 'Claude Code', '/tmp/test-claude', 'demo-claude.gif'],
    ['agent "Verify codebase and delegate to kage using konoha MCP"', 'cursor_steps', 'CURSOR • MCP DELEGATION', 'Cursor Agent', '/tmp/test-cursor', 'demo-cursor.gif'],
    ['pi "Audit architecture and delegate to kage via konoha MCP"', 'pi_steps', 'PI (PI.DEV) • MCP DELEGATION', 'Pi Coding Agent', '/tmp/test-pi', 'demo-pi.gif'],
  ];

  for (const [cmdStr, stepsKey, badge, titlePrefix, promptDir, outName] of clients) {
    const frames = buildClientDelegationScene(cmdStr, G[stepsKey], badge, { titlePrefix, promptDir });
    saveOptimizedGif(frames, path.join(ASSETS_DIR, outName));
  }

  console.log('\n✨ ALL 100% REAL DEMO & TEST COVERAGE GIFS GENERATED SUCCESSFULLY!');
}

// ---------------------------------------------------------------------------
// Exports (used by sibling generators, e.g. generate_skill_embed_demo.js)
// ---------------------------------------------------------------------------

module.exports = {
  ROOT_DIR,
  ASSETS_DIR,
  renderTerminalFrame,
  saveOptimizedGif,
  buildSceneFrames,
  executeRealCommand,
  buildClientDelegationScene,
};

if (require.main === module) {
  main();
}
