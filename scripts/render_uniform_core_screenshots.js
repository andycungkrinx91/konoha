#!/usr/bin/env node
/**
 * Generate uniform, same-size (1200x700) HD dark-mode terminal screenshots
 * for Konoha core features.
 *
 * Node.js port of render_uniform_core_screenshots.py (@napi-rs/canvas).
 * Scene data lives in scripts/lib/data.json under `uniform_screenshots`.
 */

const fs = require('fs');
const {
  data: d,
  solidCanvas,
  drawEllipse,
  drawHLine,
  drawSegment,
  textWidth,
  parseTagLine,
  canvasFont,
  css,
} = require('./lib/shared.js');

// Layout constants (verbatim from the original Python script)
const WIDTH = d.uniform_screenshots.WIDTH; // 1200
const HEIGHT = d.uniform_screenshots.HEIGHT; // 700
const FONT_SIZE = d.uniform_screenshots.FONT_SIZE; // 14
const LINE_HEIGHT = d.uniform_screenshots.LINE_HEIGHT; // 22
const TITLE_FONT_SIZE = 13;
const BADGE_FONT_SIZE = 11;

// Colors (verbatim from the original Python script)
const BG_COLOR = d.uniform_screenshots.BG_COLOR; // (15, 23, 42)
const HEADER_BG = d.uniform_screenshots.HEADER_BG; // (30, 41, 59)
const BORDER_COLOR = d.uniform_screenshots.BORDER_COLOR; // (51, 65, 85)
const DEFAULT_TEXT = d.uniform_screenshots.DEFAULT_TEXT; // (248, 250, 252)
const MUTED_COLOR = d.uniform_screenshots.MUTED_COLOR; // (148, 163, 184)
const GREEN = d.uniform_screenshots.GREEN; // (74, 222, 128)
const CYAN = d.uniform_screenshots.CYAN; // (56, 189, 248)
const AMBER = d.uniform_screenshots.AMBER; // (251, 191, 36)
const PURPLE = d.uniform_screenshots.PURPLE; // (192, 132, 252)
const RED = d.uniform_screenshots.RED; // (248, 113, 113)
const DOT_RED = [239, 68, 68];
const DOT_YELLOW = [245, 158, 11];
const DOT_GREEN = [34, 197, 94];

// Bracket-tag palette — matches parse_line_colors() in the original script
const TAG_PALETTE = {
  default: DEFAULT_TEXT,
  cyan: CYAN,
  green: GREEN,
  amber: AMBER,
  purple: PURPLE,
  red: RED,
  muted: MUTED_COLOR,
};

/**
 * Draw a uniform 1200x700 dark-mode terminal window with the given content.
 * Verbatim port of draw_uniform_terminal() from the Python original.
 */
function drawUniformTerminal(title, command, lines, badgeText) {
  const canvas = solidCanvas(WIDTH, HEIGHT, BG_COLOR);
  const ctx = canvas.getContext('2d');
  ctx.textBaseline = 'top';

  // Outer border (2px)
  ctx.lineWidth = 2;
  ctx.strokeStyle = css(BORDER_COLOR);
  ctx.strokeRect(1, 1, WIDTH - 2, HEIGHT - 2);

  // Header bar
  const headerH = 42;
  ctx.fillStyle = css(HEADER_BG);
  ctx.fillRect(1, 1, WIDTH - 3, headerH - 1);
  drawHLine(ctx, 1, WIDTH - 2, headerH, BORDER_COLOR, 1);

  // Traffic lights
  drawEllipse(ctx, [18, 14, 30, 26], DOT_RED);
  drawEllipse(ctx, [40, 14, 52, 26], DOT_YELLOW);
  drawEllipse(ctx, [62, 14, 74, 26], DOT_GREEN);

  // Window title (centered, muted)
  const titleW = textWidth(ctx, title, TITLE_FONT_SIZE, true);
  ctx.font = canvasFont(TITLE_FONT_SIZE, true);
  ctx.fillStyle = css(MUTED_COLOR);
  ctx.fillText(title, Math.floor((WIDTH - titleW) / 2), 12);

  // Top badge
  ctx.font = canvasFont(BADGE_FONT_SIZE, true);
  ctx.fillStyle = css(CYAN);
  ctx.fillText(`⚡ ${badgeText}`, WIDTH - 280, 13);

  let y = headerH + 16;
  const xStart = 24;

  // Prompt line
  const promptPrefix = 'user@konoha:~$ ';
  ctx.font = canvasFont(FONT_SIZE, true);
  ctx.fillStyle = css(GREEN);
  ctx.fillText(promptPrefix, xStart, y);
  const prefixW = textWidth(ctx, promptPrefix, FONT_SIZE, true);
  ctx.fillStyle = css(DEFAULT_TEXT);
  ctx.fillText(command, xStart + prefixW, y);
  y += 28;

  // Divider under the prompt
  drawHLine(ctx, xStart, WIDTH - 24, y, HEADER_BG, 1);
  y += 14;

  // Body lines (no cap — full content)
  for (const line of lines) {
    const segments = parseTagLine(line, TAG_PALETTE);
    let curX = xStart;
    for (const segment of segments) {
      curX += drawSegment(ctx, curX, y, segment, FONT_SIZE);
    }
    y += LINE_HEIGHT;
  }

  return canvas;
}

function main() {
  const coreScreenshots = d.uniform_screenshots.core_screenshots;

  fs.mkdirSync('assets', { recursive: true });

  console.log('Generating uniform (1200x700) core feature screenshots...');
  for (const [outPath, info] of Object.entries(coreScreenshots)) {
    const canvas = drawUniformTerminal(info.title, info.cmd, info.lines, info.badge);
    fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
    const sizeKb = fs.statSync(outPath).size / 1024;
    console.log(`  ✓ Saved ${outPath} (${sizeKb.toFixed(1)} KB)`);
  }
  console.log('✨ All uniform core screenshots generated successfully!');
}

if (require.main === module) {
  main();
}

module.exports = { drawUniformTerminal, main };
