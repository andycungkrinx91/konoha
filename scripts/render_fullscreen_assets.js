#!/usr/bin/env node
/**
 * Generate FULL-SCREEN, UNCLIPPED high-definition PNG screenshots and demo GIF
 * for Konoha.
 *
 * Node.js port of render_fullscreen_assets.py (@napi-rs/canvas).
 * Runs the real `node bin/cli.js ...` commands and renders their actual ANSI
 * output at 1200px width with dynamic height (GIF frames fixed at 1200x760).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  data: d,
  registerFonts,
  solidCanvas,
  drawEllipse,
  drawHLine,
  drawSegment,
  textWidth,
  parseAnsiToSegments,
  canvasFont,
  css,
  saveGif,
} = require('./lib/shared.js');

registerFonts();

const ROOT_DIR = path.resolve(__dirname, '..');
const ASSETS_DIR = path.join(ROOT_DIR, 'assets');

// Layout constants (verbatim from the original Python script)
const FONT_SIZE = 14;
const LINE_HEIGHT = 20;
const CANVAS_WIDTH = 1200;
const GIF_WIDTH = 1200;
const GIF_HEIGHT = 760;
const HEADER_H = 42;
const PROMPT_H = 45;
const FOOTER_PADDING = 30;

const BG_COLOR = d.fullscreen.BG_COLOR;
const HEADER_BG = d.fullscreen.HEADER_BG;
const BORDER_COLOR = d.fullscreen.BORDER_COLOR;
const DEFAULT_TEXT = d.fullscreen.DEFAULT_TEXT;
const MUTED_COLOR = d.fullscreen.MUTED_COLOR;
const BADGE_COLOR = [56, 189, 248];
const PROMPT_COLOR = [74, 222, 128];
const DIVIDER_COLOR = [30, 41, 59];
const DOT_RED = [239, 68, 68];
const DOT_YELLOW = [245, 158, 11];
const DOT_GREEN = [34, 197, 94];
const ANSI_16 = d.real_gifs.ANSI_16; // identical table to fullscreen ANSI_COLORS

const commands = d.fullscreen.commands;
const gifScenes = d.fullscreen.gif_scenes;

/**
 * Draw the shared chrome (border, header, dots, title, badge, prompt,
 * command, divider) and return the canvas. Used by both the dynamic-height
 * PNG renderer and the fixed-height GIF frame renderer.
 */
function drawChrome(canvas, commandStr, title, badge) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  ctx.textBaseline = 'top';

  // Outer border: PIL rectangle [0,0,W-1,H-1] outline width=2
  ctx.strokeStyle = css(BORDER_COLOR);
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, W - 3, canvas.height - 3);

  // Header bar
  ctx.fillStyle = css(HEADER_BG);
  ctx.fillRect(1, 1, W - 3, HEADER_H - 1);
  drawHLine(ctx, 1, W - 2, HEADER_H, BORDER_COLOR);

  // Traffic lights
  drawEllipse(ctx, [18, 14, 30, 26], DOT_RED);
  drawEllipse(ctx, [40, 14, 52, 26], DOT_YELLOW);
  drawEllipse(ctx, [62, 14, 74, 26], DOT_GREEN);

  // Centered title
  const tW = textWidth(ctx, title, 13, true);
  ctx.font = canvasFont(13, true);
  ctx.fillStyle = css(MUTED_COLOR);
  ctx.fillText(title, Math.floor((W - tW) / 2), 12);

  // Badge
  ctx.font = canvasFont(11, true);
  ctx.fillStyle = css(BADGE_COLOR);
  ctx.fillText(`⚡ ${badge}`, W - 260, 13);

  // Prompt + command
  const xStart = 24;
  let y = HEADER_H + 16;
  ctx.font = canvasFont(FONT_SIZE, true);
  ctx.fillStyle = css(PROMPT_COLOR);
  ctx.fillText('user@konoha:~$ ', xStart, y);
  const prefixW = textWidth(ctx, 'user@konoha:~$ ', FONT_SIZE, true);
  ctx.fillStyle = css(DEFAULT_TEXT);
  ctx.fillText(commandStr, xStart + prefixW, y);
  y += 28;

  // Divider
  drawHLine(ctx, xStart, W - 24, y, DIVIDER_COLOR);
  y += 14;

  return { ctx, y, xStart };
}

/** Render output lines (ANSI-aware) starting at (xStart, startY); returns the final y. */
function renderOutputLines(ctx, lines, xStart, startY) {
  let y = startY;
  for (const line of lines) {
    const segments = parseAnsiToSegments(line, {
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
  return y;
}

/** Render a full terminal frame with dynamic height (real CLI output). */
function renderFullscreenTerminal(commandStr, outputText, title, badge) {
  const lines = outputText.split('\n');
  const contentH = lines.length * LINE_HEIGHT;
  const totalH = Math.max(380, HEADER_H + PROMPT_H + contentH + FOOTER_PADDING);

  const canvas = solidCanvas(CANVAS_WIDTH, totalH, BG_COLOR);
  const { ctx, y: startY, xStart } = drawChrome(canvas, commandStr, title, badge);
  let y = startY;

  y = renderOutputLines(ctx, lines, xStart, y);

  return canvas;
}

/** Render a fixed-size (1200x760) GIF frame, capping at 32 lines. */
// aislop-ignore-next-line code-quality/duplicate-block (frame renderer branches (dynamic vs fixed height))
// aislop-ignore-next-line code-quality/duplicate-block (frame renderer branches (dynamic vs fixed height))
function renderGifFrame(commandStr, outputText, title, badge) {
  const lines = outputText.split('\n').slice(0, 32);

  const canvas = solidCanvas(GIF_WIDTH, GIF_HEIGHT, BG_COLOR);
  const { ctx, y: startY, xStart } = drawChrome(canvas, commandStr, title, badge);

  renderOutputLines(ctx, lines, xStart, startY);

  return canvas;
}

function main() {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });

  // --- Full-screen PNG screenshots (real CLI output, dynamic height) ---
  for (const [outPath, cmdStr, cmdArgs, badge] of commands) {
    const res = spawnSync(cmdArgs[0], cmdArgs.slice(1), {
      encoding: 'utf8',
      cwd: ROOT_DIR,
    });
    const rawOutput = res.stdout ? res.stdout : res.stderr ? res.stderr : '';
    const canvas = renderFullscreenTerminal(cmdStr, rawOutput, 'konoha', badge);
    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(outPath, buffer);
    const sizeKb = (buffer.length / 1024).toFixed(1);
    console.log(
      `✓ Saved ${outPath} (Dimensions: ${canvas.width}x${canvas.height}, ${sizeKb} KB)`
    );
  }

  // --- Full-screen demo.gif (8 scenes x 3 frames) ---
  const gifFrames = [];
  for (const [cmdStr, cmdArgs, badge] of gifScenes) {
    const res = spawnSync(cmdArgs[0], cmdArgs.slice(1), {
      encoding: 'utf8',
      cwd: ROOT_DIR,
    });
    const rawOutput = res.stdout ? res.stdout : res.stderr ? res.stderr : '';
    const title = `konoha — ${cmdStr}`;

    // Frame 1: half-typed command with cursor
    const halfCmd = cmdStr.slice(0, cmdStr.length >> 1) + '█';
    gifFrames.push({
      canvas: renderGifFrame(halfCmd, '', title, badge),
      duration: 250,
    });

    // Frame 2: full command with cursor
    gifFrames.push({
      canvas: renderGifFrame(cmdStr + '█', '', title, badge),
      duration: 350,
    });

    // Frame 3: real executed output
    gifFrames.push({
      canvas: renderGifFrame(cmdStr, rawOutput, title, badge),
      duration: 2800,
    });
  }

  saveGif(gifFrames, path.join(ASSETS_DIR, 'demo.gif'));
  const sizeKb = (fs.statSync(path.join(ASSETS_DIR, 'demo.gif')).size / 1024).toFixed(1);
  console.log(`✓ Saved assets/demo.gif (${gifFrames.length} frames, ${sizeKb} KB)`);
  console.log('✨ Full-screen HD screenshots & demo GIF generated successfully!');
}

if (require.main === module) {
  main();
}

module.exports = {
  ROOT_DIR,
  ASSETS_DIR,
  renderFullscreenTerminal,
  renderGifFrame,
  main,
};
