#!/usr/bin/env node
/**
 * Generate high-definition dark-mode terminal PNG screenshots for ALL Konoha core commands.
 * Node.js port of generate_all_command_screenshots.py (PIL -> @napi-rs/canvas).
 */

const fs = require('fs');


const {
  data,
  
  canvasFont,
  css,
  parseTagLine,
  solidCanvas,
  drawEllipse,
  drawHLine,
  drawSegment,
  textWidth,
} = require('./lib/shared.js');

const d = data.command_screenshots;
const WIDTH = d.WIDTH;
const HEIGHT = d.HEIGHT;
const BG_COLOR = d.BG_COLOR;
const HEADER_BG = d.HEADER_BG;
const BORDER_COLOR = d.BORDER_COLOR;
const TEXT_COLOR = d.TEXT_COLOR;
const MUTED_COLOR = d.MUTED_COLOR;
const GREEN = d.GREEN;
const CYAN = d.CYAN;

const FONT_SIZE = 13;
const FONT_BADGE_SIZE = 11;
const HEADER_H = 38;
const X_START = 22;
const LINE_H = 18;

// Tag palette for this renderer (verbatim from the Python module constants)
const TAG_PALETTE = {
  default: TEXT_COLOR,
  green: d.GREEN,
  cyan: d.CYAN,
  amber: d.AMBER,
  purple: d.PURPLE,
  red: d.RED,
  muted: d.MUTED_COLOR,
};

function drawTerminalWindow(title, command, lines, badgeText) {
  const canvas = solidCanvas(WIDTH, HEIGHT, BG_COLOR);
  const ctx = canvas.getContext('2d');
  ctx.textBaseline = 'top';

  // Outer border
  ctx.lineWidth = 2;
  ctx.strokeStyle = css(BORDER_COLOR);
  ctx.strokeRect(1, 1, WIDTH - 2, HEIGHT - 2);

  // Header bar
  ctx.fillStyle = css(HEADER_BG);
  ctx.fillRect(1, 1, WIDTH - 3, HEADER_H - 1);
  drawHLine(ctx, 1, WIDTH - 2, HEADER_H, BORDER_COLOR, 1);

  // Traffic lights
  drawEllipse(ctx, [16, 13, 28, 25], d.DOT_RED);
  drawEllipse(ctx, [36, 13, 48, 25], d.DOT_YELLOW);
  drawEllipse(ctx, [56, 13, 68, 25], d.DOT_GREEN);

  // Window title
  const titleW = textWidth(ctx, title, FONT_SIZE, true);
  ctx.font = canvasFont(FONT_SIZE, true);
  ctx.fillStyle = css(MUTED_COLOR);
  ctx.fillText(title, Math.floor((WIDTH - titleW) / 2), 11);

  // Top badge
  ctx.font = canvasFont(FONT_BADGE_SIZE, true);
  ctx.fillStyle = css(CYAN);
  ctx.fillText(badgeText, WIDTH - 240, 12);

  let y = 52;
  const xStart = X_START;

  // Prompt line
  const promptPrefix = 'user@konoha:~$ ';
  ctx.font = canvasFont(FONT_SIZE, true);
  ctx.fillStyle = css(GREEN);
  ctx.fillText(promptPrefix, xStart, y);
  const prefixW = textWidth(ctx, promptPrefix, FONT_SIZE, true);
  ctx.fillStyle = css(TEXT_COLOR);
  ctx.fillText(command, xStart + prefixW, y);
  y += 24;

  drawHLine(ctx, xStart, WIDTH - 22, y, [30, 41, 59], 1);
  y += 10;

  for (const line of lines.slice(0, 23)) {
    const segments = parseTagLine(line, TAG_PALETTE);
    let curX = xStart;
    for (const segment of segments) {
      curX += drawSegment(ctx, curX, y, segment, FONT_SIZE);
    }
    y += LINE_H;
  }

  return canvas;
}

function main() {
  const commandsData = d.commands_data;

  fs.mkdirSync('assets', { recursive: true });

  console.log('Generating screenshots for ALL Konoha core commands...');
  for (const [outPath, info] of Object.entries(commandsData)) {
    const canvas = drawTerminalWindow(info.title, info.cmd, info.lines, info.badge);
    fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
    const sizeKb = fs.statSync(outPath).size / 1024;
    console.log(`  ✓ Saved ${outPath} (${sizeKb.toFixed(1)} KB)`);
  }

  console.log(`✓ All ${Object.keys(commandsData).length} screenshots successfully generated!`);
}

main();
