#!/usr/bin/env node
/**
 * Generate high-definition dark-mode terminal PNG screenshots for README.md.
 * (Node port of generate_screenshots.py — legacy 860x520 variants.)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  data,
  registerFonts,
  css,
  parseTagLine,
  solidCanvas,
  drawEllipse,
  drawHLine,
  drawSegment,
  textWidth,
} = require('./lib/shared');

const d = data.legacy_screenshots;
const ROOT_DIR = path.join(__dirname, '..');

// Layout constants (legacy family)
const WIDTH = d.WIDTH; // 860
const HEIGHT = d.HEIGHT; // 520
const HEADER_H = 38;
const X_START = 22;
const LINE_H = 18;
const FONT_SIZE = 13;
const BADGE_SIZE = 11;

// Bracket-tag palette (legacy family colors)
const TAG_PALETTE = {
  default: d.TEXT_COLOR,
  cyan: d.CYAN,
  green: d.GREEN,
  amber: d.AMBER,
  purple: d.PURPLE,
  red: d.RED,
  muted: d.MUTED_COLOR,
};

function drawTerminalWindow(title, promptCmd, lines, badgeText) {
  const canvas = solidCanvas(WIDTH, HEIGHT, d.BG_COLOR);
  const ctx = canvas.getContext('2d');
  ctx.textBaseline = 'top';

  // Outer border
  ctx.strokeStyle = css(d.BORDER_COLOR);
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, WIDTH - 2, HEIGHT - 2);

  // Header bar
  ctx.fillStyle = css(d.HEADER_BG);
  ctx.fillRect(1, 1, WIDTH - 3, HEADER_H - 1);
  drawHLine(ctx, 1, WIDTH - 2, HEADER_H, d.BORDER_COLOR, 1);

  // Traffic lights
  drawEllipse(ctx, [16, 13, 28, 25], d.DOT_RED);
  drawEllipse(ctx, [36, 13, 48, 25], d.DOT_YELLOW);
  drawEllipse(ctx, [56, 13, 68, 25], d.DOT_GREEN);

  // Window title (centered)
  const titleW = textWidth(ctx, title, FONT_SIZE, true);
  ctx.font = `${FONT_SIZE}px "DejaVuSansMono-Bold"`;
  ctx.fillStyle = css(d.MUTED_COLOR);
  ctx.fillText(title, Math.floor((WIDTH - titleW) / 2), 11);

  // Top badge (no ⚡ prefix in the legacy family)
  ctx.font = `${BADGE_SIZE}px "DejaVuSansMono-Bold"`;
  ctx.fillStyle = css(d.CYAN);
  ctx.fillText(badgeText, WIDTH - 220, 12);

  // Prompt line
  let y = 52;
  const promptPrefix = 'user@konoha:~$ ';
  ctx.font = `${FONT_SIZE}px "DejaVuSansMono-Bold"`;
  ctx.fillStyle = css(d.GREEN);
  ctx.fillText(promptPrefix, X_START, y);
  const prefixW = textWidth(ctx, promptPrefix, FONT_SIZE, true);
  ctx.fillStyle = css(d.TEXT_COLOR);
  ctx.fillText(promptCmd, X_START + prefixW, y);
  y += 24;

  // Divider
  drawHLine(ctx, X_START, WIDTH - 22, y, d.HEADER_BG, 1);
  y += 10;

  // Body lines (23-line cap, faithful to the original)
  for (const line of lines.slice(0, 23)) {
    let curX = X_START;
    for (const seg of parseTagLine(line, TAG_PALETTE)) {
      if (seg.text) curX += drawSegment(ctx, curX, y, seg, FONT_SIZE);
    }
    y += LINE_H;
  }

  return canvas;
}

async function main() {
  registerFonts();
  fs.mkdirSync(path.join(ROOT_DIR, 'assets'), { recursive: true });

  for (const [outPath, info] of Object.entries(d.screenshots)) {
    const canvas = drawTerminalWindow(info.title, info.cmd, info.lines, info.badge);
    const absPath = path.join(ROOT_DIR, outPath);
    fs.writeFileSync(absPath, canvas.toBuffer('image/png'));

    const sizeKb = fs.statSync(absPath).size / 1024;
    console.log(`✓ Generated ${outPath} (${sizeKb.toFixed(1)} KB)`);
  }

  console.log('All screenshots generated successfully!');
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { drawTerminalWindow, main };
