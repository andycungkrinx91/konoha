'use strict';

/**
 * bin/lib/format.js — CLI Visual Formatting, ANSI Colors, Gradients & Tables.
 *
 * Provides cross-platform terminal styling for Konoha:
 * - Color gate: Non-TTY, CI, NO_COLOR, and KONOHA_COLOR=0 token suppression
 * - Visual length & CJK/emoji wide character calculations
 * - Gradient rendering (Leaf, Fire, Ninja, Rasengan, Chidori)
 * - Table and Box drawing
 */

const fs = require('fs');
const path = require('path');

// ANSI color gate: CLI reports are consumed by AI agents and CI pipelines far
// more often than by humans. Plain output whenever stdout is not a TTY,
// or when NO_COLOR/CI is set, or KONOHA_COLOR=0.
const USE_COLOR = Boolean(
  process.stdout && process.stdout.isTTY &&
  !process.env.NO_COLOR && !process.env.CI && process.env.KONOHA_COLOR !== '0'
);

const _C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',

  // Standard foreground colors
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};

const C = USE_COLOR
  ? _C
  : Object.fromEntries(Object.keys(_C).map((k) => [k, '']));

const Box = {
  tl: '┌',
  tr: '┐',
  bl: '└',
  br: '┘',
  h: '─',
  v: '│',
  div: '├',
  rdiv: '┤',
};

// Gradient color themes
const LEAF_THEME = [
  [34, 197, 94],   // Bright Green
  [16, 185, 129],  // Emerald Green
  [20, 184, 166],  // Teal
  [14, 165, 233],  // Sky Blue
];

const FIRE_THEME = [
  [249, 115, 22],  // Orange
  [239, 68, 68],   // Red
  [236, 72, 153],  // Pink
];

const NINJA_THEME = [
  [124, 58, 237],  // Violet
  [168, 85, 247],  // Purple
  [239, 68, 68],   // Red
  [249, 115, 22],  // Orange
];

const RASENGAN_THEME = [
  [0, 255, 255],     // Bright Cyan
  [30, 144, 255],    // Dodger Blue
  [0, 191, 255],     // Deep Sky Blue
  [224, 242, 254],   // Light Blue/White
];

const CHIDORI_THEME = [
  [100, 180, 255],   // Electric Blue
  [0, 255, 255],     // Cyan
  [180, 220, 255],   // Ice White-Blue
  [255, 255, 255],   // Flash White
  [0, 200, 255],     // Deep Electric
];

function log(msg) { process.stdout.write((msg !== undefined ? String(msg) : '') + '\n'); }

// Emoji-presentation symbols render 2 columns in most modern terminals
const WIDE_SYMBOL_RANGES = [
  [0x1100, 0x115F], // Hangul Jamo
  [0x2E80, 0x303E], // CJK Radicals..CJK Symbols
  [0x3041, 0x33FF], // Hiragana..CJK Compatibility
  [0x3400, 0x4DBF], // CJK Ext A
  [0x4E00, 0x9FFF], // CJK Unified Ideographs
  [0xA000, 0xA4CF], // Yi
  [0xAC00, 0xD7A3], // Hangul Syllables
  [0xF900, 0xFAFF], // CJK Compatibility Ideographs
  [0xFE30, 0xFE4F], // CJK Compatibility Forms
  [0xFF00, 0xFF60], // Fullwidth Forms
  [0xFFE0, 0xFFE6], // Fullwidth Signs
  [0x2600, 0x2604],
  [0x26A1, 0x26A1], // high voltage
  [0x26BD, 0x26BD],
  [0x26C4, 0x26C5],
  [0x26F0, 0x26F5],
  [0x26F7, 0x26FA],
  [0x2668, 0x2668],
  [0x2B05, 0x2B07],
  [0x2B1B, 0x2B1C],
  [0x2B50, 0x2B50],
  [0x2B55, 0x2B55],
  [0x1F300, 0x1F5FF],
  [0x1F600, 0x1F64F],
  [0x1F680, 0x1F6FF],
  [0x1F900, 0x1F9FF],
  [0x1FA70, 0x1FAFF],
];

function isWideSymbol(codePoint) {
  for (const [lo, hi] of WIDE_SYMBOL_RANGES) {
    if (codePoint >= lo && codePoint <= hi) return true;
  }
  return false;
}

function getVisualLength(str) {
  if (!str) return 0;
  let clean = str.replace(/\x1b\[[0-9;]*m/g, '');
  clean = clean.replace(/[\uFE00-\uFE0F\u200B-\u200D\u202A-\u202E]/g, '');

  let len = 0;
  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i);
    if (code >= 0xD800 && code <= 0xDBFF) {
      len += 2;
      i++;
    } else if (isWideSymbol(code)) {
      len += 2;
    } else {
      len += 1;
    }
  }
  return len;
}

function truncateVisual(str, maxLen) {
  if (!str) return '';
  const clean = stripAnsi(String(str));
  const visLen = getVisualLength(clean);
  if (visLen <= maxLen) return clean;

  let truncated = clean.length > maxLen + 8 ? clean.slice(0, maxLen + 8) : clean;
  while (getVisualLength(truncated + '...') > maxLen && truncated.length > 0) {
    const lastChar = truncated.charCodeAt(truncated.length - 1);
    if (lastChar >= 0xDC00 && lastChar <= 0xDFFF && truncated.length > 1) {
      truncated = truncated.slice(0, -2);
    } else {
      truncated = truncated.slice(0, -1);
    }
  }
  return truncated + '...';
}

function padEndVisual(str, targetLen, padChar = ' ') {
  const visualLen = getVisualLength(str);
  if (visualLen >= targetLen) return str;
  return str + padChar.repeat(targetLen - visualLen);
}

function padStartVisual(str, targetLen, padChar = ' ') {
  const visualLen = getVisualLength(str);
  if (visualLen >= targetLen) return str;
  return padChar.repeat(targetLen - visualLen) + str;
}

function stripAnsi(str) {
  return String(str || '').replace(/\x1b\[[0-9;]*m/g, '');
}

function computeTableWidths(headers, rows, options = {}) {
  const { minWidths = [], maxWidths = [] } = options;
  return headers.map((header, colIdx) => {
    const maxBound = maxWidths[colIdx] != null ? maxWidths[colIdx] * 2 : Infinity;
    let max = getVisualLength(stripAnsi(header));
    rows.forEach((row) => {
      const cell = row[colIdx] != null ? row[colIdx] : '';
      const cellStr = stripAnsi(cell);
      const boundedCell = cellStr.length > maxBound ? cellStr.slice(0, maxBound) : cellStr;
      max = Math.max(max, getVisualLength(boundedCell));
    });
    if (minWidths[colIdx] != null) max = Math.max(max, minWidths[colIdx]);
    if (maxWidths[colIdx] != null) max = Math.min(max, maxWidths[colIdx]);
    return max;
  });
}

function getStatusTheme(status) {
  const s = stripAnsi(status).trim();
  if (s === 'HEALTHY' || s === 'ACTIVE' || s === 'EXISTS') {
    return [[52, 211, 153], [34, 197, 94]];
  }
  if (s === 'REPAIRED') {
    return [[0, 255, 255], [56, 189, 248]];
  }
  if (s === 'INFO') {
    return [[56, 189, 248], [14, 165, 233]];
  }
  if (s === 'WARNING' || s === 'INACTIVE' || s === 'MISSING') {
    return [[251, 191, 36], [249, 115, 22]];
  }
  return [[248, 113, 113], [239, 68, 68]];
}

function gradientStatusCell(paddedPlain) {
  const trimmed = paddedPlain.trim();
  if (!trimmed) return paddedPlain;
  const start = paddedPlain.indexOf(trimmed);
  const prefix = paddedPlain.slice(0, start);
  const suffix = paddedPlain.slice(start + trimmed.length);
  return prefix + applyGradient(trimmed, getStatusTheme(trimmed)) + suffix;
}

function sectionTitle(text, theme = NINJA_THEME) {
  log(`\n  ${C.bold}${applyGradient(text, theme)}${C.reset}`);
}

function drawIntegrationRow(label, active, detail, theme = LEAF_THEME) {
  const labelWidth = 30;
  const statusWidth = 10;
  const statusText = active ? 'ACTIVE' : 'INACTIVE';
  const labelCol = applyGradient(padEndVisual(label, labelWidth), theme, 0.92);
  const statusCol = gradientStatusCell(padEndVisual(statusText, statusWidth));
  const bullet = applyGradient(active ? '•' : '•', active ? LEAF_THEME : FIRE_THEME);
  const detailText = truncateVisual(detail, 58);
  const pipe = applyGradientToBorders('│', CHIDORI_THEME);
  log(`    ${bullet} ${labelCol} [ ${statusCol} ] ${pipe} ${applyGradient(detailText, CHIDORI_THEME, 0.75)}`);
}

function drawTable(headers, widths, aligns, rows, rowColors = [], theme = LEAF_THEME, options = {}) {
  const { columnFormatters = [] } = options;
  const lineTopRaw = `┌${widths.map(w => '─'.repeat(w + 2)).join('┬')}┐`;
  const lineMidRaw = `├${widths.map(w => '─'.repeat(w + 2)).join('┼')}┤`;
  const lineBotRaw = `└${widths.map(w => '─'.repeat(w + 2)).join('┴')}┘`;

  const lineTop = '    ' + applyGradientToBorders(lineTopRaw, theme);
  const lineMid = '    ' + applyGradientToBorders(lineMidRaw, theme);
  const lineBot = '    ' + applyGradientToBorders(lineBotRaw, theme);

  function formatRow(cols, colors, isHeader = false) {
    const formatted = cols.map((col, idx) => {
      const width = widths[idx];
      const align = aligns[idx];
      const plain = truncateVisual(stripAnsi(String(col)), width);
      const padded = align === 'right'
        ? padStartVisual(plain, width)
        : padEndVisual(plain, width);

      if (isHeader) {
        return applyGradient(padded, theme);
      }
      if (columnFormatters[idx]) {
        return columnFormatters[idx](padded);
      }
      const color = colors ? colors[idx] : '';
      if (color) {
        return `${color}${padded}${C.reset}`;
      }
      return padded;
    });
    const rawRow = `│ ${formatted.join(' │ ')} │`;
    return '    ' + applyGradientToBorders(rawRow, theme);
  }

  log(lineTop);
  log(formatRow(headers, [], true));
  log(lineMid);
  rows.forEach((row, rowIdx) => {
    const colors = rowColors[rowIdx] || [];
    log(formatRow(row, colors));
  });
  log(lineBot);
}

function info(msg) { log(`  \x1b[38;2;0;200;255mϟ\x1b[0m ${applyGradient(msg, CHIDORI_THEME, 0.95)}`); }
function success(msg) { log(`  \x1b[38;2;0;255;255m⚡\x1b[0m ${applyGradient(msg, LEAF_THEME)}`); }
function warn(msg) { log(`  \x1b[38;2;255;200;0m↯\x1b[0m ${applyGradient(msg, FIRE_THEME, 0.95)}`); }
function error(msg) { log(`  ${applyGradient('✗', [[239, 68, 68], [185, 28, 28]])} ${applyGradient(msg, [[248, 113, 113], [239, 68, 68]])}`); }

function rgb(r, g, b) {
  if (!USE_COLOR) return '';
  return `\x1b[38;2;${Math.round(r)};${Math.round(g)};${Math.round(b)}m`;
}

function applyGradient(line, colors, brightness = 1.0) {
  let result = '';
  const len = line.length;
  if (len === 0) return result;

  for (let i = 0; i < len; i++) {
    const char = line[i];

    if (char === '\x1b') {
      const endIdx = line.indexOf('m', i);
      if (endIdx !== -1) {
        result += line.substring(i, endIdx + 1);
        i = endIdx;
        continue;
      }
    }

    if (char === ' ') {
      result += ' ';
      continue;
    }

    const code = char.charCodeAt(0);
    const position = i / (len - 1 || 1);
    const segmentCount = colors.length - 1;
    const segmentIndex = Math.min(Math.floor(position * segmentCount), segmentCount - 1);

    const startColor = colors[segmentIndex];
    const endColor = colors[segmentIndex + 1];

    const segmentPos = (position - (segmentIndex / segmentCount)) * segmentCount;

    const r = (startColor[0] + (endColor[0] - startColor[0]) * segmentPos) * brightness;
    const g = (startColor[1] + (endColor[1] - startColor[1]) * segmentPos) * brightness;
    const b = (startColor[2] + (endColor[2] - startColor[2]) * segmentPos) * brightness;

    if (code >= 0xD800 && code <= 0xDBFF && i + 1 < len) {
      result += rgb(r, g, b) + char + line[i + 1];
      i++;
    } else {
      result += rgb(r, g, b) + char;
    }
  }
  return result + C.reset;
}

function applyGradientToBorders(line, theme) {
  const cleanLine = line.replace(/\x1b\[[0-9;]*m/g, '');
  const len = cleanLine.length;
  if (len === 0) return '';

  let result = '';
  let cleanIdx = 0;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '\x1b') {
      const endIdx = line.indexOf('m', i);
      if (endIdx !== -1) {
        result += line.substring(i, endIdx + 1);
        i = endIdx;
        continue;
      }
    }

    const isBorder = '┌┬┐├┼┤└┴┘─│═'.includes(char);
    if (isBorder) {
      const position = cleanIdx / (len - 1 || 1);
      const segmentCount = theme.length - 1;
      const segmentIndex = Math.min(Math.floor(position * segmentCount), segmentCount - 1);
      const startColor = theme[segmentIndex];
      const endColor = theme[segmentIndex + 1];
      const segmentPos = (position - (segmentIndex / segmentCount)) * segmentCount;

      const r = startColor[0] + (endColor[0] - startColor[0]) * segmentPos;
      const g = startColor[1] + (endColor[1] - startColor[1]) * segmentPos;
      const b = startColor[2] + (endColor[2] - startColor[2]) * segmentPos;

      result += rgb(r, g, b) + char + C.reset;
    } else {
      const position = cleanIdx / (len - 1 || 1);
      const segmentCount = theme.length - 1;
      const segmentIndex = Math.min(Math.floor(position * segmentCount), segmentCount - 1);
      const startColor = theme[segmentIndex];
      const endColor = theme[segmentIndex + 1];
      const segmentPos = (position - (segmentIndex / segmentCount)) * segmentCount;
      const r = startColor[0] + (endColor[0] - startColor[0]) * segmentPos;
      const g = startColor[1] + (endColor[1] - startColor[1]) * segmentPos;
      const b = startColor[2] + (endColor[2] - startColor[2]) * segmentPos;
      result += rgb(r, g, b) + char + C.reset;
    }
    cleanIdx++;
  }
  return result;
}

function getThemeForHeader(msg) {
  if (msg.includes('Savings') || msg.includes('Savings Report') || msg.includes('Combined')) {
    return FIRE_THEME;
  }
  if (msg.includes('Uninstall') || msg.includes('Failed') || msg.includes('Error')) {
    return [[239, 68, 68], [185, 28, 28]];
  }
  if (msg.includes('Doctor') || msg.includes('Diagnostics')) {
    return CHIDORI_THEME;
  }
  if (msg.includes('Complete') || msg.includes('Success') || msg.includes('Status') || msg.includes('Installer')) {
    return LEAF_THEME;
  }
  return NINJA_THEME;
}

function header(msg) {
  const theme = getThemeForHeader(msg);
  let icon = '';
  let text = msg;
  const match = msg.match(/^([\uD800-\uDBFF][\uDC00-\uDFFF]|\S+)\s+(.+)$/);
  if (match) {
    icon = match[1] + ' ';
    text = match[2];
  }

  const coloredText = applyGradient(text, theme);
  log(`\n${icon}${C.bold}${coloredText}${C.reset}`);

  const sepLen = Math.max(60, msg.length + 4);
  const sepLine = '═'.repeat(sepLen);

  log(applyGradient(sepLine, CHIDORI_THEME));
}

function getCliVersion() {
  try {
    const pkgPath = path.resolve(__dirname, '..', '..', 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.version) return pkg.version;
    }
  } catch (_) { /* intentional fallback */ }
  return '2.2.2';
}

function drawLogo() {
  const ver = getCliVersion();
  const textLines = [
    "| |/ /  / _ \\ | \\| | / _ \\ | || |   / \\  ",
    "| ' /  | | | || .` || | | || __ |  / _ \\ ",
    "|_|\\_\\  \\___/ |_|\\_| \\___/ |_||_| /_/ \\_\\",
    `${C.bold}Konoha v${ver}${C.reset} — MCP Tools Orchestrator`,
    `${C.dim}Token reduction: 83-98% via on-demand search${C.reset}`,
    `${C.dim}Maintainer: Andy Setiyawan${C.reset}`,
  ];

  for (let i = 0; i < textLines.length; i++) {
    const coloredText = i < 3
      ? applyGradient(textLines[i], FIRE_THEME)
      : textLines[i];
    log(coloredText);
  }
  log('');
}

function drawBox(title, lines, theme = LEAF_THEME) {
  const width = Math.max(title.length + 4, ...lines.map(l => l.replace(/\x1b\[[0-9;]*m/g, '').length)) + 4;

  const titlePart = ` ${C.bold}${applyGradient(title, theme)} `;
  const borderLength = width - titlePart.replace(/\x1b\[[0-9;]*m/g, '').length - 2;
  const leftBorder = Box.h.repeat(Math.floor(borderLength / 2));
  const rightBorder = Box.h.repeat(Math.ceil(borderLength / 2));

  const top = applyGradient(Box.tl + leftBorder, theme) + titlePart + applyGradient(rightBorder + Box.tr, theme);
  log(top);

  lines.forEach(line => {
    const cleanLine = line.replace(/\x1b\[[0-9;]*m/g, '').trim();
    if (/^[─-]+$/.test(cleanLine)) {
      const dividerLine = applyGradient(Box.div + Box.h.repeat(width - 2) + Box.rdiv, theme);
      log(dividerLine);
    } else {
      const cleanLen = line.replace(/\x1b\[[0-9;]*m/g, '').length;
      const padding = ' '.repeat(width - cleanLen - 4);
      log(applyGradient(Box.v, theme) + ' ' + line + padding + ' ' + applyGradient(Box.v, theme));
    }
  });

  const bottom = applyGradient(Box.bl + Box.h.repeat(width - 2) + Box.br, theme);
  log(bottom);
}

async function chidoriTransition(command) {
  const frames = ['⚡', 'ϟ', '⚡', 'ϟ', '⚡'];
  for (const f of frames) {
    process.stdout.write(`\r  ${C.cyan}${f}${C.reset} Switching to ${command}...`);
    await new Promise(r => setTimeout(r, 60));
  }
  process.stdout.write('\r\x1b[2K');
}

module.exports = {
  USE_COLOR,
  C,
  Box,
  LEAF_THEME,
  FIRE_THEME,
  NINJA_THEME,
  RASENGAN_THEME,
  CHIDORI_THEME,
  log,
  info,
  success,
  warn,
  error,
  header,
  sectionTitle,
  rgb,
  applyGradient,
  applyGradientToBorders,
  getThemeForHeader,
  isWideSymbol,
  getVisualLength,
  truncateVisual,
  padEndVisual,
  padStartVisual,
  stripAnsi,
  computeTableWidths,
  getStatusTheme,
  gradientStatusCell,
  drawIntegrationRow,
  drawTable,
  drawLogo,
  drawBox,
  getCliVersion,
  chidoriTransition,
};
