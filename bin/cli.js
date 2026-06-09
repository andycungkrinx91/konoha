#!/usr/bin/env node

/**
 * konoha CLI
 * 
 * SQLite FTS5 Skills-DB installer for Antigravity IDE/CLI.
 * Migrates agent skills into a searchable MCP server to reduce token usage.
 *
 * Usage:
 *   konoha init          # Install MCP server + migrate skills
 *   konoha migrate       # Re-run migration (after editing skills)
 *   konoha test          # Test MCP server search
 *   konoha status        # Show installation status
 *   konoha uninstall     # Remove skills-db
 * 
 * Cross-platform: Linux, macOS, Windows
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawn, spawnSync } = require('child_process');
const readline = require('readline');
const https = require('https');

const agentManager = require('../src/agent_manager');
const skillManager = require('../src/skill_manager');

// ─── Constants ───────────────────────────────────────────────────────────────

const HOME = os.homedir();
const SKILLS_DB_DIR = path.join(HOME, '.gemini', 'skills-db');
const MCP_CONFIG_PATH = path.join(HOME, '.gemini', 'config', 'mcp_config.json');
const GEMINI_MD_PATH = path.join(HOME, '.gemini', 'GEMINI.md');
const AGENTS_MD_PATH = path.join(HOME, '.agents', 'AGENTS.md');
const DB_PATH = path.join(SKILLS_DB_DIR, 'skills.db');
const SERVER_PATH = path.join(SKILLS_DB_DIR, 'server.py');
const MIGRATE_PATH = path.join(SKILLS_DB_DIR, 'migrate.py');

const SRC_DIR = path.join(__dirname, '..', 'src');
const DOCS_DIR = path.join(__dirname, '..', 'docs');

// Default skills directories to scan
const DEFAULT_SKILLS_DIRS = [
  path.join(HOME, '.agents', 'skills'),
  path.join(HOME, '.gemini', 'antigravity-cli', 'skills'),
  path.join(process.cwd(), '.agents', 'skills'),
];

// Colors for terminal output
const C = {
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

const NO_ANIMATION = process.env.NO_ANIMATE === '1' || process.argv.includes('--no-animate') || process.env.CI === 'true';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function log(msg) { console.log(msg); }

// Helper to get visual length of string (ignoring ANSI and variation selectors)
function getVisualLength(str) {
  if (!str) return 0;
  let clean = str.replace(/\x1b\[[0-9;]*m/g, '');
  clean = clean.replace(/[\uFE00-\uFE0F\u200B-\u200D\u202A-\u202E]/g, '');
  
  let len = 0;
  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const codePoint = clean.codePointAt(i);
      if (codePoint === 0x1F6E1) {
        len += 1; // Shield emoji U+1F6E1 renders as 1 column on some terminals
      } else {
        len += 2;
      }
      i++;
    } else {
      len += 1;
    }
  }
  return len;
}

// Helper to truncate a string to a target visual length
function truncateVisual(str, maxLen) {
  if (!str) return '';
  const visLen = getVisualLength(str);
  if (visLen <= maxLen) return str;
  
  let truncated = str;
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

// Helper to pad end based on visual length
function padEndVisual(str, targetLen, padChar = ' ') {
  const visualLen = getVisualLength(str);
  if (visualLen >= targetLen) return str;
  return str + padChar.repeat(targetLen - visualLen);
}

// Helper to pad start based on visual length
function padStartVisual(str, targetLen, padChar = ' ') {
  const visualLen = getVisualLength(str);
  if (visualLen >= targetLen) return str;
  return padChar.repeat(targetLen - visualLen) + str;
}

/**
 * Draws a professional CLI table.
 * @param {Array<string>} headers - Column headers.
 * @param {Array<number>} widths - Column widths.
 * @param {Array<'left'|'right'>} aligns - Column alignments.
 * @param {Array<Array<any>>} rows - Data rows.
 * @param {Array<Array<string>>} rowColors - Optional text colors for each row column.
 */
function drawTable(headers, widths, aligns, rows, rowColors = [], theme = LEAF_THEME) {
  const lineTopRaw = `┌${widths.map(w => '─'.repeat(w + 2)).join('┬')}┐`;
  const lineMidRaw = `├${widths.map(w => '─'.repeat(w + 2)).join('┼')}┤`;
  const lineBotRaw = `└${widths.map(w => '─'.repeat(w + 2)).join('┴')}┘`;

  const lineTop = '    ' + applyGradientToBorders(lineTopRaw, theme);
  const lineMid = '    ' + applyGradientToBorders(lineMidRaw, theme);
  const lineBot = '    ' + applyGradientToBorders(lineBotRaw, theme);

  function formatRow(cols, colors) {
    const formatted = cols.map((col, idx) => {
      const width = widths[idx];
      const align = aligns[idx];
      const color = colors ? colors[idx] : '';
      
      let text = String(col);
      text = truncateVisual(text, width);
      
      let padded = align === 'right'
        ? padStartVisual(text, width)
        : padEndVisual(text, width);
        
      if (color) {
        padded = `${color}${padded}${C.reset}`;
      }
      return padded;
    });
    const rawRow = `│ ${formatted.join(' │ ')} │`;
    return '    ' + applyGradientToBorders(rawRow, theme);
  }

  log(lineTop);
  log(formatRow(headers, headers.map(() => C.bold)));
  log(lineMid);
  rows.forEach((row, rowIdx) => {
    const colors = rowColors[rowIdx] || [];
    log(formatRow(row, colors));
  });
  log(lineBot);
}

function startAgentTui(agents) {
  return new Promise((resolve) => {
    let selectedIndex = 0;
    let viewMode = 'list'; // 'list' or 'detail'
    
    // Hide cursor
    process.stdout.write('\x1b[?25l');
    
    function render() {
      // Clear console and cursor to home
      console.clear();
      
      if (viewMode === 'list') {
        header('🥷 Subagents Interactive Explorer');
        log(`  ${C.dim}Use ↑/↓ keys to navigate, Press Enter to view details, ESC to exit${C.reset}\n`);
        
        const headers = [' ', 'Subagent', 'Title', 'Model Tier', 'Active Skills'];
        const widths = [2, 22, 20, 28, 22];
        const aligns = ['left', 'left', 'left', 'left', 'left'];
        
        const rows = agents.map((a, idx) => {
          const skillsList = a.skills && a.skills.length > 0 ? a.skills.join(', ') : 'None';
          const indicator = idx === selectedIndex ? '➔' : ' ';
          return [
            indicator,
            `${a.icon || '👤'} @${a.name}`,
            a.title || 'Ninja',
            a.modelTier || '-',
            skillsList
          ];
        });
        
        const rowColors = agents.map((a, idx) => {
          if (idx === selectedIndex) {
            return [C.bold + C.yellow, C.bold + C.cyan, C.bold + C.white, C.bold + C.green, C.bold + C.magenta];
          }
          return [C.dim, C.cyan, C.reset, C.green, C.dim];
        });
        
        drawTable(headers, widths, aligns, rows, rowColors);
        log('');
      } else {
        // Detail View
        const agent = agents[selectedIndex];
        header(`🥷 Subagent Details: ${agent.icon || '👤'} @${agent.name}`);
        log(`  ${C.dim}Press ESC or Backspace to return to list${C.reset}\n`);
        
        const boxWidth = 80;
        const d = C.dim;
        const r = C.reset;
        
        log(`    ${d}┌${'─'.repeat(boxWidth)}┐${r}`);
        
        const printDetailLine = (label, val, color = C.reset) => {
          const contentWidth = boxWidth - 17; // 80 - 17 = 63
          let text = String(val);
          let lines = [];
          while (getVisualLength(text) > contentWidth) {
            let splitIdx = 0;
            let currentVisualLen = 0;
            for (let i = 0; i < text.length; i++) {
              const code = text.charCodeAt(i);
              const charLen = (code >= 0xD800 && code <= 0xDBFF) ? 2 : 1;
              if (currentVisualLen + charLen > contentWidth) {
                splitIdx = i;
                break;
              }
              currentVisualLen += charLen;
              if (charLen === 2) i++; // skip low surrogate
            }
            lines.push(text.substring(0, splitIdx));
            text = text.substring(splitIdx);
          }
          lines.push(text);
          
          lines.forEach((line, idx) => {
            const lbl = idx === 0 ? padEndVisual(label, 12) : ' '.repeat(12);
            const formatted = `${d}│${r} ${C.bold}${lbl}${C.reset} ${d}➔${r} ${color}${padEndVisual(line, contentWidth)}${r} ${d}│${r}`;
            log(`    ${formatted}`);
          });
        };
        
        printDetailLine('Icon', agent.icon || '👤', C.yellow);
        printDetailLine('Name', `@${agent.name}`, C.cyan);
        printDetailLine('Title', agent.title || 'Ninja', C.white);
        printDetailLine('Model Tier', agent.modelTier || '-', C.green);
        printDetailLine('Purpose', agent.purpose || 'General assistant', C.reset);
        printDetailLine('Skills', agent.skills && agent.skills.length > 0 ? agent.skills.join(', ') : 'None', C.magenta);
        printDetailLine('Keywords', agent.delegationKeywords || agent.name, C.yellow);
        
        // Instructions & Constraints with border lines
        log(`    ${d}├${'─'.repeat(boxWidth)}┤${r}`);
        
        const printMultiLineSection = (title, text) => {
          log(`    ${d}│${r} ${C.bold}${padEndVisual(title, boxWidth - 2)}${r} ${d}│${r}`);
          const contentWidth = boxWidth - 2;
          
          const paragraphs = text.split('\n');
          paragraphs.forEach(p => {
            if (!p.trim()) return;
            const words = p.split(' ');
            let line = '';
            words.forEach(word => {
              if (getVisualLength(line + word) > contentWidth) {
                log(`    ${d}│${r} ${padEndVisual(line, contentWidth)}${r} ${d}│${r}`);
                line = word + ' ';
              } else {
                line += word + ' ';
              }
            });
            if (line.trim()) {
              log(`    ${d}│${r} ${padEndVisual(line, contentWidth)}${r} ${d}│${r}`);
            }
          });
        };
        
        printMultiLineSection('Description/Purpose:', agent.description || agent.purpose || 'Custom subagent.');
        log(`    ${d}├${'─'.repeat(boxWidth)}┤${r}`);
        printMultiLineSection('Constraints:', agent.constraints || 'None');
        log(`    ${d}├${'─'.repeat(boxWidth)}┤${r}`);
        printMultiLineSection('Workflow:', agent.workflow || 'Process input and report findings.');
        log(`    ${d}├${'─'.repeat(boxWidth)}┤${r}`);
        printMultiLineSection('Instructions:', agent.instructions || 'General instructions.');
        
        log(`    ${d}└${'─'.repeat(boxWidth)}┘${r}\n`);
      }
    }

    render();

    // Start key listener
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    function onKey(key) {
      // ctrl+c (SIGINT)
      if (key === '\u0003') {
        cleanup();
        process.exit(0);
      }

      if (viewMode === 'list') {
        if (key === '\u001b[A' || key === 'k') { // Up arrow or 'k'
          selectedIndex = (selectedIndex - 1 + agents.length) % agents.length;
          render();
        } else if (key === '\u001b[B' || key === 'j') { // Down arrow or 'j'
          selectedIndex = (selectedIndex + 1) % agents.length;
          render();
        } else if (key === '\r' || key === '\n') { // Enter
          viewMode = 'detail';
          render();
        } else if (key === '\u001b') { // ESC
          cleanup();
          resolve();
        }
      } else { // Detail Mode
        if (key === '\u001b' || key === '\u007f' || key === 'q' || key === '\b') { // ESC or Backspace or 'q'
          viewMode = 'list';
          render();
        }
      }
    }

    process.stdin.on('data', onKey);

    function cleanup() {
      process.stdin.removeListener('data', onKey);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      // Show cursor
      process.stdout.write('\x1b[?25h');
    }
  });
}


function info(msg) { log(`${C.cyan}ℹ${C.reset} ${msg}`); }
function success(msg) { log(`${C.green}✓${C.reset} ${msg}`); }
function warn(msg) { log(`${C.yellow}⚠${C.reset} ${msg}`); }
function error(msg) { log(`${C.red}✗${C.reset} ${msg}`); }

let rlInstance = null;
function askQuestion(query) {
  if (!rlInstance) {
    rlInstance = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }
  return new Promise((resolve) => {
    rlInstance.question(query, (answer) => {
      resolve(answer.trim());
    });
  });
}

function closeReadline() {
  if (rlInstance) {
    rlInstance.close();
    rlInstance = null;
  }
}

function rgb(r, g, b) {
  return `\x1b[38;2;${Math.round(r)};${Math.round(g)};${Math.round(b)}m`;
}

function applyGradient(line, colors, brightness = 1.0) {
  let result = '';
  const len = line.length;
  if (len === 0) return '';
  
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
  let result = '';
  const cleanLine = line.replace(/\x1b\[[0-9;]*m/g, '');
  const len = cleanLine.length;
  
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
      result += char;
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
  log(applyGradient('═'.repeat(Math.max(60, msg.length + 4)), theme));
}

function divider() {
  log(applyGradient('─'.repeat(60), NINJA_THEME));
}

function startSpinner(text) {
  const isInteractive = process.stdout.isTTY && !process.env.CI;
  const frames = ['✹', '✷', '✶', '✵'];
  let frameIdx = 0;
  let interval = null;
  
  if (isInteractive && !NO_ANIMATION) {
    process.stdout.write(`  \x1b[33m${frames[0]}\x1b[0m  ${text}`);
    interval = setInterval(() => {
      frameIdx = (frameIdx + 1) % frames.length;
      process.stdout.write(`\r  \x1b[33m${frames[frameIdx]}\x1b[0m  ${text}`);
    }, 100);
  } else {
    log(`  ${C.cyan}ℹ${C.reset} ${text}`);
  }
  
  return {
    update(newText) {
      text = newText;
      if (!isInteractive || NO_ANIMATION) {
        log(`  ${C.cyan}ℹ${C.reset} ${text}`);
      }
    },
    success(successText) {
      if (interval) {
        clearInterval(interval);
        process.stdout.write(`\r  \x1b[32m✓\x1b[0m  ${successText || text}\n`);
      } else {
        log(`  ${C.green}✓${C.reset} ${successText || text}`);
      }
    },
    warn(warnText) {
      if (interval) {
        clearInterval(interval);
        process.stdout.write(`\r  \x1b[33m⚠\x1b[0m  ${warnText || text}\n`);
      } else {
        log(`  ${C.yellow}⚠${C.reset} ${warnText || text}`);
      }
    },
    error(errText) {
      if (interval) {
        clearInterval(interval);
        process.stdout.write(`\r  \x1b[31m✗\x1b[0m  ${errText || text}\n`);
      } else {
        log(`  ${C.red}✗${C.reset} ${errText || text}`);
      }
    }
  };
}

function drawLogo(animated = false) {
  const isInteractive = process.stdout.isTTY && !process.env.CI;
  
  const textLines = [
    "| |/ /  / _ \\ | \\| | / _ \\ | || |   / \\  ",
    "| ' /  | | | || .` || | | || __ |  / _ \\ ",
    "|_|\\_\\  \\___/ |_|\\_| \\___/ |_||_| /_/ \\_\\",
    `${C.bold}Konoha${C.reset} — SQLite FTS5 Skills-DB`,
    `${C.dim}Token reduction: 83-98% via on-demand search${C.reset}`,
    `${C.dim}Maintainer: Andy Setiyawan${C.reset}`,
  ];
  
  if (animated && isInteractive && !NO_ANIMATION) {
    process.stdout.write('\x1b[?25l'); // Hide cursor
    
    // Print empty lines first
    for (let i = 0; i < textLines.length; i++) {
      log('');
    }
    
    const frames = 12;
    for (let f = 1; f <= frames; f++) {
      const brightness = f / frames;
      process.stdout.write(`\x1b[${textLines.length}A`); // Move cursor up
      
      for (let i = 0; i < textLines.length; i++) {
        const coloredText = i < 3
          ? applyGradient(textLines[i], FIRE_THEME, brightness)
          : textLines[i];
        log(coloredText);
      }
      
      // Synchronous delay
      const start = Date.now();
      while (Date.now() - start < 35) {}
    }
    process.stdout.write('\x1b[?25h'); // Show cursor
  } else {
    for (let i = 0; i < textLines.length; i++) {
      const coloredText = i < 3
        ? applyGradient(textLines[i], FIRE_THEME)
        : textLines[i];
      log(coloredText);
    }
  }
  log('');
}

function drawBox(title, lines, theme = LEAF_THEME) {
  const width = Math.max(title.length + 4, ...lines.map(l => l.replace(/\x1b\[[0-9;]*m/g, '').length)) + 4;
  
  const titlePart = ` ${C.bold}${title} `;
  const borderLength = width - titlePart.replace(/\x1b\[[0-9;]*m/g, '').length - 2;
  const leftBorder = Box.h.repeat(Math.floor(borderLength / 2));
  const rightBorder = Box.h.repeat(Math.ceil(borderLength / 2));
  
  const top = applyGradient(Box.tl + leftBorder, theme) + titlePart + applyGradient(rightBorder + Box.tr, theme);
  log(top);
  
  lines.forEach(line => {
    const cleanLine = line.replace(/\x1b\[[0-9;]*m/g, '').trim();
    if (/^[─\-]+$/.test(cleanLine)) {
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

function fileExists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest) {
  fs.copyFileSync(src, dest);
}

function checkPython() {
  const cmds = ['python3', 'python'];
  for (const cmd of cmds) {
    try {
      const version = execSync(`${cmd} --version 2>&1`, { encoding: 'utf-8' }).trim();
      if (version.includes('Python 3')) {
        return cmd;
      }
    } catch {}
  }
  return null;
}

function detectSkillsDirs() {
  const found = [];
  for (const dir of DEFAULT_SKILLS_DIRS) {
    if (fileExists(dir)) {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        const skillCount = entries.filter(e => 
          (e.isDirectory() && fileExists(path.join(dir, e.name, 'SKILL.md'))) ||
          (e.isFile() && e.name.endsWith('-skill.md'))
        ).length;
        if (skillCount > 0) {
          found.push({ path: dir, count: skillCount });
        }
      } catch {}
    }
  }
  return found;
}

function detectCustomSkills(skillsDir) {
  try {
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    const skills = [];
    for (const e of entries) {
      if (e.isDirectory() && fileExists(path.join(skillsDir, e.name, 'SKILL.md'))) {
        skills.push(e.name);
      } else if (e.isFile() && e.name.endsWith('-skill.md')) {
        skills.push(e.name);
      }
    }
    return skills;
  } catch {
    return [];
  }
}

// ─── Commands ────────────────────────────────────────────────────────────────

function cmdInit(args) {
  drawLogo(true); // Animate fade-in of the logo!
  
  header('🚀 Konoha Installer');
  log(`${C.dim}SQLite FTS5 Skills-DB for Antigravity IDE/CLI${C.reset}`);
  log(`${C.dim}Reduces token usage by 83-98% via on-demand skill search${C.reset}\n`);

  // 1. Check Python
  const spinner1 = startSpinner('Checking Python 3 environment...');
  const python = checkPython();
  if (!python) {
    spinner1.error('Python 3 is required but not found.');
    log('  Install from: https://www.python.org/downloads/');
    process.exit(1);
  }
  spinner1.success(`Python 3 found: ${python}`);

  // 2. Check for existing installation
  if (fileExists(SERVER_PATH) && fileExists(DB_PATH)) {
    warn('Skills-DB already installed.');
    info(`Database: ${DB_PATH}`);
    info(`Server:   ${SERVER_PATH}`);
    log('');
    info('Use "konoha migrate" to re-index skills.');
    info('Use "konoha status" to check status.');

    if (!args.includes('--force')) {
      log(`\n${C.dim}Run with --force to reinstall.${C.reset}`);
      return;
    }
    warn('Reinstalling (--force)...');
  }

  // 3. Detect skills directories
  const spinner2 = startSpinner('Detecting skills directories...');
  const skillsDirs = detectSkillsDirs();

  if (skillsDirs.length === 0) {
    spinner2.warn('No skills directories found with SKILL.md files.');
    info('Expected locations:');
    DEFAULT_SKILLS_DIRS.forEach(d => info(`  ${d}`));
    log('');
    info('You can still install the server and migrate manually later.');
    info('Use: konoha migrate --skills-dir /path/to/skills');
  } else {
    spinner2.success(`Detected ${skillsDirs.length} skills directories.`);
    skillsDirs.forEach(s => {
      success(`Found: ${s.path} (${s.count} skills)`);
    });
  }

  // 4. Install server files
  header('📦 Installing MCP Server');
  const spinner3 = startSpinner('Installing MCP Server files...');
  ensureDir(SKILLS_DB_DIR);

  // Copy basic subagent skills to global directory
  const pkgSkillsDir = path.join(__dirname, '..', '.agents', 'skills');
  const globalSkillsDir = path.join(HOME, '.agents', 'skills');
  if (fileExists(pkgSkillsDir)) {
    ensureDir(globalSkillsDir);
    try {
      const files = fs.readdirSync(pkgSkillsDir);
      files.forEach(file => {
        if (file.endsWith('-skill.md')) {
          const srcPath = path.join(pkgSkillsDir, file);
          const destPath = path.join(globalSkillsDir, file);
          copyFile(srcPath, destPath);
        }
      });
    } catch (err) {
      // ignore
    }
  }

  copyFile(path.join(SRC_DIR, 'server.py'), SERVER_PATH);
  copyFile(path.join(SRC_DIR, 'migrate.py'), MIGRATE_PATH);

  const statsScriptSrc = path.join(SRC_DIR, 'db_stats.py');
  const statsScriptDest = path.join(SKILLS_DB_DIR, 'db_stats.py');
  if (fileExists(statsScriptSrc)) {
    copyFile(statsScriptSrc, statsScriptDest);
  }

  const savingsScriptSrc = path.join(SRC_DIR, 'db_savings.py');
  const savingsScriptDest = path.join(SKILLS_DB_DIR, 'db_savings.py');
  if (fileExists(savingsScriptSrc)) {
    copyFile(savingsScriptSrc, savingsScriptDest);
  }

  const agentStatsScriptSrc = path.join(SRC_DIR, 'agent_stats.py');
  const agentStatsScriptDest = path.join(SKILLS_DB_DIR, 'agent_stats.py');
  if (fileExists(agentStatsScriptSrc)) {
    copyFile(agentStatsScriptSrc, agentStatsScriptDest);
  }
  spinner3.success('All files installed to ~/.gemini/skills-db/');

  // 5. Run migration (seed default rank skills only)
  if (fileExists(pkgSkillsDir)) {
    header('📊 Seeding Default Subagent Skills to SQLite FTS5');
    const skills = detectCustomSkills(pkgSkillsDir);
    if (skills.length > 0) {
      const spinnerMigrate = startSpinner(`Seeding default skills from: ${pkgSkillsDir}...`);
      try {
        const run = spawnSync(python, [MIGRATE_PATH, '--skills-dir', pkgSkillsDir, '--skills', ...skills], {
          encoding: 'utf-8', cwd: SKILLS_DB_DIR, timeout: 30000
        });
        if (run.status !== 0) throw new Error(run.stderr || 'Migration failed');
        spinnerMigrate.success('Default subagent skills seeded successfully.');
      } catch (e) {
        // Fallback: run without args (uses defaults in script)
        try {
          const runFallback = spawnSync(python, [MIGRATE_PATH], {
            encoding: 'utf-8', cwd: SKILLS_DB_DIR, timeout: 30000
          });
          if (runFallback.status !== 0) throw new Error(runFallback.stderr || 'Migration fallback failed');
          spinnerMigrate.success('Default subagent skills seeded successfully (fallback mode).');
        } catch (e2) {
          spinnerMigrate.error(`Failed to seed default skills: ${e2.message}`);
        }
      }
    }
  }

  // 6. Register MCP config
  header('⚙️  Registering MCP Server');
  const spinner4 = startSpinner('Registering in ~/.gemini/config/mcp_config.json...');
  registerMcp(python);
  spinner4.success('skills-db registered in MCP config.');

  // 7. Update GEMINI.md
  header('📝 Updating GEMINI.md');
  const spinner5 = startSpinner('Adding on-demand skills usage rules...');
  updateGeminiMd();
  spinner5.success('GEMINI.md updated.');

  // 8. Update AGENTS.md
  header('👥 Updating AGENTS.md');
  const spinner6 = startSpinner('Re-deploying Naruto Ninja Ranks...');
  updateAgentsMd();
  spinner6.success('AGENTS.md updated.');

  // 9. Summary
  header('✅ Installation Complete!');
  const summaryLines = [
    `Server:     ${C.dim}${SERVER_PATH}${C.reset}`,
    `Migration:  ${C.dim}${MIGRATE_PATH}${C.reset}`,
    `Database:   ${C.dim}${DB_PATH}${C.reset}`,
    `MCP Config: ${C.dim}${MCP_CONFIG_PATH}${C.reset}`,
    `GEMINI.md:  ${C.dim}${GEMINI_MD_PATH}${C.reset}`,
    `AGENTS.md:  ${C.dim}${AGENTS_MD_PATH}${C.reset}`,
  ];
  drawBox('Installed Files', summaryLines, LEAF_THEME);
  log('');

  info(`${C.bold}Next steps:${C.reset}`);
  log(`  1. Restart Antigravity IDE/CLI to load the new MCP server`);
  log(`  2. Test execution: ${C.cyan}konoha test${C.reset}`);
  log(`  3. Check status:   ${C.cyan}konoha status${C.reset}`);
  log('');
}

function installUv() {
  info('Attempting to auto-install "uv" for Semble MCP...');
  try {
    if (process.platform === 'win32') {
      execSync('powershell -ExecutionPolicy Bypass -Command "irm https://astral.sh/uv/install.ps1 | iex"', { stdio: 'inherit' });
    } else {
      execSync('curl -LsSf https://astral.sh/uv/install.sh | sh', { stdio: 'inherit' });
    }
    success('uv installed successfully!');
    return true;
  } catch (err) {
    warn(`Failed to auto-install uv: ${err.message}`);
    log('Please install uv manually: https://docs.astral.sh/uv/');
    return false;
  }
}

function getUvCommand() {
  try {
    execSync('uv --version', { stdio: 'ignore' });
    return 'uv';
  } catch {}

  const home = os.homedir();
  const localPaths = [];
  if (process.platform === 'win32') {
    localPaths.push(
      path.join(home, '.local', 'bin', 'uv.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'programs', 'uv', 'uv.exe')
    );
  } else {
    localPaths.push(
      path.join(home, '.local', 'bin', 'uv'),
      path.join(home, '.cargo', 'bin', 'uv'),
      '/usr/local/bin/uv',
      '/usr/bin/uv'
    );
  }

  for (const p of localPaths) {
    if (p && fileExists(p)) {
      try {
        execSync(`"${p}" --version`, { stdio: 'ignore' });
        return p;
      } catch {}
    }
  }

  return null;
}

function registerMcp(python) {
  const pythonCmd = python || checkPython() || 'python3';
  
  ensureDir(path.dirname(MCP_CONFIG_PATH));

  let config = { mcpServers: {} };

  if (fileExists(MCP_CONFIG_PATH)) {
    try {
      config = JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, 'utf-8'));
      if (!config.mcpServers) config.mcpServers = {};
      info('Existing MCP config found, registering servers...');
    } catch {
      warn('Could not parse existing MCP config, creating new one...');
      config = { mcpServers: {} };
    }
  } else {
    info('Creating new MCP config...');
  }

  config.mcpServers['skills-db'] = {
    command: pythonCmd,
    args: [SERVER_PATH]
  };

  let uvCmd = getUvCommand();
  if (!uvCmd) {
    if (installUv()) {
      uvCmd = getUvCommand() || 'uv';
    } else {
      uvCmd = 'uv';
    }
  }

  let uvxCmd = 'uvx';
  if (uvCmd !== 'uv') {
    const companionUvx = path.join(path.dirname(uvCmd), process.platform === 'win32' ? 'uvx.exe' : 'uvx');
    if (fileExists(companionUvx)) {
      uvxCmd = companionUvx;
    }
  }

  config.mcpServers['semble'] = {
    command: uvxCmd,
    args: ['--from', 'semble[mcp]@latest', 'semble']
  };
  success(`Registered 'semble' using command: ${uvxCmd}`);

  fs.writeFileSync(MCP_CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
  success(`MCP config updated with skills-db and semble: ${MCP_CONFIG_PATH}`);
}

function updateGeminiMd() {
  agentManager.regenerateAndDeploy();
}

function updateAgentsMd() {
  agentManager.regenerateAndDeploy();
}

function cmdMigrate(args) {
  header('📊 Re-running Skills Migration');

  const python = checkPython();
  if (!python) {
    error('Python 3 is required but not found.');
    process.exit(1);
  }

  if (!fileExists(MIGRATE_PATH)) {
    error('Migration script not found. Run "konoha init" first.');
    process.exit(1);
  }

  // Check for custom skills dir
  const customDirIdx = args.indexOf('--skills-dir');
  if (customDirIdx >= 0 && args[customDirIdx + 1]) {
    const customDir = args[customDirIdx + 1];
    try {
      const run = spawnSync(python, [MIGRATE_PATH, '--skills-dir', customDir], {
        encoding: 'utf-8', cwd: SKILLS_DB_DIR, timeout: 30000
      });
      if (run.status !== 0) throw new Error(run.stderr || 'Migration failed');
      log(run.stdout);
      success('Migration complete!');
    } catch (e) {
      error(`Migration failed: ${e.message}`);
      process.exit(1);
    }
  } else {
    // Migrate all detected skill directories
    const skillsDirs = detectSkillsDirs();
    if (skillsDirs.length === 0) {
      // Fallback: run without args
      try {
        const runFallback = spawnSync(python, [MIGRATE_PATH], {
          encoding: 'utf-8', cwd: SKILLS_DB_DIR, timeout: 30000
        });
        if (runFallback.status !== 0) throw new Error(runFallback.stderr || 'Migration failed');
        log(runFallback.stdout);
        success('Migration complete!');
      } catch (e) {
        error(`Migration failed: ${e.message}`);
        process.exit(1);
      }
    } else {
      let anySuccess = false;
      for (const s of skillsDirs) {
        const skills = detectCustomSkills(s.path);
        if (skills.length === 0) continue;

        info(`Migrating from: ${s.path}`);
        try {
          const run = spawnSync(python, [MIGRATE_PATH, '--skills-dir', s.path, '--skills', ...skills], {
            encoding: 'utf-8', cwd: SKILLS_DB_DIR, timeout: 30000
          });
          if (run.status !== 0) throw new Error(run.stderr || 'Migration failed');
          log(run.stdout);
          anySuccess = true;
        } catch (e) {
          warn(`Migration failed for ${s.path}: ${e.message}`);
        }
      }
      if (anySuccess) {
        success('Migration complete!');
      } else {
        error('Migration failed for all directories.');
        process.exit(1);
      }
    }
  }

  // v1.1.0: Auto-optimize — regenerate GEMINI.md and AGENTS.md with compact token-optimized generators
  try {
    info('Auto-optimizing generated configurations...');
    agentManager.regenerateAndDeploy();
    success('GEMINI.md and AGENTS.md regenerated with optimized token footprint.');
  } catch (e) {
    warn(`Auto-optimize skipped: ${e.message}`);
  }
}

function cmdTest() {
  header('🧪 Testing Skills-DB MCP Server');

  const python = checkPython();
  if (!python) {
    error('Python 3 is required.');
    process.exit(1);
  }

  if (!fileExists(SERVER_PATH)) {
    error('Server not installed. Run "konoha init" first.');
    process.exit(1);
  }

  if (!fileExists(DB_PATH)) {
    error('Database not found. Run "konoha migrate" first.');
    process.exit(1);
  }

  const tests = [
    { name: 'Initialize', req: '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' },
    { name: 'List Tools', req: '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' },
    { name: 'Find Skill (security)', req: '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"find_skill","arguments":{"keyword":"security"}}}' },
    { name: 'List Skills', req: '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"list_skills","arguments":{}}}' },
    { name: 'Get Skill (golang-security)', req: '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"get_skill","arguments":{"name":"golang-security"}}}' },
  ];

  let allPassed = true;

  for (const test of tests) {
    try {
      const run = spawnSync(python, [SERVER_PATH], {
        input: test.req,
        encoding: 'utf-8',
        timeout: 10000
      });
      if (run.status !== 0) throw new Error(run.stderr || 'Execution failed');
      const output = run.stdout;

      const response = JSON.parse(output.trim());
      if (response.error) {
        error(`${test.name}: ${response.error.message}`);
        allPassed = false;
      } else {
        success(`${test.name}: OK`);

        // Show extra info for specific tests
        if (test.name === 'Find Skill (security)') {
          try {
            const content = JSON.parse(response.result.content[0].text);
            info(`  Found ${content.found} results for "security"`);
            if (content.results) {
              content.results.forEach(r => {
                log(`  ${C.dim}→ ${r.name} (${r.type})${C.reset}`);
              });
            }
          } catch {}
        }

        if (test.name === 'List Skills') {
          try {
            const content = JSON.parse(response.result.content[0].text);
            info(`  Total indexed: ${content.total} entries`);
          } catch {}
        }

        if (test.name === 'Get Skill (golang-security)') {
          try {
            const content = JSON.parse(response.result.content[0].text);
            info(`  Retrieved skill: ${content.name} (${content.byte_size} bytes)`);
          } catch {}
        }
      }
    } catch (e) {
      error(`${test.name}: FAILED - ${e.message}`);
      allPassed = false;
    }
  }

  log('');
  if (allPassed) {
    success('All tests passed! 🎉');
  } else {
    error('Some tests failed. Check the output above.');
    process.exit(1);
  }
}

function cmdStatus() {
  drawLogo(false); // Static logo
  
  header('📋 Skills-DB Status');

  // Check Python
  const python = checkPython();
  let pythonInfo = '';
  if (python) {
    try {
      pythonInfo = execSync(`${python} --version 2>&1`, { encoding: 'utf-8' }).trim();
    } catch {
      pythonInfo = 'Found';
    }
  }

  // Check files
  const checks = [
    { label: 'Server File', path: SERVER_PATH },
    { label: 'Migration Script', path: MIGRATE_PATH },
    { label: 'Database File', path: DB_PATH },
    { label: 'MCP Configuration', path: MCP_CONFIG_PATH },
    { label: 'GEMINI Instructions', path: GEMINI_MD_PATH },
    { label: 'AGENTS Definition', path: AGENTS_MD_PATH },
  ];

  log(`\n  ${C.bold}Environment & Files:${C.reset}`);
  const envHeaders = ['Resource / Path', 'Status', 'Size', 'Location'];
  const envWidths = [20, 8, 10, 54];
  const envAligns = ['left', 'left', 'right', 'left'];
  const envRows = [];
  const envRowColors = [];

  // Python Status Row
  if (python) {
    envRows.push(['Python 3', 'ACTIVE', '-', pythonInfo]);
    envRowColors.push(['', C.green, '', '']);
  } else {
    envRows.push(['Python 3', 'MISSING', '-', 'Please install Python 3']);
    envRowColors.push(['', C.red, '', '']);
  }

  // File rows
  checks.forEach(check => {
    if (fileExists(check.path)) {
      const stats = fs.statSync(check.path);
      const sizeStr = `${(stats.size / 1024).toFixed(1)} KB`;
      const displayPath = check.path.replace(HOME, '~');
      envRows.push([check.label, 'EXISTS', sizeStr, displayPath]);
      envRowColors.push(['', C.green, '', '']);
    } else {
      envRows.push([check.label, 'MISSING', '-', check.path]);
      envRowColors.push(['', C.red, '', '']);
    }
  });

  drawTable(envHeaders, envWidths, envAligns, envRows, envRowColors, LEAF_THEME);

  // Check MCP configs
  log(`\n  ${C.bold}MCP Integrations:${C.reset}`);
  if (fileExists(MCP_CONFIG_PATH)) {
    try {
      const config = JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, 'utf-8'));
      
      const printMcpRow = (name) => {
        const hasServer = config.mcpServers && config.mcpServers[name];
        const statusStr = hasServer ? `${C.green}ACTIVE${C.reset}` : `${C.yellow}INACTIVE${C.reset}`;
        const cmdStr = hasServer ? `cmd: ${config.mcpServers[name].command} ${config.mcpServers[name].args.join(' ')}` : '-';
        log(`    ${hasServer ? C.green : C.yellow}•${C.reset} ${name.padEnd(14)} [ ${statusStr} ] ${C.dim}│${C.reset} ${C.dim}${cmdStr.length > 58 ? cmdStr.substring(0, 55) + '...' : cmdStr}${C.reset}`);
      };
      
      printMcpRow('skills-db');
      printMcpRow('semble');
    } catch {
      log(`    ${C.red}✗${C.reset} MCP config parse failed`);
    }
  } else {
    log(`    ${C.red}✗${C.reset} MCP config not found`);
  }

  // Check instructions patterns
  if (fileExists(GEMINI_MD_PATH)) {
    try {
      const content = fs.readFileSync(GEMINI_MD_PATH, 'utf-8');
      const hasSkillsDb = content.includes('skills-db find_skill');
      log(`    ${hasSkillsDb ? C.green : C.yellow}•${C.reset} GEMINI.md instructions: ${hasSkillsDb ? C.green + 'skills-db active' : C.yellow + 'not found'}${C.reset}`);
    } catch {}
  }

  // Subagents list
  log(`\n  ${C.bold}Subagents (Naruto Ninja Ranks):${C.reset}`);
  const agents = agentManager.loadAgents();
  const iconMap = {
    'genin': '🍃',
    'chunin': '📜',
    'jonin': '🛡️',
    'anbu': '👥',
    'tokubetsu-jonin': '🎯',
    'kage': '🌀'
  };

  const subHeaders = ['Rank / Name', 'Specialization / Purpose', 'Skills Configuration'];
  const subWidths = [20, 42, 27];
  const subAligns = ['left', 'left', 'left'];
  const subRows = [];
  const subRowColors = [];

  agents.forEach(a => {
    const icon = a.icon || iconMap[a.name] || '👤';
    const displayName = `${icon} ${a.name.charAt(0).toUpperCase() + a.name.slice(1)}`;
    const role = a.purpose || 'Custom Subagent';
    const activeSkills = a.skills && a.skills.length > 0 ? a.skills.join(', ') : 'None';
    
    subRows.push([displayName, role, activeSkills]);
    subRowColors.push(['', '', C.green]);
  });

  drawTable(subHeaders, subWidths, subAligns, subRows, subRowColors, LEAF_THEME);

  // Database stats
  log(`\n  ${C.bold}Database Stats:${C.reset}`);
  if (fileExists(DB_PATH) && python) {
    const statsScript = path.join(SKILLS_DB_DIR, 'db_stats.py');
    const statsScriptPkg = path.join(SRC_DIR, 'db_stats.py');
    const scriptToUse = fileExists(statsScript) ? statsScript : fileExists(statsScriptPkg) ? statsScriptPkg : null;

    if (scriptToUse) {
      try {
        const output = execSync(
          `${python} "${scriptToUse}" "${DB_PATH}"`,
          { encoding: 'utf-8', timeout: 5000 }
        );
        const stats = JSON.parse(output.trim());
        if (stats.error) {
          log(`    ${C.yellow}⚠${C.reset} Database error: ${stats.error}`);
        } else {
          log(`    ${C.green}✓${C.reset} SQLite FTS5 database is healthy:`);
          log(`      ${C.dim}├─${C.reset} Total Entries:   ${C.bold}${stats.total}${C.reset}`);
          log(`      ${C.dim}├─${C.reset} Unique Skills:   ${C.bold}${stats.skills}${C.reset}`);
          log(`      ${C.dim}├─${C.reset} Reference Files: ${C.bold}${stats.refs}${C.reset}`);
          log(`      ${C.dim}└─${C.reset} Indexed size:    ${C.bold}${(stats.bytes / 1024).toFixed(1)} KB${C.reset}`);
        }
      } catch {
        log(`    ${C.yellow}⚠${C.reset} Could not read database stats.`);
      }
    } else {
      log(`    ${C.yellow}⚠${C.reset} Stats helper script not found.`);
    }
  } else {
    log(`    ${C.yellow}⚠${C.reset} Database not found. Run "konoha init" to build database.`);
  }

  // Skills directories
  log(`\n  ${C.bold}Skills Directories:${C.reset}`);
  const skillsDirs = detectSkillsDirs();
  if (skillsDirs.length > 0) {
    skillsDirs.forEach(s => {
      const displayPath = s.path.replace(HOME, '~');
      log(`    ${C.green}✓${C.reset} ${displayPath} [ ${C.green}${s.count} skills${C.reset} ]`);
    });
  } else {
    log(`    ${C.yellow}⚠${C.reset} No skills directories found`);
  }

  log('');
}

function cmdDoctor() {
  drawLogo(false); // Static logo
  header('🩺 Konoha Doctor');
  log(`${C.dim}Diagnosing environment requirements and auto-repairing missing components...${C.reset}\n`);

  const globalSpinner = startSpinner('Running environment diagnostics...');

  let repairsDone = 0;
  let hasErrors = false;
  
  const results = [];

  // Helper to record result
  const record = (component, status, details) => {
    results.push({ component, status, details });
  };

  // 1. Python 3
  const python = checkPython();
  let pythonVersion = 'Python 3';
  if (!python) {
    hasErrors = true;
    record('Python 3 Environment', 'FAILED', 'Python 3 is not found in system PATH');
  } else {
    try {
      pythonVersion = execSync(`${python} --version 2>&1`, { encoding: 'utf-8' }).trim();
    } catch {}
    record('Python 3 Environment', 'ACTIVE', `${pythonVersion} (${python})`);
  }

  // Helper to check and repair local package files
  const checkAndRepairFile = (srcName, destPath, label) => {
    const srcPath = path.join(SRC_DIR, srcName);
    const srcExists = fileExists(srcPath);
    
    if (fileExists(destPath)) {
      if (srcExists) {
        try {
          const srcContent = fs.readFileSync(srcPath, 'utf-8');
          const destContent = fs.readFileSync(destPath, 'utf-8');
          if (srcContent !== destContent) {
            copyFile(srcPath, destPath);
            record(label, 'REPAIRED', 'Updated outdated file from package templates');
            repairsDone++;
            return true;
          }
        } catch (e) {
          record(label, 'FAILED', `Error checking content: ${e.message}`);
          hasErrors = true;
          return false;
        }
      }
      record(label, 'HEALTHY', 'File is present and healthy');
      return true;
    }
    
    // Repair
    try {
      ensureDir(path.dirname(destPath));
      if (srcExists) {
        copyFile(srcPath, destPath);
        record(label, 'REPAIRED', 'Restored missing file from package templates');
        repairsDone++;
        return true;
      } else {
        record(label, 'FAILED', `Source file ${srcName} not found in package`);
        hasErrors = true;
        return false;
      }
    } catch (e) {
      record(label, 'FAILED', `Error: ${e.message}`);
      hasErrors = true;
      return false;
    }
  };

  // 2. Server File
  checkAndRepairFile('server.py', SERVER_PATH, 'Server File (server.py)');

  // 3. Migration Script
  checkAndRepairFile('migrate.py', MIGRATE_PATH, 'Migration Script (migrate.py)');

  // 4. Stats Helper
  const statsScriptDest = path.join(SKILLS_DB_DIR, 'db_stats.py');
  checkAndRepairFile('db_stats.py', statsScriptDest, 'Stats Helper Script');

  // 5. Savings Helper
  const savingsScriptDest = path.join(SKILLS_DB_DIR, 'db_savings.py');
  checkAndRepairFile('db_savings.py', savingsScriptDest, 'Savings Helper Script');

  // 5b. Agent Stats Helper
  const agentStatsScriptDest = path.join(SKILLS_DB_DIR, 'agent_stats.py');
  checkAndRepairFile('agent_stats.py', agentStatsScriptDest, 'Agent Stats Helper Script');

  // 6. Database File (requires Python)
  if (fileExists(DB_PATH)) {
    record('Database File (skills.db)', 'HEALTHY', 'Database file is present');
  } else {
    if (!python) {
      record('Database File (skills.db)', 'FAILED', 'Missing; cannot be built because Python 3 is missing');
      hasErrors = true;
    } else {
      // Try to run migration
      const skillsDirs = detectSkillsDirs();
      let migrationSuccess = false;
      
      if (skillsDirs.length > 0) {
        for (const s of skillsDirs) {
          const skills = detectCustomSkills(s.path);
          if (skills.length === 0) continue;
          
          try {
            const run = spawnSync(python, [MIGRATE_PATH, '--skills-dir', s.path, '--skills', ...skills], {
              encoding: 'utf-8', cwd: SKILLS_DB_DIR, timeout: 30000
            });
            if (run.status === 0) migrationSuccess = true;
          } catch {}
        }
      }
      
      if (!migrationSuccess) {
        try {
          const runFallback = spawnSync(python, [MIGRATE_PATH], {
            encoding: 'utf-8', cwd: SKILLS_DB_DIR, timeout: 30000
          });
          if (runFallback.status === 0) migrationSuccess = true;
        } catch {}
      }
      
      if (migrationSuccess && fileExists(DB_PATH)) {
        record('Database File (skills.db)', 'REPAIRED', 'Re-created and indexed skills');
        repairsDone++;
      } else {
        record('Database File (skills.db)', 'FAILED', 'Failed to create database via migration script');
        hasErrors = true;
      }
    }
  }

  // 7. MCP Configuration
  let skillsDbRegistered = false;
  let sembleRegistered = false;
  if (fileExists(MCP_CONFIG_PATH)) {
    try {
      const config = JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, 'utf-8'));
      if (config.mcpServers) {
        if (config.mcpServers['skills-db']) skillsDbRegistered = true;
        if (config.mcpServers['semble']) sembleRegistered = true;
      }
    } catch {}
  }
  
  if (skillsDbRegistered && sembleRegistered) {
    record('MCP Config (mcp_config.json)', 'HEALTHY', 'skills-db and semble are active');
  } else {
    if (!python) {
      record('MCP Config (mcp_config.json)', 'FAILED', 'Incomplete registration; missing Python 3');
      hasErrors = true;
    } else {
      try {
        registerMcp(python);
        record('MCP Config (mcp_config.json)', 'REPAIRED', 'Registered skills-db and semble in config');
        repairsDone++;
      } catch (e) {
        record('MCP Config (mcp_config.json)', 'FAILED', `Error: ${e.message}`);
        hasErrors = true;
      }
    }
  }

  // 8. GEMINI Instructions
  let geminiHealthy = false;
  if (fileExists(GEMINI_MD_PATH)) {
    try {
      const content = fs.readFileSync(GEMINI_MD_PATH, 'utf-8');
      if (content.includes('skills-db find_skill')) {
        geminiHealthy = true;
      }
    } catch {}
  }
  
  if (geminiHealthy) {
    record('GEMINI Instructions (GEMINI.md)', 'HEALTHY', 'Instructions are active');
  } else {
    try {
      updateGeminiMd();
      record('GEMINI Instructions (GEMINI.md)', 'REPAIRED', 'GEMINI.md instructions restored');
      repairsDone++;
    } catch (e) {
      record('GEMINI Instructions (GEMINI.md)', 'FAILED', `Error: ${e.message}`);
      hasErrors = true;
    }
  }

  // 9. AGENTS Definition
  let agentsHealthy = false;
  if (fileExists(AGENTS_MD_PATH)) {
    try {
      const content = fs.readFileSync(AGENTS_MD_PATH, 'utf-8');
      if (content.includes('@genin')) {
        agentsHealthy = true;
      }
    } catch {}
  }
  
  if (agentsHealthy) {
    record('AGENTS Definition (AGENTS.md)', 'HEALTHY', 'Ninja ranks are active');
  } else {
    try {
      updateAgentsMd();
      record('AGENTS Definition (AGENTS.md)', 'REPAIRED', 'AGENTS.md configurations restored');
      repairsDone++;
    } catch (e) {
      record('AGENTS Definition (AGENTS.md)', 'FAILED', `Error: ${e.message}`);
      hasErrors = true;
    }
  }

  // Complete diagnostic spinner
  globalSpinner.success('Diagnostic checks complete.');

  // Print results table
  log(`\n    ${C.dim}┌──────────────────────────────────┬──────────────┬────────────────────────────────────────────────────────┐${C.reset}`);
  log(`    ${C.dim}│${C.reset} ${C.bold}${'Requirement / Component'.padEnd(32)}${C.reset} ${C.dim}│${C.reset} ${C.bold}${'Status'.padEnd(12)}${C.reset} ${C.dim}│${C.reset} ${C.bold}${'Diagnostic Details'.padEnd(54)}${C.reset} ${C.dim}│${C.reset}`);
  log(`    ${C.dim}├──────────────────────────────────┼──────────────┼────────────────────────────────────────────────────────┤${C.reset}`);
  
  results.forEach(res => {
    let statusStr = '';
    if (res.status === 'HEALTHY' || res.status === 'ACTIVE') {
      statusStr = `${C.green}${res.status.padEnd(12)}${C.reset}`;
    } else if (res.status === 'REPAIRED') {
      statusStr = `${C.cyan}${res.status.padEnd(12)}${C.reset}`;
    } else {
      statusStr = `${C.red}${res.status.padEnd(12)}${C.reset}`;
    }
    
    const detailsStr = res.details.length > 52 ? res.details.substring(0, 49) + '...' : res.details;
    log(`    ${C.dim}│${C.reset} ${res.component.padEnd(32)} ${C.dim}│${C.reset} ${statusStr} ${C.dim}│${C.reset} ${detailsStr.padEnd(54)} ${C.dim}│${C.reset}`);
  });
  
  log(`    ${C.dim}└──────────────────────────────────┴──────────────┴────────────────────────────────────────────────────────┘${C.reset}`);
  log('');

  // Diagnostic Report Summary
  if (hasErrors) {
    const summaryLines = [
      `${C.red}✗ Diagnostic complete with errors.${C.reset}`,
      `Please check the warnings and install instructions above.`,
      `Repairs successfully performed: ${C.bold}${repairsDone}${C.reset}`,
    ];
    drawBox('🩺 Doctor Summary', summaryLines, [[239, 68, 68], [185, 28, 28]]);
    process.exit(1);
  } else {
    const summaryLines = [
      `${C.green}✓ All diagnostic checks passed successfully!${C.reset}`,
      `Your Konoha environment is fully operational.`,
      repairsDone > 0 
        ? `Auto-repaired ${C.bold}${repairsDone}${C.reset} component(s) successfully.` 
        : `No repairs were required.`
    ];
    drawBox('🩺 Doctor Summary', summaryLines, LEAF_THEME);
    log('');
    
    // If we repaired anything, trigger a self-test to confirm health
    if (repairsDone > 0) {
      info('Running self-test to verify repairs...');
      try {
        cmdTest();
      } catch (testErr) {
        error(`Self-test failed after repairs: ${testErr.message}`);
        process.exit(1);
      }
    }
  }
}

function cmdUninstall() {
  header('🗑️  Uninstalling Skills-DB');

  // Remove server files
  if (fileExists(SKILLS_DB_DIR)) {
    fs.rmSync(SKILLS_DB_DIR, { recursive: true });
    success(`Removed: ${SKILLS_DB_DIR}`);
  }

  // Remove from MCP config
  if (fileExists(MCP_CONFIG_PATH)) {
    try {
      const config = JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, 'utf-8'));
      let updated = false;
      if (config.mcpServers && config.mcpServers['skills-db']) {
        delete config.mcpServers['skills-db'];
        success('Removed skills-db from MCP config');
        updated = true;
      }
      if (config.mcpServers && config.mcpServers['semble']) {
        delete config.mcpServers['semble'];
        success('Removed semble from MCP config');
        updated = true;
      }
      if (updated) {
        fs.writeFileSync(MCP_CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
      }
    } catch {
      warn('Could not update MCP config');
    }
  }

  // Restore GEMINI.md backup if exists
  const backupPath = GEMINI_MD_PATH + '.backup';
  if (fileExists(backupPath)) {
    fs.copyFileSync(backupPath, GEMINI_MD_PATH);
    fs.unlinkSync(backupPath);
    success('Restored GEMINI.md from backup');
  }

  // Restore AGENTS.md backup if exists
  const agentsBackupPath = AGENTS_MD_PATH + '.backup';
  if (fileExists(agentsBackupPath)) {
    fs.copyFileSync(agentsBackupPath, AGENTS_MD_PATH);
    fs.unlinkSync(agentsBackupPath);
    success('Restored AGENTS.md from backup');
  }

  log('');
  success('Skills-DB uninstalled.');
  info('Your original skills in ~/.agents/skills/ are untouched.');
}

function cmdAgentStatus() {
  drawLogo(false); // Static logo
  header('🥷 Agent Call Statistics');
  
  // 1. Get python command
  const python = checkPython();
  if (!python) {
    error('Python 3 is required but not found.');
    process.exit(1);
  }

  const agentStatsScript = path.join(SKILLS_DB_DIR, 'agent_stats.py');
  const agentStatsScriptPkg = path.join(SRC_DIR, 'agent_stats.py');
  const scriptToUse = fileExists(agentStatsScript) ? agentStatsScript : fileExists(agentStatsScriptPkg) ? agentStatsScriptPkg : null;

  if (!scriptToUse) {
    error('Agent stats helper script not found.');
    process.exit(1);
  }

  // Load registered subagents
  const agents = agentManager.loadAgents();

  let stats = {};
  if (fileExists(DB_PATH)) {
    try {
      const run = spawnSync(python, [scriptToUse, DB_PATH], {
        encoding: 'utf-8',
        timeout: 5000
      });
      if (run.status === 0) {
        stats = JSON.parse(run.stdout.trim());
      }
    } catch (e) {
      warn(`Failed to retrieve stats: ${e.message}`);
    }
  }

  // Build a map/list of all agents to show
  const displayAgents = [];
  const processedNames = new Set();

  agents.forEach(a => {
    const name = a.name.toLowerCase();
    processedNames.add(name);
    
    const agentStats = stats[name] || { today: 0, last7days: 0, alltime: 0 };
    displayAgents.push({
      name: `@${a.name}`,
      icon: a.icon || '👤',
      title: a.title,
      modelTier: a.modelTier,
      today: agentStats.today,
      last7days: agentStats.last7days,
      alltime: agentStats.alltime,
      isRegistered: true
    });
  });

  // Add any agents from stats that were not in loadAgents (e.g. (direct))
  Object.keys(stats).forEach(name => {
    const lowerName = name.toLowerCase();
    if (!processedNames.has(lowerName)) {
      processedNames.add(lowerName);
      const agentStats = stats[name];
      displayAgents.push({
        name: name === '(direct)' ? 'Direct Tool Calls' : `@${name}`,
        icon: name === '(direct)' ? '🔌' : '👤',
        title: name === '(direct)' ? 'Non-agent / direct MCP tools usage' : 'Legacy Subagent',
        modelTier: '-',
        today: agentStats.today,
        last7days: agentStats.last7days,
        alltime: agentStats.alltime,
        isRegistered: false
      });
    }
  });

  // Display Table
  log(`\n  ${C.bold}Call Frequency Summary:${C.reset}`);
  
  const headers = ['Subagent', 'Model Tier', 'Today', '7 Days', 'All Time'];
  const widths = [22, 28, 8, 10, 12];
  const aligns = ['left', 'left', 'right', 'right', 'right'];

  const rows = displayAgents.map(da => [
    `${da.icon} ${da.name}`,
    da.modelTier || '-',
    da.today,
    da.last7days,
    da.alltime
  ]);

  const rowColors = displayAgents.map(da => {
    const nameColor = da.isRegistered ? C.cyan : C.yellow;
    return [nameColor, C.reset, C.reset, C.reset, C.reset];
  });

  drawTable(headers, widths, aligns, rows, rowColors);
  log('');
}

function cmdSavings() {
  drawLogo(false); // Static logo
  
  header('📊 Token Savings Report');

  // 1. Get python command
  const python = checkPython();
  if (!python) {
    error('Python 3 is required but not found.');
    process.exit(1);
  }

  const savingsScript = path.join(SKILLS_DB_DIR, 'db_savings.py');
  const savingsScriptPkg = path.join(SRC_DIR, 'db_savings.py');
  const scriptToUse = fileExists(savingsScript) ? savingsScript : fileExists(savingsScriptPkg) ? savingsScriptPkg : null;

  if (scriptToUse && fileExists(DB_PATH)) {
    try {
      log(`\n  ${C.bold}${applyGradient('1. ⚡ Skills-DB (konoha) Savings', LEAF_THEME)}${C.reset}`);
      log(`     ${C.dim}Calculated relative to full context index sizing (~550 KB baseline)${C.reset}\n`);

      const run = spawnSync(python, [scriptToUse, DB_PATH], {
        encoding: 'utf-8',
        timeout: 5000
      });
      if (run.status !== 0) throw new Error(run.stderr || 'Savings query failed');
      const output = run.stdout;
      const stats = JSON.parse(output.trim());
      
      if (stats.error) {
        log(`     ${C.yellow}⚠${C.reset} Database error: ${stats.error}`);
      } else {
        const formatBytes = (b) => {
          if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(2)} MB`;
          return `${(b / 1024).toFixed(1)} KB`;
        };

        const formatTokens = (t) => {
          if (t >= 1000000) return `${(t / 1000000).toFixed(1)}M`;
          if (t >= 1000) return `${(t / 1000).toFixed(1)}k`;
          return String(t);
        };

        const formatSavings = (tokens, pct) => {
          const width = 18;
          const filledCount = Math.min(width, Math.max(0, Math.round((pct / 100) * width)));
          const filled = '█'.repeat(filledCount);
          const empty = '░'.repeat(width - filledCount);
          
          let coloredFilled = '';
          if (filledCount > 0) {
            const theme = pct >= 80 ? LEAF_THEME : (pct >= 50 ? FIRE_THEME : [[239,68,68],[239,68,68]]);
            coloredFilled = applyGradient(filled, theme);
          }
          
          return `[${coloredFilled}${C.dim}${empty}${C.reset}]  ~${C.bold}${formatTokens(tokens).padEnd(5)}${C.reset} tokens (${C.green}${pct}%${C.reset})`;
        };

        // Table
        log('    ' + applyGradientToBorders('┌──────────────┬─────────┬──────────────┬────────────────────────────────────────────────────────┐', LEAF_THEME));
        log('    ' + applyGradientToBorders(`│ ${C.bold}${padEndVisual('Period', 12)}${C.reset} │ ${C.bold}${padEndVisual('Calls', 7)}${C.reset} │ ${C.bold}${padEndVisual('Bytes Saved', 12)}${C.reset} │ ${C.bold}${padEndVisual('Visual Savings (Tokens / %)', 54)}${C.reset} │`, LEAF_THEME));
        log('    ' + applyGradientToBorders('├──────────────┼─────────┼──────────────┼────────────────────────────────────────────────────────┤', LEAF_THEME));
        log('    ' + applyGradientToBorders(`│ ${padEndVisual('Today', 12)} │ ${padEndVisual(stats.today.calls.toString(), 7)} │ ${padEndVisual(formatBytes(stats.today.bytes), 12)} │ ${padEndVisual(formatSavings(stats.today.tokens, stats.today.pct || 0), 54)} │`, LEAF_THEME));
        log('    ' + applyGradientToBorders(`│ ${padEndVisual('Last 7 days', 12)} │ ${padEndVisual(stats.last7days.calls.toString(), 7)} │ ${padEndVisual(formatBytes(stats.last7days.bytes), 12)} │ ${padEndVisual(formatSavings(stats.last7days.tokens, stats.last7days.pct || 0), 54)} │`, LEAF_THEME));
        log('    ' + applyGradientToBorders(`│ ${padEndVisual('All time', 12)} │ ${padEndVisual(stats.alltime.calls.toString(), 7)} │ ${padEndVisual(formatBytes(stats.alltime.bytes), 12)} │ ${padEndVisual(formatSavings(stats.alltime.tokens, stats.alltime.pct || 0), 54)} │`, LEAF_THEME));
        log('    ' + applyGradientToBorders('└──────────────┴─────────┴──────────────┴────────────────────────────────────────────────────────┘', LEAF_THEME));
        log('');

        global.skillsDbTodayCalls = stats.today.calls;
        global.skillsDbTodayTokens = stats.today.tokens;
        global.skillsDbTodayBytes = stats.today.bytes;

        global.skillsDbLast7DaysCalls = stats.last7days.calls;
        global.skillsDbLast7DaysTokens = stats.last7days.tokens;
        global.skillsDbLast7DaysBytes = stats.last7days.bytes;

        global.skillsDbAllTimeCalls = stats.alltime.calls;
        global.skillsDbAllTimeTokens = stats.alltime.tokens;
        global.skillsDbAllTimeBytes = stats.alltime.bytes;
      }
    } catch (e) {
      log(`     ${C.yellow}⚠${C.reset} Could not read Skills-DB savings: ${e.message}`);
    }
  } else {
    log(`     ${C.yellow}⚠${C.reset} Skills-DB database not found. Run "konoha init" first.\n`);
  }

  // 2. Query Semble Savings
  log(`  ${C.bold}${applyGradient('2. 🔍 Semble (Semantic Code Search) Savings', RASENGAN_THEME)}${C.reset}`);
  log(`     ${C.dim}Fetching from Semble tool cli...${C.reset}\n`);

  let sembleTodayCalls = 0;
  let sembleTodayTokens = 0;
  let sembleLast7DaysCalls = 0;
  let sembleLast7DaysTokens = 0;
  let sembleAllTimeCalls = 0;
  let sembleAllTimeTokens = 0;

  try {
    const runSemble = spawnSync('uvx', ['--from', 'semble[mcp]@latest', 'semble', 'savings', '--verbose'], {
      encoding: 'utf-8',
      timeout: 45000
    });
    if (runSemble.status !== 0) throw new Error(runSemble.stderr || 'Semble savings query failed');
    const sembleOutput = runSemble.stdout;
    
    // Print Semble output indented slightly to fit the style
    const indentedSemble = sembleOutput.split('\n').map(l => '    ' + l).join('\n');
    log(indentedSemble);

    const lines = sembleOutput.split('\n');
    for (const line of lines) {
      const cleanLine = line.replace(/\x1b\[[0-9;]*m/g, '');
      const todayMatch = cleanLine.match(/^\s*Today\s+(\d+)\s+\[.*?\]\s+~?([0-9.]+)([M|k]?)\s+tokens/i);
      if (todayMatch) {
        sembleTodayCalls = parseInt(todayMatch[1], 10) || 0;
        const val = parseFloat(todayMatch[2]);
        const unit = (todayMatch[3] || '').toLowerCase();
        sembleTodayTokens = unit === 'm' ? Math.round(val * 1000000) : (unit === 'k' ? Math.round(val * 1000) : Math.round(val));
      }

      const last7Match = cleanLine.match(/^\s*Last\s+7\s+days\s+(\d+)\s+\[.*?\]\s+~?([0-9.]+)([M|k]?)\s+tokens/i);
      if (last7Match) {
        sembleLast7DaysCalls = parseInt(last7Match[1], 10) || 0;
        const val = parseFloat(last7Match[2]);
        const unit = (last7Match[3] || '').toLowerCase();
        sembleLast7DaysTokens = unit === 'm' ? Math.round(val * 1000000) : (unit === 'k' ? Math.round(val * 1000) : Math.round(val));
      }

      const allTimeMatch = cleanLine.match(/^\s*All\s+time\s+(\d+)\s+\[.*?\]\s+~?([0-9.]+)([M|k]?)\s+tokens/i);
      if (allTimeMatch) {
        sembleAllTimeCalls = parseInt(allTimeMatch[1], 10) || 0;
        const val = parseFloat(allTimeMatch[2]);
        const unit = (allTimeMatch[3] || '').toLowerCase();
        sembleAllTimeTokens = unit === 'm' ? Math.round(val * 1000000) : (unit === 'k' ? Math.round(val * 1000) : Math.round(val));
      }
    }
  } catch (e) {
    log(`     ${C.yellow}⚠${C.reset} Could not fetch Semble savings.`);
  }

  // 3. Combined Summary
  const combinedTodayCalls = (global.skillsDbTodayCalls || 0) + sembleTodayCalls;
  const combinedTodayTokens = (global.skillsDbTodayTokens || 0) + sembleTodayTokens;
  const combinedTodayBytes = (global.skillsDbTodayBytes || 0) + (sembleTodayTokens * 4);

  const combinedLast7DaysCalls = (global.skillsDbLast7DaysCalls || 0) + sembleLast7DaysCalls;
  const combinedLast7DaysTokens = (global.skillsDbLast7DaysTokens || 0) + sembleLast7DaysTokens;
  const combinedLast7DaysBytes = (global.skillsDbLast7DaysBytes || 0) + (sembleLast7DaysTokens * 4);

  const combinedAllTimeCalls = (global.skillsDbAllTimeCalls || 0) + sembleAllTimeCalls;
  const combinedAllTimeTokens = (global.skillsDbAllTimeTokens || 0) + sembleAllTimeTokens;
  const combinedAllTimeBytes = (global.skillsDbAllTimeBytes || 0) + (sembleAllTimeTokens * 4);

  const formatBytesComb = (b) => {
    if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(2)} MB`;
    return `${(b / 1024).toFixed(1)} KB`;
  };

  const formatTokensComb = (t) => {
    if (t >= 1000000) return `${(t / 1000000).toFixed(2)}M`;
    if (t >= 1000) return `${(t / 1000).toFixed(1)}k`;
    return t;
  };

  header('🏆 Combined Total Savings');
  log('');
  
  const combinedSummaryLines = [
    `${C.bold}Today:${C.reset}        ${String(combinedTodayCalls).padStart(5)} calls   ~${C.bold}${formatTokensComb(combinedTodayTokens).padEnd(7)}${C.reset} tokens (~${C.bold}${formatBytesComb(combinedTodayBytes)}${C.reset} equivalent)`,
    `${C.bold}Last 7 Days:${C.reset}  ${String(combinedLast7DaysCalls).padStart(5)} calls   ~${C.bold}${formatTokensComb(combinedLast7DaysTokens).padEnd(7)}${C.reset} tokens (~${C.bold}${formatBytesComb(combinedLast7DaysBytes)}${C.reset} equivalent)`,
    `${C.bold}All Time:${C.reset}     ${String(combinedAllTimeCalls).padStart(5)} calls   ~${C.bold}${formatTokensComb(combinedAllTimeTokens).padEnd(7)}${C.reset} tokens (~${C.bold}${formatBytesComb(combinedAllTimeBytes)}${C.reset} equivalent)`,
    '─',
    `Token reduction:       ${C.bold}${C.green}83-98%${C.reset} average per query`,
  ];
  drawBox('Combined Savings Metric', combinedSummaryLines, FIRE_THEME);
  log('');
}

function cmdSkillHelp() {
  log(`
  ${C.bold}📚 Konoha Skill Management Help 📚${C.reset}
  ${C.dim}========================================================================
  A "Skill" is a folder containing prompt instructions, examples, and rules
  that you teach to your AI subagents. By giving agents skills, they become
  experts in specific fields (like SvelteKit frontend, security DevOps, API design, etc.).
  ========================================================================${C.reset}

${C.bold}USAGE${C.reset}
  konoha skill <subcommand> [args]

${C.bold}SUBCOMMANDS${C.reset}
  ${C.cyan}list${C.reset}                Show all custom skills currently installed in your village.
  ${C.cyan}search <query>${C.reset}      Find new skills on the public registry (skills.sh) and install them.
  ${C.cyan}add <url> <name>${C.reset}   Directly install a skill from a Git repository URL.
  ${C.cyan}remove <name>${C.reset}      Uninstall a skill from your local environment.

${C.bold}EXAMPLES FOR BEGINNERS${C.reset}
  ${C.dim}1. Find and install a Terraform skill from the registry:${C.reset}
     konoha skill search terraform

  ${C.dim}2. Install a specific skill directly from GitHub:${C.reset}
     konoha skill add https://github.com/example/my-skill my-custom-skill

  ${C.dim}3. View all skills currently installed:${C.reset}
     konoha skill list
`);
}

function cmdSkill(args) {
  const subcommand = args[0];
  const subArgs = args.slice(1);

  if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    cmdSkillHelp();
    process.exit(0);
  }

  switch (subcommand) {
    case 'list': {
      header('Installed Skills');
      divider();
      const installed = skillManager.listInstalledSkills();
      if (installed.length === 0) {
        warn('No custom skills currently installed.');
      } else {
        installed.forEach(s => {
          success(`${C.bold}${s.name}${C.reset}`);
          log(`  ${C.dim}Path:${C.reset} ${s.path}`);
          log(`  ${C.dim}Desc:${C.reset} ${s.description}`);
        });
      }
      break;
    }
    case 'search': {
      const query = subArgs.join(' ');
      if (!query) {
        error('Usage: konoha skill search <query>');
        process.exit(1);
      }
      skillManager.runInteractiveSearch(query);
      break;
    }
    case 'add': {
      const url = subArgs[0];
      const name = subArgs[1];
      if (!url || !name) {
        error('Usage: konoha skill add <repository-url> <skill-name>');
        process.exit(1);
      }
      try {
        skillManager.addSkillDirect(url, name);
      } catch (err) {
        error(`Failed to add skill: ${err.message}`);
        process.exit(1);
      }
      break;
    }
    case 'remove': {
      const name = subArgs[0];
      if (!name) {
        error('Usage: konoha skill remove <skill-name>');
        process.exit(1);
      }
      try {
        skillManager.removeSkill(name);
        success(`Successfully removed skill: ${name}`);
        info('Re-indexing SQLite database...');
        cmdMigrate([]);
      } catch (err) {
        error(`Failed to remove skill: ${err.message}`);
        process.exit(1);
      }
      break;
    }
    default:
      error(`Unknown skill subcommand: ${subcommand}`);
      cmdSkillHelp();
      process.exit(1);
  }
}

function cmdAgentHelp() {
  log(`
  ${C.bold}👤 Konoha Subagent (Ninja) Management Help 👤${C.reset}
  ${C.dim}========================================================================
  An "Agent" (or Ninja) is a specialized AI assistant that handles specific tasks.
  By splitting work among multiple subagents, we get better results at lower cost.
  - @genin: Scout for read-only codebase reconnaissance & tracing code dependencies.
  - @kage: Village Leader for high-level architecture decisions & security audits.
  - @chunin: Intelligence researcher for looking up documentation and best practices.
  - @jonin: Builder for high-quality frontend styling and component creation.
  - @anbu: Black Ops backend developer for fixing bugs, API logic, and DevOps/CI-CD.
  - @tokubetsu-jonin: Scribe for writing READMEs, API specs, and runbooks.
  ========================================================================${C.reset}

${C.bold}USAGE${C.reset}
  konoha agent <subcommand> [args]

${C.bold}SUBCOMMANDS${C.reset}
  ${C.cyan}list${C.reset}                        List all active agents, their assigned models, and active skills.
  ${C.cyan}create <agent-name> [options]${C.reset} Create a custom subagent manually.
                              Options: --title, --purpose, --instructions, --keywords.
  ${C.cyan}models [agent-name]${C.reset}         Interactively change the primary/fallback model for an agent.
  ${C.cyan}skill [agent-name]${C.reset}          Interactively toggle (embed or remove) a skill for an agent.
  ${C.cyan}delete <agent-name>${C.reset}         Permanently delete/prune an agent and prune its historical statistics.
  ${C.cyan}status${C.reset}                      View detailed call statistics (today, 7 days, all time) for subagents.

${C.bold}EXAMPLES FOR BEGINNERS${C.reset}
  ${C.dim}1. View all configured agents in your village:${C.reset}
     konoha agent list

  ${C.dim}2. Interactively configure LLM models for @kage:${C.reset}
     konoha agent models kage

  ${C.dim}3. Interactively teach @genin a new skill (toggle from list):${C.reset}
     konoha agent skill genin

  ${C.dim}4. View subagent call frequency statistics:${C.reset}
     konoha agent status

  ${C.dim}5. Permanently delete/prune an agent and clean up its database stats:${C.reset}
     konoha agent delete name

  ${C.dim}6. Create a custom subagent manually:${C.reset}
     konoha agent create my-agent --title "Special Agent" --purpose "Custom tasks" --instructions "Custom instructions" --keywords "my-agent"
`);
}

async function cmdAgent(args) {
  const subcommand = args[0];
  const subArgs = args.slice(1);

  if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    cmdAgentHelp();
    process.exit(0);
  }

  switch (subcommand) {
    case 'list': {
      const agents = agentManager.loadAgents();
      if (agents.length === 0) {
        warn('No subagents found.');
        break;
      }

      if (!process.stdin.isTTY) {
        header('Subagents List');
        divider();
        const headers = ['Subagent', 'Title', 'Model Tier', 'Active Skills'];
        const widths = [22, 18, 28, 22];
        const aligns = ['left', 'left', 'left', 'left'];

        const rows = agents.map(a => {
          const skillsList = a.skills && a.skills.length > 0 ? a.skills.join(', ') : 'None';
          return [
            `${a.icon || '👤'} @${a.name}`,
            a.title || 'Ninja',
            a.modelTier || '-',
            skillsList
          ];
        });

        const rowColors = agents.map(() => [
          C.cyan,
          C.reset,
          C.green,
          C.dim
        ]);

        drawTable(headers, widths, aligns, rows, rowColors);
        log('');
        break;
      }

      await startAgentTui(agents);
      break;
    }
    case 'create': {
      const name = subArgs[0];
      if (!name) {
        error('Usage: konoha agent create <agent-name> [options]');
        process.exit(1);
      }
      
      const options = {};
      const titleIdx = subArgs.indexOf('--title');
      if (titleIdx >= 0 && subArgs[titleIdx + 1]) options.title = subArgs[titleIdx + 1];
      
      const purposeIdx = subArgs.indexOf('--purpose');
      if (purposeIdx >= 0 && subArgs[purposeIdx + 1]) options.purpose = subArgs[purposeIdx + 1];
      
      const instrIdx = subArgs.indexOf('--instructions');
      if (instrIdx >= 0 && subArgs[instrIdx + 1]) options.instructions = subArgs[instrIdx + 1];
      
      const keywordsIdx = subArgs.indexOf('--keywords');
      if (keywordsIdx >= 0 && subArgs[keywordsIdx + 1]) options.delegationKeywords = subArgs[keywordsIdx + 1];

      try {
        const newAgent = agentManager.createSubagent(name, options);
        success(`Successfully created subagent: @${newAgent.name}`);
        info('Updated configurations and deployed to ~/.gemini/GEMINI.md and ~/.agents/AGENTS.md');
      } catch (err) {
        error(`Failed to create subagent: ${err.message}`);
        process.exit(1);
      }
      break;
    }
    case 'models': {
      let agentName = subArgs[0];
      const agents = agentManager.loadAgents();
      if (agents.length === 0) {
        warn('No subagents found.');
        process.exit(1);
      }

      // 1. Resolve agent
      if (!agentName) {
        header('Choose Subagent');
        agents.forEach((a, idx) => {
          log(`  [${idx + 1}] @${a.name} (${a.title})`);
        });
        const ans = await askQuestion(`\nSelect subagent (1-${agents.length}): `);
        const num = parseInt(ans, 10);
        if (isNaN(num) || num < 1 || num > agents.length) {
          error('Invalid subagent selection.');
          process.exit(1);
        }
        agentName = agents[num - 1].name;
      } else {
        const found = agents.find(a => a.name.toLowerCase() === agentName.toLowerCase());
        if (!found) {
          error(`Subagent "@${agentName}" not found.`);
          process.exit(1);
        }
        agentName = found.name;
      }

      // 2. Select primary model
      header(`Configure Models for @${agentName}`);
      AVAILABLE_MODELS.forEach((m, idx) => {
        const tagStr = m.tag ? ` [${m.tag}]` : '';
        log(`  [${idx + 1}] ${m.name}${tagStr}`);
      });
      const primaryAns = await askQuestion(`\nSelect primary model (1-${AVAILABLE_MODELS.length}): `);
      const primaryNum = parseInt(primaryAns, 10);
      if (isNaN(primaryNum) || primaryNum < 1 || primaryNum > AVAILABLE_MODELS.length) {
        error('Invalid primary model selection.');
        process.exit(1);
      }
      const primaryModel = AVAILABLE_MODELS[primaryNum - 1];

      // 3. Select fallback model (optional)
      const defaultFallbackModelName = 'Gemini 3.5 Flash (High)';
      const fallbackAns = await askQuestion('\nWould you like to configure a fallback model? (y/n) [y]: ');
      let resolvedModelString = primaryModel.name;
      if (primaryModel.name !== defaultFallbackModelName) {
        resolvedModelString = `${primaryModel.name} | Fallback when fail ${defaultFallbackModelName}`;
      }

      if (fallbackAns.toLowerCase() === 'y' || fallbackAns.toLowerCase() === 'yes' || fallbackAns.trim() === '') {
        log('');
        AVAILABLE_MODELS.forEach((m, idx) => {
          const tagStr = m.tag ? ` [${m.tag}]` : '';
          log(`  [${idx + 1}] ${m.name}${tagStr}`);
        });
        const defaultIndex = AVAILABLE_MODELS.findIndex(m => m.name === defaultFallbackModelName) + 1;
        const fallbackNumAns = await askQuestion(`\nSelect fallback model (1-${AVAILABLE_MODELS.length}) [${defaultIndex}]: `);
        let fallbackNum = parseInt(fallbackNumAns, 10);
        if (fallbackNumAns.trim() === '') {
          fallbackNum = defaultIndex;
        }
        if (isNaN(fallbackNum) || fallbackNum < 1 || fallbackNum > AVAILABLE_MODELS.length) {
          error('Invalid fallback model selection.');
          process.exit(1);
        }
        const fallbackModel = AVAILABLE_MODELS[fallbackNum - 1];
        resolvedModelString = `${primaryModel.name} | Fallback when fail ${fallbackModel.name}`;
      } else if (fallbackAns.toLowerCase() === 'n' || fallbackAns.toLowerCase() === 'no') {
        resolvedModelString = primaryModel.name;
      }

      try {
        const updated = agentManager.updateAgentModel(agentName, resolvedModelString);
        if (updated) {
          success(`Successfully updated model configuration for @${agentName} to:`);
          log(`  ${C.green}${resolvedModelString}${C.reset}`);
          info('Re-deployed team configurations.');
        } else {
          warn(`Model configuration for @${agentName} is already: ${resolvedModelString}`);
        }
      } catch (err) {
        error(`Failed to update agent model: ${err.message}`);
        process.exit(1);
      }
      break;
    }
    case 'skill': {
      let agentName = subArgs[0];
      const agents = agentManager.loadAgents();
      if (agents.length === 0) {
        warn('No subagents found.');
        process.exit(1);
      }

      // 1. Resolve agent
      if (!agentName) {
        header('Choose Subagent');
        agents.forEach((a, idx) => {
          log(`  [${idx + 1}] @${a.name} (${a.title})`);
        });
        const ans = await askQuestion(`\nSelect subagent (1-${agents.length}): `);
        const num = parseInt(ans, 10);
        if (isNaN(num) || num < 1 || num > agents.length) {
          error('Invalid subagent selection.');
          process.exit(1);
        }
        agentName = agents[num - 1].name;
      } else {
        const found = agents.find(a => a.name.toLowerCase() === agentName.toLowerCase());
        if (!found) {
          error(`Subagent "@${agentName}" not found.`);
          process.exit(1);
        }
        agentName = found.name;
      }

      const agent = agents.find(a => a.name.toLowerCase() === agentName.toLowerCase());

      // Get all installed skills
      const installedSkills = skillManager.listInstalledSkills();
      
      const allUniqueSkills = new Map();
      
      const defaultSkills = [
        { name: 'genin-skill', description: 'Codebase Reconnaissance & Trace SOPs' },
        { name: 'kage-skill', description: 'Architecture & Strategy SOPs' },
        { name: 'chunin-skill', description: 'Research & Intel SOPs' },
        { name: 'jonin-skill', description: 'UI & Frontend Specialist SOPs' },
        { name: 'anbu-skill', description: 'Backend, Bug Fixing & DevOps SOPs' },
        { name: 'tokubetsu-jonin-skill', description: 'Technical Scribe SOPs' }
      ];
      defaultSkills.forEach(s => {
        allUniqueSkills.set(s.name, s.description);
      });

      installedSkills.forEach(s => {
        allUniqueSkills.set(s.name, s.description);
      });

      agents.forEach(a => {
        if (a.skills) {
          a.skills.forEach(s => {
            if (!allUniqueSkills.has(s)) {
              allUniqueSkills.set(s, 'Currently embedded skill');
            }
          });
        }
      });

      const skillList = Array.from(allUniqueSkills.entries()).map(([name, desc]) => ({
        name,
        description: desc
      })).sort((a, b) => a.name.localeCompare(b.name));

      if (skillList.length === 0) {
        warn('No skills found. Install some skills first using "konoha skill search" or "konoha skill add".');
        process.exit(1);
      }

      header(`Configure Skills for @${agentName}`);
      log('Select a skill to toggle (embed / unembed):');
      skillList.forEach((s, idx) => {
        const isEmbedded = agent.skills.includes(s.name);
        const statusIcon = isEmbedded ? `${C.green}[✓] Embedded    ${C.reset}` : `${C.dim}[ ] Not Embedded${C.reset}`;
        log(`  [${idx + 1}] ${statusIcon} ${C.bold}${s.name}${C.reset}`);
        log(`      ${C.dim}${s.description}${C.reset}`);
      });

      const skillAns = await askQuestion(`\nSelect skill to toggle (1-${skillList.length}): `);
      const skillNum = parseInt(skillAns, 10);
      if (isNaN(skillNum) || skillNum < 1 || skillNum > skillList.length) {
        error('Invalid skill selection.');
        process.exit(1);
      }

      const selectedSkill = skillList[skillNum - 1].name;
      const isCurrentlyEmbedded = agent.skills.includes(selectedSkill);

      try {
        if (isCurrentlyEmbedded) {
          agentManager.unembedSkill(agentName, selectedSkill);
          success(`Successfully removed skill "${selectedSkill}" from @${agentName}`);
        } else {
          agentManager.embedSkill(agentName, selectedSkill);
          success(`Successfully embedded skill "${selectedSkill}" into @${agentName}`);
        }
        info('Re-deployed team configurations.');
      } catch (err) {
        error(`Failed to toggle skill: ${err.message}`);
        process.exit(1);
      }
      break;
    }
    case 'delete': {
      const name = subArgs[0];
      if (!name) {
        error('Usage: konoha agent delete <agent-name>');
        process.exit(1);
      }
      try {
        // 1. Try to delete from agents.json
        let deletedFromJson = false;
        try {
          agentManager.deleteAgent(name);
          deletedFromJson = true;
        } catch (err) {
          if (!err.message.includes('not found')) {
            throw err;
          }
        }

        // 2. Try to prune from database tool_calls
        let deletedFromDb = false;
        const python = checkPython();
        if (python && fileExists(DB_PATH)) {
          const agentStatsScript = path.join(SKILLS_DB_DIR, 'agent_stats.py');
          const agentStatsScriptPkg = path.join(SRC_DIR, 'agent_stats.py');
          const scriptToUse = fileExists(agentStatsScript) ? agentStatsScript : fileExists(agentStatsScriptPkg) ? agentStatsScriptPkg : null;
          
          if (scriptToUse) {
            try {
              const run = spawnSync(python, [scriptToUse, DB_PATH, '--prune', name], {
                encoding: 'utf-8',
                timeout: 5000
              });
              if (run.status === 0) {
                const res = JSON.parse(run.stdout.trim());
                if (res.success && res.deleted_count > 0) {
                  deletedFromDb = true;
                }
              }
            } catch (e) {
              warn(`Failed to prune database statistics: ${e.message}`);
            }
          }
        }

        if (deletedFromJson || deletedFromDb) {
          success(`Successfully deleted/pruned subagent: @${name}`);
          if (deletedFromJson) {
            info('Updated and redeployed configurations.');
          }
          if (deletedFromDb) {
            info('Pruned historical call statistics from database.');
          }
        } else {
          error(`Failed to delete subagent: Subagent "${name}" not found in configuration or statistics.`);
          process.exit(1);
        }
      } catch (err) {
        error(`Failed to delete subagent: ${err.message}`);
        process.exit(1);
      }
      break;
    }
    case 'status': {
      cmdAgentStatus();
      break;
    }
    default:
      error(`Unknown agent subcommand: ${subcommand}`);
      log(`Available subcommands: list, create, models, skill, delete, status`);
      process.exit(1);
  }
}

const AVAILABLE_MODELS = [
  { name: 'Gemini 3.5 Flash (Medium)', tag: 'Fast', aliases: ['flash-medium', 'gemini-3.5-flash-medium', 'medium'] },
  { name: 'Gemini 3.5 Flash (High)', tag: 'Fast', aliases: ['flash-high', 'gemini-3.5-flash-high', 'high'] },
  { name: 'Gemini 3.5 Flash (Low)', tag: 'Fast', aliases: ['flash-low', 'gemini-3.5-flash-low', 'low'] },
  { name: 'Gemini 3.1 Pro (Low)', tag: '', aliases: ['pro-low', 'gemini-3.1-pro-low'] },
  { name: 'Gemini 3.1 Pro (High)', tag: '', aliases: ['pro-high', 'gemini-3.1-pro-high'] },
  { name: 'Claude Sonnet 4.6 (Thinking)', tag: '', aliases: ['sonnet', 'sonnet-4.6', 'claude-sonnet-4.6', 'sonnet-thinking'] },
  { name: 'Claude Opus 4.6 (Thinking)', tag: '', aliases: ['opus', 'opus-4.6', 'claude-opus-4.6', 'opus-thinking'] },
  { name: 'GPT-OSS 120B (Medium)', tag: '', aliases: ['gpt', 'gpt-oss', 'gpt-oss-120b', 'gpt-120b'] }
];

function cmdModelsHelp() {
  log(`
  ${C.bold}🤖 Antigravity Models Management Help 🤖${C.reset}
  ${C.dim}========================================================================
  This command lets you view and configure which large language models (LLMs) are used
  by your subagents. Using smaller, faster models for simple tasks and large models
  only for complex reasoning saves you token usage and speeds up responses!
  ========================================================================${C.reset}

${C.bold}USAGE${C.reset}
  konoha models <subcommand> [args]

${C.bold}SUBCOMMANDS${C.reset}
  ${C.cyan}list${C.reset}                                 List all available Antigravity model tiers and current agent mapping.
  ${C.cyan}embed <agent-name> <model-expression>${C.reset}  Set the model for an agent (supports fallback expressions).

${C.bold}MODEL EXPRESSIONS${C.reset}
  You can specify a single model, or a primary model with a fallback:
  - Single model: "Gemini 3.5 Flash (High)"
  - With fallback: "Claude Opus 4.6 (Thinking) | Fallback when fail Gemini 3.5 Flash (High)"

${C.bold}EXAMPLES FOR BEGINNERS${C.reset}
  ${C.dim}1. List all models and their current assignments:${C.reset}
     konoha models list

  ${C.dim}2. Manually set @chunin's model with a fallback:${C.reset}
     konoha models embed chunin "Claude Sonnet 4.6 (Thinking) | Fallback when fail Gemini 3.5 Flash (High)"
`);
}

function cmdModels(args) {
  const subcommand = args[0];
  const subArgs = args.slice(1);

  if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    cmdModelsHelp();
    process.exit(0);
  }

  const printModelRow = (col1, col2, col1Color = '', col2Color = '') => {
    const c1 = col1Color ? `${col1Color}${col1.padEnd(30)}${C.reset}` : col1.padEnd(30);
    const c2 = col2Color ? `${col2Color}${col2.padEnd(12)}${C.reset}` : col2.padEnd(12);
    log(`    ${C.dim}│${C.reset} ${c1} ${C.dim}│${C.reset} ${c2} ${C.dim}│${C.reset}`);
  };

  const printTwoColRow = (col1, col2, col1Color = '', col2Color = '') => {
    const c1 = col1Color ? `${col1Color}${col1.padEnd(20)}${C.reset}` : col1.padEnd(20);
    const c2 = col2Color ? `${col2Color}${col2.padEnd(80)}${C.reset}` : col2.padEnd(80);
    log(`    ${C.dim}│${C.reset} ${c1} ${C.dim}│${C.reset} ${c2} ${C.dim}│${C.reset}`);
  };

  switch (subcommand) {
    case 'list': {
      header('Available Antigravity Models');
      log(`    ${C.dim}┌────────────────────────────────┬──────────────┐${C.reset}`);
      log(`    ${C.dim}│${C.reset} ${C.bold}${'Model Name'.padEnd(30)}${C.reset} ${C.dim}│${C.reset} ${C.bold}${'Tag'.padEnd(12)}${C.reset} ${C.dim}│${C.reset}`);
      log(`    ${C.dim}├────────────────────────────────┼──────────────┤${C.reset}`);
      AVAILABLE_MODELS.forEach(m => {
        printModelRow(m.name, m.tag, C.green, C.yellow);
      });
      log(`    ${C.dim}└────────────────────────────────┴──────────────┘${C.reset}`);

      header('Subagent Model Configurations');
      log(`    ${C.dim}┌──────────────────────┬${'─'.repeat(82)}┐${C.reset}`);
      log(`    ${C.dim}│${C.reset} ${C.bold}${'Subagent'.padEnd(20)}${C.reset} ${C.dim}│${C.reset} ${C.bold}${'Assigned Model Tier / Name'.padEnd(80)}${C.reset} ${C.dim}│${C.reset}`);
      log(`    ${C.dim}├──────────────────────┼${'─'.repeat(82)}┤${C.reset}`);
      const agents = agentManager.loadAgents();
      agents.forEach(a => {
        const icon = a.icon || '👤';
        const displayName = `${icon} ${a.name.charAt(0).toUpperCase() + a.name.slice(1)}`;
        printTwoColRow(displayName, a.modelTier, C.cyan, C.green);
      });
      log(`    ${C.dim}└──────────────────────┴${'─'.repeat(82)}┘${C.reset}`);
      log('');
      break;
    }
    case 'embed': {
      const agentName = subArgs[0];
      const modelInput = subArgs.slice(1).join(' ');
      if (!agentName || !modelInput) {
        error('Usage: konoha models embed <agent-name> <model-name>');
        process.exit(1);
      }

      let resolvedModelString = '';
      try {
        const resolveModelString = (input) => {
          const searchStr = input.trim();
          
          if (!searchStr.includes('|')) {
            const foundModel = AVAILABLE_MODELS.find(m => 
              m.name.toLowerCase() === searchStr.toLowerCase() || 
              m.aliases.includes(searchStr.toLowerCase())
            );
            if (!foundModel) throw new Error(`Unknown model: "${input}"`);
            
            const defaultFallbackModelName = 'Gemini 3.5 Flash (High)';
            if (foundModel.name !== defaultFallbackModelName) {
              return `${foundModel.name} | Fallback when fail ${defaultFallbackModelName}`;
            }
            return foundModel.name;
          }
          
          const parts = searchStr.split('|');
          const left = parts[0].trim();
          const right = parts[1].trim();
          
          const foundPrimary = AVAILABLE_MODELS.find(m => 
            m.name.toLowerCase() === left.toLowerCase() || 
            m.aliases.includes(left.toLowerCase())
          );
          if (!foundPrimary) throw new Error(`Unknown primary model: "${left}"`);
          
          let foundFallback = null;
          const sortedModels = [...AVAILABLE_MODELS].sort((a, b) => b.name.length - a.name.length);
          for (const m of sortedModels) {
            if (right.toLowerCase().includes(m.name.toLowerCase())) {
              foundFallback = m;
              break;
            }
            for (const alias of m.aliases) {
              if (right.toLowerCase().includes(alias.toLowerCase())) {
                foundFallback = m;
                break;
              }
            }
            if (foundFallback) break;
          }
          
          if (!foundFallback) throw new Error(`Could not identify fallback model in: "${right}"`);
          
          return `${foundPrimary.name} | Fallback when fail ${foundFallback.name}`;
        };

        resolvedModelString = resolveModelString(modelInput);
      } catch (err) {
        error(err.message + '. Run "konoha models list" to see available options.');
        process.exit(1);
      }

      try {
        const updated = agentManager.updateAgentModel(agentName, resolvedModelString);
        if (updated) {
          success(`Successfully embedded model "${resolvedModelString}" into @${agentName}`);
          info('Re-deployed team configurations.');
        } else {
          warn(`Model "${resolvedModelString}" is already embedded in @${agentName}`);
        }
      } catch (err) {
        error(`Failed to embed model: ${err.message}`);
        process.exit(1);
      }
      break;
    }
    default:
      error(`Unknown models subcommand: ${subcommand}`);
      cmdModelsHelp();
      process.exit(1);
  }
}

function semverCompare(v1, v2) {
  const p1 = v1.replace(/^v/, '').split('.').map(Number);
  const p2 = v2.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const n1 = p1[i] || 0;
    const n2 = p2[i] || 0;
    if (n1 > n2) return 1;
    if (n2 > n1) return -1;
  }
  return 0;
}

function getGithubData(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'Konoha-CLI-Updater'
      },
      timeout: 5000
    };
    https.get(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Failed to parse JSON: ' + e.message));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    }).on('error', reject).on('timeout', () => reject(new Error('Request timed out')));
  });
}

async function getLatestVersion() {
  try {
    const release = await getGithubData('https://api.github.com/repos/andycungkrinx91/konoha/releases/latest');
    if (release && release.tag_name) {
      return release.tag_name;
    }
  } catch (err) {
    // Silently fall through to tags
  }

  const tags = await getGithubData('https://api.github.com/repos/andycungkrinx91/konoha/tags');
  if (tags && tags.length > 0) {
    const sorted = tags
      .map(t => t.name)
      .filter(name => /v?\d+\.\d+\.\d+/.test(name))
      .sort((a, b) => semverCompare(b, a));
    if (sorted.length > 0) {
      return sorted[0];
    }
  }
  throw new Error('No release or tag found on GitHub');
}

async function cmdVersion(args) {
  const pkgPath = path.join(__dirname, '..', 'package.json');
  let currentVersion = '1.0.2';
  try {
    currentVersion = require(pkgPath).version;
  } catch {}

  header('✨ Konoha Version');
  log(`  ${C.bold}Current Version:${C.reset}  ${C.green}${currentVersion}${C.reset}\n`);

  const spinner = startSpinner('Checking for latest release from GitHub...');
  try {
    const latestVersion = await getLatestVersion();
    const cleanLatest = latestVersion.replace(/^v/, '');
    const cleanCurrent = currentVersion.replace(/^v/, '');
    const cmp = semverCompare(cleanLatest, cleanCurrent);

    if (cmp > 0) {
      spinner.warn(`Update available! Latest: ${C.green}${cleanLatest}${C.reset} (current: ${C.yellow}${cleanCurrent}${C.reset})`);
      log('');
      log(`  To upgrade to the latest version, run:`);
      log(`    ${C.cyan}konoha upgrade${C.reset}`);
      log('');
    } else {
      spinner.success(`You are already running the latest version of Konoha (${currentVersion}).`);
    }
  } catch (err) {
    spinner.error(`Failed to check for updates: ${err.message}`);
  }
}

async function cmdUpgrade(args) {
  header('🔄 Upgrading Konoha');
  log(`  Preparing to upgrade Konoha to the latest version...`);

  const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const cmdArgs = ['-y', 'github:andycungkrinx91/konoha', 'init', '--force'];

  log(`  Executing: ${C.cyan}${cmd} ${cmdArgs.join(' ')}${C.reset}\n`);

  const spinner = startSpinner('Upgrading Konoha CLI...');
  spinner.success('Starting upgrade command...');

  const options = { stdio: 'inherit' };
  if (process.platform === 'win32') {
    options.shell = true;
  }

  try {
    const res = spawnSync(cmd, cmdArgs, options);
    if (res.status === 0) {
      success('Konoha has been successfully upgraded!');
    } else {
      error(`Upgrade failed with exit code ${res.status}.`);
      process.exit(res.status || 1);
    }
  } catch (err) {
    error(`Failed to execute upgrade command: ${err.message}`);
    process.exit(1);
  }
}

function cmdHelp() {
  drawLogo(false); // Print static logo for help menu
  
  log(`
  ${C.bold}🍃 Welcome to Konoha — The Ninja Agent Village Management Tool! 🍃${C.reset}
  ${C.dim}========================================================================
  Konoha helps you manage a team of specialized AI subagents (Ninjas) for your
  Antigravity IDE or CLI. It stores agent "skills" (instructions, rules, scripts)
  in a local SQLite FTS5 database and exposes them via a searchable MCP server,
  providing massive token savings (~80-95%) while keeping agents highly capable.
  ========================================================================${C.reset}

${C.bold}USAGE${C.reset}
  konoha <command> [options]

${C.bold}CORE COMMANDS${C.reset}
  ${C.cyan}init${C.reset}          🚀 Setup MCP server, migrate local skills, and configure Antigravity.
  ${C.cyan}migrate${C.reset}       🔄 Re-index/migrate your custom skills database (run after editing skills).
  ${C.cyan}test${C.reset}          🧪 Perform verification tests on the MCP server.
  ${C.cyan}status${C.reset}        🩺 Check installation health, database size, and loaded skills.
  ${C.cyan}version${C.reset}       ✨ Display current version and check for updates from GitHub.
  ${C.cyan}upgrade${C.reset}       🔄 Upgrade Konoha CLI to the latest version from GitHub.
  ${C.cyan}savings${C.reset}       📊 View your total token savings (Today, 7 days, All time).
  ${C.cyan}doctor${C.reset}        🏥 Diagnose environment health and automatically repair missing files.
  ${C.cyan}uninstall${C.reset}     🗑️  Safely remove Konoha MCP server (leaves custom skill files intact).

${C.bold}SUBAGENT & SKILL MANAGEMENT COMMANDS${C.reset}
  ${C.cyan}skill${C.reset}         📚 Manage skills (list installed, search the public registry, add/remove).
  ${C.cyan}agent${C.reset}         👤 Configure your Ninja subagents (list, change models, toggle skills, delete, status).
  ${C.cyan}models${C.reset}        🤖 Manage available LLM models and assign them to subagents.
  ${C.cyan}help${C.reset}          ❓ Show this educational help menu.

${C.bold}GLOBAL OPTIONS${C.reset}
  ${C.dim}--force${C.reset}        Force clean re-installation (used with init).
  ${C.dim}--skills-dir${C.reset}   Specify a custom directory to scan for skill folders (used with migrate).

${C.bold}QUICK-START EXAMPLES FOR BEGINNERS${C.reset}
  ${C.dim}1. Setup everything for the first time:${C.reset}
     npx github:andycungkrinx91/konoha init

  ${C.dim}2. Search for a custom skill (e.g. Golang, Docker) on the registry and install it:${C.reset}
     konoha skill search golang

  ${C.dim}3. Interactively link/toggle skills for a subagent (e.g. teach @genin a new skill):${C.reset}
     konoha agent skill genin

  ${C.dim}4. Interactively change models for a subagent (e.g. set @kage to Claude Opus 4.6):${C.reset}
     konoha agent models kage

  ${C.dim}5. View how many tokens (and how much context window) you have saved:${C.reset}
     konoha savings
`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

const [,, command, ...args] = process.argv;

async function main() {
  try {
    switch (command) {
      case 'init':
        cmdInit(args);
        break;
      case 'migrate':
        cmdMigrate(args);
        break;
      case 'test':
        cmdTest();
        break;
      case 'status':
        cmdStatus();
        break;
      case 'savings':
        cmdSavings();
        break;
      case 'doctor':
        cmdDoctor();
        break;
      case 'uninstall':
        cmdUninstall();
        break;
      case 'version':
        await cmdVersion(args);
        break;
      case 'upgrade':
        await cmdUpgrade(args);
        break;
      case 'skill':
        cmdSkill(args);
        break;
      case 'agent':
      case 'agents':
        await cmdAgent(args);
        break;
      case 'models':
        cmdModels(args);
        break;
      case 'help':
      case '--help':
      case '-h':
        cmdHelp();
        break;
      case undefined:
        cmdHelp();
        break;
      default:
        error(`Unknown command: ${command}`);
        log(`Run ${C.cyan}konoha help${C.reset} for usage.`);
        process.exit(1);
    }
  } finally {
    closeReadline();
  }
}

main().catch(err => {
  closeReadline();
  error(`Execution error: ${err.message}`);
  process.exit(1);
});
