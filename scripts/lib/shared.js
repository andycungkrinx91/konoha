'use strict';

/**
 * Shared helpers for the Konoha asset-generation scripts (Node.js port).
 *
 * Replaces the PIL/Pillow-based helpers from the original Python scripts:
 *  - DejaVu Sans Mono font registration (@napi-rs/canvas)
 *  - ANSI SGR escape-sequence parsing (two variants, unified via options)
 *  - Bracket-tag markup parsing ([cyan]...[/cyan] etc.)
 *  - Optimized GIF saving via gifenc (~ PIL adaptive 256-color palettes)
 */

const fs = require('fs');
const path = require('path');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const { GIFEncoder, quantize, applyPalette } = require('gifenc');

const FONT_PATH = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf';
const BOLD_FONT_PATH = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf';

const FONT_FAMILY = 'DejaVuSansMono';
const BOLD_FONT_FAMILY = 'DejaVuSansMono-Bold';

let fontsRegistered = false;

/** Register the DejaVu Sans Mono TTFs with @napi-rs/canvas (idempotent). */
function registerFonts() {
  if (fontsRegistered) return;
  if (!fs.existsSync(FONT_PATH)) {
    throw new Error(`Font not found: ${FONT_PATH}`);
  }
  GlobalFonts.registerFromPath(FONT_PATH, FONT_FAMILY);
  if (fs.existsSync(BOLD_FONT_PATH)) {
    GlobalFonts.registerFromPath(BOLD_FONT_PATH, BOLD_FONT_FAMILY);
  } else {
    // Fall back to the regular face (PIL would raise; we degrade gracefully).
    GlobalFonts.registerFromPath(FONT_PATH, BOLD_FONT_FAMILY);
  }
  fontsRegistered = true;
}

/** Build a canvas font string, e.g. `13px "DejaVuSansMono-Bold"`. */
function canvasFont(size, bold) {
  registerFonts();
  return `${size}px "${bold ? BOLD_FONT_FAMILY : FONT_FAMILY}"`;
}

/** Convert an [r, g, b] array (JSON color tuples) to a CSS color string. */
function css(rgb) {
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

/* ------------------------------------------------------------------ *
 * ANSI SGR parsing (render_fullscreen_assets.py / generate_real_demo_gifs.py)
 * ------------------------------------------------------------------ */

/**
 * Strip trailing CR and non-SGR control sequences.
 * Port of clean_line_text() from generate_real_demo_gifs.py.
 */
function cleanLineText(line) {
  return line
    .replace(/\r/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[\?25[hl]/g, '')
    .replace(/\x1b\[[0-9;]*[ABCDGJK]/g, '');
}

/**
 * Parse text containing ANSI escape sequences into styled segments.
 *
 * Both original implementations (generate_real_demo_gifs.py and
 * render_fullscreen_assets.py) are semantically identical: code 0 resets,
 * 1 bold, 2 dim (muted color + bold off), 30-37/90-97 mapped via the
 * 16-color table, 38;2;r;g;b truecolor (clamped 0-255), 39 default color.
 * The only difference: the real_gifs variant cleans the line first.
 *
 * @param {string} text
 * @param {{ ansi16: Object, defaultText: number[], mutedColor: number[], clean?: boolean }} opts
 * @returns {{ text: string, color: number[], bold: boolean }[]}
 */
function parseAnsiToSegments(text, opts) {
  const { ansi16, defaultText, mutedColor, clean = false } = opts;
  if (clean) text = cleanLineText(text);

  const segments = [];
  const pattern = /\x1b\[([0-9;]*)m/g;
  let currentColor = defaultText;
  let currentBold = false;
  let lastIdx = 0;
  let m;

  while ((m = pattern.exec(text)) !== null) {
    const start = m.index;
    const end = m.index + m[0].length;
    if (start > lastIdx) {
      const chunk = text.slice(lastIdx, start);
      if (chunk) segments.push({ text: chunk, color: currentColor, bold: currentBold });
    }

    const group = m[1];
    const codes = group ? group.split(';') : ['0'];
    let i = 0;
    while (i < codes.length) {
      let codeStr = codes[i];
      if (!codeStr) codeStr = '0';
      const code = Number.parseInt(codeStr, 10);
      if (Number.isNaN(code)) {
        i += 1;
        continue;
      }

      if (code === 0) {
        currentColor = defaultText;
        currentBold = false;
      } else if (code === 1) {
        currentBold = true;
      } else if (code === 2) {
        currentBold = false;
        currentColor = mutedColor;
      } else if (Object.prototype.hasOwnProperty.call(ansi16, code)) {
        currentColor = ansi16[code];
      } else if (code === 38 && i + 4 < codes.length && codes[i + 1] === '2') {
        try {
          const r = Number.parseInt(codes[i + 2], 10);
          const g = Number.parseInt(codes[i + 3], 10);
          const b = Number.parseInt(codes[i + 4], 10);
          if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) throw new Error('bad truecolor');
          currentColor = [
            Math.max(0, Math.min(255, r)),
            Math.max(0, Math.min(255, g)),
            Math.max(0, Math.min(255, b)),
          ];
          i += 4;
        } catch {
          /* skip malformed truecolor sequence */
        }
      } else if (code === 39) {
        currentColor = defaultText;
      }
      i += 1;
    }

    lastIdx = end;
  }

  if (lastIdx < text.length) {
    const chunk = text.slice(lastIdx);
    if (chunk) segments.push({ text: chunk, color: currentColor, bold: currentBold });
  }

  return segments;
}

/* ------------------------------------------------------------------ *
 * Bracket-tag markup parsing (parse_line_colors)
 * ------------------------------------------------------------------ */

const TAG_PATTERN = /(\[(cyan|green|amber|purple|red|muted|bold)\](.*?)\[\/\2\])/;

/**
 * Parse bracket-tag markup into styled segments.
 *
 * Port of parse_line_colors() — identical in generate_all_command_screenshots.py,
 * generate_screenshots.py and render_uniform_core_screenshots.py (only the
 * default-color constant name differed).
 *
 * @param {string} text
 * @param {{ default: number[], cyan: number[], green: number[], amber: number[],
 *           purple: number[], red: number[], muted: number[] }} palette
 * @returns {{ text: string, color: number[], bold: boolean }[]}
 */
function parseTagLine(text, palette) {
  const segments = [];
  const pattern = new RegExp(TAG_PATTERN.source, 'g');
  let lastIdx = 0;
  let m;

  while ((m = pattern.exec(text)) !== null) {
    const start = m.index;
    const end = m.index + m[0].length;
    if (start > lastIdx) {
      const gap = text.slice(lastIdx, start);
      if (gap) segments.push({ text: gap, color: palette.default, bold: false });
    }

    const tag = m[2];
    const content = m[3];
    let color = palette.default;
    let isBold = false;
    if (tag === 'cyan') color = palette.cyan;
    else if (tag === 'green') color = palette.green;
    else if (tag === 'amber') color = palette.amber;
    else if (tag === 'purple') color = palette.purple;
    else if (tag === 'red') color = palette.red;
    else if (tag === 'muted') color = palette.muted;
    else if (tag === 'bold') isBold = true; // color stays default
    segments.push({ text: content, color, bold: isBold });
    lastIdx = end;
  }

  if (lastIdx < text.length) {
    const gap = text.slice(lastIdx);
    if (gap) segments.push({ text: gap, color: palette.default, bold: false });
  }

  return segments;
}

/* ------------------------------------------------------------------ *
 * Canvas draw helpers (PIL ImageDraw equivalents)
 * ------------------------------------------------------------------ */

/** Create a solid-color canvas (Image.new RGB). */
function solidCanvas(width, height, rgb) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = css(rgb);
  ctx.fillRect(0, 0, width, height);
  return canvas;
}

/** Draw a filled ellipse from a PIL-style [x1, y1, x2, y2] box. */
function drawEllipse(ctx, box, rgb) {
  ctx.fillStyle = css(rgb);
  ctx.beginPath();
  ctx.ellipse((box[0] + box[2]) / 2, (box[1] + box[3]) / 2, (box[2] - box[0]) / 2, (box[3] - box[1]) / 2, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** Draw a horizontal divider line (ImageDraw.line with width). */
function drawHLine(ctx, x1, x2, y, rgb, width = 1) {
  ctx.strokeStyle = css(rgb);
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.stroke();
}

/** Draw one styled segment; returns the advance width (getbbox-based). */
function drawSegment(ctx, x, y, segment, fontSize) {
  ctx.font = canvasFont(fontSize, segment.bold);
  ctx.fillStyle = css(segment.color);
  ctx.fillText(segment.text, x, y);
  return ctx.measureText(segment.text).width;
}

/** Measure the rendered width of a string in a given font. */
function textWidth(ctx, text, fontSize, bold) {
  ctx.font = canvasFont(fontSize, bold);
  return ctx.measureText(text).width;
}

/* ------------------------------------------------------------------ *
 * GIF saving (save_optimized_gif)
 * ------------------------------------------------------------------ */

/**
 * Save frames as an optimized looping GIF (gifenc, adaptive 256-color
 * palettes per frame — equivalent to PIL's ADAPTIVE quantization).
 *
 * @param {{ canvas: any, duration: number }[]} frames
 * @param {string} outPath
 */
function saveGif(frames, outPath) {
  const gif = GIFEncoder();
  for (const frame of frames) {
    const { canvas, duration } = frame;
    const { width, height } = canvas;
    const data = canvas.getContext('2d').getImageData(0, 0, width, height).data;
    const palette = quantize(data, 256, { format: 'rgb565' });
    const index = applyPalette(data, palette, 'rgb565');
    gif.writeFrame(index, width, height, { palette, delay: duration });
  }
  gif.finish();
  fs.writeFileSync(outPath, gif.bytes());

  const sizeKb = fs.statSync(outPath).size / 1024;
  console.log(`  ✓ Saved ${path.basename(outPath)} (${frames.length} frames, ${sizeKb.toFixed(1)} KB)`);
}

/* ------------------------------------------------------------------ *
 * Data access
 * ------------------------------------------------------------------ */

const data = require('./data.json');

module.exports = {
  data,
  FONT_PATH,
  BOLD_FONT_PATH,
  FONT_FAMILY,
  BOLD_FONT_FAMILY,
  registerFonts,
  canvasFont,
  css,
  cleanLineText,
  parseAnsiToSegments,
  parseTagLine,
  TAG_PATTERN,
  solidCanvas,
  drawEllipse,
  drawHLine,
  drawSegment,
  textWidth,
  saveGif,
};
