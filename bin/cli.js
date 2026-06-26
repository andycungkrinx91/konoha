#!/usr/bin/env node

/**
 * konoha CLI
 * 
 * SQLite FTS5 Skills-DB installer for Antigravity IDE/CLI and Cursor IDE/CLI.
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
const cursorManager = require('../src/cursor_manager');
const mcpClientsManager = require('../src/mcp_clients_manager');
const deployUtils = require('../src/deploy_utils');
const antigravityManager = require('../src/antigravity_manager');
const { runSplashScreen } = require('../src/splash');


// ─── Constants ───────────────────────────────────────────────────────────────

const HOME = os.homedir();
const SKILLS_DB_DIR = path.join(HOME, '.konoha');
const MCP_CONFIG_PATH = path.join(HOME, '.gemini', 'config', 'mcp_config.json');
const GEMINI_MD_PATH = path.join(HOME, '.gemini', 'GEMINI.md');
const AGENTS_MD_PATH = path.join(HOME, '.agents', 'AGENTS.md');
const DB_PATH = path.join(SKILLS_DB_DIR, 'skills.db');
const SERVER_PATH = path.join(SKILLS_DB_DIR, 'server.py');
const MIGRATE_PATH = path.join(SKILLS_DB_DIR, 'migrate.py');
const FILE_TOOLS_MCP_PATH = path.join(SKILLS_DB_DIR, 'file_tools_mcp.js');
const FILE_TOOLS_ROUTER_PATH = path.join(SKILLS_DB_DIR, 'file_tools_router.js');
const FILE_TOOLS_LAUNCHER_PATH = path.join(SKILLS_DB_DIR, 'file_tools_launcher.sh');
const FILE_TOOLS_PY_DIR = path.join(SKILLS_DB_DIR, 'file_tools');
const SETTINGS_PATH = path.join(HOME, '.gemini', 'antigravity-cli', 'settings.json');

const SRC_DIR = path.join(__dirname, '..', 'src');
const DOCS_DIR = path.join(__dirname, '..', 'docs');

let currentCwd = HOME;
try {
  currentCwd = process.cwd();
} catch (e) {
  if (process.env.PWD) {
    try {
      const fs = require('fs');
      if (fs.existsSync(process.env.PWD)) {
        currentCwd = process.env.PWD;
      }
    } catch (_) {}
  }
}

// Default skills directories to scan
const DEFAULT_SKILLS_DIRS = [
  path.join(HOME, '.agents', 'skills'),
  path.join(HOME, '.gemini', 'antigravity-cli', 'skills'),
  path.join(currentCwd, '.agents', 'skills'),
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

const CHIDORI_THEME = [
  [100, 180, 255],   // Electric Blue
  [0, 255, 255],     // Cyan
  [180, 220, 255],   // Ice White-Blue
  [255, 255, 255],   // Flash White
  [0, 200, 255],     // Deep Electric
];

const LIGHTNING_CHARS = ['Z', '⌁', '⚡', '↯', 'ϟ', '═'];
const CHIDORI_SPINNER_FRAMES = ['⚡', '϶', '⌁', '↯', '✹', '✷', '⚡', 'ϟ'];

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

function stripAnsi(str) {
  return String(str || '').replace(/\x1b\[[0-9;]*m/g, '');
}

function computeTableWidths(headers, rows, options = {}) {
  const { minWidths = [], maxWidths = [] } = options;
  return headers.map((header, colIdx) => {
    let max = getVisualLength(stripAnsi(header));
    rows.forEach((row) => {
      const cell = row[colIdx] != null ? row[colIdx] : '';
      max = Math.max(max, getVisualLength(stripAnsi(cell)));
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

/**
 * Draws a professional CLI table.
 * @param {Array<string>} headers - Column headers.
 * @param {Array<number>} widths - Column widths.
 * @param {Array<'left'|'right'>} aligns - Column alignments.
 * @param {Array<Array<any>>} rows - Data rows.
 * @param {Array<Array<string>>} rowColors - Optional text colors for each row column.
 */
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

        const widths = headers.map((h, colIdx) => {
          if (colIdx === 0) return 2;
          let maxLen = getVisualLength(h);
          rows.forEach(row => {
            const cellLen = getVisualLength(row[colIdx]);
            if (cellLen > maxLen) {
              maxLen = cellLen;
            }
          });
          return maxLen;
        });
        
        const rowColors = agents.map((a, idx) => {
          if (idx === selectedIndex) {
            return [C.bold + C.yellow, C.bold + C.cyan, C.bold + C.white, C.bold + C.green, C.bold + C.magenta];
          }
          return [C.dim, C.cyan, C.reset, C.green, C.dim];
        });
        
        drawTable(headers, widths, aligns, rows, rowColors, NINJA_THEME);
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
    if (process.stdin && typeof process.stdin.setRawMode === 'function') {
      process.stdin.setRawMode(true);
    }
    if (process.stdin) {
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
    }

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

    if (process.stdin) {
      process.stdin.on('data', onKey);
    }

    function cleanup() {
      if (process.stdin) {
        process.stdin.removeListener('data', onKey);
        if (typeof process.stdin.setRawMode === 'function') {
          process.stdin.setRawMode(false);
        }
        process.stdin.pause();
      }
      // Show cursor
      process.stdout.write('\x1b[?25h');
    }
  });
}


function info(msg) { log(`  \x1b[38;2;0;200;255mϟ\x1b[0m ${applyGradient(msg, CHIDORI_THEME, 0.95)}`); }
function success(msg) { log(`  \x1b[38;2;0;255;255m⚡\x1b[0m ${applyGradient(msg, LEAF_THEME)}`); }
function warn(msg) { log(`  \x1b[38;2;255;200;0m↯\x1b[0m ${applyGradient(msg, FIRE_THEME, 0.95)}`); }
function error(msg) { log(`  ${applyGradient('✗', [[239, 68, 68], [185, 28, 28]])} ${applyGradient(msg, [[248, 113, 113], [239, 68, 68]])}`); }

let rlInstance = null;
function askQuestion(query) {
  return new Promise((resolve) => {
    if (!rlInstance) {
      rlInstance = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
    }

    let resolved = false;

    const onData = (data) => {
      const str = data.toString();
      if (str === '\u001b') {
        cleanup();
        resolved = true;
        closeReadline();
        process.stdout.write('\n');
        resolve('ESC');
      }
    };

    const wasRaw = process.stdin && process.stdin.isRaw;
    if (process.stdin && !wasRaw && typeof process.stdin.setRawMode === 'function') {
      process.stdin.setRawMode(true);
    }
    if (process.stdin) {
      process.stdin.resume();
      process.stdin.on('data', onData);
    }

    rlInstance.question(query, (answer) => {
      if (!resolved) {
        cleanup();
        resolved = true;
        resolve(answer.trim());
      }
    });

    function cleanup() {
      if (process.stdin) {
        process.stdin.removeListener('data', onData);
        if (!wasRaw && typeof process.stdin.setRawMode === 'function') {
          process.stdin.setRawMode(false);
        }
      }
    }
  });
}

function closeReadline() {
  if (rlInstance) {
    rlInstance.close();
    rlInstance = null;
  }
}

function isCancel(ans) {
  if (ans === 'ESC') return true;
  if (!ans) return false;
  const lower = ans.toLowerCase().trim();
  return lower === '0' || lower === 'q' || lower === 'exit' || lower === 'back';
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
  
  // Pure separator line with CHIDORI_THEME
  const sepLen = Math.max(60, msg.length + 4);
  const sepLine = '═'.repeat(sepLen);
  
  log(applyGradient(sepLine, CHIDORI_THEME));
}

function divider() {
  const sepLen = 60;
  const sepLine = '═'.repeat(sepLen);
  
  log(applyGradient(sepLine, CHIDORI_THEME));
}

function startSpinner(text) {
  const isInteractive = process.stdout.isTTY && !process.env.CI;
  const frames = CHIDORI_SPINNER_FRAMES;
  const chidoriColors = [
    '\x1b[38;2;100;180;255m',  // Electric Blue
    '\x1b[38;2;0;255;255m',    // Cyan
    '\x1b[38;2;180;220;255m',  // Ice White-Blue
    '\x1b[38;2;255;255;255m',  // Flash White
    '\x1b[38;2;0;200;255m',    // Deep Electric
  ];
  let frameIdx = 0;
  let interval = null;
  
  if (isInteractive && !NO_ANIMATION) {
    // Generate a crackle trail of 3 random lightning chars
    const crackle = () => {
      let trail = '';
      for (let i = 0; i < 3; i++) {
        const ch = LIGHTNING_CHARS[Math.floor(Math.random() * LIGHTNING_CHARS.length)];
        const col = chidoriColors[Math.floor(Math.random() * chidoriColors.length)];
        trail += col + ch;
      }
      return trail + C.reset;
    };

    process.stdout.write(`  ${chidoriColors[0]}${frames[0]}${C.reset}  ${text} ${crackle()}`);
    interval = setInterval(() => {
      frameIdx = (frameIdx + 1) % frames.length;
      const colorIdx = frameIdx % chidoriColors.length;
      // Flash white every 8th frame for Chidori discharge effect
      const isFlash = frameIdx % 8 === 0;
      const color = isFlash ? '\x1b[97m' : chidoriColors[colorIdx];
      const displayText = isFlash ? `\x1b[97m${text}` : text;
      process.stdout.write(`\r  ${color}${frames[frameIdx]}${C.reset}  ${displayText}${C.reset} ${crackle()}   `);
    }, 80);
  } else {
    log(`  ${C.cyan}ϟ${C.reset} ${text}`);
  }
  
  return {
    stop() {
      if (interval) {
        clearInterval(interval);
        interval = null;
        process.stdout.write('\r\x1b[K');
      }
    },
    start(newText) {
      if (newText) text = newText;
      if (isInteractive && !NO_ANIMATION && !interval) {
        interval = setInterval(() => {
          frameIdx = (frameIdx + 1) % frames.length;
          const colorIdx = frameIdx % chidoriColors.length;
          const isFlash = frameIdx % 8 === 0;
          const color = isFlash ? '\x1b[97m' : chidoriColors[colorIdx];
          const displayText = isFlash ? `\x1b[97m${text}` : text;
          const crackle = () => {
            let trail = '';
            for (let i = 0; i < 3; i++) {
              const ch = LIGHTNING_CHARS[Math.floor(Math.random() * LIGHTNING_CHARS.length)];
              const col = chidoriColors[Math.floor(Math.random() * chidoriColors.length)];
              trail += col + ch;
            }
            return trail + C.reset;
          };
          process.stdout.write(`\r  ${color}${frames[frameIdx]}${C.reset}  ${displayText}${C.reset} ${crackle()}   `);
        }, 80);
      }
    },
    update(newText) {
      text = newText;
      if (!isInteractive || NO_ANIMATION) {
        log(`  ${C.cyan}ϟ${C.reset} ${text}`);
      }
    },
    success(successText) {
      if (interval) {
        clearInterval(interval);
        interval = null;
        process.stdout.write(`\r\x1b[K  \x1b[38;2;0;255;255m⚡\x1b[0m  ${successText || text}\n`);
      } else {
        log(`  \x1b[38;2;0;255;255m⚡\x1b[0m ${successText || text}`);
      }
    },
    warn(warnText) {
      if (interval) {
        clearInterval(interval);
        interval = null;
        process.stdout.write(`\r\x1b[K  \x1b[38;2;255;200;0m↯\x1b[0m  ${warnText || text}\n`);
      } else {
        log(`  \x1b[38;2;255;200;0m↯\x1b[0m ${warnText || text}`);
      }
    },
    error(errText) {
      if (interval) {
        clearInterval(interval);
        interval = null;
        process.stdout.write(`\r\x1b[K  \x1b[31m✗\x1b[0m  ${errText || text}\n`);
      } else {
        log(`  ${C.red}✗${C.reset} ${errText || text}`);
      }
    }
  };
}


async function chidoriTransition(commandName) {
  const isInteractive = process.stdout.isTTY && !process.env.CI;
  if (!isInteractive || NO_ANIMATION) return;
  
  const width = 60;
  const chidoriColors = [
    [100, 180, 255],
    [0, 255, 255],
    [180, 220, 255],
    [255, 255, 255],
    [0, 200, 255],
  ];
  
  process.stdout.write('\x1b[?25l');
  
  const frames = 3;
  for (let f = 0; f < frames; f++) {
    let line1 = '';
    
    // Density increases per frame for building energy effect
    const density = 0.3 + (f / frames) * 0.5;
    
    for (let x = 0; x < width; x++) {
      if (Math.random() < density) {
        const ch = LIGHTNING_CHARS[Math.floor(Math.random() * LIGHTNING_CHARS.length)];
        const ci = chidoriColors[Math.floor(Math.random() * chidoriColors.length)];
        line1 += `\x1b[38;2;${ci[0]};${ci[1]};${ci[2]}m${ch}`;
      } else {
        line1 += '\x1b[38;2;100;180;255m═';
      }
    }
    
    // On last frame, flash everything white like Chidori impact
    if (f === frames - 1) {
      line1 = '\x1b[97m' + '⚡'.repeat(width);
    }
    
    process.stdout.write(`\x1b[2K${line1}\x1b[0m\n`);
    
    await new Promise(r => setTimeout(r, 15));
    
    // Move cursor back up 1 line for next frame overlay
    if (f < frames - 1) {
      process.stdout.write('\x1b[1A');
    }
  }
  
  // Clear the lightning lines
  process.stdout.write('\x1b[1A\x1b[2K');
  process.stdout.write('\x1b[?25h');
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
  
  const titlePart = ` ${C.bold}${applyGradient(title, theme)} `;
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
  return require('../src/platform_utils').detectPython();
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

async function cmdInit(args) {
  await chidoriTransition('init');
  drawLogo(true); // Animate fade-in of the logo!
  
  header('🚀 Konoha Installer');
  log(`${C.dim}SQLite FTS5 Skills-DB for Antigravity IDE/CLI${C.reset}`);
  log(`${C.dim}Reduces token usage by 83-98% via on-demand skill search${C.reset}\n`);

  let confirm;
  const isNonInteractive = args.includes('--yes') || args.includes('-y') || process.env.CI === 'true';
  if (!isNonInteractive) {
    try {
      const prompts = await import('@inquirer/prompts');
      confirm = prompts.confirm;
    } catch (e) {
      error('Could not load @inquirer/prompts. Please run "npm install".');
      process.exit(1);
    }
  }

  const doInit = isNonInteractive ? true : await confirm({ message: 'Initialize Konoha and modify ~/.gemini configurations?', default: true });
  if (!doInit) {
    warn('Initialization aborted.');
    return;
  }

  const allowAutoApprove = isNonInteractive ? true : await confirm({ message: 'Allow for skills-db and semble for auto approve in ~/.gemini/config/mcp_config.json?', default: true });
  const allowHooks = isNonInteractive ? true : await confirm({ message: 'Allow registering prompt-saver hook in ~/.gemini/config/hooks.json?', default: true });
  const allowCursor = isNonInteractive ? true : await confirm({ message: 'Configure Konoha for Cursor IDE and Cursor CLI (~/.cursor/mcp.json, subagents, hooks)?', default: true });

  const claudeInstalled = mcpClientsManager.isClaudeCodeInstalled();
  const opencodeInstalled = mcpClientsManager.isOpenCodeInstalled();
  let allowClaudeCode = false;
  let allowOpenCode = false;
  if (claudeInstalled) {
    allowClaudeCode = isNonInteractive
      ? true
      : await confirm({
          message: 'Configure Konoha for Claude Code (~/.claude.json)?',
          default: true
        });
  }
  if (opencodeInstalled) {
    allowOpenCode = isNonInteractive
      ? true
      : await confirm({
          message: 'Configure Konoha for OpenCode (~/.config/opencode/opencode.json)?',
          default: true
        });
  }
  // 1. Ensure the directories exist
  const dirs = [
    path.join(HOME, '.gemini'),
    path.join(HOME, '.agents'),
    SKILLS_DB_DIR,
    path.join(HOME, '.gemini', 'antigravity-cli'),
    path.join(HOME, '.gemini', 'config'),
    path.join(HOME, '.cursor'),
    path.join(HOME, '.cursor', 'agents')
  ];
  dirs.forEach(d => {
    if (!fileExists(d)) {
      ensureDir(d);
    }
  });

  // 2. Check Python
  const spinner1 = startSpinner('Checking Python 3 environment...');
  const python = checkPython();
  if (!python) {
    spinner1.error('Python 3 is required but not found.');
    log('  Install from: https://www.python.org/downloads/');
    process.exit(1);
  }
  spinner1.success(`Python 3 found: ${python}`);

  // 3. Check for existing installation
  if (fileExists(SERVER_PATH) && fileExists(DB_PATH)) {
    warn('Skills-DB already installed.');
    info(`Database: ${DB_PATH}`);
    info(`Server:   ${SERVER_PATH}`);
    log('');
    info('Use "konoha migrate" to re-index skills.');
    info('Use "konoha status" to check status.');

    if (!args.includes('--force')) {
      log(`\n${C.dim}Run with --force to reinstall.${C.reset}`);
      info('Refreshing MCP integrations...');
      const refreshFiles = ['server.py', 'migrate.py', 'db_stats.py', 'db_savings.py', 'agent_stats.py', 'prompt_hook.js', 'antigravity_subagent_hook.js', 'antigravity_tool_sanitize_hook.js', 'antigravity_manager.js', 'cursor_bootstrap.js'];
      refreshFiles.forEach(f => {
        const src = path.join(SRC_DIR, f);
        const dest = path.join(SKILLS_DB_DIR, f);
        if (fileExists(src)) copyIfDifferent(src, dest);
      });
      installFileTools(true);
      registerMcp(python, true, allowAutoApprove);
      registerHooks(true, allowHooks);
      const agentsForSetup = agentManager.loadAgents();
      if (allowCursor) {
        cursorManager.ensureCursorSetup({
          pythonCmd: python,
          serverPath: SERVER_PATH,
          uvxCmd: getUvxCommand(),
          agents: agentsForSetup,
          projectRoot: currentCwd,
          deployProject: true,
          silent: true,
          allowHooks: true,
          ruleContent: null
        });
        cursorManager.registerCursorProjectMcp(currentCwd, python, SERVER_PATH, getUvxCommand(), true);
      }
      if (allowClaudeCode) {
        mcpClientsManager.ensureClaudeCodeSetup({
          pythonCmd: python,
          serverPath: SERVER_PATH,
          uvxCmd: getUvxCommand(),
          ruleContent: agentManager.generateClaudeCodeMd(agentsForSetup),
          silent: true,
          agents: agentsForSetup
        });
      }
      if (allowOpenCode) {
        mcpClientsManager.ensureOpenCodeSetup({
          pythonCmd: python,
          serverPath: SERVER_PATH,
          uvxCmd: getUvxCommand(),
          silent: true
        });
      }
      success('Integrations refreshed.');
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
      const files = fs.readdirSync(pkgSkillsDir, { withFileTypes: true });
      files.forEach(entry => {
        const name = entry.name;
        if (entry.isDirectory()) {
          if (name.endsWith('-skill')) {
            const srcPath = path.join(pkgSkillsDir, name);
            const destPath = path.join(globalSkillsDir, name);
            copyRecursive(srcPath, destPath);
          }
        } else if (entry.isFile()) {
          if (name.endsWith('-skill.md')) {
            const srcPath = path.join(pkgSkillsDir, name);
            const destPath = path.join(globalSkillsDir, name);
            copyFile(srcPath, destPath);
          }
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

  const promptHookSrc = path.join(SRC_DIR, 'prompt_hook.js');
  const promptHookDest = path.join(SKILLS_DB_DIR, 'prompt_hook.js');
  if (fileExists(promptHookSrc)) {
    copyFile(promptHookSrc, promptHookDest);
  }

  const subagentHookSrc = path.join(SRC_DIR, 'antigravity_subagent_hook.js');
  const subagentHookDest = path.join(SKILLS_DB_DIR, 'antigravity_subagent_hook.js');
  if (fileExists(subagentHookSrc)) {
    copyFile(subagentHookSrc, subagentHookDest);
  }

  const antigravityManagerSrc = path.join(SRC_DIR, 'antigravity_manager.js');
  const antigravityManagerDest = path.join(SKILLS_DB_DIR, 'antigravity_manager.js');
  if (fileExists(antigravityManagerSrc)) {
    copyFile(antigravityManagerSrc, antigravityManagerDest);
  }

  const sanitizeHookSrc = path.join(SRC_DIR, 'antigravity_tool_sanitize_hook.js');
  const sanitizeHookDest = path.join(SKILLS_DB_DIR, 'antigravity_tool_sanitize_hook.js');
  if (fileExists(sanitizeHookSrc)) {
    copyFile(sanitizeHookSrc, sanitizeHookDest);
  }

  const cursorBootstrapSrc = path.join(SRC_DIR, 'cursor_bootstrap.js');
  const cursorBootstrapDest = path.join(SKILLS_DB_DIR, 'cursor_bootstrap.js');
  if (fileExists(cursorBootstrapSrc)) {
    copyFile(cursorBootstrapSrc, cursorBootstrapDest);
  }
  installFileTools(true);
  spinner3.success('All files installed to ~/.konoha/');

  // 5. Run migration (seed default rank skills only)
  if (fileExists(pkgSkillsDir)) {
    header('📊 Seeding Default Subagent Skills to SQLite FTS5');
    const skills = detectCustomSkills(pkgSkillsDir);
    if (skills.length > 0) {
      const spinnerMigrate = startSpinner(`Seeding default skills from: ${pkgSkillsDir}...`);
      try {
        const run = spawnSync(python, [MIGRATE_PATH, '--clean', '--skills-dir', pkgSkillsDir, '--skills', ...skills], {
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
  registerMcp(python, true, allowAutoApprove);
  spinner4.success('skills-db registered in MCP config.');

  // Register Hooks config
  header('🔗 Registering Hooks');
  const spinnerHook = startSpinner(allowHooks ? 'Registering prompt hook in ~/.gemini/config/hooks.json...' : 'Removing prompt hook from ~/.gemini/config/hooks.json...');
  registerHooks(false, allowHooks);
  spinnerHook.success(allowHooks ? 'prompt_hook registered in hooks.json.' : 'prompt_hook removed/unregistered from hooks.json.');

  // 7. Update GEMINI.md
  header('📝 Updating GEMINI.md');
  const spinner5 = startSpinner('Adding on-demand skills usage rules...');
  updateGeminiMd(true);
  spinner5.success('GEMINI.md updated.');

  // 8. Update AGENTS.md
  header('👥 Updating AGENTS.md');
  const spinner6 = startSpinner('Re-deploying Naruto Ninja Ranks...');
  updateAgentsMd(true);
  spinner6.success('AGENTS.md updated.');

  // 10. Configure Cursor IDE/CLI
  const setupAgents = agentManager.loadAgents();
  if (allowCursor) {
    header('🖱️  Configuring Cursor IDE/CLI');
    const spinner7 = startSpinner('Registering Cursor MCP, subagents, and hooks...');
    const uvxCmd = getUvxCommand();
    cursorManager.ensureCursorSetup({
      pythonCmd: python,
      serverPath: SERVER_PATH,
      uvxCmd,
      agents: setupAgents,
      projectRoot: currentCwd,
      deployProject: true,
      silent: true,
      allowHooks: true,
      ruleContent: null
    });
    cursorManager.registerCursorProjectMcp(currentCwd, python, SERVER_PATH, uvxCmd, true);
    spinner7.success('Cursor IDE/CLI configured.');
  }

  // 10b. Configure Claude Code (when CLI detected)
  if (allowClaudeCode) {
    header('🤖 Configuring Claude Code');
    const spinnerClaude = startSpinner('Registering Claude Code MCP servers...');
    const uvxCmd = getUvxCommand();
    mcpClientsManager.ensureClaudeCodeSetup({
      pythonCmd: python,
      serverPath: SERVER_PATH,
      uvxCmd,
      ruleContent: agentManager.generateClaudeCodeMd(setupAgents),
      silent: true,
      agents: setupAgents
    });
    spinnerClaude.success('Claude Code MCP configured.');
  } else if (!claudeInstalled) {
    info('Claude Code not detected — skip auto-setup (see docs/templates/claude-code.mcp.json if you install later).');
  }

  // 10c. Configure OpenCode (when CLI detected)
  if (allowOpenCode) {
    header('📟 Configuring OpenCode');
    const spinnerOpenCode = startSpinner('Registering OpenCode MCP servers...');
    const uvxCmd = getUvxCommand();
    mcpClientsManager.ensureOpenCodeSetup({
      pythonCmd: python,
      serverPath: SERVER_PATH,
      uvxCmd,
      silent: true
    });
    spinnerOpenCode.success('OpenCode MCP configured.');
  } else if (!opencodeInstalled) {
    info('OpenCode not detected — skip auto-setup (see docs/templates/opencode.mcp.json if you install later).');
  }

  // 11. Summary
  header('✅ Installation Complete!');
  const summaryLines = [
    `Server:     ${C.dim}${SERVER_PATH}${C.reset}`,
    `Migration:  ${C.dim}${MIGRATE_PATH}${C.reset}`,
    `Database:   ${C.dim}${DB_PATH}${C.reset}`,
    `MCP Config: ${C.dim}${MCP_CONFIG_PATH}${C.reset}`,
    `GEMINI.md:  ${C.dim}${GEMINI_MD_PATH}${C.reset}`,
    `AGENTS.md:  ${C.dim}${AGENTS_MD_PATH}${C.reset}`,
    `Cursor MCP: ${C.dim}${cursorManager.CURSOR_MCP_GLOBAL}${C.reset}`,
    `Cursor Agents: ${C.dim}${cursorManager.CURSOR_AGENTS_GLOBAL}${C.reset}`,
  ];
  if (claudeInstalled) {
    summaryLines.push(`Claude Code:  ${C.dim}${mcpClientsManager.CLAUDE_JSON}${C.reset}`);
  }
  if (opencodeInstalled) {
    summaryLines.push(`OpenCode:     ${C.dim}${mcpClientsManager.OPENCODE_GLOBAL}${C.reset}`);
  }
  drawBox('Installed Files', summaryLines, LEAF_THEME);
  log('');

  info(`${C.bold}Next steps:${C.reset}`);
  log(`  1. Restart your agentic IDE/CLI (Antigravity, Cursor${claudeInstalled ? ', Claude Code' : ''}${opencodeInstalled ? ', OpenCode' : ''}) to load MCP servers`);
  log(`  2. Test execution: ${C.cyan}konoha test${C.reset}`);
  log(`  3. Check status:   ${C.cyan}konoha status${C.reset}`);
  log('');
}

function installUv(silent = false) {
  if (!silent) info('Attempting to auto-install "uv" for Semble MCP...');
  try {
    const stdioOpt = silent ? 'ignore' : 'inherit';
    if (process.platform === 'win32') {
      execSync('powershell -ExecutionPolicy Bypass -Command "irm https://astral.sh/uv/install.ps1 | iex"', { stdio: stdioOpt });
    } else {
      execSync('curl -LsSf https://astral.sh/uv/install.sh | sh', { stdio: stdioOpt });
    }
    if (!silent) success('uv installed successfully!');
    return true;
  } catch (err) {
    if (!silent) {
      warn(`Failed to auto-install uv: ${err.message}`);
      log('Please install uv manually: https://docs.astral.sh/uv/');
    }
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

function getUvxCommand() {
  const uvCmd = getUvCommand();
  if (!uvCmd) return 'uvx';
  if (uvCmd !== 'uv') {
    const companionUvx = path.join(path.dirname(uvCmd), process.platform === 'win32' ? 'uvx.exe' : 'uvx');
    if (fileExists(companionUvx)) {
      return companionUvx;
    }
  }
  return 'uvx';
}

function registerMcp(python, silent = false, allowAutoApprove = true) {
  const pythonCmd = python || checkPython() || 'python3';
  
  ensureDir(path.dirname(MCP_CONFIG_PATH));

  let config = { mcpServers: {} };

  if (fileExists(MCP_CONFIG_PATH)) {
    try {
      config = JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, 'utf-8'));
      if (!config.mcpServers) config.mcpServers = {};
      if (!silent) {
        info('Existing MCP config found, registering servers...');
      }
    } catch {
      if (!silent) {
        warn(`Skipped MCP config update: invalid JSON in ${MCP_CONFIG_PATH}`);
      }
      return;
    }
  } else {
    if (!silent) {
      info('Creating new MCP config...');
    }
  }

  const skillsDbConfig = {
    command: pythonCmd,
    args: [SERVER_PATH]
  };
  if (allowAutoApprove) {
    skillsDbConfig.autoApprove = ['*', 'find_skill', 'list_skills', 'get_skill', 'optimize_report'];
  }
  // Only update if missing or command/args changed
  const existingSkillsDb = config.mcpServers['skills-db'];
  if (!existingSkillsDb || existingSkillsDb.command !== pythonCmd ||
      !existingSkillsDb.args || existingSkillsDb.args[0] !== SERVER_PATH) {
    config.mcpServers['skills-db'] = skillsDbConfig;
  }

  let uvCmd = getUvCommand();
  if (!uvCmd) {
    if (installUv(silent)) {
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

  const sembleConfig = {
    command: uvxCmd,
    args: ['--from', 'semble[mcp]@latest', 'semble', '--content', 'all']
  };
  if (allowAutoApprove) {
    sembleConfig.autoApprove = ['*', 'search', 'find_related'];
  }
  // Only update if missing or command/args changed
  const existingSemble = config.mcpServers['semble'];
  if (
    !existingSemble ||
    existingSemble.command !== uvxCmd ||
    JSON.stringify(existingSemble.args || []) !== JSON.stringify(sembleConfig.args)
  ) {
    config.mcpServers['semble'] = sembleConfig;
  }

  const nodeCmd = process.execPath;
  const fileToolsConfig = deployUtils.buildKonohaFilesMcpEntry('execPath');
  if (fileToolsConfig && allowAutoApprove) {
    fileToolsConfig.autoApprove = [
      '*',
      'read_file_head',
      'read_file_range',
      'file_info',
      'token_efficient_grep',
      'get_file_structure',
      'find_files_clean'
    ];
  }
  const existingFileTools = config.mcpServers['konoha-files'];
  if (fileToolsConfig) {
    if (
      !existingFileTools ||
      existingFileTools.command !== fileToolsConfig.command ||
      JSON.stringify(existingFileTools.args || []) !== JSON.stringify(fileToolsConfig.args || [])
    ) {
      config.mcpServers['konoha-files'] = fileToolsConfig;
    }
  } else if (existingFileTools) {
    delete config.mcpServers['konoha-files'];
  }

  if (!silent) {
    success(`Registered 'semble' using command: ${uvxCmd}`);
  }

  fs.writeFileSync(MCP_CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
  if (!silent) {
    success(`MCP config updated with skills-db and semble: ${MCP_CONFIG_PATH}`);
  }

  if (allowAutoApprove) {
    registerPermissions(silent);
  }
}

function registerPermissions(silent = false) {
  const settingsPaths = [
    SETTINGS_PATH,
    path.join(HOME, '.gemini', 'settings.json')
  ];

  for (const settingsPath of settingsPaths) {
    ensureDir(path.dirname(settingsPath));

    let settings = {};
    if (fileExists(settingsPath)) {
      try {
        settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      } catch {
        settings = {};
      }
    }

    if (!settings.permissions) settings.permissions = {};
    if (!settings.permissions.allow) settings.permissions.allow = [];

    const requiredGrants = [
      'command(node bin/cli.js)',
      'command(konoha)',
      'command(node "' + path.join(SKILLS_DB_DIR, 'prompt_hook.js') + '")',
      'mcp(semble/search)',
      'mcp(semble/find_related)',
      'mcp(semble/*)',
      'mcp(konoha-files/read_file_head)',
      'mcp(konoha-files/read_file_range)',
      'mcp(konoha-files/file_info)',
      'mcp(konoha-files/token_efficient_grep)',
      'mcp(konoha-files/get_file_structure)',
      'mcp(konoha-files/find_files_clean)',
      'mcp(konoha-files/*)',
      'mcp(skills-db/find_skill)',
      'mcp(skills-db/list_skills)',
      'mcp(skills-db/get_skill)',
      'mcp(skills-db/optimize_report)',
      'mcp(skills-db/*)'
    ];

    let updated = false;
    for (const grant of requiredGrants) {
      if (!settings.permissions.allow.includes(grant)) {
        settings.permissions.allow.push(grant);
        updated = true;
      }
    }

    if (updated) {
      try {
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
        if (!silent) {
          success(`Command permissions auto-approved in: ${settingsPath}`);
        }
      } catch (e) {
        if (!silent) {
          warn(`Could not update settings.json: ${e.message}`);
        }
      }
    } else {
      if (!silent) {
        info(`Command permissions for Konoha already configured in ${settingsPath}`);
      }
    }
  }
}

function unregisterPermissions(silent = false) {
  const settingsPaths = [
    SETTINGS_PATH,
    path.join(HOME, '.gemini', 'settings.json')
  ];

  for (const settingsPath of settingsPaths) {
    if (!fileExists(settingsPath)) continue;

    let settings = {};
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    } catch {
      continue;
    }

    if (settings.permissions && settings.permissions.allow) {
      const requiredGrants = [
        'command(node bin/cli.js)',
        'command(konoha)',
        'command(node "' + path.join(SKILLS_DB_DIR, 'prompt_hook.js') + '")',
        'mcp(semble/search)',
        'mcp(semble/find_related)',
        'mcp(semble/*)',
        'mcp(konoha-files/read_file_head)',
        'mcp(konoha-files/read_file_range)',
        'mcp(konoha-files/file_info)',
        'mcp(konoha-files/token_efficient_grep)',
        'mcp(konoha-files/get_file_structure)',
        'mcp(konoha-files/find_files_clean)',
        'mcp(konoha-files/*)',
        'mcp(skills-db/find_skill)',
        'mcp(skills-db/list_skills)',
        'mcp(skills-db/get_skill)',
        'mcp(skills-db/optimize_report)',
        'mcp(skills-db/*)'
      ];

      const initialLength = settings.permissions.allow.length;
      settings.permissions.allow = settings.permissions.allow.filter(
        (grant) => !requiredGrants.includes(grant)
      );

      if (settings.permissions.allow.length !== initialLength) {
        try {
          fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
          if (!silent) {
            success(`Removed command permissions from: ${settingsPath}`);
          }
        } catch (e) {
          if (!silent) {
            warn(`Could not update settings.json: ${e.message}`);
          }
        }
      }
    }
  }
}

function registerHooks(silent = false, allowHooks) {
  const HOOKS_CONFIG_PATH = path.join(HOME, '.gemini', 'config', 'hooks.json');
  ensureDir(path.dirname(HOOKS_CONFIG_PATH));

  let config = {};
  if (fileExists(HOOKS_CONFIG_PATH)) {
    try {
      config = JSON.parse(fs.readFileSync(HOOKS_CONFIG_PATH, 'utf-8'));
    } catch (e) {
      config = {};
    }
  }

  const promptHookPath = path.join(SKILLS_DB_DIR, 'prompt_hook.js');
  const subagentHookPath = path.join(SKILLS_DB_DIR, 'antigravity_subagent_hook.js');
  const sanitizeHookPath = path.join(SKILLS_DB_DIR, 'antigravity_tool_sanitize_hook.js');
  const hookExists = config['konoha-prompt-hook'] !== undefined;
  const sanitizeExists = config['konoha-tool-sanitize'] !== undefined;
  const legacySubagentHook = config['konoha-subagent-hook'] !== undefined;

  let shouldWrite = false;

  if (allowHooks === true) {
    delete config['konoha-subagent-hook'];
    config['konoha-prompt-hook'] = {
      PreInvocation: [
        { type: 'command', command: `node "${subagentHookPath}"` },
        { type: 'command', command: `node "${promptHookPath}"` },
      ],
    };
    config['konoha-tool-sanitize'] = {
      PreToolUse: [
        {
          matcher: 'define_subagent|invoke_subagent',
          hooks: [{ type: 'command', command: `node "${sanitizeHookPath}"`, timeout: 10 }],
        },
      ],
    };
    shouldWrite = true;
  } else if (allowHooks === false) {
    if (hookExists) {
      delete config['konoha-prompt-hook'];
      shouldWrite = true;
    }
    if (sanitizeExists) {
      delete config['konoha-tool-sanitize'];
      shouldWrite = true;
    }
    if (legacySubagentHook) {
      delete config['konoha-subagent-hook'];
      shouldWrite = true;
    }
  } else if (allowHooks === undefined) {
    if (hookExists) {
      config['konoha-prompt-hook'] = {
        PreInvocation: [
          { type: 'command', command: `node "${subagentHookPath}"` },
          { type: 'command', command: `node "${promptHookPath}"` },
        ],
      };
      config['konoha-tool-sanitize'] = {
        PreToolUse: [
          {
            matcher: 'define_subagent|invoke_subagent',
            hooks: [{ type: 'command', command: `node "${sanitizeHookPath}"`, timeout: 10 }],
          },
        ],
      };
      delete config['konoha-subagent-hook'];
      shouldWrite = true;
    }
  }

  if (shouldWrite) {
    try {
      fs.writeFileSync(HOOKS_CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
      if (!silent) {
        if (allowHooks === false) {
          success(`Removed prompt hook from: ${HOOKS_CONFIG_PATH}`);
        } else {
          success(`Registered prompt hook in: ${HOOKS_CONFIG_PATH}`);
        }
      }
    } catch (e) {
      if (!silent) {
        warn(`Could not update hooks.json: ${e.message}`);
      }
    }
  }
}

function copyIfDifferent(src, dest) {
  if (!fileExists(dest)) {
    copyFile(src, dest);
    return true;
  }
  try {
    const srcContent = fs.readFileSync(src);
    const destContent = fs.readFileSync(dest);
    if (!srcContent.equals(destContent)) {
      copyFile(src, dest);
      return true;
    }
  } catch (e) {
    try { copyFile(src, dest); return true; } catch {}
  }
  return false;
}

function copyRecursive(src, dest) {
  const stats = fs.statSync(src);
  if (stats.isDirectory()) {
    ensureDir(dest);
    const entries = fs.readdirSync(src);
    for (const entry of entries) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    copyFile(src, dest);
  }
}

function copyRecursiveIfDifferent(src, dest) {
  let stats;
  try {
    stats = fs.statSync(src);
  } catch {
    return;
  }
  if (stats.isDirectory()) {
    ensureDir(dest);
    const entries = fs.readdirSync(src);
    for (const entry of entries) {
      copyRecursiveIfDifferent(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    copyIfDifferent(src, dest);
  }
}

function smokeTestKonohaFilesMcp(useLauncher = false) {
  if (!fileExists(FILE_TOOLS_MCP_PATH)) {
    return { ok: false, error: 'file_tools_mcp.js missing' };
  }

  const input = [
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"konoha-doctor","version":"1.0"}}}',
    '{"jsonrpc":"2.0","method":"notifications/initialized"}',
    '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
  ].join('\n');

  let run;
  if (useLauncher) {
    const entry = deployUtils.buildKonohaFilesMcpEntry('cursor');
    if (entry) {
      run = spawnSync(entry.command, entry.args, {
        input,
        encoding: 'utf-8',
        timeout: 15000,
        shell: process.platform === 'win32'
      });
    }
  }
  if (!run || run.status !== 0) {
    run = spawnSync(process.execPath, [FILE_TOOLS_MCP_PATH], {
      input,
      encoding: 'utf-8',
      timeout: 15000
    });
  }

  if (run.status !== 0) {
    return { ok: false, error: (run.stderr || '').trim() || `exit code ${run.status}` };
  }

  try {
    const lines = (run.stdout || '').trim().split('\n').filter(Boolean);
    const response = JSON.parse(lines[lines.length - 1]);
    const tools = response.result && response.result.tools;
    if (!Array.isArray(tools) || tools.length < 4) {
      return { ok: false, error: `tools/list returned ${tools ? tools.length : 0} tools` };
    }
    return { ok: true, toolCount: tools.length };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function installFileTools(silent = true) {
  const python = checkPython();
  const ok = deployUtils.installFileTools(silent, python);
  if (!silent && ok) {
    success(`File tools installed: ${FILE_TOOLS_MCP_PATH}`);
  }
  return ok;
}

function ensureAutoSetup() {
  // 1. Ensure the directories exist
  const dirs = [
    path.join(HOME, '.gemini'),
    path.join(HOME, '.agents'),
    SKILLS_DB_DIR,
    path.join(HOME, '.gemini', 'antigravity-cli'),
    path.join(HOME, '.gemini', 'config'),
    path.join(HOME, '.cursor'),
    path.join(HOME, '.cursor', 'agents')
  ];
  dirs.forEach(d => {
    if (!fileExists(d)) {
      ensureDir(d);
    }
  });

  // 2. Copy the Python server files if missing or outdated
  const filesToCopy = ['server.py', 'migrate.py', 'db_stats.py', 'db_savings.py', 'agent_stats.py', 'prompt_hook.js', 'antigravity_subagent_hook.js', 'antigravity_tool_sanitize_hook.js', 'antigravity_manager.js', 'cursor_bootstrap.js'];
  filesToCopy.forEach(f => {
    const src = path.join(SRC_DIR, f);
    const dest = path.join(SKILLS_DB_DIR, f);
    if (fileExists(src)) {
      copyIfDifferent(src, dest);
    }
  });
  installFileTools(true);

  // Also copy basic subagent skills to global directory if missing or outdated
  const pkgSkillsDir = path.join(__dirname, '..', '.agents', 'skills');
  const globalSkillsDir = path.join(HOME, '.agents', 'skills');
  if (fileExists(pkgSkillsDir)) {
    ensureDir(globalSkillsDir);
    try {
      const files = fs.readdirSync(pkgSkillsDir, { withFileTypes: true });
      files.forEach(entry => {
        const name = entry.name;
        if (entry.isDirectory()) {
          if (name.endsWith('-skill')) {
            const srcPath = path.join(pkgSkillsDir, name);
            const destPath = path.join(globalSkillsDir, name);
            copyRecursiveIfDifferent(srcPath, destPath);
          }
        } else if (entry.isFile()) {
          if (name.endsWith('-skill.md')) {
            const srcPath = path.join(pkgSkillsDir, name);
            const destPath = path.join(globalSkillsDir, name);
            copyRecursiveIfDifferent(srcPath, destPath);
          }
        }
      });
    } catch (err) {}
  }

  // 3 & 4. Configure settings.json permissions & register skills-db and semble in mcp_config.json silently
  const python = checkPython() || 'python3';
  registerMcp(python, true);
  registerHooks(true, true);

  // 5. Ensure agents.json is initialized with defaults if missing
  const agentsJsonPath = path.join(HOME, '.agents', 'agents.json');
  if (!fileExists(agentsJsonPath)) {
    try {
      agentManager.loadAgents(); // Silently initializes USER_AGENTS_JSON_PATH if missing
    } catch (e) {}
  }

  // 6. Ensure GEMINI.md, AGENTS.md, subagents, and client integrations are fully deployed/updated
  const originalLog = console.log;
  console.log = () => {};
  try {
    const uvxCmd = getUvxCommand();
    agentManager.regenerateAndDeploy({
      pythonCmd: python,
      serverPath: SERVER_PATH,
      uvxCmd,
      projectRoot: currentCwd,
      deployProject: false,
      silent: true
    });
  } catch (e) {
    // ignore
  } finally {
    console.log = originalLog;
  }

  // 7. Silently trigger migration if database file (skills.db) is missing
  if (!fileExists(DB_PATH)) {
    if (fileExists(pkgSkillsDir)) {
      const skills = detectCustomSkills(pkgSkillsDir);
      if (skills.length > 0) {
        try {
          spawnSync(python, [MIGRATE_PATH, '--skills-dir', pkgSkillsDir, '--skills', ...skills], {
            encoding: 'utf-8', cwd: SKILLS_DB_DIR, timeout: 30000
          });
        } catch (e) {
          try {
            spawnSync(python, [MIGRATE_PATH], {
              encoding: 'utf-8', cwd: SKILLS_DB_DIR, timeout: 30000
            });
          } catch (e2) {}
        }
      }
    } else {
      try {
        spawnSync(python, [MIGRATE_PATH], {
          encoding: 'utf-8', cwd: SKILLS_DB_DIR, timeout: 30000
        });
      } catch (e) {}
    }
  }
}

function updateGeminiMd(silent = false) {
  agentManager.regenerateAndDeploy(silent);
}

function updateAgentsMd(silent = false) {
  agentManager.regenerateAndDeploy(silent);
}

async function cmdMigrate(args) {
  await chidoriTransition('migrate');
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
      const run = spawnSync(python, [MIGRATE_PATH, '--clean', '--skills-dir', customDir], {
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
        const runFallback = spawnSync(python, [MIGRATE_PATH, '--clean'], {
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
      let isFirst = true;
      for (const s of skillsDirs) {
        const skills = detectCustomSkills(s.path);
        if (skills.length === 0) continue;

        info(`Migrating from: ${s.path}`);
        try {
          const argsList = [MIGRATE_PATH, '--skills-dir', s.path, '--skills', ...skills];
          if (isFirst) {
            argsList.push('--clean');
            isFirst = false;
          }
          const run = spawnSync(python, argsList, {
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

async function cmdTest() {
  await chidoriTransition('test');
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

  let tempTestDir = '';
  try {
    tempTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-test-'));
    fs.writeFileSync(path.join(tempTestDir, 'index.css'), '/* test style */');
  } catch (e) {
    warn(`Could not create temp directory for build_from_source test: ${e.message}`);
  }

  const buildFromSourceDir = tempTestDir || 'src';
  const buildFromSourceReq = JSON.stringify({
    jsonrpc: "2.0",
    id: 8,
    method: "tools/call",
    params: {
      name: "build_from_source",
      arguments: {
        name: "test_build",
        source_dir: buildFromSourceDir,
        framework: "nextjs",
        agent: "jonin"
      }
    }
  });

  const tests = [
    { name: 'Initialize', req: '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' },
    { name: 'List Tools', req: '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' },
    { name: 'Find Skill (genin-skill)', req: '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"find_skill","arguments":{"keyword":"genin-skill","agent":"genin"}}}' },
    { name: 'Find Skill (security)', req: '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"find_skill","arguments":{"keyword":"security","agent":"kage"}}}' },
    { name: 'List Skills', req: '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"list_skills","arguments":{"agent":"chunin"}}}' },
    { name: 'Get Skill (anbu-skill)', req: '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"get_skill","arguments":{"name":"anbu-skill","agent":"anbu"}}}' },
    { name: 'Get Skill (tokubetsu-jonin-skill)', req: '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"get_skill","arguments":{"name":"tokubetsu-jonin-skill","agent":"tokubetsu-jonin"}}}' },
    { name: 'Build from Source', req: buildFromSourceReq },
    { name: 'Build from Text', req: '{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"build_from_text","arguments":{"name":"test_build","description":"a dummy storefront","framework":"nextjs","agent":"jonin"}}}' }
  ];

  if (fileExists(FILE_TOOLS_MCP_PATH)) {
    const workspaceUri = JSON.stringify(path.join(SRC_DIR, '..'));
    tests.push(
      { name: 'File Tools List', req: '{"jsonrpc":"2.0","id":8,"method":"tools/list","params":{}}', useNode: true },
      {
        name: 'Read File Head',
        req: `{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"read_file_head","arguments":{"path":"src/search_policy.js","max_lines":5}}}`,
        useNode: true,
        init: `{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"rootPath":${workspaceUri}}}`
      },
      {
        name: 'Read File Range',
        req: `{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"read_file_range","arguments":{"path":"src/search_policy.js","start_line":1,"end_line":5}}}`,
        useNode: true,
        init: `{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"rootPath":${workspaceUri}}}`
      },
      {
        name: 'File Info',
        req: `{"jsonrpc":"2.0","id":11,"method":"tools/call","params":{"name":"file_info","arguments":{"path":"src/search_policy.js"}}}`,
        useNode: true,
        init: `{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"rootPath":${workspaceUri}}}`
      },
      {
        name: 'Token Efficient Grep',
        req: `{"jsonrpc":"2.0","id":12,"method":"tools/call","params":{"name":"token_efficient_grep","arguments":{"pattern":"buildSembleSearchPolicy","dir":"src"}}}`,
        useNode: true,
        init: `{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"rootPath":${workspaceUri}}}`
      },
      {
        name: 'Get File Structure',
        req: `{"jsonrpc":"2.0","id":13,"method":"tools/call","params":{"name":"get_file_structure","arguments":{"path":"src/file_tools_router.js"}}}`,
        useNode: true,
        init: `{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"rootPath":${workspaceUri}}}`
      },
      {
        name: 'Find Files Clean',
        req: `{"jsonrpc":"2.0","id":14,"method":"tools/call","params":{"name":"find_files_clean","arguments":{"pattern":"*.py","dir":"src/file_tools"}}}`,
        useNode: true,
        init: `{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"rootPath":${workspaceUri}}}`
      }
    );
  }

  let allPassed = true;

  try {
    for (const test of tests) {
      try {
        const inputParts = [];
        if (test.init) inputParts.push(test.init);
        inputParts.push(test.req);
        const input = inputParts.join('\n');

        const run = test.useNode
          ? spawnSync(process.execPath, [FILE_TOOLS_MCP_PATH], {
              input,
              encoding: 'utf-8',
              timeout: 15000,
              cwd: path.join(SRC_DIR, '..')
            })
          : spawnSync(python, [SERVER_PATH], {
              input: test.req,
              encoding: 'utf-8',
              timeout: 10000,
              cwd: path.join(SRC_DIR, '..')
            });
        if (run.status !== 0) throw new Error(run.stderr || 'Execution failed');
        const lines = run.stdout.trim().split('\n').filter(Boolean);
        const response = JSON.parse(lines[lines.length - 1]);
        if (response.error) {
          error(`${test.name}: ${response.error.message}`);
          allPassed = false;
        } else {
          // Parse tool content response to check for tool-level errors
          let toolError = null;
          try {
            const content = JSON.parse(response.result.content[0].text);
            if (content.error) {
              toolError = content.error;
            }
          } catch (e) {}

          if (toolError) {
            error(`${test.name}: FAILED - ${toolError}`);
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

            if (test.name === 'Get Skill (anbu-skill)') {
              try {
                const content = JSON.parse(response.result.content[0].text);
                info(`  Retrieved skill: ${content.name} (${content.byte_size} bytes)`);
              } catch {}
            }
          }
        }
      } catch (e) {
        error(`${test.name}: FAILED - ${e.message}`);
        allPassed = false;
      }
    }
  } finally {
    if (tempTestDir) {
      try {
        fs.rmSync(tempTestDir, { recursive: true, force: true });
      } catch (e) {}
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

async function cmdStatus() {
  await chidoriTransition('status');
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

  sectionTitle('Environment & Files:', LEAF_THEME);
  const envHeaders = ['Resource / Path', 'Status', 'Size', 'Location'];
  const envAligns = ['left', 'left', 'right', 'left'];
  const envRows = [];
  const envRowColors = [];

  // Python Status Row
  if (python) {
    envRows.push(['Python 3', 'ACTIVE', '-', pythonInfo]);
    envRowColors.push(['', '', '', '']);
  } else {
    envRows.push(['Python 3', 'MISSING', '-', 'Please install Python 3']);
    envRowColors.push(['', '', '', '']);
  }

  // File rows
  checks.forEach(check => {
    if (fileExists(check.path)) {
      const stats = fs.statSync(check.path);
      const sizeStr = `${(stats.size / 1024).toFixed(1)} KB`;
      const displayPath = check.path.replace(HOME, '~');
      envRows.push([check.label, 'EXISTS', sizeStr, displayPath]);
      envRowColors.push(['', '', '', '']);
    } else {
      envRows.push([check.label, 'MISSING', '-', check.path]);
      envRowColors.push(['', '', '', '']);
    }
  });

  const envWidths = computeTableWidths(envHeaders, envRows, {
    minWidths: [14, 8, 8, 36],
    maxWidths: [24, 10, 12, 64]
  });
  drawTable(envHeaders, envWidths, envAligns, envRows, envRowColors, LEAF_THEME, {
    columnFormatters: [
      (cell) => applyGradient(cell.trimEnd(), NINJA_THEME, 0.9) + cell.slice(cell.trimEnd().length),
      gradientStatusCell,
      (cell) => applyGradient(cell, CHIDORI_THEME, 0.8),
      (cell) => applyGradient(cell, CHIDORI_THEME, 0.7)
    ]
  });

  // Check MCP configs
  sectionTitle('MCP Integrations:', RASENGAN_THEME);
  if (fileExists(MCP_CONFIG_PATH)) {
    try {
      const config = JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, 'utf-8'));

      const printMcpRow = (name) => {
        const hasServer = config.mcpServers && config.mcpServers[name];
        const cmdStr = hasServer ? `cmd: ${config.mcpServers[name].command} ${config.mcpServers[name].args.join(' ')}` : '-';
        drawIntegrationRow(name, hasServer, cmdStr, RASENGAN_THEME);
      };

      printMcpRow('skills-db');
      printMcpRow('semble');
      printMcpRow('konoha-files');
    } catch {
      error('MCP config parse failed');
    }
  } else {
    warn('MCP config not found');
  }

  // Cursor IDE/CLI integrations
  sectionTitle('Cursor IDE/CLI Integrations:', NINJA_THEME);
  const cursorStatus = cursorManager.getCursorStatus();
  drawIntegrationRow(
    '~/.cursor/mcp.json',
    cursorStatus.mcpSkillsDb && cursorStatus.mcpSemble && cursorStatus.mcpKonohaFiles,
    cursorStatus.mcpGlobal ? 'skills-db + semble + konoha-files' : 'not configured',
    NINJA_THEME
  );
  drawIntegrationRow(
    'Cursor subagents',
    cursorStatus.subagentsGlobal >= 6,
    `${cursorStatus.subagentsGlobal}/6 in ~/.cursor/agents/`,
    NINJA_THEME
  );
  drawIntegrationRow(
    'Cursor skills',
    cursorStatus.skillsGlobal > 0,
    `${cursorStatus.skillsGlobal} in ~/.cursor/skills/ (mirrored from ~/.agents/skills/)`,
    NINJA_THEME
  );
  drawIntegrationRow(
    'CLI permissions',
    cursorStatus.cliPermissions,
    cursorStatus.cliPermissions ? 'MCP auto-allow configured' : 'run konoha init',
    NINJA_THEME
  );
  drawIntegrationRow(
    'sessionStart hook',
    cursorStatus.hooks,
    cursorStatus.hooks ? 'auto-bootstrap on session' : 'not registered',
    NINJA_THEME
  );
  drawIntegrationRow(
    'Project .cursor/',
    cursorStatus.projectMcp,
    `mcp:${cursorStatus.projectMcp ? 'yes' : 'no'} agents:${cursorStatus.projectAgents} skills:${cursorStatus.skillsProject} rule:${cursorStatus.projectRule ? 'yes' : 'no'}`,
    NINJA_THEME
  );

  // Claude Code integration (auto-configured when `claude` CLI is installed)
  const claudeStatus = mcpClientsManager.getClaudeCodeStatus();
  if (claudeStatus.installed) {
    sectionTitle('Claude Code Integrations:', NINJA_THEME);
    const claudeOk = claudeStatus.mcpSkillsDb && claudeStatus.mcpSemble && claudeStatus.mcpKonohaFiles && claudeStatus.permissionsAllowed;
    drawIntegrationRow(
      '~/.claude.json',
      claudeOk,
      claudeStatus.permissionsAllowed ? 'skills-db + semble + konoha-files' : 'skills-db + semble + konoha-files (permissions missing)',
      NINJA_THEME
    );
    if (claudeStatus.agentsCount > 0) {
      drawIntegrationRow(
        'Claude subagents',
        true,
        `${claudeStatus.agentsCount}/6 in ~/.claude/agents/`,
        NINJA_THEME
      );
    }
  } else {
    log(`\n  ${applyGradient('Claude Code:', CHIDORI_THEME, 0.85)} ${applyGradient('not installed (template: docs/templates/claude-code.mcp.json)', CHIDORI_THEME, 0.6)}`);
  }

  // OpenCode integration (auto-configured when `opencode` CLI is installed)
  const openCodeStatus = mcpClientsManager.getOpenCodeStatus();
  if (openCodeStatus.installed) {
    sectionTitle('OpenCode Integrations:', NINJA_THEME);
    drawIntegrationRow(
      '~/.config/opencode/',
      openCodeStatus.mcpSkillsDb && openCodeStatus.mcpSemble && openCodeStatus.mcpKonohaFiles,
      openCodeStatus.globalConfig ? 'skills-db + semble + konoha-files' : 'not configured',
      NINJA_THEME
    );
  } else {
    log(`\n  ${applyGradient('OpenCode:', CHIDORI_THEME, 0.85)} ${applyGradient('not installed (template: docs/templates/opencode.mcp.json)', CHIDORI_THEME, 0.6)}`);
  }

  // Check instructions patterns
  if (fileExists(GEMINI_MD_PATH)) {
    try {
      const content = fs.readFileSync(GEMINI_MD_PATH, 'utf-8');
      const hasSkillsDb = content.includes('find_skill');
      drawIntegrationRow(
        'GEMINI.md instructions',
        hasSkillsDb,
        hasSkillsDb ? 'skills-db active' : 'not found',
        LEAF_THEME
      );
    } catch {}
  }

  // Subagents list
  sectionTitle('Subagents (Naruto Ninja Ranks):', NINJA_THEME);
  const agents = agentManager.loadAgents();
  const iconMap = {
    'genin': '🍃',
    'chunin': '📜',
    'jonin': '🛡️',
    'anbu': '👥',
    'tokubetsu-jonin': '🎯',
    'kage': '🌀'
  };

  const subHeaders = [
    'Rank / Name',
    'Model (Antigravity)',
    'Model (Cursor)',
    'Model (Claude)',
    'Model (OpenCode)',
    'Skills Configuration'
  ];
  const subAligns = ['left', 'left', 'left', 'left', 'left', 'left'];
  const subRows = [];
  const subRowColors = [];

  agents.forEach(a => {
    const icon = a.icon || iconMap[a.name] || '👤';
    const displayName = `${icon} ${a.name.charAt(0).toUpperCase() + a.name.slice(1)}`;
    const agyModel = a.modelTier || '-';
    const cursorModel = a.cursorModel || cursorManager.resolveCursorModel(a);
    const claudeModel = a.claudeModel || 'Claude Sonnet 4.6 (Thinking)';
    const opencodeModel = a.opencodeModel || 'inherit';
    const activeSkills = a.skills && a.skills.length > 0 ? a.skills.join(', ') : 'None';

    subRows.push([displayName, agyModel, cursorModel, claudeModel, opencodeModel, activeSkills]);
    subRowColors.push(['', '', '', '', '', '']);
  });

  const subWidths = computeTableWidths(subHeaders, subRows, {
    minWidths: [18, 24, 16, 28, 16, 24],
    maxWidths: [24, 40, 24, 40, 24, 48]
  });
  drawTable(subHeaders, subWidths, subAligns, subRows, subRowColors, NINJA_THEME, {
    columnFormatters: [
      (cell) => applyGradient(cell.trimEnd(), NINJA_THEME, 0.92) + cell.slice(cell.trimEnd().length),
      (cell) => applyGradient(cell, FIRE_THEME, 0.85),
      (cell) => applyGradient(cell, RASENGAN_THEME, 0.85),
      (cell) => applyGradient(cell, LEAF_THEME, 0.85),
      (cell) => applyGradient(cell, CHIDORI_THEME, 0.85),
      (cell) => applyGradient(cell, NINJA_THEME, 0.8)
    ]
  });

  // Database stats
  sectionTitle('Database Stats:', LEAF_THEME);
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
          success('SQLite FTS5 database is healthy:');
          const statRows = [
            ['Total Entries', String(stats.total)],
            ['Unique Skills', String(stats.skills)],
            ['Reference Files', String(stats.refs)],
            ['Indexed size', `${(stats.bytes / 1024).toFixed(1)} KB`]
          ];
          const statHeaders = ['Metric', 'Value'];
          const statWidths = computeTableWidths(statHeaders, statRows, { minWidths: [16, 12] });
          drawTable(statHeaders, statWidths, ['left', 'left'], statRows, [], LEAF_THEME, {
            columnFormatters: [
              (cell) => applyGradient(cell, CHIDORI_THEME, 0.85),
              (cell) => applyGradient(cell, LEAF_THEME, 0.95)
            ]
          });
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
  sectionTitle('Skills Directories:', LEAF_THEME);
  const skillsDirs = detectSkillsDirs();
  if (skillsDirs.length > 0) {
    const dirRows = skillsDirs.map(s => [s.path.replace(HOME, '~'), `${s.count} skills`]);
    const dirHeaders = ['Path', 'Count'];
    const dirWidths = computeTableWidths(dirHeaders, dirRows, { minWidths: [24, 10] });
    drawTable(dirHeaders, dirWidths, ['left', 'left'], dirRows, [], LEAF_THEME, {
      columnFormatters: [
        (cell) => applyGradient(cell, CHIDORI_THEME, 0.8),
        (cell) => applyGradient(cell, LEAF_THEME, 0.95)
      ]
    });
  } else {
    warn('No skills directories found');
  }

  log('');
}

async function cmdDoctor() {
  await chidoriTransition('doctor');
  drawLogo(false); // Static logo
  header('🩺 Konoha Doctor');
  log(`${applyGradient('Diagnosing environment requirements and auto-repairing missing components...', CHIDORI_THEME, 0.75)}\n`);

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

  // 5c. Prompt Hook Script
  const promptHookScriptDest = path.join(SKILLS_DB_DIR, 'prompt_hook.js');
  checkAndRepairFile('prompt_hook.js', promptHookScriptDest, 'Prompt Hook Script (prompt_hook.js)');

  const subagentHookScriptDest = path.join(SKILLS_DB_DIR, 'antigravity_subagent_hook.js');
  checkAndRepairFile('antigravity_subagent_hook.js', subagentHookScriptDest, 'Subagent Hook Script (antigravity_subagent_hook.js)');

  const antigravityManagerScriptDest = path.join(SKILLS_DB_DIR, 'antigravity_manager.js');
  checkAndRepairFile('antigravity_manager.js', antigravityManagerScriptDest, 'Antigravity Manager Script (antigravity_manager.js)');

  const sanitizeHookScriptDest = path.join(SKILLS_DB_DIR, 'antigravity_tool_sanitize_hook.js');
  checkAndRepairFile('antigravity_tool_sanitize_hook.js', sanitizeHookScriptDest, 'Tool Sanitize Hook (antigravity_tool_sanitize_hook.js)');

  // 5d. Token-efficient file tools (konoha-files MCP)
  checkAndRepairFile('file_tools_mcp.js', FILE_TOOLS_MCP_PATH, 'File Tools MCP (file_tools_mcp.js)');
  checkAndRepairFile('file_tools_router.js', FILE_TOOLS_ROUTER_PATH, 'File Tools Router (file_tools_router.js)');
  checkAndRepairFile('file_tools_launcher.js', path.join(SKILLS_DB_DIR, 'file_tools_launcher.js'), 'File Tools Launcher (file_tools_launcher.js)');
  checkAndRepairFile('platform_utils.js', path.join(SKILLS_DB_DIR, 'platform_utils.js'), 'Platform Utils (platform_utils.js)');
  checkAndRepairFile('file_tools_launcher.sh', FILE_TOOLS_LAUNCHER_PATH, 'File Tools Launcher (file_tools_launcher.sh)');
  if (fileExists(FILE_TOOLS_LAUNCHER_PATH)) {
    try {
      fs.chmodSync(FILE_TOOLS_LAUNCHER_PATH, 0o755);
    } catch {}
  }
  deployUtils.writeNodeExecPathRecord();
  deployUtils.writePythonCmdRecord(checkPython());
  const srcPyDir = path.join(SRC_DIR, 'file_tools');
  if (fileExists(srcPyDir)) {
    try {
      ensureDir(FILE_TOOLS_PY_DIR);
      for (const entry of fs.readdirSync(srcPyDir)) {
        if (entry === '__pycache__') continue;
        const srcEntry = path.join(srcPyDir, entry);
        if (!fs.statSync(srcEntry).isFile()) continue;
        checkAndRepairFile(
          path.join('file_tools', entry),
          path.join(FILE_TOOLS_PY_DIR, entry),
          `File Tools Python (${entry})`
        );
      }
    } catch (e) {
      record('File Tools Python helpers', 'FAILED', e.message);
      hasErrors = true;
    }
  }
  if (!fileExists(FILE_TOOLS_MCP_PATH)) {
    try {
      installFileTools(true);
      if (fileExists(FILE_TOOLS_MCP_PATH)) {
        record('File Tools MCP (konoha-files)', 'REPAIRED', 'Installed konoha-files MCP server and Python helpers');
        repairsDone++;
      } else {
        record('File Tools MCP (konoha-files)', 'FAILED', 'file_tools_mcp.js missing after install');
        hasErrors = true;
      }
    } catch (e) {
      record('File Tools MCP (konoha-files)', 'FAILED', e.message);
      hasErrors = true;
    }
  }

  const fileToolsSmoke = smokeTestKonohaFilesMcp(true);
  if (fileToolsSmoke.ok) {
    record('konoha-files MCP smoke test', 'HEALTHY', `${fileToolsSmoke.toolCount} tools via launcher`);
  } else {
    const directSmoke = smokeTestKonohaFilesMcp(false);
    if (directSmoke.ok) {
      record('konoha-files MCP smoke test', 'WARNING', `Launcher failed (${fileToolsSmoke.error}); direct node OK (${directSmoke.toolCount} tools)`);
      try {
        installFileTools(true);
        const retry = smokeTestKonohaFilesMcp(true);
        if (retry.ok) {
          record('konoha-files launcher', 'REPAIRED', 'Launcher script refreshed');
          repairsDone++;
        }
      } catch {}
    } else {
      record('konoha-files MCP smoke test', 'FAILED', directSmoke.error || fileToolsSmoke.error);
      hasErrors = true;
    }
  }

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
  const nodeCmd = process.execPath;
  const expectedSembleArgs = ['--from', 'semble[mcp]@latest', 'semble', '--content', 'all'];
  let mcpHealthy = false;
  if (fileExists(MCP_CONFIG_PATH) && python) {
    try {
      const config = JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, 'utf-8'));
      const servers = config.mcpServers || {};
      const skillsOk = servers['skills-db'] &&
        servers['skills-db'].command === python &&
        servers['skills-db'].args &&
        servers['skills-db'].args[0] === SERVER_PATH;
      const sembleOk = servers['semble'] &&
        JSON.stringify(servers['semble'].args || []) === JSON.stringify(expectedSembleArgs);
      const fileToolsOk = servers['konoha-files'] &&
        servers['konoha-files'].args &&
        servers['konoha-files'].args[0] === FILE_TOOLS_MCP_PATH &&
        (servers['konoha-files'].command === nodeCmd || servers['konoha-files'].command === 'node');
      mcpHealthy = skillsOk && sembleOk && fileToolsOk;
    } catch {}
  }

  if (mcpHealthy) {
    record('MCP Config (mcp_config.json)', 'HEALTHY', 'skills-db, semble, and konoha-files are active');
  } else {
    if (!python) {
      record('MCP Config (mcp_config.json)', 'FAILED', 'Incomplete registration; missing Python 3');
      hasErrors = true;
    } else {
      try {
        registerMcp(python);
        record('MCP Config (mcp_config.json)', 'REPAIRED', 'Registered skills-db, semble, and konoha-files in config');
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
      if (content.includes('find_skill')) {
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

  // 9b. Prompt Hook Configuration (hooks.json)
  const HOOKS_CONFIG_PATH = path.join(HOME, '.gemini', 'config', 'hooks.json');
  let promptHookRegistered = false;
  let sanitizeHookRegistered = false;
  if (fileExists(HOOKS_CONFIG_PATH)) {
    try {
      const config = JSON.parse(fs.readFileSync(HOOKS_CONFIG_PATH, 'utf-8'));
      if (config['konoha-prompt-hook'] && config['konoha-prompt-hook'].PreInvocation) {
        const hooks = config['konoha-prompt-hook'].PreInvocation;
        const hasPrompt = hooks.some(hook => hook.command && hook.command.includes('prompt_hook.js'));
        const hasSubagent = hooks.some(hook => hook.command && hook.command.includes('antigravity_subagent_hook.js'));
        if (hasPrompt && hasSubagent) promptHookRegistered = true;
      }
      if (config['konoha-tool-sanitize'] && config['konoha-tool-sanitize'].PreToolUse) {
        const hasSanitize = config['konoha-tool-sanitize'].PreToolUse.some(
          (entry) => entry.hooks && entry.hooks.some((h) => h.command && h.command.includes('antigravity_tool_sanitize_hook.js'))
        );
        if (hasSanitize) sanitizeHookRegistered = true;
      }
    } catch {}
  }

  if (promptHookRegistered && sanitizeHookRegistered) {
    record('Prompt Hook Config (hooks.json)', 'HEALTHY', 'subagent + prompt + sanitize hooks registered');
  } else {
    let allowHooks = false;
    let loadFailed = false;
    const isNonInteractive = process.argv.includes('--yes') || process.argv.includes('-y') || process.env.CI === 'true';
    if (isNonInteractive) {
      allowHooks = true;
    } else {
      globalSpinner.stop();
      try {
        const prompts = await import('@inquirer/prompts');
        allowHooks = await prompts.confirm({ message: 'Allow registering prompt-saver hook in ~/.gemini/config/hooks.json?', default: true });
      } catch (e) {
        loadFailed = true;
        record('Prompt Hook Config (hooks.json)', 'FAILED', 'Could not load @inquirer/prompts');
        hasErrors = true;
      }
      globalSpinner.start('Running environment diagnostics...');
    }

    if (allowHooks) {
      try {
        registerHooks(true, true);
        record('Prompt Hook Config (hooks.json)', 'REPAIRED', 'Registered subagent + prompt hooks in hooks.json');
        repairsDone++;
      } catch (e) {
        record('Prompt Hook Config (hooks.json)', 'FAILED', `Error: ${e.message}`);
        hasErrors = true;
      }
    } else if (!loadFailed) {
      record('Prompt Hook Config (hooks.json)', 'WARNING', 'Prompt hook is not registered (user declined)');
    }
  }

  // 9c. Cursor IDE/CLI Configuration
  const cursorStatus = cursorManager.getCursorStatus();
  const cursorHealthy = cursorStatus.mcpSkillsDb &&
    cursorStatus.mcpSemble &&
    cursorStatus.mcpKonohaFiles &&
    cursorStatus.subagentsGlobal >= 6;
  if (cursorHealthy) {
    record('Cursor IDE/CLI (~/.cursor/)', 'HEALTHY', 'MCP, subagents, and hooks configured');
  } else {
    try {
      const agents = agentManager.loadAgents();
      const python = checkPython() || 'python3';
      cursorManager.ensureCursorSetup({
        pythonCmd: python,
        serverPath: SERVER_PATH,
        uvxCmd: getUvxCommand(),
        agents,
        projectRoot: currentCwd,
        deployProject: false,
        silent: true,
        allowHooks: true,
        ruleContent: null
      });
      const repaired = cursorManager.getCursorStatus();
      if (repaired.mcpSkillsDb && repaired.mcpSemble && repaired.mcpKonohaFiles && repaired.subagentsGlobal >= 6) {
        record('Cursor IDE/CLI (~/.cursor/)', 'REPAIRED', 'Registered MCP, subagents, and session hook');
        repairsDone++;
      } else {
        record('Cursor IDE/CLI (~/.cursor/)', 'WARNING', 'Partial Cursor setup — run konoha init');
      }
    } catch (e) {
      record('Cursor IDE/CLI (~/.cursor/)', 'FAILED', `Error: ${e.message}`);
      hasErrors = true;
    }
  }

  // 9d. Claude Code Configuration (only when CLI installed)
  if (mcpClientsManager.isClaudeCodeInstalled()) {
    const claudeStatus = mcpClientsManager.getClaudeCodeStatus();
    const claudeHealthy =
      claudeStatus.mcpSkillsDb &&
      claudeStatus.mcpSemble &&
      claudeStatus.mcpKonohaFiles &&
      claudeStatus.permissionsAllowed;
    if (claudeHealthy) {
      record('Claude Code (~/.claude.json)', 'HEALTHY', 'skills-db, semble, and konoha-files active & allowed');
    } else {
      try {
        const python = checkPython() || 'python3';
        const agents = agentManager.loadAgents();
        const ruleContent = agentManager.generateClaudeCodeMd(agents);
        mcpClientsManager.ensureClaudeCodeSetup({
          pythonCmd: python,
          serverPath: SERVER_PATH,
          uvxCmd: getUvxCommand(),
          ruleContent,
          silent: true
        });
        const repaired = mcpClientsManager.getClaudeCodeStatus();
        if (repaired.mcpSkillsDb && repaired.mcpSemble && repaired.mcpKonohaFiles && repaired.permissionsAllowed) {
          record('Claude Code (~/.claude.json)', 'REPAIRED', 'Registered Konoha MCP servers & allowed tools');
          repairsDone++;
        } else {
          record('Claude Code (~/.claude.json)', 'WARNING', 'Partial Claude Code setup — run konoha init');
        }
      } catch (e) {
        record('Claude Code (~/.claude.json)', 'FAILED', `Error: ${e.message}`);
        hasErrors = true;
      }
    }
  }

  // 9e. OpenCode Configuration (only when CLI installed)
  if (mcpClientsManager.isOpenCodeInstalled()) {
    const openCodeStatus = mcpClientsManager.getOpenCodeStatus();
    const openCodeHealthy =
      openCodeStatus.mcpSkillsDb &&
      openCodeStatus.mcpSemble &&
      openCodeStatus.mcpKonohaFiles;
    if (openCodeHealthy) {
      record('OpenCode (~/.config/opencode/)', 'HEALTHY', 'skills-db, semble, and konoha-files active');
    } else {
      try {
        const python = checkPython() || 'python3';
        mcpClientsManager.ensureOpenCodeSetup({
          pythonCmd: python,
          serverPath: SERVER_PATH,
          uvxCmd: getUvxCommand(),
          silent: true
        });
        const repaired = mcpClientsManager.getOpenCodeStatus();
        if (repaired.mcpSkillsDb && repaired.mcpSemble && repaired.mcpKonohaFiles) {
          record('OpenCode (~/.config/opencode/)', 'REPAIRED', 'Registered Konoha MCP servers');
          repairsDone++;
        } else {
          record('OpenCode (~/.config/opencode/)', 'WARNING', 'Partial OpenCode setup — run konoha init');
        }
      } catch (e) {
        record('OpenCode (~/.config/opencode/)', 'FAILED', `Error: ${e.message}`);
        hasErrors = true;
      }
    }
  }

  // 10. agent-browser CLI check
  let agentBrowserInstalled = false;
  let agentBrowserVersion = '';
  try {
    const abCmd = process.platform === 'win32' ? 'agent-browser.cmd' : 'agent-browser';
    const abVerRes = spawnSync(abCmd, ['--version'], { encoding: 'utf-8', shell: process.platform === 'win32' });
    if (abVerRes.status === 0) {
      agentBrowserInstalled = true;
      agentBrowserVersion = abVerRes.stdout.trim();
    }
  } catch (e) {
    // not installed
  }

  if (!agentBrowserInstalled) {
    record('agent-browser CLI', 'WARNING', 'Missing agent-browser (recommended for design match comparison)');
  } else {
    record('agent-browser CLI', 'ACTIVE', agentBrowserVersion || 'Installed');
  }

  // Complete diagnostic spinner
  globalSpinner.success('Diagnostic checks complete.');

  // Print results table
  const doctorHeaders = ['Requirement / Component', 'Status', 'Diagnostic Details'];
  const doctorRows = results.map((res) => [res.component, res.status, res.details]);
  const doctorWidths = computeTableWidths(doctorHeaders, doctorRows, {
    minWidths: [30, 10, 36],
    maxWidths: [50, 12, 64]
  });
  drawTable(doctorHeaders, doctorWidths, ['left', 'left', 'left'], doctorRows, [], CHIDORI_THEME, {
    columnFormatters: [
      (cell) => applyGradient(cell.trimEnd(), NINJA_THEME, 0.9) + cell.slice(cell.trimEnd().length),
      gradientStatusCell,
      (cell) => applyGradient(cell, CHIDORI_THEME, 0.72)
    ]
  });
  log('');

  // Diagnostic Report Summary
  if (hasErrors) {
    const summaryLines = [
      `${applyGradient('✗ Diagnostic complete with errors.', [[239, 68, 68], [185, 28, 28]])}`,
      `${applyGradient('Please check the warnings and install instructions above.', FIRE_THEME, 0.85)}`,
      `${applyGradient('Repairs successfully performed: ', CHIDORI_THEME, 0.85)}${applyGradient(String(repairsDone), FIRE_THEME)}`,
    ];
    drawBox('🩺 Doctor Summary', summaryLines, [[239, 68, 68], [185, 28, 28]]);
    process.exit(1);
  } else {
    const summaryLines = [
      `${applyGradient('✓ All diagnostic checks passed successfully!', LEAF_THEME)}`,
      `${applyGradient('Your Konoha environment is fully operational.', LEAF_THEME, 0.9)}`,
      repairsDone > 0
        ? `${applyGradient('Auto-repaired ', CHIDORI_THEME, 0.85)}${applyGradient(String(repairsDone), FIRE_THEME)}${applyGradient(' component(s) successfully.', CHIDORI_THEME, 0.85)}`
        : `${applyGradient('No repairs were required.', CHIDORI_THEME, 0.8)}`
    ];
    drawBox('🩺 Doctor Summary', summaryLines, LEAF_THEME);
    log('');
    
    // If we repaired anything, trigger a self-test to confirm health
    if (repairsDone > 0) {
      info('Running self-test to verify repairs...');
      try {
        await cmdTest();
      } catch (testErr) {
        error(`Self-test failed after repairs: ${testErr.message}`);
        process.exit(1);
      }
    }
  }
}

async function cmdUninstall() {
  await chidoriTransition('uninstall');
  header('🗑️  Uninstalling Skills-DB');

  // Remove server files (preserving the skills.db database and its metrics)
  if (fileExists(SKILLS_DB_DIR)) {
    const files = fs.readdirSync(SKILLS_DB_DIR);
    files.forEach(file => {
      if (file !== 'skills.db' && file !== 'skills.db-journal' && file !== 'skills.db-wal' && file !== 'skills.db-shm') {
        const filePath = path.join(SKILLS_DB_DIR, file);
        try {
          if (fs.statSync(filePath).isDirectory()) {
            fs.rmSync(filePath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(filePath);
          }
        } catch (e) {}
      }
    });
    success(`Cleaned server files in: ${SKILLS_DB_DIR} (preserved skills.db)`);
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
      if (config.mcpServers && config.mcpServers['konoha-files']) {
        delete config.mcpServers['konoha-files'];
        success('Removed konoha-files from MCP config');
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

  // Remove default official skills from global skills directory
  const pkgSkillsDir = path.join(__dirname, '..', '.agents', 'skills');
  const globalSkillsDir = path.join(HOME, '.agents', 'skills');
  if (fileExists(pkgSkillsDir) && fileExists(globalSkillsDir)) {
    try {
      const files = fs.readdirSync(pkgSkillsDir, { withFileTypes: true });
      files.forEach(entry => {
        const name = entry.name;
        const targetPath = path.join(globalSkillsDir, name);
        if (fileExists(targetPath)) {
          const isOfficial = (entry.isDirectory() && (name.endsWith('-skill') || name === 'konoha')) ||
                             (entry.isFile() && name.endsWith('-skill.md'));
          if (isOfficial) {
            fs.rmSync(targetPath, { recursive: true, force: true });
            success(`Removed official skill: ${targetPath}`);
          }
        }
      });
    } catch (err) {
      // ignore
    }
  }

  log('');
  success('Skills-DB uninstalled.');
  info('Your custom skills in ~/.agents/skills/ are untouched.');

  // Remove Cursor-specific Konoha configuration
  try {
    cursorManager.removeCursorConfig(true);
    success('Removed Konoha entries from ~/.cursor/ (MCP, subagents, hooks)');
  } catch {
    warn('Could not fully clean Cursor configuration');
  }

  try {
    mcpClientsManager.removeClaudeCodeConfig(true);
    mcpClientsManager.removeOpenCodeConfig(true);
    success('Removed Konoha entries from Claude Code / OpenCode global MCP configs (when present)');
  } catch {
    warn('Could not fully clean Claude Code / OpenCode configuration');
  }

  // Remove Antigravity-specific configurations
  try {
    registerHooks(true, false);
    unregisterPermissions(true);
    antigravityManager.removeAntigravityAgents(true);
    success('Removed Konoha entries from Antigravity (hooks, permissions, subagents)');
  } catch {
    warn('Could not fully clean Antigravity configuration');
  }
}

async function cmdAgentStatus() {
  await chidoriTransition('agent-status');
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
  const registeredNames = new Set();

  agents.forEach(a => {
    const name = a.name.toLowerCase();
    registeredNames.add(name);
    
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

  // Aggregate all unregistered/direct tool calls (including orchestrator, tests, and direct usage)
  const directStats = { today: 0, last7days: 0, alltime: 0 };
  Object.keys(stats).forEach(name => {
    const lowerName = name.toLowerCase();
    if (!registeredNames.has(lowerName)) {
      const agentStats = stats[name];
      directStats.today += agentStats.today;
      directStats.last7days += agentStats.last7days;
      directStats.alltime += agentStats.alltime;
    }
  });

  displayAgents.push({
    name: 'Direct Tool Calls',
    icon: '🔌',
    title: 'Non-agent / direct MCP tools usage',
    modelTier: '-',
    today: directStats.today,
    last7days: directStats.last7days,
    alltime: directStats.alltime,
    isRegistered: false
  });

  // Display Table
  sectionTitle('Call Frequency Summary:', NINJA_THEME);

  const headers = ['Subagent', 'Model Tier', 'Today', '7 Days', 'All Time'];
  const aligns = ['left', 'left', 'right', 'right', 'right'];

  const rows = displayAgents.map(da => [
    `${da.icon} ${da.name}`,
    da.modelTier || '-',
    da.today,
    da.last7days,
    da.alltime
  ]);

  const widths = computeTableWidths(headers, rows, {
    minWidths: [18, 20, 6, 8, 10],
    maxWidths: [28, 34, 8, 10, 12]
  });

  drawTable(headers, widths, aligns, rows, [], NINJA_THEME, {
    columnFormatters: [
      (cell) => applyGradient(cell.trimEnd(), NINJA_THEME, 0.92) + cell.slice(cell.trimEnd().length),
      (cell) => applyGradient(cell, RASENGAN_THEME, 0.85),
      (cell) => applyGradient(cell, LEAF_THEME, 0.9),
      (cell) => applyGradient(cell, LEAF_THEME, 0.9),
      (cell) => applyGradient(cell, FIRE_THEME, 0.9)
    ]
  });
  log('');
}

async function cmdSavings() {
  await chidoriTransition('savings');
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

        const formatSavings = (tokens, pct, thoughtTokens) => {
          const width = 18;
          const filledCount = Math.min(width, Math.max(0, Math.round((pct / 100) * width)));
          const filled = '█'.repeat(filledCount);
          const empty = '░'.repeat(width - filledCount);
          
          let coloredFilled = '';
          if (filledCount > 0) {
            const theme = pct >= 80 ? LEAF_THEME : (pct >= 50 ? FIRE_THEME : [[239,68,68],[239,68,68]]);
            coloredFilled = applyGradient(filled, theme);
          }
          
          const thoughtVal = thoughtTokens || 0;
          const thoughtText = ` (thought: ${formatTokens(thoughtVal)})`;
          return `[${coloredFilled}${C.dim}${empty}${C.reset}]  ~${C.bold}${formatTokens(tokens).padEnd(5)}${C.reset} tokens${C.yellow}${thoughtText}${C.reset}`;
        };

        // Table
        log('    ' + applyGradientToBorders('┌──────────────┬─────────┬──────────────┬────────────────────────────────────────────────────────┐', LEAF_THEME));
        log('    ' + applyGradientToBorders(`│ ${C.bold}${padEndVisual('Period', 12)}${C.reset} │ ${C.bold}${padEndVisual('Calls', 7)}${C.reset} │ ${C.bold}${padEndVisual('Bytes Saved', 12)}${C.reset} │ ${C.bold}${padEndVisual('Visual Savings (Tokens / thought)', 54)}${C.reset} │`, LEAF_THEME));
        log('    ' + applyGradientToBorders('├──────────────┼─────────┼──────────────┼────────────────────────────────────────────────────────┤', LEAF_THEME));
        log('    ' + applyGradientToBorders(`│ ${padEndVisual('Today', 12)} │ ${padEndVisual(stats.today.calls.toString(), 7)} │ ${padEndVisual(formatBytes(stats.today.bytes), 12)} │ ${padEndVisual(formatSavings(stats.today.tokens, stats.today.pct || 0, stats.today.thought_tokens), 54)} │`, LEAF_THEME));
        log('    ' + applyGradientToBorders(`│ ${padEndVisual('Last 7 days', 12)} │ ${padEndVisual(stats.last7days.calls.toString(), 7)} │ ${padEndVisual(formatBytes(stats.last7days.bytes), 12)} │ ${padEndVisual(formatSavings(stats.last7days.tokens, stats.last7days.pct || 0, stats.last7days.thought_tokens), 54)} │`, LEAF_THEME));
        log('    ' + applyGradientToBorders(`│ ${padEndVisual('All time', 12)} │ ${padEndVisual(stats.alltime.calls.toString(), 7)} │ ${padEndVisual(formatBytes(stats.alltime.bytes), 12)} │ ${padEndVisual(formatSavings(stats.alltime.tokens, stats.alltime.pct || 0, stats.alltime.thought_tokens), 54)} │`, LEAF_THEME));
        log('    ' + applyGradientToBorders('└──────────────┴─────────┴──────────────┴────────────────────────────────────────────────────────┘', LEAF_THEME));
        log('');

        // Provider Breakdown Table
        log(`    ${C.bold}Provider Breakdown${C.reset}`);
        log('    ' + applyGradientToBorders('┌──────────────────────┬──────────────────────┬──────────────────────┬──────────────────────┐', LEAF_THEME));
        log('    ' + applyGradientToBorders(`│ ${C.bold}${padEndVisual('Provider', 20)}${C.reset} │ ${C.bold}${padEndVisual('Today', 20)}${C.reset} │ ${C.bold}${padEndVisual('Last 7 Days', 20)}${C.reset} │ ${C.bold}${padEndVisual('All Time', 20)}${C.reset} │`, LEAF_THEME));
        log('    ' + applyGradientToBorders('├──────────────────────┼──────────────────────┼──────────────────────┼──────────────────────┤', LEAF_THEME));

        const clients = [
          { name: 'Antigravity IDE', key: 'antigravity', icon: '🌌' },
          { name: 'Antigravity CLI', key: 'agy', icon: '🚀' },
          { name: 'Cursor', key: 'cursor', icon: '🌊' },
          { name: 'Claude Code', key: 'claudecode', icon: '🌀' }
        ];

        clients.forEach(client => {
          const clientLabel = `${client.icon} ${client.name}`;
          
          const todayStats = stats.today.by_client ? (stats.today.by_client[client.key] || { calls: 0, tokens: 0 }) : { calls: 0, tokens: 0 };
          const last7Stats = stats.last7days.by_client ? (stats.last7days.by_client[client.key] || { calls: 0, tokens: 0 }) : { calls: 0, tokens: 0 };
          const alltimeStats = stats.alltime.by_client ? (stats.alltime.by_client[client.key] || { calls: 0, tokens: 0 }) : { calls: 0, tokens: 0 };
          
          const formatCellText = (cStats) => {
            if (!cStats || cStats.calls === 0) return '0 (0 Token)';
            return `${cStats.calls} (${formatTokens(cStats.tokens)} Token)`;
          };

          const todayText = formatCellText(todayStats);
          const last7Text = formatCellText(last7Stats);
          const allTimeText = formatCellText(alltimeStats);

          log('    ' + applyGradientToBorders(`│ ${padEndVisual(clientLabel, 20)} │ ${padEndVisual(todayText, 20)} │ ${padEndVisual(last7Text, 20)} │ ${padEndVisual(allTimeText, 20)} │`, LEAF_THEME));
        });
        log('    ' + applyGradientToBorders('└──────────────────────┴──────────────────────┴──────────────────────┴──────────────────────┘', LEAF_THEME));
        log('');

        if (stats.by_call_type && stats.by_call_type.length > 0) {
          log(`    ${C.bold}By Call Type${C.reset}`);
          log(`    ${applyGradient('────────────────────────────────────────────────────────────────────────', LEAF_THEME)}`);
          log(`    ${C.bold}#     Call type            Calls  Share${C.reset}`);
          log(`    ${applyGradient('────────────────────────────────────────────────────────────────────────', LEAF_THEME)}`);
          
          const totalCalls = stats.by_call_type.reduce((sum, item) => sum + item.calls, 0);
          stats.by_call_type.forEach((item, index) => {
            const idxStr = `${index + 1}.`;
            const num = idxStr.padEnd(6);
            const toolName = item.tool.padEnd(20);
            const calls = String(item.calls).padStart(6);
            
            let bar = '';
            let pctText = '  0%';
            if (totalCalls > 0) {
              const itemPct = Math.round((item.calls / totalCalls) * 100);
              pctText = `${itemPct}%`.padStart(4);
              const filledCount = Math.min(16, Math.max(0, Math.round((item.calls / totalCalls) * 16)));
              const finalFilledCount = (item.calls > 0) ? Math.max(1, filledCount) : filledCount;
              const filled = '█'.repeat(finalFilledCount);
              const empty = '░'.repeat(16 - finalFilledCount);
              const coloredFilled = finalFilledCount > 0 ? applyGradient(filled, LEAF_THEME) : '';
              bar = `${coloredFilled}${C.dim}${empty}${C.reset}`;
            } else {
              bar = `${C.dim}${'░'.repeat(16)}${C.reset}`;
            }
            log(`      ${num}${toolName}${calls}  ${bar}   ${pctText}`);
          });
          log(`    ${applyGradient('════════════════════════════════════════════════════════════════════════', LEAF_THEME)}`);
          log('');
        }


        global.skillsDbTodayCalls = stats.today.calls;
        global.skillsDbTodayTokens = stats.today.tokens;
        global.skillsDbTodayBytes = stats.today.bytes;
        global.skillsDbTodayTotalBytes = stats.today.total_bytes;

        global.skillsDbLast7DaysCalls = stats.last7days.calls;
        global.skillsDbLast7DaysTokens = stats.last7days.tokens;
        global.skillsDbLast7DaysBytes = stats.last7days.bytes;
        global.skillsDbLast7DaysTotalBytes = stats.last7days.total_bytes;

        global.skillsDbAllTimeCalls = stats.alltime.calls;
        global.skillsDbAllTimeTokens = stats.alltime.tokens;
        global.skillsDbAllTimeBytes = stats.alltime.bytes;
        global.skillsDbAllTimeTotalBytes = stats.alltime.total_bytes;
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
  let sembleTodayPct = 0;
  let sembleLast7DaysCalls = 0;
  let sembleLast7DaysTokens = 0;
  let sembleLast7DaysPct = 0;
  let sembleAllTimeCalls = 0;
  let sembleAllTimeTokens = 0;
  let sembleAllTimePct = 0;

  try {
    const uvxCmd = getUvxCommand();
    let runSemble = spawnSync(uvxCmd, ['--from', 'semble[mcp]@latest', 'semble', 'savings'], {
      encoding: 'utf-8',
      timeout: 5000,
      shell: process.platform === 'win32'
    });
    if (runSemble.status !== 0 || runSemble.error) {
      // Fallback: Try running local/global 'semble' directly if uvx fails (e.g. offline mode or PyPI timeout)
      let sembleCmd = 'semble';
      if (uvxCmd !== 'uvx') {
        const companionSemble = path.join(path.dirname(uvxCmd), 'semble');
        if (fileExists(companionSemble)) {
          sembleCmd = companionSemble;
        }
      }
      runSemble = spawnSync(sembleCmd, ['savings'], {
        encoding: 'utf-8',
        timeout: 5000,
        shell: process.platform === 'win32'
      });
    }
    if (runSemble.status !== 0 || runSemble.error) {
      throw runSemble.error || new Error(runSemble.stderr || 'Semble savings query failed');
    }
    const sembleOutput = runSemble.stdout;
    
    // Print Semble output indented slightly to fit the style
    const indentedSemble = sembleOutput.split('\n').map(l => '    ' + l).join('\n');
    log(indentedSemble);

    const lines = sembleOutput.split('\n');
    for (const line of lines) {
      const cleanLine = line.replace(/\x1b\[[0-9;]*m/g, '').trim();
      
      const todayMatch = cleanLine.match(/^Today\s+([0-9.]+)([kKmM]?)\s+~?([0-9.]+)([M|k]?)\s+tokens\s+.*?(\d+)%/i)
        || cleanLine.match(/^Today\s+([0-9.]+)([kKmM]?)\s+\[.*?\]\s+~?([0-9.]+)([M|k]?)\s+tokens(?:\s+\((\d+)%\))?/i);
      if (todayMatch) {
        const callVal = parseFloat(todayMatch[1]);
        const callUnit = (todayMatch[2] || '').toLowerCase();
        sembleTodayCalls = callUnit === 'm' ? Math.round(callVal * 1000000) : (callUnit === 'k' ? Math.round(callVal * 1000) : Math.round(callVal));
        const val = parseFloat(todayMatch[3]);
        const unit = (todayMatch[4] || '').toLowerCase();
        sembleTodayTokens = unit === 'm' ? Math.round(val * 1000000) : (unit === 'k' ? Math.round(val * 1000) : Math.round(val));
        sembleTodayPct = parseInt(todayMatch[5] || '0', 10) || 0;
      }

      const last7Match = cleanLine.match(/^Last\s+7\s+days\s+([0-9.]+)([kKmM]?)\s+~?([0-9.]+)([M|k]?)\s+tokens\s+.*?(\d+)%/i)
        || cleanLine.match(/^Last\s+7\s+days\s+([0-9.]+)([kKmM]?)\s+\[.*?\]\s+~?([0-9.]+)([M|k]?)\s+tokens(?:\s+\((\d+)%\))?/i);
      if (last7Match) {
        const callVal = parseFloat(last7Match[1]);
        const callUnit = (last7Match[2] || '').toLowerCase();
        sembleLast7DaysCalls = callUnit === 'm' ? Math.round(callVal * 1000000) : (callUnit === 'k' ? Math.round(callVal * 1000) : Math.round(callVal));
        const val = parseFloat(last7Match[3]);
        const unit = (last7Match[4] || '').toLowerCase();
        sembleLast7DaysTokens = unit === 'm' ? Math.round(val * 1000000) : (unit === 'k' ? Math.round(val * 1000) : Math.round(val));
        sembleLast7DaysPct = parseInt(last7Match[5] || '0', 10) || 0;
      }

      const allTimeMatch = cleanLine.match(/^All\s+time\s+([0-9.]+)([kKmM]?)\s+~?([0-9.]+)([M|k]?)\s+tokens\s+.*?(\d+)%/i)
        || cleanLine.match(/^All\s+time\s+([0-9.]+)([kKmM]?)\s+\[.*?\]\s+~?([0-9.]+)([M|k]?)\s+tokens(?:\s+\((\d+)%\))?/i);
      if (allTimeMatch) {
        const callVal = parseFloat(allTimeMatch[1]);
        const callUnit = (allTimeMatch[2] || '').toLowerCase();
        sembleAllTimeCalls = callUnit === 'm' ? Math.round(callVal * 1000000) : (callUnit === 'k' ? Math.round(callVal * 1000) : Math.round(callVal));
        const val = parseFloat(allTimeMatch[3]);
        const unit = (allTimeMatch[4] || '').toLowerCase();
        sembleAllTimeTokens = unit === 'm' ? Math.round(val * 1000000) : (unit === 'k' ? Math.round(val * 1000) : Math.round(val));
        sembleAllTimePct = parseInt(allTimeMatch[5] || '0', 10) || 0;
      }
    }
  } catch (e) {
    log(`     ${C.yellow}⚠${C.reset} Could not fetch Semble savings: ${e.message}`);
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

  // Calculate true combined savings percentages
  const skillsDbTodaySavedBytes = global.skillsDbTodayBytes || 0;
  const skillsDbTodayTotalBytes = global.skillsDbTodayTotalBytes || 0;
  const sembleTodaySavedBytes = sembleTodayTokens * 4;
  const combinedTodaySavedBytes = skillsDbTodaySavedBytes + sembleTodaySavedBytes;
  const sembleTodayTotalBytes = (sembleTodayPct > 0) ? (sembleTodaySavedBytes) / (sembleTodayPct / 100) : sembleTodaySavedBytes;
  const combinedTodayTotalBytes = skillsDbTodayTotalBytes + sembleTodayTotalBytes;
  const combinedTodayPct = (combinedTodayTotalBytes > 0) ? Math.round((combinedTodaySavedBytes / combinedTodayTotalBytes) * 100) : 0;

  const skillsDbLast7DaysSavedBytes = global.skillsDbLast7DaysBytes || 0;
  const skillsDbLast7DaysTotalBytes = global.skillsDbLast7DaysTotalBytes || 0;
  const sembleLast7DaysSavedBytes = sembleLast7DaysTokens * 4;
  const combinedLast7DaysSavedBytes = skillsDbLast7DaysSavedBytes + sembleLast7DaysSavedBytes;
  const sembleLast7DaysTotalBytes = (sembleLast7DaysPct > 0) ? (sembleLast7DaysSavedBytes) / (sembleLast7DaysPct / 100) : sembleLast7DaysSavedBytes;
  const combinedLast7DaysTotalBytes = skillsDbLast7DaysTotalBytes + sembleLast7DaysTotalBytes;
  const combinedLast7DaysPct = (combinedLast7DaysTotalBytes > 0) ? Math.round((combinedLast7DaysSavedBytes / combinedLast7DaysTotalBytes) * 100) : 0;

  const skillsDbAllTimeSavedBytes = global.skillsDbAllTimeBytes || 0;
  const skillsDbAllTimeTotalBytes = global.skillsDbAllTimeTotalBytes || 0;
  const sembleAllTimeSavedBytes = sembleAllTimeTokens * 4;
  const combinedAllTimeSavedBytes = skillsDbAllTimeSavedBytes + sembleAllTimeSavedBytes;
  const sembleAllTimeTotalBytes = (sembleAllTimePct > 0) ? (sembleAllTimeSavedBytes) / (sembleAllTimePct / 100) : sembleAllTimeSavedBytes;
  const combinedAllTimeTotalBytes = skillsDbAllTimeTotalBytes + sembleAllTimeTotalBytes;
  const combinedAllTimePct = (combinedAllTimeTotalBytes > 0) ? Math.round((combinedAllTimeSavedBytes / combinedAllTimeTotalBytes) * 100) : 0;

  const formatBytesComb = (b) => {
    if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(2)} MB`;
    return `${(b / 1024).toFixed(1)} KB`;
  };

  const formatTokensComb = (t) => {
    if (t >= 1000000) return `${(t / 1000000).toFixed(2)}M`;
    if (t >= 1000) return `${(t / 1000).toFixed(1)}k`;
    return String(t);
  };

  header('🏆 Combined Total Savings');
  log('');
  
  const combinedSummaryLines = [
    `${C.bold}Today:${C.reset}        ${String(combinedTodayCalls).padStart(5)} calls   ~${C.bold}${formatTokensComb(combinedTodayTokens).padEnd(7)}${C.reset} tokens (~${C.bold}${formatBytesComb(combinedTodayBytes)}${C.reset} equivalent) (${C.green}${combinedTodayPct}%${C.reset})`,
    `${C.bold}Last 7 Days:${C.reset}  ${String(combinedLast7DaysCalls).padStart(5)} calls   ~${C.bold}${formatTokensComb(combinedLast7DaysTokens).padEnd(7)}${C.reset} tokens (~${C.bold}${formatBytesComb(combinedLast7DaysBytes)}${C.reset} equivalent) (${C.green}${combinedLast7DaysPct}%${C.reset})`,
    `${C.bold}All Time:${C.reset}     ${String(combinedAllTimeCalls).padStart(5)} calls   ~${C.bold}${formatTokensComb(combinedAllTimeTokens).padEnd(7)}${C.reset} tokens (~${C.bold}${formatBytesComb(combinedAllTimeBytes)}${C.reset} equivalent) (${C.green}${combinedAllTimePct}%${C.reset})`,
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

async function cmdSkill(args) {
  await chidoriTransition('skill');
  const subcommand = args[0];
  const subArgs = args.slice(1);

  if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    cmdSkillHelp();
    process.exit(0);
  }

  switch (subcommand) {
    case 'list': {
      header('Installed Skills');
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
        await cmdMigrate([]);
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
        const headers = ['Subagent', 'Title', 'Model Tier', 'Active Skills'];
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

        const widths = headers.map((h, colIdx) => {
          let maxLen = getVisualLength(h);
          rows.forEach(row => {
            const cellLen = getVisualLength(row[colIdx]);
            if (cellLen > maxLen) {
              maxLen = cellLen;
            }
          });
          return maxLen;
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

      const manualIdx = subArgs.indexOf('--manual');
      if (manualIdx >= 0) options.manual = true;

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
      if (!process.stdin || !process.stdin.isTTY) {
        error('Cannot configure agent models in non-interactive mode.');
        process.exit(1);
      }
      let agentName = subArgs[0];
      const agents = agentManager.loadAgents();
      if (agents.length === 0) {
        warn('No subagents found.');
        process.exit(1);
      }

      // If agentName is provided on command line, we don't allow going back to subagent selection.
      const agentPassedOnCli = !!agentName;
      if (agentPassedOnCli) {
        const found = agents.find(a => a.name.toLowerCase() === agentName.toLowerCase());
        if (!found) {
          error(`Subagent "@${agentName}" not found.`);
          process.exit(1);
        }
        agentName = found.name;
      }

      let step = agentPassedOnCli ? 'SELECT_PRIMARY' : 'SELECT_AGENT';
      let selectedAgent = agentPassedOnCli ? agents.find(a => a.name === agentName) : null;
      let primaryModel = null;
      let configureFallback = false;
      let fallbackModel = null;
      let resolvedModelString = null;

      const activeModelsList = await getActiveModels();

      while (true) {
        if (step === 'SELECT_AGENT') {
          header('Choose Subagent');
          agents.forEach((a, idx) => {
            const numStr = `${idx + 1}`.padStart(2);
            log(`  ${C.cyan}[${numStr}]${C.reset} ${C.bold}@${a.name}${C.reset} ── ${a.title || 'Subagent'}`);
            log(`       ${C.dim}Model:  ${C.reset}${C.green}${a.modelTier || 'Default'}${C.reset}`);
            const skillsStr = a.skills && a.skills.length > 0 ? a.skills.join(', ') : 'None';
            log(`       ${C.dim}Skills: ${C.reset}${C.magenta}${skillsStr}${C.reset}\n`);
          });
          log(`  ${C.yellow}[ 0]${C.reset} ${C.bold}⬅ Go Back / Exit${C.reset}`);
          
          const ans = await askQuestion(`\nSelect subagent (1-${agents.length}): `);
          if (isCancel(ans)) {
            info('Exiting model configuration.');
            break; // Exit the command/loop
          }
          
          const num = parseInt(ans, 10);
          if (isNaN(num) || num < 1 || num > agents.length) {
            error('Invalid subagent selection.');
            continue; // repeat
          }
          selectedAgent = agents[num - 1];
          agentName = selectedAgent.name;
          step = 'SELECT_PRIMARY';
        }
        
        else if (step === 'SELECT_PRIMARY') {
          header(`Configure Models for @${agentName}`);
          log('Select primary model:');
          activeModelsList.forEach((m, idx) => {
            const numStr = `${idx + 1}`.padStart(2);
            const tagStr = m.tag ? ` ${C.dim}[${m.tag}]${C.reset}` : '';
            log(`  ${C.cyan}[${numStr}]${C.reset} ${C.bold}${m.name}${C.reset}${tagStr}`);
          });
          log(`  ${C.yellow}[ 0]${C.reset} ${C.bold}⬅ Go Back${C.reset}`);

          const primaryAns = await askQuestion(`\nSelect primary model (1-${activeModelsList.length}): `);
          if (isCancel(primaryAns)) {
            if (agentPassedOnCli) {
              info('Exiting model configuration.');
              break;
            } else {
              step = 'SELECT_AGENT';
              continue;
            }
          }

          const primaryNum = parseInt(primaryAns, 10);
          if (isNaN(primaryNum) || primaryNum < 1 || primaryNum > activeModelsList.length) {
            error('Invalid primary model selection.');
            continue;
          }
          primaryModel = activeModelsList[primaryNum - 1];
          step = 'ASK_FALLBACK';
        }
        
        else if (step === 'ASK_FALLBACK') {
          const defaultFallbackModelName = 'Gemini 3.1 Flash-Lite';
          const fallbackAns = await askQuestion('\nWould you like to configure a fallback model? (y/n) [y] (or "0" to go back): ');
          if (isCancel(fallbackAns)) {
            step = 'SELECT_PRIMARY';
            continue;
          }

          if (fallbackAns.toLowerCase() === 'y' || fallbackAns.toLowerCase() === 'yes' || fallbackAns.trim() === '') {
            configureFallback = true;
            step = 'SELECT_FALLBACK';
          } else if (fallbackAns.toLowerCase() === 'n' || fallbackAns.toLowerCase() === 'no') {
            configureFallback = false;
            resolvedModelString = primaryModel.name;
            step = 'SAVE';
          } else {
            error('Invalid input. Please enter y, n, or 0.');
          }
        }
        
        else if (step === 'SELECT_FALLBACK') {
          const defaultFallbackModelName = 'Gemini 3.1 Flash-Lite';
          header('Select Fallback Model');
          log('Select fallback model to use when the primary model fails:');
          activeModelsList.forEach((m, idx) => {
            const numStr = `${idx + 1}`.padStart(2);
            const tagStr = m.tag ? ` ${C.dim}[${m.tag}]${C.reset}` : '';
            log(`  ${C.cyan}[${numStr}]${C.reset} ${C.bold}${m.name}${C.reset}${tagStr}`);
          });
          log(`  ${C.yellow}[ 0]${C.reset} ${C.bold}⬅ Go Back${C.reset}`);

          const defaultIndex = activeModelsList.findIndex(m => m.name === defaultFallbackModelName) + 1;
          const fallbackNumAns = await askQuestion(`\nSelect fallback model (1-${activeModelsList.length}) [${defaultIndex}]: `);
          if (isCancel(fallbackNumAns)) {
            step = 'ASK_FALLBACK';
            continue;
          }

          let fallbackNum = parseInt(fallbackNumAns, 10);
          if (fallbackNumAns.trim() === '') {
            fallbackNum = defaultIndex;
          }
          if (isNaN(fallbackNum) || fallbackNum < 1 || fallbackNum > activeModelsList.length) {
            error('Invalid fallback model selection.');
            continue;
          }
          fallbackModel = activeModelsList[fallbackNum - 1];
          resolvedModelString = `${primaryModel.name} | Fallback when fail ${fallbackModel.name}`;
          step = 'SAVE';
        }
        
        else if (step === 'SAVE') {
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
          }
          break; // Done!
        }
      }
      break;
    }
    case 'skill': {
      if (!process.stdin || !process.stdin.isTTY) {
        error('Cannot configure agent skills in non-interactive mode.');
        process.exit(1);
      }
      let agentName = subArgs[0];
      let agents = agentManager.loadAgents();
      if (agents.length === 0) {
        warn('No subagents found.');
        process.exit(1);
      }

      const agentPassedOnCli = !!agentName;
      if (agentPassedOnCli) {
        const found = agents.find(a => a.name.toLowerCase() === agentName.toLowerCase());
        if (!found) {
          error(`Subagent "@${agentName}" not found.`);
          process.exit(1);
        }
        agentName = found.name;
      }

      let step = agentPassedOnCli ? 'SELECT_SKILL' : 'SELECT_AGENT';
      
      while (true) {
        if (step === 'SELECT_AGENT') {
          header('Choose Subagent');
          agents.forEach((a, idx) => {
            const numStr = `${idx + 1}`.padStart(2);
            log(`  ${C.cyan}[${numStr}]${C.reset} ${C.bold}@${a.name}${C.reset} ── ${a.title || 'Subagent'}`);
            log(`       ${C.dim}Model:  ${C.reset}${C.green}${a.modelTier || 'Default'}${C.reset}`);
            const skillsStr = a.skills && a.skills.length > 0 ? a.skills.join(', ') : 'None';
            log(`       ${C.dim}Skills: ${C.reset}${C.magenta}${skillsStr}${C.reset}\n`);
          });
          log(`  ${C.yellow}[ 0]${C.reset} ${C.bold}⬅ Go Back / Exit${C.reset}`);

          const ans = await askQuestion(`\nSelect subagent (1-${agents.length}): `);
          if (isCancel(ans)) {
            info('Exiting skill configuration.');
            break;
          }

          const num = parseInt(ans, 10);
          if (isNaN(num) || num < 1 || num > agents.length) {
            error('Invalid subagent selection.');
            continue;
          }
          agentName = agents[num - 1].name;
          step = 'SELECT_SKILL';
        }
        
        else if (step === 'SELECT_SKILL') {
          // Reload agents to get the most up-to-date skills status
          agents = agentManager.loadAgents();
          const agent = agents.find(a => a.name.toLowerCase() === agentName.toLowerCase());
          if (!agent) {
            error(`Error: agent @${agentName} could not be loaded.`);
            step = 'SELECT_AGENT';
            continue;
          }

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
            if (agentPassedOnCli) {
              break;
            } else {
              step = 'SELECT_AGENT';
              continue;
            }
          }

          header(`Configure Skills for @${agentName}`);
          log('Select a skill to toggle (embed / unembed):');
          skillList.forEach((s, idx) => {
            const isEmbedded = agent.skills && agent.skills.includes(s.name);
            const statusIcon = isEmbedded 
              ? `${C.green}✨ [✓] Embedded${C.reset}` 
              : `${C.dim}   [ ] Not Embedded${C.reset}`;
            const numStr = `${idx + 1}`.padStart(2);
            log(`  ${C.cyan}[${numStr}]${C.reset} ${statusIcon} ${C.bold}${s.name}${C.reset}`);
            log(`       ${C.dim}${s.description}${C.reset}\n`);
          });
          log(`  ${C.yellow}[ 0]${C.reset} ${C.bold}⬅ Go Back${C.reset}`);

          const skillAns = await askQuestion(`\nSelect skill to toggle (1-${skillList.length}): `);
          if (isCancel(skillAns)) {
            if (agentPassedOnCli) {
              info('Exiting skill configuration.');
              break;
            } else {
              step = 'SELECT_AGENT';
              continue;
            }
          }

          const skillNum = parseInt(skillAns, 10);
          if (isNaN(skillNum) || skillNum < 1 || skillNum > skillList.length) {
            error('Invalid skill selection.');
            continue;
          }

          const selectedSkill = skillList[skillNum - 1].name;
          const isCurrentlyEmbedded = agent.skills && agent.skills.includes(selectedSkill);

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
          }
          // The loop automatically continues, displaying the updated list!
        }
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
      await cmdAgentStatus();
      break;
    }
    default:
      error(`Unknown agent subcommand: ${subcommand}`);
      log(`Available subcommands: list, create, models, skill, delete, status`);
      process.exit(1);
  }
}

const AVAILABLE_MODELS = [
  { name: 'Gemini 3.1 Flash-Lite', tag: 'Fast', aliases: ['gemini-3.1-flash-lite', 'flash-lite-3.1', '3.1-flash-lite'] },
  { name: 'Gemini 2.5 Flash', tag: 'Fast', aliases: ['gemini-2.5-flash', 'flash-2.5', '2.5-flash'] },
  { name: 'Gemini 2.5 Flash-Lite', tag: 'Fast', aliases: ['gemini-2.5-flash-lite', 'flash-lite-2.5', '2.5-flash-lite'] },
  { name: 'Gemini 3.5 Flash (Medium)', tag: 'Fast', aliases: ['flash-medium', 'gemini-3.5-flash-medium', 'medium'] },
  { name: 'Gemini 3.5 Flash (High)', tag: 'Fast', aliases: ['flash-high', 'gemini-3.5-flash-high', 'high'] },
  { name: 'Gemini 3.5 Flash (Low)', tag: 'Fast', aliases: ['flash-low', 'gemini-3.5-flash-low', 'low'] },
  { name: 'Gemini 3.1 Pro (Low)', tag: 'Standard', aliases: ['pro-low', 'gemini-3.1-pro-low'] },
  { name: 'Gemini 3.1 Pro (High)', tag: 'Standard', aliases: ['pro-high', 'gemini-3.1-pro-high'] },
  { name: 'Claude Sonnet 4.6 (Thinking)', tag: 'Reasoning', aliases: ['sonnet', 'sonnet-4.6', 'claude-sonnet-4.6', 'sonnet-thinking'] },
  { name: 'Claude Opus 4.6 (Thinking)', tag: 'Advanced', aliases: ['opus', 'opus-4.6', 'claude-opus-4.6', 'opus-thinking'] },
  { name: 'GPT-OSS 120B (Medium)', tag: 'Standard', aliases: ['gpt', 'gpt-oss', 'gpt-oss-120b', 'gpt-120b'] }
];

async function getActiveModels() {
  const models = [...AVAILABLE_MODELS];
  const active = await checkPortActive(11434);
  if (!active) return models;

  return new Promise((resolve) => {
    const http = require('http');
    const req = http.get('http://127.0.0.1:11434/v1/models', (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json && Array.isArray(json.data)) {
            const existing = new Set(models.map(m => m.name.toLowerCase()));
            for (const m of json.data) {
              const id = m.id;
              if (!existing.has(id.toLowerCase())) {
                let tag = 'Bridge';
                if (id.includes('claude')) tag = 'Reasoning';
                else if (id.includes('gpt')) tag = 'Standard';
                else if (id.includes('gemini')) {
                  if (id.includes('flash')) tag = 'Fast';
                  else tag = 'Standard';
                }
                models.push({
                  name: id,
                  tag,
                  aliases: [id.toLowerCase()]
                });
              }
            }
          }
          resolve(models);
        } catch {
          resolve(models);
        }
      });
    });
    req.on('error', () => {
      resolve(models);
    });
    req.setTimeout(5000, () => {
      req.destroy();
      resolve(models);
    });
  });
}

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
  ${C.cyan}list${C.reset}                                           List all available Antigravity model tiers and current agent mapping.
  ${C.cyan}embed <agent-name> <model-expression> [options]${C.reset}    Set the model for an agent (supports fallback expressions).
                                                      Options:
                                                        --cursor    Configure for Cursor IDE/CLI
                                                        --claude    Configure for Claude Code
                                                        --opencode  Configure for OpenCode
  ${C.cyan}reset${C.reset}                                          Clear local usage logs in sqlite db to restore model quotas.

${C.bold}MODEL EXPRESSIONS${C.reset}
  You can specify a single model, or a primary model with a fallback (supports "inherit" for Cursor/OpenCode):
  - Single model: "Gemini 3.1 Flash-Lite"
  - With fallback: "Claude Opus 4.6 (Thinking) | Fallback when fail Gemini 3.1 Flash-Lite"

${C.bold}EXAMPLES FOR BEGINNERS${C.reset}
  ${C.dim}1. List all models and their current assignments:${C.reset}
     konoha models list

  ${C.dim}2. Manually set @chunin's model with a fallback:${C.reset}
     konoha models embed chunin "Claude Sonnet 4.6 (Thinking) | Fallback when fail Gemini 3.1 Flash-Lite"

  ${C.dim}3. Set Cursor model for @chunin:${C.reset}
     konoha models embed chunin "Gemini 3.5 Flash (Low)" --cursor

  ${C.dim}4. Reset local usage logs and model quotas:${C.reset}
     konoha models reset
`);
}

async function cmdModels(args) {
  await chidoriTransition('models');
  const subcommand = args[0];
  const subArgs = args.slice(1);

  if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    cmdModelsHelp();
    process.exit(0);
  }

  const activeModelsList = await getActiveModels();

  const printModelRow = (col1, col2, col1Color = '', col2Color = '') => {
    const c1 = col1Color ? `${col1Color}${padEndVisual(col1, 30)}${C.reset}` : padEndVisual(col1, 30);
    const c2 = col2Color ? `${col2Color}${padEndVisual(col2, 12)}${C.reset}` : padEndVisual(col2, 12);
    log(`    ${C.dim}│${C.reset} ${c1} ${C.dim}│${C.reset} ${c2} ${C.dim}│${C.reset}`);
  };

  const printTwoColRow = (col1, col2, col1Color = '', col2Color = '') => {
    const c1 = col1Color ? `${col1Color}${padEndVisual(col1, 20)}${C.reset}` : padEndVisual(col1, 20);
    const c2 = col2Color ? `${col2Color}${padEndVisual(col2, 80)}${C.reset}` : padEndVisual(col2, 80);
    log(`    ${C.dim}│${C.reset} ${c1} ${C.dim}│${C.reset} ${c2} ${C.dim}│${C.reset}`);
  };

  switch (subcommand) {
    case 'status': {
      const agents = agentManager.loadAgents();

      header('Subagent Model Configurations');
      const agentModelRows = agents.map(a => {
        const icon = a.icon || '👤';
        const displayName = `${icon} ${a.name.charAt(0).toUpperCase() + a.name.slice(1)}`;
        return [
          displayName,
          a.modelTier || '-',
          a.cursorModel || 'inherit',
          a.claudeModel || 'Claude Sonnet 4.6 (Thinking)',
          a.opencodeModel || 'inherit'
        ];
      });
      const agentModelHeaders = ['Subagent', 'Antigravity Model', 'Cursor Model', 'Claude Model', 'OpenCode Model'];
      const agentModelWidths = computeTableWidths(agentModelHeaders, agentModelRows, {
        minWidths: [18, 24, 16, 28, 16],
        maxWidths: [24, 40, 24, 40, 24]
      });
      drawTable(agentModelHeaders, agentModelWidths, ['left', 'left', 'left', 'left', 'left'], agentModelRows, [], NINJA_THEME, {
        columnFormatters: [
          (cell) => applyGradient(cell.trimEnd(), NINJA_THEME, 0.92) + cell.slice(cell.trimEnd().length),
          (cell) => applyGradient(cell, LEAF_THEME, 0.85),
          (cell) => applyGradient(cell, RASENGAN_THEME, 0.85),
          (cell) => applyGradient(cell, FIRE_THEME, 0.85),
          (cell) => applyGradient(cell, CHIDORI_THEME, 0.85)
        ]
      });
      log('');
      break;
    }
    case 'list': {
      const agents = agentManager.loadAgents();

      header('Available Antigravity Models');
      const modelRows = activeModelsList.map(m => [m.name, m.tag || '-']);
      const modelHeaders = ['Model Name', 'Tag'];
      const modelWidths = computeTableWidths(modelHeaders, modelRows, { minWidths: [24, 10], maxWidths: [42, 16] });
      drawTable(modelHeaders, modelWidths, ['left', 'left'], modelRows, [], RASENGAN_THEME, {
        columnFormatters: [
          (cell) => applyGradient(cell.trimEnd(), RASENGAN_THEME, 0.9) + cell.slice(cell.trimEnd().length),
          (cell) => applyGradient(cell, FIRE_THEME, 0.85)
        ]
      });

      header('Subagent Model Configurations');
      const agentModelRows = agents.map(a => {
        const icon = a.icon || '👤';
        const displayName = `${icon} ${a.name.charAt(0).toUpperCase() + a.name.slice(1)}`;
        return [
          displayName,
          a.modelTier || '-',
          a.cursorModel || 'inherit',
          a.claudeModel || 'Claude Sonnet 4.6 (Thinking)',
          a.opencodeModel || 'inherit'
        ];
      });
      const agentModelHeaders = ['Subagent', 'Antigravity Model', 'Cursor Model', 'Claude Model', 'OpenCode Model'];
      const agentModelWidths = computeTableWidths(agentModelHeaders, agentModelRows, {
        minWidths: [18, 24, 16, 28, 16],
        maxWidths: [24, 40, 24, 40, 24]
      });
      drawTable(agentModelHeaders, agentModelWidths, ['left', 'left', 'left', 'left', 'left'], agentModelRows, [], NINJA_THEME, {
        columnFormatters: [
          (cell) => applyGradient(cell.trimEnd(), NINJA_THEME, 0.92) + cell.slice(cell.trimEnd().length),
          (cell) => applyGradient(cell, LEAF_THEME, 0.85),
          (cell) => applyGradient(cell, RASENGAN_THEME, 0.85),
          (cell) => applyGradient(cell, FIRE_THEME, 0.85),
          (cell) => applyGradient(cell, CHIDORI_THEME, 0.85)
        ]
      });
      log('');
      break;
    }
    case 'embed': {
      let clientType = 'antigravity';
      const claudeIdx = subArgs.indexOf('--claude');
      const cursorIdx = subArgs.indexOf('--cursor');
      const opencodeIdx = subArgs.indexOf('--opencode');

      if (claudeIdx >= 0) {
        clientType = 'claude';
        subArgs.splice(claudeIdx, 1);
      } else if (cursorIdx >= 0) {
        clientType = 'cursor';
        subArgs.splice(cursorIdx, 1);
      } else if (opencodeIdx >= 0) {
        clientType = 'opencode';
        subArgs.splice(opencodeIdx, 1);
      }

      const agentName = subArgs[0];
      const modelInput = subArgs.slice(1).join(' ');
      if (!agentName || !modelInput) {
        error('Usage: konoha models embed <agent-name> <model-name> [--cursor|--claude|--opencode]');
        process.exit(1);
      }

      let resolvedModelString = '';
      try {
        const resolveModelString = (input) => {
          const searchStr = input.trim();

          if (searchStr.toLowerCase() === 'inherit') {
            return 'inherit';
          }

          if (!searchStr.includes('|')) {
            const foundModel = activeModelsList.find(m =>
              m.name.toLowerCase() === searchStr.toLowerCase() ||
              m.aliases.includes(searchStr.toLowerCase())
            );
            if (!foundModel) throw new Error(`Unknown model: "${input}"`);

            const defaultFallbackModelName = 'Gemini 3.1 Flash-Lite';
            if (foundModel.name !== defaultFallbackModelName) {
              return `${foundModel.name} | Fallback when fail ${defaultFallbackModelName}`;
            }
            return foundModel.name;
          }
          
          const parts = searchStr.split('|');
          const left = parts[0].trim();
          const right = parts[1].trim();
          
          const foundPrimary = activeModelsList.find(m => 
            m.name.toLowerCase() === left.toLowerCase() || 
            m.aliases.includes(left.toLowerCase())
          );
          if (!foundPrimary) throw new Error(`Unknown primary model: "${left}"`);
          
          let foundFallback = null;
          const sortedModels = [...activeModelsList].sort((a, b) => b.name.length - a.name.length);
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
        const updated = agentManager.updateAgentModel(agentName, resolvedModelString, clientType);
        if (updated) {
          success(`Successfully embedded model "${resolvedModelString}" into @${agentName} for ${clientType}`);
          info('Re-deployed team configurations.');
        } else {
          warn(`Model "${resolvedModelString}" is already embedded in @${agentName} for ${clientType}`);
        }
      } catch (err) {
        error(`Failed to embed model: ${err.message}`);
        process.exit(1);
      }
      break;
    }
    case 'reset': {
      try {
        const python = checkPython();
        if (python && fileExists(DB_PATH)) {
          const script = `
import sqlite3, sys
conn = sqlite3.connect(sys.argv[1])
conn.execute("DELETE FROM tool_calls;")
conn.commit()
print("success")
`.trim();
          const run = spawnSync(python, ['-c', script, DB_PATH], { encoding: 'utf-8', timeout: 3000 });
          if (run.status === 0 && run.stdout.trim() === 'success') {
            success('Successfully cleared local usage logs. Model quotas restored to 100%!');
          } else {
            error('Failed to clear local usage logs.');
          }
        } else {
          error('SQLite database or python command not found.');
        }
      } catch (err) {
        error(`Failed to reset: ${err.message}`);
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
  await chidoriTransition('version');
  const pkgPath = path.join(__dirname, '..', 'package.json');
  let currentVersion = '1.0.5';
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
  await chidoriTransition('upgrade');
  header('🔄 Upgrading Konoha');
  log(`  Preparing to upgrade Konoha to the latest version...`);

  let confirm;
  try {
    const prompts = await import('@inquirer/prompts');
    confirm = prompts.confirm;
  } catch (e) {
    error('Could not load @inquirer/prompts. Please run "npm install".');
    process.exit(1);
  }

  const doUpgrade = await confirm({ message: 'Proceed with upgrading Konoha and modify ~/.gemini configurations?', default: true });
  if (!doUpgrade) {
    warn('Upgrade aborted.');
    return;
  }

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

// cmdRender removed — visual comparison feature deprecated in favor of image/source-to-code (build_from_source)

async function cmdHelp() {
  await chidoriTransition('help');
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
  ${C.cyan}data${C.reset}          🧠 Manage SQLite active session history and prune database space.
  ${C.cyan}doctor${C.reset}        🩺 Run environment diagnostics to detect/fix integration issues.
  ${C.cyan}bridge${C.reset}        🌉 Manage multiple LLM bridge configurations (status, list, create, delete, enable, disable).

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

  ${C.dim}6. View database disk space and active session size:${C.reset}
     konoha data view

`);
}

function cmdDataHelp() {
  log(`
${C.cyan}konoha data${C.reset} — Manage SQLite active session history and database size

${C.bold}USAGE${C.reset}
  konoha data <subcommand>

${C.bold}SUBCOMMANDS${C.reset}
  ${C.cyan}view${C.reset}      📊 See how much disk size and records are in your database knowledge data.
  ${C.cyan}prune${C.reset}     🧹 Clean up old active sessions and usage logs, then vacuum disk space.
  ${C.cyan}export${C.reset}    📤 Export indexed skills and database knowledge into a Markdown report.
  ${C.cyan}vacuum${C.reset}    ⚡ Defragment and compress SQLite database file directly.

${C.bold}EXAMPLES${C.reset}
  ${C.dim}1. View current database statistics:${C.reset}
     konoha data view

  ${C.dim}2. Prune usage logs and clean database free space:${C.reset}
     konoha data prune

  ${C.dim}3. Export skills database to a Markdown persona file:${C.reset}
     konoha data export

  ${C.dim}4. Defragment and compress database size directly:${C.reset}
     konoha data vacuum
`);
}

async function cmdData(args) {
  await chidoriTransition('data');
  const subcommand = args[0];

  if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    cmdDataHelp();
    process.exit(0);
  }

  switch (subcommand) {
    case 'view':
      await cmdDataView();
      break;
    case 'prune':
      await cmdDataPrune();
      break;
    case 'export':
      await cmdDataExport();
      break;
    case 'vacuum':
      await cmdDataVacuum();
      break;
    default:
      error(`Unknown data subcommand: ${subcommand}`);
      cmdDataHelp();
      process.exit(1);
  }
}

function getBridgesConfigPath() {
  const dir = path.join(os.homedir(), '.konoha');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, 'bridges.json');
}

function loadBridges() {
  const p = getBridgesConfigPath();
  if (!fs.existsSync(p)) {
    const defaultBridges = [
      {
        name: 'antigravity',
        port: 11435,
        provider: 'antigravity',
        enabled: true
      }
    ];
    fs.writeFileSync(p, JSON.stringify(defaultBridges, null, 2) + '\n');
    return defaultBridges;
  }
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    return [];
  }
}

function saveBridges(bridges) {
  const p = getBridgesConfigPath();
  fs.writeFileSync(p, JSON.stringify(bridges, null, 2) + '\n');
}

function checkPortActive(port) {
  const net = require('net');
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(500);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, '127.0.0.1');
  });
}

function getNextAvailablePort(bridges) {
  let maxPort = 11435;
  for (const b of bridges) {
    if (b.port && b.port > maxPort) {
      maxPort = b.port;
    }
  }
  return maxPort + 1;
}

function cmdBridgeHelp() {
  header('Konoha Bridge Management');
  log(`
Usage:
  konoha bridge status                   Show status of all configured bridges
  konoha bridge list                     List all configured bridges in a table
  konoha bridge models                   List all served models by all active bridges
  konoha bridge create <bridge name>     Create a new bridge configuration (supports OpenAI providers)
  konoha bridge delete <bridge name>     Delete a bridge configuration
  konoha bridge enable <bridge name>     Enable a bridge configuration
  konoha bridge disable <bridge name>    Disable a bridge configuration

Examples:
  konoha bridge create my-openai
  konoha bridge enable my-openai
  konoha bridge status
`);
}

async function cmdBridge(args) {
  const subcommand = args[0];
  const subArgs = args.slice(1);

  if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    cmdBridgeHelp();
    process.exit(0);
  }

  switch (subcommand) {
    case 'status':
      await cmdBridgeStatus();
      break;
    case 'list':
      await cmdBridgeList();
      break;
    case 'models':
      await cmdBridgeModels();
      break;
    case 'delete':
      await cmdBridgeDelete(subArgs[0]);
      break;
    case 'enable':
      await cmdBridgeEnable(subArgs[0]);
      break;
    case 'disable':
      await cmdBridgeDisable(subArgs[0]);
      break;
    case 'create':
      await cmdBridgeCreate(subArgs[0]);
      break;
    default:
      error(`Unknown bridge subcommand: ${subcommand}`);
      log(`Run ${C.cyan}konoha bridge help${C.reset} for usage.`);
      process.exit(1);
  }
}

async function cmdBridgeList() {
  const bridges = loadBridges();
  header('Configured Bridges');

  if (bridges.length === 0) {
    log('  No bridges configured.');
    return;
  }

  const rows = [];
  for (const b of bridges) {
    const active = await checkPortActive(b.port);
    rows.push([
      b.name,
      String(b.port),
      b.provider,
      b.enabled ? 'Enabled' : 'Disabled',
      active ? 'Running' : 'Stopped',
      b.targetUrl || '-'
    ]);
  }

  const headers = ['Name', 'Port', 'Provider', 'Configured Status', 'Runtime Status', 'Target URL'];
  const widths = computeTableWidths(headers, rows, { minWidths: [15, 6, 12, 10, 10, 20] });
  drawTable(headers, widths, ['left', 'left', 'left', 'left', 'left', 'left'], rows, [], RASENGAN_THEME, {
    columnFormatters: [
      (cell) => applyGradient(cell.trimEnd(), RASENGAN_THEME, 0.9) + cell.slice(cell.trimEnd().length),
      (cell) => cell,
      (cell) => cell,
      (cell) => cell.includes('Enabled') ? `${C.green}${cell}${C.reset}` : `${C.dim}${cell}${C.reset}`,
      (cell) => cell.includes('Running') ? `${C.green}${cell}${C.reset}` : `${C.red}${cell}${C.reset}`,
      (cell) => cell
    ]
  });
}

async function cmdBridgeModels() {
  const http = require('http');
  header('Served Models via Proxy Gateway');

  const gatewayActive = await checkPortActive(11434);
  if (!gatewayActive) {
    error('Proxy Gateway is not running on port 11434.');
    warn('Ensure the konoha-files MCP server is running to start the gateway and enabled bridges.');
    return;
  }

  try {
    const modelsData = await new Promise((resolve, reject) => {
      const req = http.get('http://127.0.0.1:11434/v1/models', (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Failed to parse models response JSON.'));
          }
        });
      });
      req.on('error', (err) => {
        reject(err);
      });
      req.setTimeout(2000, () => {
        req.destroy();
        reject(new Error('Request timed out.'));
      });
    });

    if (!modelsData || !Array.isArray(modelsData.data) || modelsData.data.length === 0) {
      log('  No models are currently served by any active bridges.');
      return;
    }

    const rows = [];
    for (const m of modelsData.data) {
      const idx = m.id.indexOf('-');
      let bridge = '-';
      let baseModel = m.id;
      if (idx !== -1) {
        bridge = m.id.substring(0, idx);
        baseModel = m.id.substring(idx + 1);
      }
      rows.push([
        bridge,
        baseModel,
        m.id,
        m.owned_by || '-'
      ]);
    }

    const headers = ['Bridge', 'Base Model Name', 'Full Alias Model ID', 'Owned By'];
    const widths = computeTableWidths(headers, rows, { minWidths: [12, 25, 45, 12] });
    drawTable(headers, widths, ['left', 'left', 'left', 'left'], rows, [], RASENGAN_THEME, {
      columnFormatters: [
        (cell) => applyGradient(cell.trimEnd(), RASENGAN_THEME, 0.9) + cell.slice(cell.trimEnd().length),
        (cell) => cell,
        (cell) => `${C.bold}${cell}${C.reset}`,
        (cell) => cell
      ]
    });
  } catch (err) {
    error(`Failed to query served models: ${err.message}`);
  }
}

async function cmdBridgeStatus() {
  const bridges = loadBridges();
  header('Bridge Status Report');

  const gatewayActive = await checkPortActive(11434);
  log(`  ${C.bold}Proxy Gateway${C.reset} on port ${C.bold}11434${C.reset}: ${gatewayActive ? `${C.green}● RUNNING${C.reset}` : `${C.red}○ STOPPED${C.reset}`}`);
  log('  ────────────────────────────────────────────────────────────');

  let activeCount = 0;
  for (const b of bridges) {
    const active = await checkPortActive(b.port);
    const statusStr = active 
      ? `${C.green}● RUNNING${C.reset}` 
      : (b.enabled ? `${C.red}○ STOPPED (Enabled)${C.reset}` : `${C.dim}○ DISABLED${C.reset}`);
    
    log(`  ${applyGradient(b.name, RASENGAN_THEME)} on port ${C.bold}${b.port}${C.reset} [${b.provider}]: ${statusStr}`);
    if (b.targetUrl) {
      log(`    ${C.dim}Target URL: ${b.targetUrl}${C.reset}`);
    }
    if (active) {
      activeCount++;
    }
  }

  log('');
  if (activeCount > 0) {
    success(`${activeCount} bridge(s) active and listening.`);
  } else {
    warn('No active bridges are currently running. Ensure the konoha-files MCP server is running to start enabled bridges.');
  }
}

async function cmdBridgeDelete(name) {
  if (!name) {
    error('Please specify a bridge name to delete.');
    log(`Usage: ${C.cyan}konoha bridge delete <bridge name>${C.reset}`);
    process.exit(1);
  }

  const bridges = loadBridges();
  const index = bridges.findIndex(b => b.name === name);
  if (index === -1) {
    error(`Bridge "${name}" not found.`);
    process.exit(1);
  }

  const deleted = bridges.splice(index, 1)[0];
  saveBridges(bridges);
  success(`Deleted bridge "${deleted.name}".`);
}

async function cmdBridgeEnable(name) {
  if (!name) {
    error('Please specify a bridge name to enable.');
    log(`Usage: ${C.cyan}konoha bridge enable <bridge name>${C.reset}`);
    process.exit(1);
  }

  const bridges = loadBridges();
  const bridge = bridges.find(b => b.name === name);
  if (!bridge) {
    error(`Bridge "${name}" not found.`);
    process.exit(1);
  }

  if (bridge.enabled) {
    warn(`Bridge "${name}" is already enabled.`);
    return;
  }

  bridge.enabled = true;
  saveBridges(bridges);
  success(`Enabled bridge "${name}". The runtime has been started automatically.`);
}

async function cmdBridgeDisable(name) {
  if (!name) {
    error('Please specify a bridge name to disable.');
    log(`Usage: ${C.cyan}konoha bridge disable <bridge name>${C.reset}`);
    process.exit(1);
  }

  const bridges = loadBridges();
  const bridge = bridges.find(b => b.name === name);
  if (!bridge) {
    error(`Bridge "${name}" not found.`);
    process.exit(1);
  }

  if (!bridge.enabled) {
    warn(`Bridge "${name}" is already disabled.`);
    return;
  }

  bridge.enabled = false;
  saveBridges(bridges);
  success(`Disabled bridge "${name}". The runtime has been stopped automatically.`);
}

async function cmdBridgeCreate(name) {
  let bridgeName = name;
  if (!bridgeName) {
    bridgeName = await askQuestion('Enter bridge name: ');
    if (!bridgeName) {
      error('Bridge name is required.');
      process.exit(1);
    }
  }

  const nameRegex = /^[a-zA-Z0-9_-]+$/;
  if (!nameRegex.test(bridgeName)) {
    error('Invalid bridge name. Use only alphanumeric characters, hyphens, and underscores.');
    process.exit(1);
  }

  const bridges = loadBridges();
  if (bridges.some(b => b.name === bridgeName)) {
    error(`Bridge "${bridgeName}" already exists.`);
    process.exit(1);
  }

  log(`\nCreating bridge "${C.bold}${bridgeName}${C.reset}"...\n`);

  let provider = await askQuestion('Enter provider (antigravity / openai) [default: openai]: ');
  provider = provider.toLowerCase() || 'openai';
  if (provider !== 'antigravity' && provider !== 'openai') {
    error('Invalid provider. Must be "antigravity" or "openai".');
    process.exit(1);
  }

  const defaultPort = getNextAvailablePort(bridges);
  let portStr = await askQuestion(`Enter local port [default: ${defaultPort}]: `);
  let port = portStr ? parseInt(portStr, 10) : defaultPort;
  if (isNaN(port) || port <= 0 || port > 65535) {
    error('Invalid port number.');
    process.exit(1);
  }

  if (bridges.some(b => b.port === port)) {
    error(`Port ${port} is already configured for another bridge.`);
    process.exit(1);
  }

  let targetUrl = '';
  let apiKey = '';

  if (provider === 'openai') {
    while (!targetUrl) {
      targetUrl = await askQuestion('Enter OpenAI-compatible target URL (e.g. https://api.openai.com/v1): ');
      if (!targetUrl) {
        warn('Target URL is required for OpenAI provider.');
      }
    }
    apiKey = await askQuestion('Enter API Key (optional): ');
  }

  const newBridge = {
    name: bridgeName,
    port,
    provider,
    enabled: true
  };

  if (provider === 'openai') {
    newBridge.targetUrl = targetUrl;
    if (apiKey) {
      newBridge.apiKey = apiKey;
    }
  }

  bridges.push(newBridge);
  saveBridges(bridges);

  success(`Successfully created bridge "${bridgeName}"!`);
  log(`  Port: ${port}`);
  log(`  Provider: ${provider}`);
  if (provider === 'openai') {
    log(`  Target URL: ${targetUrl}`);
    log(`  API Key: ${apiKey ? '••••••••' : '(none)'}`);
  }
}

async function cmdDataView() {
  try {
    const python = checkPython();
    if (python && fileExists(DB_PATH)) {
      const script = `
import sqlite3, os, sys, json
db_path = sys.argv[1]
conn = sqlite3.connect(db_path)
db_size = os.path.getsize(db_path) if os.path.exists(db_path) else 0

try:
    skills_count = conn.execute("SELECT COUNT(*) FROM skills").fetchone()[0]
except Exception:
    skills_count = 0

try:
    tool_calls_count = conn.execute("SELECT COUNT(*) FROM tool_calls").fetchone()[0]
except Exception:
    tool_calls_count = 0

try:
    sessions_count = conn.execute("SELECT COUNT(*) FROM active_sessions").fetchone()[0]
except Exception:
    sessions_count = 0

try:
    page_count = conn.execute("PRAGMA page_count;").fetchone()[0]
    freelist_count = conn.execute("PRAGMA freelist_count;").fetchone()[0]
    page_size = conn.execute("PRAGMA page_size;").fetchone()[0]
    freelist_size = freelist_count * page_size
except Exception:
    freelist_size = 0

print(json.dumps({
    "db_size": db_size,
    "skills_count": skills_count,
    "tool_calls_count": tool_calls_count,
    "sessions_count": sessions_count,
    "freelist_size": freelist_size
}))
`.trim();
      const run = spawnSync(python, ['-c', script, DB_PATH], { encoding: 'utf-8', timeout: 5000 });
      if (run.status === 0) {
        const data = JSON.parse(run.stdout.trim());
        const sizeMb = (data.db_size / (1024 * 1024)).toFixed(2);
        const freeMb = (data.freelist_size / (1024 * 1024)).toFixed(2);
        
        log(`\n${C.cyan}📊 Konoha Database Statistics${C.reset}`);
        log(`════════════════════════════════════════════════════════════`);
        log(`  ${C.bold}Database path:${C.reset}  ${DB_PATH}`);
        log(`  ${C.bold}Disk Size:${C.reset}      ${sizeMb} MB`);
        log(`  ${C.bold}Indexed Skills:${C.reset} ${data.skills_count} skills`);
        log(`  ${C.bold}Usage Logs:${C.reset}     ${data.tool_calls_count} records`);
        log(`  ${C.bold}Active Sessions:${C.reset} ${data.sessions_count} sessions`);
        log(`  ${C.bold}Prunable Space:${C.reset}  ${freeMb} MB (vacuumable)`);
        log(`════════════════════════════════════════════════════════════`);
        log(`Use ${C.cyan}konoha data prune${C.reset} to clear usage logs and shrink database size.\n`);
      } else {
        error(`Failed to retrieve database statistics: ${run.stderr}`);
      }
    } else {
      error('SQLite database or python command not found.');
    }
  } catch (err) {
    error(`Failed to view database statistics: ${err.message}`);
  }
}

async function cmdDataPrune() {
  try {
    const python = checkPython();
    if (python && fileExists(DB_PATH)) {
      info('Pruning database (clearing session history, old usage logs)...');
      const script = `
import sqlite3, os, sys, json
db_path = sys.argv[1]
conn = sqlite3.connect(db_path)
size_before = os.path.getsize(db_path) if os.path.exists(db_path) else 0

# Prune tables
try:
    conn.execute("DELETE FROM tool_calls;")
except Exception:
    pass

try:
    conn.execute("DELETE FROM active_sessions;")
except Exception:
    pass

conn.commit()

# Compress
try:
    conn.execute("VACUUM;")
except Exception:
    pass

size_after = os.path.getsize(db_path) if os.path.exists(db_path) else 0
print(json.dumps({
    "size_before": size_before,
    "size_after": size_after,
    "saved": max(size_before - size_after, 0)
}))
`.trim();
      const run = spawnSync(python, ['-c', script, DB_PATH], { encoding: 'utf-8', timeout: 10000 });
      if (run.status === 0) {
        const data = JSON.parse(run.stdout.trim());
        const sizeBeforeMb = (data.size_before / (1024 * 1024)).toFixed(2);
        const sizeAfterMb = (data.size_after / (1024 * 1024)).toFixed(2);
        const savedMb = (data.saved / (1024 * 1024)).toFixed(2);

        success('Successfully pruned active session mappings and usage logs!');
        log(`  ${C.bold}Size Before:${C.reset} ${sizeBeforeMb} MB`);
        log(`  ${C.bold}Size After:${C.reset}  ${sizeAfterMb} MB`);
        log(`  ${C.bold}Disk Reclaimed:${C.reset} ${C.green}${savedMb} MB${C.reset}`);
      } else {
        error(`Failed to prune database: ${run.stderr}`);
      }
    } else {
      error('SQLite database or python command not found.');
    }
  } catch (err) {
    error(`Failed to prune database: ${err.message}`);
  }
}

async function cmdDataVacuum() {
  try {
    const python = checkPython();
    if (python && fileExists(DB_PATH)) {
      info('Vacuuming database (compressing SQLite files and reclaiming disk space)...');
      const script = `
import sqlite3, os, sys, json
db_path = sys.argv[1]
conn = sqlite3.connect(db_path)
size_before = os.path.getsize(db_path) if os.path.exists(db_path) else 0

# Compress
try:
    conn.execute("VACUUM;")
except Exception:
    pass

size_after = os.path.getsize(db_path) if os.path.exists(db_path) else 0
print(json.dumps({
    "size_before": size_before,
    "size_after": size_after,
    "saved": max(size_before - size_after, 0)
}))
`.trim();
      const run = spawnSync(python, ['-c', script, DB_PATH], { encoding: 'utf-8', timeout: 10000 });
      if (run.status === 0) {
        const data = JSON.parse(run.stdout.trim());
        const sizeBeforeMb = (data.size_before / (1024 * 1024)).toFixed(2);
        const sizeAfterMb = (data.size_after / (1024 * 1024)).toFixed(2);
        const savedMb = (data.saved / (1024 * 1024)).toFixed(2);

        success('Successfully vacuumed database!');
        log(`  ${C.bold}Size Before:${C.reset} ${sizeBeforeMb} MB`);
        log(`  ${C.bold}Size After:${C.reset}  ${sizeAfterMb} MB`);
        log(`  ${C.bold}Disk Reclaimed:${C.reset} ${C.green}${savedMb} MB${C.reset}`);
      } else {
        error(`Failed to vacuum database: ${run.stderr}`);
      }
    } else {
      error('SQLite database or python command not found.');
    }
  } catch (err) {
    error(`Failed to vacuum database: ${err.message}`);
  }
}

async function cmdDataExport() {
  try {
    const python = checkPython();
    if (python && fileExists(DB_PATH)) {
      const now = new Date();
      const dd = String(now.getDate()).padStart(2, '0');
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const yy = String(now.getFullYear()).slice(-2);
      const ms = String(now.getMilliseconds()).padStart(3, '0');
      const filename = `konoha-persona-${dd}${mm}${yy}${ms}.md`;
      const exportPath = path.join(process.cwd(), filename);

      info(`Exporting database to Markdown at ${exportPath}...`);

      const script = `
import sqlite3, sys, os, json
db_path = sys.argv[1]
export_path = sys.argv[2]
conn = sqlite3.connect(db_path)

try:
    skills = conn.execute("SELECT name, skill_name, type, tags, content, byte_size, line_count FROM skills ORDER BY name ASC").fetchall()
except Exception as e:
    skills = []

try:
    sessions = conn.execute("SELECT client, workspace_root, session_id, last_active_at FROM active_sessions ORDER BY last_active_at DESC").fetchall()
except Exception:
    sessions = []

try:
    tool_calls_sum = conn.execute("SELECT COUNT(*), SUM(bytes_saved), SUM(tokens_saved) FROM tool_calls").fetchone()
except Exception:
    tool_calls_sum = (0, 0, 0)

with open(export_path, "w", encoding="utf-8") as f:
    f.write("# 🍃 Konoha Persona & Knowledge Export\\n\\n")
    f.write(f"Generated Database Dump: {db_path}\\n")
    f.write("This file contains the structured skills, agent identities, and active sessions database.\\n\\n")
    
    f.write("## 👤 Special Agent Village Roster\\n")
    agents_path = os.path.expanduser("~/.agents/agents.json")
    if os.path.exists(agents_path):
        try:
            with open(agents_path, "r", encoding="utf-8") as af:
                agents_data = json.load(af)
            for a in agents_data:
                icon = a.get("icon", "👤")
                f.write(f"- **{icon} {a.get('name')}** (Model: {a.get('modelTier')}): {a.get('description')}\\n")
        except Exception:
            f.write("Failed to load agents configuration.\\n")
    else:
        f.write("No ~/.agents/agents.json found.\\n")
    f.write("\\n")
    
    f.write("## 📚 Indexed Reference Skills\\n")
    if not skills:
        f.write("No skills currently indexed in the SQLite database.\\n")
    else:
        for name, skill_name, stype, tags, content, size, lines in skills:
            f.write(f"### 📦 {name} ({stype})\\n")
            f.write(f"- **Skill Group**: {skill_name}\\n")
            f.write(f"- **Tags**: {tags or ''}\\n")
            f.write(f"- **Size**: {size} bytes ({lines} lines)\\n\\n")
            f.write("#### Instruction Content:\\n")
            f.write("\`\`\`markdown\\n")
            f.write(content.strip() + "\\n")
            f.write("\`\`\`\\n\\n")
            f.write("---\\n\\n")

    f.write("## 📊 Active Workspace Sessions\\n")
    if not sessions:
        f.write("No active workspace sessions recorded.\\n")
    else:
        f.write("| Client | Workspace Root | Session ID | Last Active |\\n")
        f.write("| --- | --- | --- | --- |\\n")
        for client, root, sess_id, last_active in sessions:
            f.write(f"| {client} | {root} | {sess_id} | {last_active} |\\n")
    f.write("\\n")

    f.write("## 📉 Token Telemetry Summary\\n")
    calls, bytes_saved, tokens_saved = tool_calls_sum
    f.write(f"- **Total Tool Invocations**: {calls or 0}\\n")
    f.write(f"- **Cumulative Bytes Saved**: {bytes_saved or 0} bytes\\n")
    f.write(f"- **Cumulative Tokens Saved**: {tokens_saved or 0} tokens\\n")

print("success")
`.trim();
      const run = spawnSync(python, ['-c', script, DB_PATH, exportPath], { encoding: 'utf-8', timeout: 15000 });
      if (run.status === 0 && run.stdout.trim() === 'success') {
        success(`Successfully exported database knowledge base to ${exportPath}!`);
      } else {
        error(`Failed to export database: ${run.stderr}`);
      }
    } else {
      error('SQLite database or python command not found.');
    }
  } catch (err) {
    error(`Failed to export database: ${err.message}`);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

const [,, command, ...args] = process.argv;

async function main() {
  if (command === undefined || command === 'init') {
    await runSplashScreen();
  }

  // Silent auto-setup on every command (except help/uninstall)
  const skipAutoSetup = ['uninstall', 'help', '--help', '-h'].includes(command);
  if (!skipAutoSetup) {
    try {
      ensureAutoSetup();
    } catch (e) {
      // Never block CLI on auto-setup failures
    }
  }

  try {
    switch (command) {
      case 'init':
        await cmdInit(args);
        break;
      case 'migrate':
        await cmdMigrate(args);
        break;
      case 'test':
        await cmdTest();
        break;
      case 'status':
        await cmdStatus();
        break;
      case 'saving':
      case 'savings':
        await cmdSavings();
        break;
      case 'doctor':
        await cmdDoctor();
        break;
      case 'uninstall':
        await cmdUninstall();
        break;
      case 'version':
        await cmdVersion(args);
        break;
      case 'upgrade':
        await cmdUpgrade(args);
        break;
      case 'skill':
        await cmdSkill(args);
        break;
      case 'agent':
      case 'agents':
        await cmdAgent(args);
        break;
      case 'models':
        await cmdModels(args);
        break;
      case 'data':
        await cmdData(args);
        break;
      case 'bridge':
        await cmdBridge(args);
        break;
      case 'help':
      case '--help':
      case '-h':
        await cmdHelp();
        break;
      case undefined:
        await cmdHelp();
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
