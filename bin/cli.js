#!/usr/bin/env node

/**
 * konoha CLI
 * 
 * MCP Tools Orchestrator installer for Antigravity IDE/CLI and Cursor IDE/CLI.
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
const { execSync, spawnSync } = require('child_process');
const readline = require('readline');
const https = require('https');

const agentManager = require('../src/agent_manager');
const skillManager = require('../src/skill_manager');
const cursorManager = require('../src/cursor_manager');
const mcpClientsManager = require('../src/mcp_clients_manager');
const opencodeManager = require('../src/opencode_manager');
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
        
        const headers = [' ', 'Subagent', 'Title', 'Active Skills'];
        const aligns = ['left', 'left', 'left', 'left'];

        const rows = agents.map((a, idx) => {
          const skillsList = a.skills && a.skills.length > 0 ? a.skills.join(', ') : 'None';
          const indicator = idx === selectedIndex ? '➔' : ' ';
          return [
            indicator,
            `${a.icon || '👤'} @${a.name}`,
            a.title || 'Ninja',
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
        
        const rowColors = agents.map((_, idx) => {
          if (idx === selectedIndex) {
            return [C.bold + C.yellow, C.bold + C.cyan, C.bold + C.white, C.bold + C.magenta];
          }
          return [C.dim, C.cyan, C.reset, C.bold + C.magenta];
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
      // Colorize non-border chars (spaces etc.) with the border color at this position
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
  
  // Pure separator line with CHIDORI_THEME
  const sepLen = Math.max(60, msg.length + 4);
  const sepLine = '═'.repeat(sepLen);
  
  log(applyGradient(sepLine, CHIDORI_THEME));
}

function divider() {
  log(applyGradient('═'.repeat(60), CHIDORI_THEME));
}

function startSpinner(text) {
  log(`  ${C.dim}›${C.reset} ${text}`);
  return {
    stop() {},
    start(newText) { if (newText) log(`  ${C.dim}›${C.reset} ${newText}`); },
    update(newText) { if (newText) log(`  ${C.dim}›${C.reset} ${newText}`); },
    success(successText) { log(`  ${C.green}✓${C.reset} ${successText || text}`); },
    warn(warnText) { log(`  ${C.yellow}⚠${C.reset} ${warnText || text}`); },
    error(errText) { log(`  ${C.red}✗${C.reset} ${errText || text}`); },
  };
}


function drawLogo() {
  
  const textLines = [
    "| |/ /  / _ \\ | \\| | / _ \\ | || |   / \\  ",
    "| ' /  | | | || .` || | | || __ |  / _ \\ ",
    "|_|\\_\\  \\___/ |_|\\_| \\___/ |_||_| /_/ \\_\\",
    `${C.bold}Konoha${C.reset} — MCP Tools Orchestrator`,
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

function hasCompleteDatabaseSchema(python) {
  if (!python || !fileExists(DB_PATH)) return false;
  const script = [
    'import sqlite3, sys',
    'conn = sqlite3.connect(sys.argv[1])',
    'required = {"skills", "skills_fts", "tool_calls", "active_sessions", "agents", "bridges"}',
    'actual = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type=\\\'table\\\'")}',
    'raise SystemExit(0 if required.issubset(actual) else 1)'
  ].join('; ');
  try {
    return spawnSync(python, ['-c', script, DB_PATH], { encoding: 'utf-8', timeout: 5000 }).status === 0;
  } catch {
    return false;
  }
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

function hasCanonicalGeninSkill(skillsDir) {
  return fileExists(path.join(skillsDir, 'genin-skill', 'SKILL.md'));
}

function verifySkillDatabaseContract(python, requiredSkill = 'genin-skill') {
  if (!python || !fileExists(DB_PATH)) {
    return { ok: false, reason: 'skills database is unavailable' };
  }
  const script = [
    'import json, sqlite3, sys',
    'conn = sqlite3.connect(sys.argv[1])',
    'required = sys.argv[2]',
    'has_required = bool(conn.execute("SELECT 1 FROM skills WHERE name = ?", (required,)).fetchone())',
    'legacy = [row[0] for row in conn.execute("SELECT name FROM skills WHERE name LIKE \'deep-code-explorer%\' OR skill_name = \'deep-code-explorer\'")]',
    'print(json.dumps({"has_required": has_required, "legacy": legacy}))'
  ].join('; ');
  try {
    const result = spawnSync(python, ['-c', script, DB_PATH, requiredSkill], {
      encoding: 'utf-8', timeout: 5000
    });
    if (result.status !== 0) {
      return { ok: false, reason: (result.stderr || '').trim() || 'skill database query failed' };
    }
    const report = JSON.parse((result.stdout || '').trim());
    if (!report.has_required) {
      return { ok: false, reason: `required skill ${requiredSkill} is not indexed` };
    }
    if (report.legacy.length > 0) {
      return { ok: false, reason: `legacy skill rows remain: ${report.legacy.join(', ')}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

// ─── Transition Helper ────────────────────────────────────────────────────────

async function chidoriTransition(command) {
  log(`  ${C.dim}› Konoha ${command}${C.reset}`);
}

// ─── Commands ────────────────────────────────────────────────────────────────

async function cmdInit(args) {
  drawLogo();
  
  header('🚀 Konoha Installer');
  log(`${C.dim}MCP Tools Orchestrator for Antigravity IDE/CLI${C.reset}`);
  log(`${C.dim}Reduces token usage by 83-98% via on-demand skill search${C.reset}\n`);

  let confirm;
  const isNonInteractive = args.includes('--yes') || args.includes('-y') || process.env.CI === 'true';
  if (!isNonInteractive) {
    try {
      const prompts = await import('@inquirer/prompts');
      confirm = prompts.confirm;
    } catch (e) {
      error('Could not load @inquirer/prompts. Please run "pnpm install".');
      process.exit(1);
    }
  }

  const doInit = isNonInteractive ? true : await confirm({ message: 'Initialize Konoha and modify ~/.gemini configurations?', default: true });
  if (!doInit) {
    warn('Initialization aborted.');
    return;
  }

  // Auto-configure all detected MCP clients without prompting.
  // Only the "Initialize Konoha?" consent prompt above is asked.
  // Skipped silently when the client is not detected.
  const allowAutoApprove = true;
  const allowHooks = true;
  const cursorInstalled = cursorManager.isCursorInstalled();
  const claudeInstalled = mcpClientsManager.isClaudeCodeInstalled();
  const openCodeInstalled = opencodeManager.isOpenCodeInstalled();
  const commandCodeInstalled = mcpClientsManager.isCommandCodeInstalled();
  const allowCursor = cursorInstalled;
  const allowClaudeCode = claudeInstalled;
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

  // 2b. Ensure uv is installed (dependency for semble and uvx-based MCP tools)
  const spinner1b = startSpinner('Checking uv (Python package manager)...');
  let uvInstalled = installUv(false);
  if (!uvInstalled) {
    try {
      execSync('uv --version', { stdio: 'ignore' });
      uvInstalled = true;
      spinner1b.success('uv is available on PATH.');
    } catch {
      spinner1b.warn('uv not found — semble MCP will install lazily on first use.');
    }
  } else {
    spinner1b.success('uv installed successfully.');
  }

  if (args.includes('--force')) {
    const sembleRefresh = refreshSemblePackage(true);
    if (!sembleRefresh.ok) warn(`Semble refresh skipped: ${sembleRefresh.reason}`);
  }

  // 3. Check for existing installation
  if (fileExists(SERVER_PATH) && hasCompleteDatabaseSchema(python)) {
    warn('Konoha MCP already installed.');
    info(`Database: ${DB_PATH}`);
    info(`Server:   ${SERVER_PATH}`);
    log('');
    info('Use "konoha migrate" to re-index skills.');
    info('Use "konoha status" to check status.');

    if (!args.includes('--force')) {
      log(`\n${C.dim}Run with --force to reinstall.${C.reset}`);
      info('Refreshing MCP integrations...');
      const refreshFiles = ['server.py', 'migrate.py', 'db_stats.py', 'db_savings.py', 'db_bridges.py', 'agent_stats.py', 'prompt_hook.js', 'antigravity_subagent_hook.js', 'antigravity_tool_sanitize_hook.js', 'hook-base.js', 'antigravity_manager.js', 'agent_contract.js', 'cursor_bootstrap.js'];
      refreshFiles.forEach(f => {
        const src = path.join(SRC_DIR, f);
        const dest = path.join(SKILLS_DB_DIR, f);
        if (fileExists(src)) copyIfDifferent(src, dest);
      });
      installFileTools(true);
      autoInstallKonohaBridgeExtension(true);
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
          agents: agentsForSetup,
          projectRoot: currentCwd,
          deployProject: true
        });
      }
      if (openCodeInstalled) {
        opencodeManager.ensureOpenCodeSetup({
          pythonCmd: python,
          serverPath: SERVER_PATH,
          uvxCmd: getUvxCommand(),
          silent: true
        });
      }
      if (commandCodeInstalled) {
        mcpClientsManager.ensureCommandCodeSetup({
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
    const sembleRefresh = refreshSemblePackage(true);
    if (!sembleRefresh.ok) warn(`Semble refresh skipped: ${sembleRefresh.reason}`);
  }

  // 3. Detect skills directories
  const pkgSkillsDir = path.join(__dirname, '..', '.agents', 'skills');
  if (!hasCanonicalGeninSkill(pkgSkillsDir)) {
    error(`Packaged canonical skill missing: ${path.join(pkgSkillsDir, 'genin-skill', 'SKILL.md')}`);
    process.exit(1);
  }
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
  const globalSkillsDir = path.join(HOME, '.agents', 'skills');
  if (fileExists(pkgSkillsDir)) {
    ensureDir(globalSkillsDir);
    try {
      const files = fs.readdirSync(pkgSkillsDir, { withFileTypes: true });
      files.forEach(entry => {
        const name = entry.name;
        if (name === '.' || name === '..') return;
        const srcPath = path.join(pkgSkillsDir, name);
        const destPath = path.join(globalSkillsDir, name);
        if (entry.isDirectory()) {
          copyRecursive(srcPath, destPath);
        } else if (entry.isFile()) {
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
  const agentContractSrc = path.join(SRC_DIR, 'agent_contract.js');
  const agentContractDest = path.join(SKILLS_DB_DIR, 'agent_contract.js');
  if (fileExists(agentContractSrc)) {
    copyFile(agentContractSrc, agentContractDest);
  }

  const sanitizeHookSrc = path.join(SRC_DIR, 'antigravity_tool_sanitize_hook.js');
  const sanitizeHookDest = path.join(SKILLS_DB_DIR, 'antigravity_tool_sanitize_hook.js');
  if (fileExists(sanitizeHookSrc)) {
    copyFile(sanitizeHookSrc, sanitizeHookDest);
  }

  const hookBaseSrc = path.join(SRC_DIR, 'hook-base.js');
  const hookBaseDest = path.join(SKILLS_DB_DIR, 'hook-base.js');
  if (fileExists(hookBaseSrc)) {
    copyFile(hookBaseSrc, hookBaseDest);
  }

  const cursorBootstrapSrc = path.join(SRC_DIR, 'cursor_bootstrap.js');
  const cursorBootstrapDest = path.join(SKILLS_DB_DIR, 'cursor_bootstrap.js');
  if (fileExists(cursorBootstrapSrc)) {
    copyFile(cursorBootstrapSrc, cursorBootstrapDest);
  }
  installFileTools(true);
  spinner3.success('All files installed to ~/.konoha/');

  // Install or refresh Konoha Bridge extension for Antigravity IDE
  autoInstallKonohaBridgeExtension(true, true);

  // 5. Run migration and always initialize the complete SQLite schema.
  header('📊 Seeding Default Subagent Skills to SQLite FTS5');
  const skills = fileExists(pkgSkillsDir) ? detectCustomSkills(pkgSkillsDir) : [];
  const spinnerMigrate = startSpinner(skills.length > 0 ? `Seeding default skills from: ${pkgSkillsDir}...` : 'Initializing empty skills database schema...');
  const migrationArgs = skills.length > 0
    ? ['--clean', '--skills-dir', pkgSkillsDir, '--skills', ...skills, '--require-skill', 'genin-skill']
    : ['--clean', '--require-skill', 'genin-skill'];
  const run = spawnSync(python, [MIGRATE_PATH, ...migrationArgs], {
    encoding: 'utf-8', cwd: SKILLS_DB_DIR, timeout: 30000
  });
  if (run.status !== 0) {
    spinnerMigrate.error(`Failed to initialize skills database: ${run.stderr || run.stdout || 'Migration failed'}`);
    process.exit(1);
  }
  const skillContract = verifySkillDatabaseContract(python);
  if (!skillContract.ok) {
    spinnerMigrate.error(`Skill database contract failed: ${skillContract.reason}`);
    process.exit(1);
  }
  spinnerMigrate.success(skills.length > 0 ? 'Default subagent skills seeded successfully.' : 'Empty skills database schema initialized.');
  try {
    const schemaCheck = spawnSync(python, ['-c', `import sqlite3; c=sqlite3.connect(${JSON.stringify(DB_PATH)}); names={r[0] for r in c.execute("select name from sqlite_master where type='table'")}; missing={'skills','skills_fts','tool_calls','active_sessions','agents','bridges'}-names; raise SystemExit(1 if missing else 0)`], { encoding: 'utf-8', timeout: 5000 });
    if (schemaCheck.status !== 0) throw new Error('required SQLite schema is incomplete');
  } catch (schemaError) {
    error(`SQLite schema verification failed: ${schemaError.message}`);
    process.exit(1);
  }

  // 6. Register MCP config
  header('⚙️  Registering MCP Server');
  const spinner4 = startSpinner('Registering in ~/.gemini/config/mcp_config.json...');
  registerMcp(python, true, allowAutoApprove);
  spinner4.success('konoha registered in MCP config.');

  // Register Hooks config
  header('🔗 Registering Hooks');
  const spinnerHook = startSpinner(allowHooks ? 'Registering prompt hook in ~/.gemini/config/hooks.json...' : 'Removing prompt hook from ~/.gemini/config/hooks.json...');
  registerHooks(false, allowHooks);
  spinnerHook.success(allowHooks ? 'prompt_hook registered in hooks.json.' : 'prompt_hook removed/unregistered from hooks.json.');

  // 7. Update agents.yaml
  header('👥 Updating agents.yaml');
  const spinner5 = startSpinner('Adding on-demand skills usage rules...');
  agentManager.loadAgents(); // Silently updates YAML/DB
  agentManager.regenerateAndDeploy({ force: true, silent: true });
  spinner5.success('agents.yaml updated.');

  // 8. Install and deploy RTK rules when the toolchain is available
  const rtkSpinner = startSpinner('Checking RTK (Rust Token Killer)...');
  const rtkInstall = args.includes('--force')
    ? antigravityManager.refreshRtk(false)
    : antigravityManager.ensureRtkInstalled(false);
  const rtkResult = antigravityManager.deployAntigravityRtkRule(true);
  if (rtkResult.ok) {
    rtkSpinner.success(`RTK rules deployed to ${rtkResult.deployed} Antigravity location(s).`);
  } else if (rtkResult.reason === 'rtk-not-installed') {
    rtkSpinner.warn('RTK not installed on this system — skipping RTK rule deployment. Install: cargo install rtk');
  } else {
    rtkSpinner.warn(`RTK rule deployment skipped: ${rtkResult.reason}`);
  }

  // 10. Configure Cursor IDE/CLI
  const setupAgents = agentManager.loadAgents();
  if (allowCursor) {
    header('🖱️  Configuring Cursor IDE/CLI');
    const spinner7 = startSpinner('Registering Cursor MCP, subagents, and hooks...');
    const uvxCmd = getUvxCommand();
    const cursorSetup = cursorManager.ensureCursorSetup({
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
    if (cursorSetup.ok) spinner7.success('Cursor IDE/CLI configured.');
    else spinner7.warn(`Cursor setup skipped: ${cursorSetup.reason || 'unknown error'}`);
  }

  // 10b. Configure Claude Code (when CLI detected)
  if (allowClaudeCode) {
    header('🤖 Configuring Claude Code');
    const spinnerClaude = startSpinner('Registering Claude Code MCP servers...');
    const uvxCmd = getUvxCommand();
    const claudeSetup = mcpClientsManager.ensureClaudeCodeSetup({
      pythonCmd: python,
      serverPath: SERVER_PATH,
      uvxCmd,
      ruleContent: agentManager.generateClaudeCodeMd(setupAgents),
      silent: true,
      agents: setupAgents,
      projectRoot: currentCwd,
      deployProject: true
    });
    if (claudeSetup.ok) spinnerClaude.success('Claude Code MCP configured.');
    else spinnerClaude.warn(`Claude Code setup skipped: ${claudeSetup.reason || 'unknown error'}`);
  } else if (!claudeInstalled) {
    info('Claude Code not detected — skip auto-setup (see docs/templates/claude-code.mcp.json if you install later).');
  }

  if (openCodeInstalled) {
    header('🟢 Configuring OpenCode');
    const spinnerOpenCode = startSpinner('Registering OpenCode MCP servers and RTK rules...');
    const openCodeSetup = opencodeManager.ensureOpenCodeSetup({
      pythonCmd: python,
      serverPath: SERVER_PATH,
      uvxCmd: getUvxCommand(),
      silent: true
    });
    if (openCodeSetup.ok) spinnerOpenCode.success('OpenCode MCP and RTK configured.');
    else spinnerOpenCode.warn(`OpenCode setup skipped: ${openCodeSetup.reason || 'unknown error'}`);
  }

  if (commandCodeInstalled) {
    header('⚡ Configuring Command Code');
    const spinnerCommandCode = startSpinner('Registering Command Code MCP servers and RTK rules...');
    const commandCodeSetup = mcpClientsManager.ensureCommandCodeSetup({
      pythonCmd: python,
      serverPath: SERVER_PATH,
      uvxCmd: getUvxCommand(),
      silent: true
    });
    if (commandCodeSetup.ok) spinnerCommandCode.success('Command Code MCP and RTK configured.');
    else spinnerCommandCode.warn(`Command Code setup skipped: ${commandCodeSetup.reason || 'unknown error'}`);
  }

  // 11. Summary
  header('✅ Installation Complete!');

  // Per-client auto-config summary
  const ok = `${C.green}✓${C.reset}`;
  const skip = `${C.dim}✗${C.reset}`;
  const summaryLines = [
    `Auto-configured clients:`,
    `${ok} Antigravity   ${C.dim}~/.gemini/config/mcp_config.json + hooks${C.reset}`,
    allowCursor
      ? `${ok} Cursor        ${C.dim}~/.cursor/mcp.yaml + subagents${C.reset}`
      : `${skip} Cursor        ${C.dim}(not installed)${C.reset}`,
    claudeInstalled
      ? `${ok} Claude Code   ${C.dim}~/.claude.json + RTK${C.reset}`
      : `${skip} Claude Code   ${C.dim}(not installed)${C.reset}`,
    openCodeInstalled
      ? `${ok} OpenCode     ${C.dim}~/.opencode/config.json + RTK${C.reset}`
      : `${skip} OpenCode     ${C.dim}(not installed)${C.reset}`,
    commandCodeInstalled
      ? `${ok} Command Code ${C.dim}~/.commandcode/mcp.json + RTK${C.reset}`
      : `${skip} Command Code ${C.dim}(not installed)${C.reset}`,
    '─',
    `Installed files:`,
    `Server:     ${C.dim}${SERVER_PATH}${C.reset}`,
    `Migration:  ${C.dim}${MIGRATE_PATH}${C.reset}`,
    `Database:   ${C.dim}${DB_PATH}${C.reset}`,
    `MCP Config: ${C.dim}${MCP_CONFIG_PATH}${C.reset}`,
    `Agents YAML: ${C.dim}${path.join(HOME, '.agents', 'agents.yaml')}${C.reset}`,
    `Cursor MCP: ${C.dim}${cursorManager.CURSOR_MCP_GLOBAL}${C.reset}`,
    `Cursor Agents: ${C.dim}${cursorManager.CURSOR_AGENTS_GLOBAL}${C.reset}`,
  ];
  drawBox('Installed Files', summaryLines, LEAF_THEME);
  log('');

  info(`${C.bold}Next steps:${C.reset}`);
  log(`  1. Restart your agentic IDE/CLI (Antigravity, Cursor${claudeInstalled ? ', Claude Code' : ''}${openCodeInstalled ? ', OpenCode' : ''}${commandCodeInstalled ? ', Command Code' : ''}) to load MCP servers`);
  log(`  2. Test execution: ${C.cyan}konoha test${C.reset}`);
  log(`  3. Check status:   ${C.cyan}konoha status${C.reset}`);
  log('');
}

function installUv(silent = false) {
  // Skip if uv is already on PATH — saves ~12s per CLI invocation
  try {
    execSync('uv --version', { stdio: 'ignore' });
    return true;
  } catch {}

  if (!silent) info('Attempting to auto-install "uv" for Semble MCP...');
  try {
    const stdioOpt = silent ? 'ignore' : 'inherit';
    if (process.platform === 'win32') {
      try {
        execSync('powershell -ExecutionPolicy Bypass -Command "irm https://astral.sh/uv/install.ps1 | iex"', { stdio: stdioOpt });
      } catch (psErr) {
        if (!silent) warn(`PowerShell uv installer failed: ${psErr.message}. Falling back to winget if available.`);
        try {
          execSync('winget install --id astral-sh.uv -e --source winget', { stdio: stdioOpt });
        } catch (wingetErr) {
          throw psErr;
        }
      }
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

function refreshSemblePackage(silent = true) {
  const uvxCmd = getUvxCommand();
  try {
    const result = spawnSync(uvxCmd, ['--from', 'semble[mcp]@latest', 'semble', '--version'], {
      encoding: 'utf8', timeout: 120000, stdio: silent ? 'ignore' : 'inherit'
    });
    return result.status === 0
      ? { ok: true, command: uvxCmd }
      : { ok: false, reason: `semble-refresh-failed-${result.status}` };
  } catch (error) {
    return { ok: false, reason: 'semble-refresh-failed', error: error.message };
  }
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

function autoInstallKonohaBridgeExtension(silent = false, forceRefresh = false) {
  const KONOHA_BRIDGE_REPO = 'https://github.com/andycungkrinx91/konoha-bridge';
  const KONOHA_BRIDGE_REF = 'master';
  const targetDirName = 'andycungkrinx91.konoha-bridge-master-universal';
  const detection = antigravityManager.detectAntigravityIde();

  if (!detection.present) {
    if (!silent) info(`Skipping konoha-bridge extension: ${detection.reason}.`);
    return { installed: false, skipped: true, reason: 'antigravity-ide-not-detected' };
  }

  const extensionDir = path.join(HOME, '.antigravity-ide', 'extensions');
  const targetPath = path.join(extensionDir, targetDirName);
  const installedPackage = path.join(targetPath, 'package.json');
  const manifestPath = path.join(SKILLS_DB_DIR, 'konoha-bridge.json');
  const readPackage = (packagePath) => {
    try { return JSON.parse(fs.readFileSync(packagePath, 'utf8')); } catch { return null; }
  };
  const validatePackage = (packagePath) => {
    const pkg = readPackage(packagePath);
    const bridgePort = pkg?.contributes?.configuration?.properties?.['agLocalBridge.port']?.default;
    return !!pkg && pkg.publisher === 'andycungkrinx91' &&
      pkg.name === 'konoha-bridge' && bridgePort === 1313 &&
      typeof pkg.main === 'string' && pkg.main.endsWith('src/extension.js');
  };

  if (!forceRefresh && fileExists(targetPath) && validatePackage(installedPackage)) {
    antigravityManager.syncAntigravityExtensionRegistry(extensionDir, targetDirName, readPackage(installedPackage));
    if (!silent) log(`  ⚡ Konoha Bridge master extension already installed.`);
    return { installed: true, skipped: true, path: targetPath, ref: KONOHA_BRIDGE_REF };
  }

  if (!silent) info(`Installing Konoha Bridge from ${KONOHA_BRIDGE_REF} for Antigravity IDE...`);
  const token = `${process.pid}-${Date.now()}`;
  const tmpClone = path.join(SKILLS_DB_DIR, 'tmp', `bridge-clone-${token}`);
  const stagingPath = path.join(extensionDir, `.konoha-bridge-${token}.staging`);
  const backupPath = `${targetPath}.backup-${token}`;
  let backupCreated = false;

  try {
    ensureDir(path.dirname(tmpClone));
    const cloneRes = spawnSync('git', ['clone', '--branch', KONOHA_BRIDGE_REF, '--depth', '1', KONOHA_BRIDGE_REPO, tmpClone], { encoding: 'utf8' });
    if (cloneRes.status !== 0 || !fileExists(tmpClone)) {
      throw new Error(`git clone failed for ${KONOHA_BRIDGE_REF} (exit ${cloneRes.status})`);
    }
    const branchRes = spawnSync('git', ['-C', tmpClone, 'branch', '--show-current'], { encoding: 'utf8' });
    const commitRes = spawnSync('git', ['-C', tmpClone, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
    const branch = (branchRes.stdout || '').trim();
    const commit = (commitRes.stdout || '').trim();
    if (branch !== KONOHA_BRIDGE_REF || !/^[0-9a-f]{40}$/i.test(commit)) {
      throw new Error('cloned extension is not a valid master branch checkout');
    }
    if (!validatePackage(path.join(tmpClone, 'package.json'))) {
      throw new Error('cloned package metadata is not a valid konoha-bridge extension');
    }

    ensureDir(extensionDir);
    fs.rmSync(stagingPath, { recursive: true, force: true });
    fs.cpSync(tmpClone, stagingPath, { recursive: true });
    if (!validatePackage(path.join(stagingPath, 'package.json'))) {
      throw new Error('staged extension package validation failed');
    }

    if (fileExists(targetPath)) {
      fs.renameSync(targetPath, backupPath);
      backupCreated = true;
    }
    fs.renameSync(stagingPath, targetPath);
    if (!validatePackage(installedPackage)) {
      throw new Error('installed extension package validation failed');
    }

    ensureDir(SKILLS_DB_DIR);
    fs.writeFileSync(manifestPath, JSON.stringify({
      repository: KONOHA_BRIDGE_REPO,
      ref: KONOHA_BRIDGE_REF,
      commit,
      path: targetPath,
      package: readPackage(installedPackage)
    }, null, 2) + '\n');

    if (backupCreated) {
      fs.rmSync(backupPath, { recursive: true, force: true });
      backupCreated = false;
    }

    for (const entry of fs.readdirSync(extensionDir)) {
      if (entry.startsWith('andycungkrinx91.konoha-bridge-') && entry !== targetDirName) {
        fs.rmSync(path.join(extensionDir, entry), { recursive: true, force: true });
      }
    }
    antigravityManager.syncAntigravityExtensionRegistry(extensionDir, targetDirName, readPackage(installedPackage));
    if (!silent) success(`Konoha Bridge master extension installed at ${targetPath} (${commit.slice(0, 12)}).`);
    return { installed: true, skipped: false, path: targetPath, ref: KONOHA_BRIDGE_REF, commit };
  } catch (err) {
    try { fs.rmSync(stagingPath, { recursive: true, force: true }); } catch {}
    if (backupCreated && fileExists(targetPath)) {
      try { fs.rmSync(targetPath, { recursive: true, force: true }); } catch {}
    }
    if (backupCreated && !fileExists(targetPath) && fileExists(backupPath)) {
      try { fs.renameSync(backupPath, targetPath); } catch {}
    }
    if (!silent) warn(`Failed to auto-install konoha-bridge extension: ${err.message}`);
    return { installed: false, skipped: false, reason: err.message };
  } finally {
    try { fs.rmSync(tmpClone, { recursive: true, force: true }); } catch {}
  }
}

function registerMcp(_python, silent = false, allowAutoApprove = true) {
  ensureDir(path.dirname(MCP_CONFIG_PATH));

  // Backup existing config once before replacing
  const backupPath = MCP_CONFIG_PATH + '.back';
  if (fileExists(MCP_CONFIG_PATH) && !fileExists(backupPath)) {
    fs.copyFileSync(MCP_CONFIG_PATH, backupPath);
    if (!silent) info(`Backed up existing config → ${path.basename(backupPath)}`);
  }

  // Load existing non-MCP config keys to preserve (e.g. other settings)
  let config = { mcpServers: {} };
  if (fileExists(MCP_CONFIG_PATH)) {
    try {
      config = JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, 'utf-8'));
      if (!config.mcpServers) config.mcpServers = {};
    } catch {
      if (!silent) warn(`Invalid JSON in ${MCP_CONFIG_PATH}, starting fresh.`);
      config = { mcpServers: {} };
    }
  } else {
    if (!silent) info('Creating new MCP config...');
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

  const konohaConfig = deployUtils.buildKonohaFilesMcpEntry('execPath');
  if (konohaConfig && allowAutoApprove) {
    konohaConfig.autoApprove = [
      '*',
      'read_file_head',
      'read_file_range',
      'file_info',
      'token_efficient_grep',
      'get_file_structure',
      'find_files_clean',
      'find_skill',
      'list_skills',
      'get_skill',
      'optimize_report',
      'build_from_source',
      'build_from_text',
      'sannin',
      'kage',
      'jonin',
      'anbu',
      'chunin',
      'tokubetsu_jonin',
      'genin'
    ];
  }

  // Merge Konoha servers into existing mcpServers (preserve user's other servers)
  config.mcpServers['semble'] = sembleConfig;
  if (konohaConfig) config.mcpServers['konoha'] = konohaConfig;
  delete config.mcpServers['skills-db'];
  delete config.mcpServers['konoha-files'];

  if (!silent) {
    success(`Registered 'semble' and 'konoha' MCP servers.`);
  }

  fs.writeFileSync(MCP_CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
  if (!silent) {
    success(`Merged Konoha servers into: ${MCP_CONFIG_PATH}`);
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
    const allowRaw = settings.permissions.allow;
    settings.permissions.allow = Array.isArray(allowRaw) ? allowRaw : [];

    const requiredGrants = [
      'command(node bin/cli.js)',
      'command(konoha)',
      'command(node "' + path.join(SKILLS_DB_DIR, 'prompt_hook.js') + '")',
      'mcp(semble/search)',
      'mcp(semble/find_related)',
      'mcp(semble/*)',
      'mcp(konoha/read_file_head)',
      'mcp(konoha/read_file_range)',
      'mcp(konoha/file_info)',
      'mcp(konoha/token_efficient_grep)',
      'mcp(konoha/get_file_structure)',
      'mcp(konoha/find_files_clean)',
      'mcp(konoha/find_skill)',
      'mcp(konoha/list_skills)',
      'mcp(konoha/get_skill)',
      'mcp(konoha/optimize_report)',
      'mcp(konoha/build_from_source)',
      'mcp(konoha/build_from_text)',
      'mcp(konoha/*)'
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

    const allowArr = settings.permissions && Array.isArray(settings.permissions.allow) ? settings.permissions.allow : [];
    if (allowArr.length > 0) {
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
        'mcp(konoha/find_skill)',
        'mcp(konoha/list_skills)',
        'mcp(konoha/get_skill)',
        'mcp(konoha/optimize_report)',
        'mcp(konoha/*)',
        'mcp(konoha/read_file_head)',
        'mcp(konoha/read_file_range)',
        'mcp(konoha/file_info)',
        'mcp(konoha/token_efficient_grep)',
        'mcp(konoha/get_file_structure)',
        'mcp(konoha/find_files_clean)',
        'mcp(konoha/find_skill)',
        'mcp(konoha/list_skills)',
        'mcp(konoha/get_skill)',
        'mcp(konoha/optimize_report)',
        'mcp(konoha/build_from_source)',
        'mcp(konoha/build_from_text)',
        'mcp(konoha/*)'
      ];

      const initialLength = allowArr.length;
      const filtered = allowArr.filter(
        (grant) => !requiredGrants.includes(grant)
      );

      if (filtered.length !== initialLength) {
        settings.permissions.allow = filtered;
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

// Fast mtime+size fingerprint for a directory tree. Returns "mtime:count:size".
// If two trees have the same fingerprint, they are guaranteed identical.
function _treeFingerprint(root) {
  let maxMtime = 0;
  let count = 0;
  let totalSize = 0;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const p = path.join(dir, entry.name);
      try {
        const st = fs.statSync(p);
        if (st.isDirectory()) { stack.push(p); }
        else { count++; totalSize += st.size; if (st.mtimeMs > maxMtime) maxMtime = st.mtimeMs; }
      } catch {}
    }
  }
  return `${maxMtime.toFixed(0)}:${count}:${totalSize}`;
}

// Copy srcRoot → destRoot only when files have actually changed.
// Uses a fingerprint marker so the first walk is cached forever unless
// the source tree changes (mtime or size of any file).
function copySkillsDirFast(srcRoot, destRoot) {
  if (!fileExists(srcRoot)) return;
  ensureDir(destRoot);
  const srcFp = _treeFingerprint(srcRoot);
  const fpMarker = destRoot + '.fingerprint';
  let destFp = null;
  try { destFp = fs.readFileSync(fpMarker, 'utf-8').trim(); } catch {}
  if (srcFp === destFp) return;

  const walk = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const s = path.join(dir, entry.name);
      const d = path.join(destRoot, path.relative(srcRoot, s));
      if (entry.isDirectory()) {
        ensureDir(d);
        walk(s);
      } else if (entry.isFile()) {
        try {
          const ss = fs.statSync(s);
          let needsCopy = true;
          try {
            const ds = fs.statSync(d);
            needsCopy = ss.mtimeMs > ds.mtimeMs || ss.size !== ds.size;
          } catch {}
          if (needsCopy) {
            fs.copyFileSync(s, d);
            try { fs.utimesSync(d, ss.atime, ss.mtime); } catch {}
          }
        } catch {}
      }
    }
  };
  walk(srcRoot);
  try { fs.writeFileSync(fpMarker, srcFp); } catch {}
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
  // --- PERF MARKER ---
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
  const filesToCopy = ['server.py', 'migrate.py', 'db_stats.py', 'db_savings.py', 'db_bridges.py', 'agent_stats.py', 'prompt_hook.js', 'antigravity_subagent_hook.js', 'antigravity_tool_sanitize_hook.js', 'hook-base.js', 'antigravity_manager.js', 'agent_contract.js', 'cursor_bootstrap.js'];
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
  copySkillsDirFast(pkgSkillsDir, globalSkillsDir);

  // 3 & 4. Configure settings.json permissions & register skills-db and semble in mcp_config.json silently
  autoInstallKonohaBridgeExtension(true);
  const python = checkPython() || 'python3';
  installUv(true); // Quiet install for semble/uvx
  registerMcp(python, true);
  registerHooks(true, true);

  // 5. Ensure agents.yaml is initialized with defaults if missing
  const agentsYamlPath = path.join(HOME, '.agents', 'agents.yaml');
  if (!fileExists(agentsYamlPath)) {
    try {
      agentManager.loadAgents(false, true); // Silently initializes USER_AGENTS_YAML_PATH if missing
    } catch (e) {}
  }

  // 6. Ensure subagents and client integrations are fully deployed/updated.
  // Reconcile on every startup so new and resumed sessions cannot retain stale contracts.
  {
    const originalLog = console.log;
    console.log = () => {};
    let uvxCmd = 'uvx';
    try {
      uvxCmd = getUvxCommand();
    } catch (e) {
      // ignore
    }
    try {
      agentManager.regenerateAndDeploy({
        pythonCmd: python,
        serverPath: SERVER_PATH,
        uvxCmd,
        projectRoot: currentCwd,
        deployProject: false,
        force: true,
        silent: true
      });
    } catch (e) {
      // ignore
    } finally {
      console.log = originalLog;
    }
  }

  // 6a. Deploy RTK rules for Antigravity
  try {
    antigravityManager.deployAntigravityRtkRule(true);
  } catch (e) {
    // ignore — silent self-heal
  }

  // 6b. Auto-configure detected MCP clients (Cursor / Claude Code)
  // Detection-based skip; no prompts. Mirrors the cmdInit zero-prompt flow.
  const autoSetupAgents = (() => {
    try { return agentManager.loadAgents(false, true); } catch { return []; }
  })();
  if (cursorManager.isCursorInstalled()) {
    try {
      cursorManager.ensureCursorSetup({
        pythonCmd: python,
        serverPath: SERVER_PATH,
        uvxCmd,
        agents: autoSetupAgents,
        projectRoot: currentCwd,
        deployProject: false,
        silent: true,
        allowHooks: true,
        ruleContent: null
      });
    } catch (e) {
      // ignore — silent self-heal
    }
  }
  if (mcpClientsManager.isClaudeCodeInstalled()) {
    try {
      mcpClientsManager.ensureClaudeCodeSetup({
        pythonCmd: python,
        serverPath: SERVER_PATH,
        uvxCmd,
        ruleContent: agentManager.generateClaudeCodeMd(autoSetupAgents),
        silent: true,
        agents: autoSetupAgents,
        projectRoot: currentCwd,
        injectRtk: true,
        deployProject: false
      });
    } catch (e) {
      // ignore — silent self-heal
    }
  }
  if (opencodeManager.isOpenCodeInstalled()) {
    try {
      opencodeManager.ensureOpenCodeSetup({
        pythonCmd: python,
        serverPath: SERVER_PATH,
        uvxCmd,
        silent: true
      });
    } catch (e) {
      // ignore — silent self-heal
    }
  }
  if (mcpClientsManager.isCommandCodeInstalled()) {
    try {
      mcpClientsManager.ensureCommandCodeSetup({
        pythonCmd: python,
        serverPath: SERVER_PATH,
        uvxCmd,
        silent: true
      });
    } catch (e) {
      // ignore — silent self-heal
    }
  }

  // 7. Silently trigger migration if database file (skills.db) is missing
  if (!fileExists(DB_PATH)) {
    if (!hasCanonicalGeninSkill(pkgSkillsDir)) {
      throw new Error(`Packaged canonical skill missing: ${path.join(pkgSkillsDir, 'genin-skill', 'SKILL.md')}`);
    }
    if (fileExists(pkgSkillsDir)) {
      const skills = detectCustomSkills(pkgSkillsDir);
      if (skills.length > 0) {
        try {
          spawnSync(python, [MIGRATE_PATH, '--skills-dir', pkgSkillsDir, '--skills', ...skills, '--require-skill', 'genin-skill'], {
            encoding: 'utf-8', cwd: SKILLS_DB_DIR, timeout: 30000
          });
        } catch (e) {
          try {
            spawnSync(python, [MIGRATE_PATH, '--require-skill', 'genin-skill'], {
              encoding: 'utf-8', cwd: SKILLS_DB_DIR, timeout: 30000
            });
          } catch (e2) {}
        }
      }
    } else {
      try {
        spawnSync(python, [MIGRATE_PATH, '--require-skill', 'genin-skill'], {
          encoding: 'utf-8', cwd: SKILLS_DB_DIR, timeout: 30000
        });
      } catch (e) {}
    }
  }
}

function updateGeminiMd(silent = false) {
  agentManager.regenerateAndDeploy(silent);
}


function moveUnusedSkills(skillsDirs, agents) {
  const activeSkills = new Set();
  for (const agent of agents) {
    if (agent.skills && Array.isArray(agent.skills)) {
      for (const s of agent.skills) {
        const parent = s.split('/')[0];
        const cleanParent = parent.endsWith('.md') ? parent.slice(0, -3) : parent;
        activeSkills.add(cleanParent.toLowerCase());
      }
    }
  }

  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const yyyymmdd = `${yyyy}${mm}${dd}`;

  for (const dirObj of skillsDirs) {
    const skillsDir = dirObj.path;
    if (!fileExists(skillsDir)) continue;

    const absSkillsDir = path.resolve(skillsDir);
    const projectAgentsSkills = path.resolve(currentCwd, '.agents', 'skills');
    const projectAgentSkills = path.resolve(currentCwd, '.agent', 'skills');
    if ((absSkillsDir === projectAgentsSkills || absSkillsDir === projectAgentSkills) && currentCwd !== HOME) {
      info(`Skipping pruning for project-level skills directory: ${skillsDir}`);
      continue;
    }

    let entries = [];
    try {
      entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    } catch (e) {
      continue;
    }

    const backupSkillsDir = path.join(HOME, '.agents.backup', 'skills');

    for (const entry of entries) {
      const skillName = entry.name;
      let isSkill = false;

      if (entry.isDirectory() && fileExists(path.join(skillsDir, skillName, 'SKILL.md'))) {
        isSkill = true;
      } else if (entry.isFile() && skillName.endsWith('-skill.md')) {
        isSkill = true;
      }

      if (!isSkill) continue;

      const cleanName = skillName.endsWith('.md') ? skillName.slice(0, -3) : skillName;
      if (!activeSkills.has(cleanName.toLowerCase())) {
        const srcPath = path.join(skillsDir, skillName);
        const destPath = path.join(backupSkillsDir, `${cleanName}-${yyyymmdd}${entry.isFile() ? '.md' : ''}`);

        info(`🧹 Found unused/unembedded skill "${skillName}". Moving to backup...`);
        try {
          fs.mkdirSync(backupSkillsDir, { recursive: true });
          if (fs.existsSync(destPath)) {
            fs.rmSync(destPath, { recursive: true, force: true });
          }
          fs.renameSync(srcPath, destPath);
          success(`✓ Moved: ${skillName} ➔ ${destPath}`);
        } catch (err) {
          warn(`⚠️ Failed to move ${skillName}: ${err.message}`);
        }
      }
    }
  }
}

async function cmdMigrate(args) {
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

  const hasForce = args.includes('--force');
  if (hasForce) {
    info('Pruning unused/unembedded skills to prevent duplicate content...');
    const agents = agentManager.loadAgents();
    const skillsDirs = detectSkillsDirs();
    moveUnusedSkills(skillsDirs, agents);
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
  header('🧪 Testing Konoha MCP Server');

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
    { name: 'Get Skill (jonin-skill)', req: '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"get_skill","arguments":{"name":"jonin-skill","agent":"jonin"}}}' },
    { name: 'Get Skill (konoha)', req: '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"get_skill","arguments":{"name":"konoha","agent":"kage"}}}' },
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

  // Dynamically discover and run Python test suites (src/test_*.py)
  log('');
  header('🧪 Running Python Feature Tests (Full QA & Deep Debugging)');
  try {
    const srcDir = path.join(__dirname, '..', 'src');
    if (fs.existsSync(srcDir)) {
      const files = fs.readdirSync(srcDir);
      const testFiles = files.filter(f => f.startsWith('test_') && f.endsWith('.py'));
      for (const tf of testFiles) {
        const fp = path.join(srcDir, tf);
        info(`Running test suite: ${tf}...`);
        const runTest = spawnSync(python, [fp], { stdio: 'inherit' });
        if (runTest.status !== 0) {
          error(`${tf}: FAILED`);
          allPassed = false;
        } else {
          success(`${tf}: PASSED`);
        }
      }
    }
  } catch (e) {
    error(`Failed scanning or running Python tests: ${e.message}`);
    allPassed = false;
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
  drawLogo(false); // Static logo
  
  header('📋 Konoha MCP Status');

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

  const agyStatus = antigravityManager.getAntigravityStatus();
  const cursorStatus = cursorManager.getCursorStatus();
  const claudeStatus = mcpClientsManager.getClaudeCodeStatus();
  const cmdStatus = mcpClientsManager.getCommandCodeStatus();
  openCodeStatus = opencodeManager.getOpenCodeStatus();

  log(`  ${C.bold}${applyGradient('1. 🔌 MCP Clients Configuration', RASENGAN_THEME)}${C.reset}`);
  log(`  Auto-setup bridges Konoha directly into IDE and CLI configuration files.\n`);

    const printClientStatus = (name, configPath, isHealthy, mcpConfigExists, isInstalled = true) => {
    if (!isInstalled) {
      log(`  ${C.dim}•${C.reset} ${C.bold}${name}${C.reset} ${C.dim}(SKIPPED — client not installed)${C.reset}`);
      log(`     Config Path: ${C.dim}Not applicable${C.reset}`);
      log('');
      return;
    }
    const mark = isHealthy ? `${C.green}✔${C.reset}` : `${C.red}✖${C.reset}`;
    log(`  ${mark} ${C.bold}${name}${C.reset}`);
    log(`     Config Path: ${mcpConfigExists ? C.dim + configPath + C.reset : C.yellow + 'Not found/Not configured' + C.reset}`);
    if (mcpConfigExists) {
      log(`     Status:      ${isHealthy ? C.green + 'Healthy (Konoha MCP Registered)' + C.reset : C.red + 'Missing Konoha MCP' + C.reset}`);
      if (isHealthy) {
        log(`     Command:     ${C.dim}cmd: node /home/andycungkrinx/.konoha/file_tools_launcher.js${C.reset}`);
      }
    }
    log('');
  };

  printClientStatus('Antigravity IDE / CLI', '~/.gemini/config/mcp_config.json', agyStatus.mcpSkillsDb && agyStatus.mcpSemble, agyStatus.mcpConfigExists);
  printClientStatus('Cursor IDE', '~/.cursor/mcp.yaml', cursorStatus.mcpKonoha && cursorStatus.mcpSemble, cursorStatus.mcpGlobal, cursorManager.isCursorInstalled());
  printClientStatus('Claude Code CLI', '~/.claude.json', claudeStatus.mcpKonoha && claudeStatus.mcpSemble, claudeStatus.globalConfig, claudeStatus.installed);
  printClientStatus('OpenCode IDE', '~/.opencode/config.json', openCodeStatus.mcpKonoha && openCodeStatus.mcpSemble, openCodeStatus.configExists, openCodeStatus.installed);
  printClientStatus('Command Code CLI', '~/.commandcode/mcp.json', cmdStatus.mcpKonoha && cmdStatus.mcpSemble, cmdStatus.globalConfig, cmdStatus.installed);

  // Antigravity IDE/CLI integrations
  sectionTitle('Antigravity IDE/CLI Integrations:', NINJA_THEME);
  drawIntegrationRow(
    '~/.gemini/config/mcp_config.json',
    agyStatus.mcpSkillsDb && agyStatus.mcpSemble,
    agyStatus.mcpConfigExists ? 'konoha + semble' : 'not configured',
    NINJA_THEME
  );
  drawIntegrationRow(
    'Antigravity MCP schemas',
    agyStatus.schemasCount >= 7,
    `${agyStatus.schemasCount} in ~/.gemini/antigravity-cli/mcp/konoha/`,
    NINJA_THEME
  );
  drawIntegrationRow(
    'Sanitize Hook config',
    agyStatus.hasHooks,
    agyStatus.hasHooks ? 'sanitize hooks active' : 'hooks missing',
    NINJA_THEME
  );
  drawIntegrationRow(
    'RTK (Token Killer)',
    agyStatus.rtkInstalled,
    agyStatus.rtkInstalled
      ? 'rtk binary available — rules deployed to antigravity-cli/ide'
      : 'RTK not installed (install: cargo install rtk)',
    NINJA_THEME
  );

  // Cursor IDE/CLI integrations
  if (cursorManager.isCursorInstalled()) {
  sectionTitle('Cursor IDE/CLI Integrations:', NINJA_THEME);
  drawIntegrationRow(
    '~/.cursor/mcp.yaml',
    cursorStatus.mcpSkillsDb && cursorStatus.mcpSemble,
    cursorStatus.mcpGlobal ? 'konoha + semble' : 'not configured',
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
    `mcp:${cursorStatus.projectMcp ? 'yes' : 'no'} skills:${cursorStatus.skillsProject} rule:${cursorStatus.projectRule ? 'yes' : 'no'}`,
    NINJA_THEME
  );
  drawIntegrationRow(
    'RTK (Token Killer)',
    cursorStatus.rtkInstalled && cursorStatus.rtkRuleDeployed,
    cursorStatus.rtkInstalled
      ? (cursorStatus.rtkRuleDeployed ? 'rtk rule deployed to ~/.cursor/rules/' : 'rtk rule not deployed')
      : 'RTK not installed (install: cargo install rtk)',
    NINJA_THEME
  );
  } else {
    log(`\n  ${applyGradient('Cursor:', CHIDORI_THEME, 0.85)} ${applyGradient('not installed — skipped', CHIDORI_THEME, 0.6)}`);
  }

  // Claude Code integration (auto-configured when `claude` CLI is installed)
  if (claudeStatus.installed) {
    sectionTitle('Claude Code Integrations:', NINJA_THEME);
    const claudeOk = claudeStatus.mcpSkillsDb && claudeStatus.mcpSemble && claudeStatus.permissionsAllowed;
    drawIntegrationRow(
      '~/.claude.json',
      claudeOk,
      claudeStatus.permissionsAllowed ? 'konoha + semble' : 'konoha + semble (permissions missing)',
      NINJA_THEME
    );
    drawIntegrationRow(
      'RTK (Token Killer)',
      claudeStatus.rtkInstalled && claudeStatus.rtkRuleDeployed,
      claudeStatus.rtkInstalled
        ? (claudeStatus.rtkRuleDeployed ? 'rtk rule deployed to ~/.claude/rules/' : 'rtk rule not deployed')
        : 'RTK not installed (install: cargo install rtk)',
      NINJA_THEME
    );

  } else {
    log(`\n  ${applyGradient('Claude Code:', CHIDORI_THEME, 0.85)} ${applyGradient('not installed (template: docs/templates/claude-code.mcp.json)', CHIDORI_THEME, 0.6)}`);
  }

  // OpenCode integration (auto-configured when `opencode` CLI is installed)
  openCodeStatus = opencodeManager.getOpenCodeStatus();
  if (openCodeStatus.installed) {
    sectionTitle('OpenCode Integrations:', NINJA_THEME);
    const openCodeOk = openCodeStatus.mcpKonoha && openCodeStatus.mcpSemble;
    drawIntegrationRow(
      '~/.opencode/config.json',
      openCodeOk,
      'konoha + semble',
      NINJA_THEME
    );
    drawIntegrationRow(
      'RTK (Token Killer)',
      openCodeStatus.rtkRuleDeployed,
      openCodeStatus.rtkRuleDeployed ? 'rtk rule deployed to ~/.opencode/rules/' : 'rtk rule not deployed',
      NINJA_THEME
    );
  } else {
    log(`\n  ${applyGradient('OpenCode:', CHIDORI_THEME, 0.85)} ${applyGradient('not installed (see https://opencode.ai)', CHIDORI_THEME, 0.6)}`);
  }

  // Command Code integration
  const cmdCodeStatus = mcpClientsManager.getCommandCodeStatus();
  if (cmdCodeStatus.installed) {
    sectionTitle('Command Code Integrations:', NINJA_THEME);
    const cmdCodeOk = cmdCodeStatus.mcpKonoha && cmdCodeStatus.mcpSemble;
    drawIntegrationRow(
      '~/.commandcode/mcp.json',
      cmdCodeOk,
      'konoha + semble',
      NINJA_THEME
    );
    drawIntegrationRow(
      'RTK (Token Killer)',
      cmdCodeStatus.rtkRuleDeployed,
      cmdCodeStatus.rtkRuleDeployed ? 'rtk rule deployed to ~/.commandcode/rules/' : 'rtk rule not deployed',
      NINJA_THEME
    );
  } else {
    log(`\n  ${applyGradient('Command Code:', CHIDORI_THEME, 0.85)} ${applyGradient('not installed', CHIDORI_THEME, 0.6)}`);
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
  const agents = agentManager.loadAgents(true); // Force reload, silent
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
    'Skills Configuration'
  ];
  const subAligns = ['left', 'left'];
  const subRows = [];
  const subRowColors = [];

  agents.forEach(a => {
    const icon = a.icon || iconMap[a.name] || '👤';
    const displayName = `${icon} ${a.name.charAt(0).toUpperCase() + a.name.slice(1)}`;
    const activeSkills = a.skills && a.skills.length > 0 ? a.skills.join(', ') : 'None';

    subRows.push([displayName, activeSkills]);
    subRowColors.push(['', '']);
  });

  const subWidths = computeTableWidths(subHeaders, subRows, {
    minWidths: [18, 24],
    maxWidths: [24, 48]
  });
  drawTable(subHeaders, subWidths, subAligns, subRows, subRowColors, NINJA_THEME, {
    columnFormatters: [
      (cell) => applyGradient(cell.trimEnd(), NINJA_THEME, 0.92) + cell.slice(cell.trimEnd().length),
      (cell) => applyGradient(cell, CHIDORI_THEME, 0.85)
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
  drawLogo();
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
  if (fileExists(FILE_TOOLS_LAUNCHER_PATH) && process.platform !== 'win32') {
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
        record('File Tools MCP (konoha)', 'REPAIRED', 'Installed konoha MCP server and Python helpers');
        repairsDone++;
      } else {
        record('File Tools MCP (konoha)', 'FAILED', 'file_tools_mcp.js missing after install');
        hasErrors = true;
      }
    } catch (e) {
      record('File Tools MCP (konoha)', 'FAILED', e.message);
      hasErrors = true;
    }
  }

  const fileToolsSmoke = smokeTestKonohaFilesMcp(true);
  if (fileToolsSmoke.ok) {
    record('konoha MCP smoke test', 'HEALTHY', `${fileToolsSmoke.toolCount} tools via launcher`);
  } else {
    const directSmoke = smokeTestKonohaFilesMcp(false);
    if (directSmoke.ok) {
      record('konoha MCP smoke test', 'WARNING', `Launcher failed (${fileToolsSmoke.error}); direct node OK (${directSmoke.toolCount} tools)`);
      try {
        installFileTools(true);
        const retry = smokeTestKonohaFilesMcp(true);
        if (retry.ok) {
          record('konoha launcher', 'REPAIRED', 'Launcher script refreshed');
          repairsDone++;
        }
      } catch {}
    } else {
      record('konoha MCP smoke test', 'FAILED', directSmoke.error || fileToolsSmoke.error);
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
      const sembleOk = servers['semble'] &&
        JSON.stringify(servers['semble'].args || []) === JSON.stringify(expectedSembleArgs);
      const konohaOk = servers['konoha'] &&
        servers['konoha'].args &&
        (servers['konoha'].args[0] === FILE_TOOLS_MCP_PATH || servers['konoha'].args[0] === path.join(HOME, '.konoha', 'file_tools_launcher.js')) &&
        (servers['konoha'].command === nodeCmd || servers['konoha'].command === 'node');
      mcpHealthy = sembleOk && konohaOk;
    } catch {}
  }

  if (mcpHealthy) {
    record('MCP Config (mcp_config.json)', 'HEALTHY', 'konoha and semble are active');
  } else {
    if (!python) {
      record('MCP Config (mcp_config.json)', 'FAILED', 'Incomplete registration; missing Python 3');
      hasErrors = true;
    } else {
      try {
        registerMcp(python);
        record('MCP Config (mcp_config.json)', 'REPAIRED', 'Registered konoha and semble in config');
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

  // 9. AGENTS Definition (agents.yaml)
  const USER_AGENTS_YAML_PATH = path.join(HOME, '.agents', 'agents.yaml');
  let agentsHealthy = false;
  if (fileExists(USER_AGENTS_YAML_PATH)) {
    try {
      const content = fs.readFileSync(USER_AGENTS_YAML_PATH, 'utf-8');
      if (content.includes('name:') || content.includes('genin')) {
        agentsHealthy = true;
      }
    } catch {}
  }
  
  if (agentsHealthy) {
    record('AGENTS Definition (agents.yaml)', 'HEALTHY', 'Ninja ranks are active');
  } else {
    try {
      agentManager.loadAgents();
      record('AGENTS Definition (agents.yaml)', 'REPAIRED', 'agents.yaml configurations restored');
      repairsDone++;
    } catch (e) {
      record('AGENTS Definition (agents.yaml)', 'FAILED', `Error: ${e.message}`);
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

  // 9c. Cursor IDE/CLI Configuration (only when Cursor is installed)
  if (cursorManager.isCursorInstalled()) {
    const cursorStatus = cursorManager.getCursorStatus();
    const cursorHealthy = cursorStatus.mcpSkillsDb &&
      cursorStatus.mcpSemble &&
      cursorStatus.mcpKonoha;
    if (cursorHealthy) {
    record('Cursor IDE/CLI (~/.cursor/)', 'HEALTHY', 'MCP and hooks configured');
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
      if (repaired.mcpKonoha && repaired.mcpSemble) {
        record('Cursor IDE/CLI (~/.cursor/)', 'REPAIRED', 'Registered MCP and session hook');
        repairsDone++;
      } else {
        record('Cursor IDE/CLI (~/.cursor/)', 'WARNING', 'Partial Cursor setup — run konoha init');
      }
    } catch (e) {
      record('Cursor IDE/CLI (~/.cursor/)', 'FAILED', `Error: ${e.message}`);
      hasErrors = true;
    }
  }
  }

  // 9d. Claude Code Configuration (only when CLI installed)
  if (mcpClientsManager.isClaudeCodeInstalled()) {
    const claudeStatus = mcpClientsManager.getClaudeCodeStatus();
    const claudeHealthy =
      claudeStatus.mcpKonoha &&
      claudeStatus.mcpSemble &&
      claudeStatus.permissionsAllowed;
    if (claudeHealthy) {
      record('Claude Code (~/.claude.json)', 'HEALTHY', 'konoha and semble active & allowed');
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
        if (repaired.mcpKonoha && repaired.mcpSemble && repaired.permissionsAllowed) {
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

  // 9e. OpenCode Configuration
  if (opencodeManager.isOpenCodeInstalled()) {
    const openCodeStatus = opencodeManager.getOpenCodeStatus();
    const openCodeHealthy =
      openCodeStatus.mcpKonoha &&
      openCodeStatus.mcpSemble;
    if (openCodeHealthy) {
      record('OpenCode (~/.opencode/config.json)', 'HEALTHY', 'konoha and semble active');
    } else {
      try {
        const python = checkPython() || 'python3';
        const agents = agentManager.loadAgents();
        opencodeManager.ensureOpenCodeSetup({
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
        const repaired = opencodeManager.getOpenCodeStatus();
        if (repaired.mcpKonoha && repaired.mcpSemble) {
          record('OpenCode (~/.opencode/config.json)', 'REPAIRED', 'Registered MCP and session hook');
          repairsDone++;
        } else {
          record('OpenCode (~/.opencode/config.json)', 'WARNING', 'Partial OpenCode setup — run konoha init');
        }
      } catch (e) {
        record('OpenCode (~/.opencode/config.json)', 'FAILED', `Error: ${e.message}`);
        hasErrors = true;
      }
    }
  }

  // 9f. Command Code Configuration
  if (mcpClientsManager.isCommandCodeInstalled()) {
    const cmdStatus = mcpClientsManager.getCommandCodeStatus();
    const cmdHealthy = cmdStatus.mcpKonoha && cmdStatus.mcpSemble;
    if (cmdHealthy) {
      record('Command Code (~/.commandcode/mcp.json)', 'HEALTHY', 'konoha and semble active');
    } else {
      try {
        const python = checkPython() || 'python3';
        mcpClientsManager.ensureCommandCodeSetup({
          pythonCmd: python,
          serverPath: SERVER_PATH,
          uvxCmd: getUvxCommand(),
          silent: true
        });
        const repaired = mcpClientsManager.getCommandCodeStatus();
        if (repaired.mcpKonoha && repaired.mcpSemble) {
          record('Command Code (~/.commandcode/mcp.json)', 'REPAIRED', 'Registered Konoha MCP servers');
          repairsDone++;
        } else {
          record('Command Code (~/.commandcode/mcp.json)', 'WARNING', 'Partial Command Code setup — run konoha init');
        }
      } catch (e) {
        record('Command Code (~/.commandcode/mcp.json)', 'FAILED', `Error: ${e.message}`);
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
  header('🗑️  Uninstalling Konoha MCP');

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
      if (config.mcpServers && config.mcpServers['konoha']) {
        delete config.mcpServers['konoha'];
        success('Removed konoha from MCP config');
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
  success('Konoha MCP uninstalled.');
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
    success('Removed Konoha entries from Claude Code global MCP config (when present)');
  } catch {
    warn('Could not fully clean Claude Code configuration');
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
  drawLogo();
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

  // Load registered subagents (silent: true so we don't trigger regenerateAndDeploy and reprint the deploy banner)
  const agents = agentManager.loadAgents(false, true);

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
    const bareName = name.replace(/^mcp_/, '').replace(/^mcp-/, '');
    registeredNames.add(name);
    registeredNames.add(bareName);

    const agentStats = stats[name] || stats[bareName] || { today: 0, last7days: 0, alltime: 0 };
    displayAgents.push({
      name: `@${a.name}`,
      icon: a.icon || '👤',
      title: a.title,
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
    const bareName = lowerName.replace(/^mcp_/, '').replace(/^mcp-/, '');
    if (!registeredNames.has(lowerName) && !registeredNames.has(bareName)) {
      const agentStats = stats[name];
      directStats.today += agentStats.today;
      directStats.last7days += agentStats.last7days;
      directStats.alltime += agentStats.alltime;
    }
  });

  displayAgents.push({
    name: 'Direct Tool Calls',
    icon: '⚡',
    title: 'Non-agent / direct MCP tools usage',
    today: directStats.today,
    last7days: directStats.last7days,
    alltime: directStats.alltime,
    isRegistered: false
  });

  // Display Table
  sectionTitle('Call Frequency Summary:', NINJA_THEME);

  const headers = ['Subagent', 'Today', '7 Days', 'All Time'];
  const aligns = ['left', 'right', 'right', 'right'];

  const rows = displayAgents.map(da => [
    `${da.icon} ${da.name}`,
    da.today,
    da.last7days,
    da.alltime
  ]);

  const widths = computeTableWidths(headers, rows, {
    minWidths: [18, 6, 8, 10],
    maxWidths: [22, 8, 10, 12]
  });

  drawTable(headers, widths, aligns, rows, [], NINJA_THEME, {
    columnFormatters: [
      (cell) => applyGradient(cell.trimEnd(), NINJA_THEME, 0.92) + cell.slice(cell.trimEnd().length),
      (cell) => applyGradient(cell, CHIDORI_THEME, 0.85),
      (cell) => applyGradient(cell, LEAF_THEME, 0.9),
      (cell) => applyGradient(cell, FIRE_THEME, 0.9)
    ]
  });
  log('');
}

async function cmdSavings() {
  drawLogo();
  
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
      log(`\n  ${C.bold}${applyGradient('1. ⚡ Konoha MCP Savings', LEAF_THEME)}${C.reset}`);

      const run = spawnSync(python, [scriptToUse, DB_PATH], {
        encoding: 'utf-8',
        timeout: 5000
      });
      if (run.status !== 0) throw new Error(run.stderr || 'Savings query failed');
      const output = run.stdout;
      const stats = JSON.parse(output.trim());

      const actualBaselineKB = (stats.today.db_size_bytes ?? stats.alltime.db_size_bytes ?? 550000) / 1024;
      log(`     ${C.dim}Calculated relative to full context index sizing (${actualBaselineKB.toFixed(0)} KB actual baseline)${C.reset}\n`);
      
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
          const width = 10;
          const pctSafe = pct || 0;
          const filledCount = Math.min(width, Math.max(0, Math.round((pctSafe / 100) * width)));
          const filled = '█'.repeat(filledCount);
          const empty = '░'.repeat(width - filledCount);
          
          let coloredFilled = '';
          if (filledCount > 0) {
            const theme = pctSafe >= 80 ? LEAF_THEME : (pctSafe >= 50 ? FIRE_THEME : [[239,68,68],[239,68,68]]);
            coloredFilled = applyGradient(filled, theme);
          }
          
          const thoughtVal = thoughtTokens || 0;
          const thoughtText = ` (thought: ${formatTokensComb(thoughtVal)})`;
          const pctStr = `${Math.round(pctSafe)}%`.padStart(4);
          return `[${coloredFilled}${C.dim}${empty}${C.reset}] ${pctStr} ~${C.bold}${formatTokensComb(tokens).padEnd(5)}${C.reset} tokens${C.yellow}${thoughtText}${C.reset}`;
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
          { name: 'Antigravity IDE', key: 'antigravity', icon: '✦' },
          { name: 'Antigravity CLI', key: 'agy', icon: '▶' },
          { name: 'Cursor', key: 'cursor', icon: '♦' },
          { name: 'Claude Code', key: 'claudecode', icon: '◎' },
          { name: 'OpenCode', key: 'opencode', icon: '▫' },
          { name: 'CommandCode', key: 'commandcode', icon: '⚡' }
        ];

        clients.forEach(client => {
          const clientLabel = `${client.icon} ${client.name}`;
          
          const todayStats = stats.today.by_client ? (stats.today.by_client[client.key] || { calls: 0, tokens: 0 }) : { calls: 0, tokens: 0 };
          const last7Stats = stats.last7days.by_client ? (stats.last7days.by_client[client.key] || { calls: 0, tokens: 0 }) : { calls: 0, tokens: 0 };
          const alltimeStats = stats.alltime.by_client ? (stats.alltime.by_client[client.key] || { calls: 0, tokens: 0 }) : { calls: 0, tokens: 0 };
          
          const formatCellText = (cStats) => {
            if (!cStats || cStats.calls === 0) return '0 (0 Token)';
            return `${cStats.calls} (${formatTokensComb(cStats.tokens)} Token)`;
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
        global.skillsDbTodayPct = stats.today.pct;
        global.skillsDbTodayDbSize = stats.today.db_size_bytes;

        global.skillsDbLast7DaysCalls = stats.last7days.calls;
        global.skillsDbLast7DaysTokens = stats.last7days.tokens;
        global.skillsDbLast7DaysBytes = stats.last7days.bytes;
        global.skillsDbLast7DaysTotalBytes = stats.last7days.total_bytes;
        global.skillsDbLast7DaysPct = stats.last7days.pct;

        global.skillsDbAllTimeCalls = stats.alltime.calls;
        global.skillsDbAllTimeTokens = stats.alltime.tokens;
        global.skillsDbAllTimeBytes = stats.alltime.bytes;
        global.skillsDbAllTimeTotalBytes = stats.alltime.total_bytes;
        global.skillsDbAllTimePct = stats.alltime.pct;
      }
    } catch (e) {
      log(`     ${C.yellow}⚠${C.reset} Could not read Konoha MCP savings: ${e.message}`);
    }
  } else {
    log(`     ${C.yellow}⚠${C.reset} Konoha MCP database not found. Run "konoha init" first.\n`);
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

    // Unified regex that matches all Semble savings output formats
    // Format: "Today 1.2k calls  ~45.6k tokens  ~45.6k tokens  (X%)" or similar variants
    const SEMBLE_REGEX = /^(Today|Last\s+7\s+days|All\s+time)\s+(\d+\.?\d*)([kKmM]?)(?:\s+(?:calls|searches?))?\s+(?:~?)(\d+\.?\d*)([kKmM]?)\s+tokens(?:\s+\((\d+)%\))?(?:.*?(\d+)%)?/i;

    for (const line of lines) {
      const cleanLine = line.replace(/\x1b\[[0-9;]*m/g, '').trim();
      if (!cleanLine) continue;

      const match = cleanLine.match(SEMBLE_REGEX);
      if (match) {
        const period = match[1]; // 'Today', 'Last 7 days', 'All time'
        const rawCalls = parseFloat(match[2]);
        const callUnit = (match[3] || '').toLowerCase();
        const rawTokens = parseFloat(match[4]);
        const tokenUnit = (match[5] || '').toLowerCase();
        const explicitPct = parseInt(match[6], 10);
        const trailingPct = parseInt(match[7], 10);

        // Use whichever percentage we find (explicit first, trailing second)
        let pct = explicitPct || trailingPct || 0;

        const calls = callUnit === 'm' ? Math.round(rawCalls * 1000000) : (callUnit === 'k' ? Math.round(rawCalls * 1000) : Math.round(rawCalls));
        const tokens = tokenUnit === 'm' ? Math.round(rawTokens * 1000000) : (tokenUnit === 'k' ? Math.round(rawTokens * 1000) : Math.round(rawTokens));

        // Store based on period
        if (period.startsWith('Today')) {
          sembleTodayCalls = calls;
          sembleTodayTokens = tokens;
          sembleTodayPct = pct;
        } else if (period.startsWith('Last')) {
          sembleLast7DaysCalls = calls;
          sembleLast7DaysTokens = tokens;
          sembleLast7DaysPct = pct;
        } else {
          sembleAllTimeCalls = calls;
          sembleAllTimeTokens = tokens;
          sembleAllTimePct = pct;
        }
      } else if (cleanLine.length > 3) {
        // Skip empty lines, but log unmatched lines for debugging
        // Uncomment for debugging: log(`  [debug] Unmatched Semble line: "${cleanLine}"`);
      }
    }
  } catch (e) {
    log(`     ${C.yellow}⚠${C.reset} Could not fetch Semble savings: ${e.message}`);
  }

  // 3. Combined Summary (show both systems separately + blended view)
  // Note: combined metrics are shown for reference only. The two systems
  // measure different things (Konoha: FTS5 savings, Semble: semantic code search),
  // so totals are approximate and for overview purposes.
  const combinedTodayCalls = (global.skillsDbTodayCalls || 0) + sembleTodayCalls;
  const combinedTodayTokens = (global.skillsDbTodayTokens || 0) + sembleTodayTokens;
  const combinedTodayBytes = (global.skillsDbTodayBytes || 0) + (sembleTodayTokens * 4);

  const combinedLast7DaysCalls = (global.skillsDbLast7DaysCalls || 0) + sembleLast7DaysCalls;
  const combinedLast7DaysTokens = (global.skillsDbLast7DaysTokens || 0) + sembleLast7DaysTokens;
  const combinedLast7DaysBytes = (global.skillsDbLast7DaysBytes || 0) + (sembleLast7DaysTokens * 4);

  const combinedAllTimeCalls = (global.skillsDbAllTimeCalls || 0) + sembleAllTimeCalls;
  const combinedAllTimeTokens = (global.skillsDbAllTimeTokens || 0) + sembleAllTimeTokens;
  const combinedAllTimeBytes = (global.skillsDbAllTimeBytes || 0) + (sembleAllTimeTokens * 4);

  // Calculate true combined savings percentages using additive method
  const skillsDbTodaySavedBytes = global.skillsDbTodayBytes || 0;
  const skillsDbTodayTotalBytes = global.skillsDbTodayTotalBytes || 0;
  const sembleTodaySavedBytes = sembleTodayTokens * 4;
  // derive Semble total from saved + pct, or skip if pct is 0
  const sembleTodayTotalBytes = (sembleTodayPct > 0 && sembleTodayTokens > 0)
    ? Math.round(sembleTodaySavedBytes / (sembleTodayPct / 100))
    : (skillsDbTodayTotalBytes > 0 ? skillsDbTodayTotalBytes : 0);
  const combinedTodaySavedBytes = skillsDbTodaySavedBytes + sembleTodaySavedBytes;
  const combinedTodayTotalBytes = skillsDbTodayTotalBytes + (sembleTodayPct > 0 ? sembleTodayTotalBytes : 0);
  const combinedTodayPct = (combinedTodayTotalBytes > 0) ? Math.round((combinedTodaySavedBytes / combinedTodayTotalBytes) * 100) : 0;

  const skillsDbLast7DaysSavedBytes = global.skillsDbLast7DaysBytes || 0;
  const skillsDbLast7DaysTotalBytes = global.skillsDbLast7DaysTotalBytes || 0;
  const sembleLast7DaysSavedBytes = sembleLast7DaysTokens * 4;
  const sembleLast7DaysTotalBytes = (sembleLast7DaysPct > 0 && sembleLast7DaysTokens > 0)
    ? Math.round(sembleLast7DaysSavedBytes / (sembleLast7DaysPct / 100))
    : (skillsDbLast7DaysTotalBytes > 0 ? skillsDbLast7DaysTotalBytes : 0);
  const combinedLast7DaysSavedBytes = skillsDbLast7DaysSavedBytes + sembleLast7DaysSavedBytes;
  const combinedLast7DaysTotalBytes = skillsDbLast7DaysTotalBytes + (sembleLast7DaysPct > 0 ? sembleLast7DaysTotalBytes : 0);
  const combinedLast7DaysPct = (combinedLast7DaysTotalBytes > 0) ? Math.round((combinedLast7DaysSavedBytes / combinedLast7DaysTotalBytes) * 100) : 0;

  const skillsDbAllTimeSavedBytes = global.skillsDbAllTimeBytes || 0;
  const skillsDbAllTimeTotalBytes = global.skillsDbAllTimeTotalBytes || 0;
  const sembleAllTimeSavedBytes = sembleAllTimeTokens * 4;
  const sembleAllTimeTotalBytes = (sembleAllTimePct > 0 && sembleAllTimeTokens > 0)
    ? Math.round(sembleAllTimeSavedBytes / (sembleAllTimePct / 100))
    : (skillsDbAllTimeTotalBytes > 0 ? skillsDbAllTimeTotalBytes : 0);
  const combinedAllTimeSavedBytes = skillsDbAllTimeSavedBytes + sembleAllTimeSavedBytes;
  const combinedAllTimeTotalBytes = skillsDbAllTimeTotalBytes + (sembleAllTimePct > 0 ? sembleAllTimeTotalBytes : 0);
  const combinedAllTimePct = (combinedAllTimeTotalBytes > 0) ? Math.round((combinedAllTimeSavedBytes / combinedAllTimeTotalBytes) * 100) : 0;

  const formatBytesComb = (b) => {
    if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(2)} MB`;
    return `${(b / 1024).toFixed(1)} KB`;
  };

  function formatTokensComb(t) {
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
    `Actual savings per query:  ${C.bold}${C.green}${combinedTodayPct > 0 ? combinedTodayPct : combinedLast7DaysPct > 0 ? combinedLast7DaysPct : combinedAllTimePct > 0 ? combinedAllTimePct : global.skillsDbTodayPct > 0 ? global.skillsDbTodayPct : global.skillsDbAllTimePct > 0 ? global.skillsDbAllTimePct : 0}${C.reset}% average per query (computed from live database metrics)`,
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
  ${C.cyan}list${C.reset}                        List all active agents and their skills.
  ${C.cyan}create <agent-name> [options]${C.reset} Create a custom subagent manually.
                              Options: --title, --purpose, --instructions, --keywords.
  ${C.cyan}skill [agent-name]${C.reset}          Interactively toggle (embed or remove) a skill for an agent.
  ${C.cyan}delete <agent-name>${C.reset}         Permanently delete/prune an agent and prune its historical statistics.
  ${C.cyan}status${C.reset}                      View detailed call statistics (today, 7 days, all time) for subagents.

${C.bold}EXAMPLES FOR BEGINNERS${C.reset}
  ${C.dim}1. View all configured agents in your village:${C.reset}
     konoha agent list

  ${C.dim}2. Interactively teach @genin a new skill (toggle from list):${C.reset}
     konoha agent skill genin

  ${C.dim}3. View subagent call frequency statistics:${C.reset}
     konoha agent status

  ${C.dim}4. Permanently delete/prune an agent and clean up its database stats:${C.reset}
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
      const agents = agentManager.loadAgents(false, true);
      if (agents.length === 0) {
        warn('No subagents found.');
        break;
      }

      if (!process.stdin.isTTY) {
        header('Subagents List');
        const headers = ['Subagent', 'Title', 'Active Skills'];
        const aligns = ['left', 'left', 'left'];

        const rows = agents.map(a => {
          const skillsList = a.skills && a.skills.length > 0 ? a.skills.join(', ') : 'None';
          return [
            `${a.icon || '👤'} @${a.name}`,
            a.title || 'Ninja',
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
        info('Updated configurations and deployed to ~/.agents/agents.yaml');
      } catch (err) {
        error(`Failed to create subagent: ${err.message}`);
        process.exit(1);
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
        // 1. Try to delete from agents.yaml
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
      log(`Available subcommands: list, create, skill, delete, status`);
      process.exit(1);
  }
}

const AVAILABLE_MODELS = [
  { name: 'Gemini 3.5 Flash (Low)', tag: 'Fast', aliases: ['flash-low', 'gemini-3.5-flash-low', 'low'] },
  { name: 'Gemini 3.5 Flash (Medium)', tag: 'Fast', aliases: ['flash-medium', 'gemini-3.5-flash-medium', 'medium'] },
  { name: 'Gemini 3.5 Flash (High)', tag: 'Fast', aliases: ['flash-high', 'gemini-3.5-flash-high', 'high'] },
  { name: 'Gemini 3.6 Flash (Low)', tag: 'Fast', aliases: ['flash-3.6-low', 'gemini-3.6-flash-low', '3.6-low'] },
  { name: 'Gemini 3.6 Flash (Medium)', tag: 'Fast', aliases: ['flash-3.6-medium', 'gemini-3.6-flash-medium', '3.6-medium'] },
  { name: 'Gemini 3.6 Flash (High)', tag: 'Fast', aliases: ['flash-3.6-high', 'gemini-3.6-flash-high', '3.6-high'] },
  { name: 'Gemini 3.7 Flash (Low)', tag: 'Fast', aliases: ['flash-3.7-low', 'gemini-3.7-flash-low', '3.7-low'] },
  { name: 'Gemini 3.7 Flash (Medium)', tag: 'Fast', aliases: ['flash-3.7-medium', 'gemini-3.7-flash-medium', '3.7-medium'] },
  { name: 'Gemini 3.7 Flash (High)', tag: 'Fast', aliases: ['flash-3.7-high', 'gemini-3.7-flash-high', '3.7-high'] },
  { name: 'Gemini 3.1 Pro (Low)', tag: 'Standard', aliases: ['pro-low', 'gemini-3.1-pro-low'] },
  { name: 'Gemini 3.1 Pro (High)', tag: 'Standard', aliases: ['pro-high', 'gemini-3.1-pro-high'] },
  { name: 'Claude Sonnet 4.6 (Thinking)', tag: 'Reasoning', aliases: ['sonnet', 'sonnet-4.6', 'claude-sonnet-4.6', 'sonnet-thinking'] },
  { name: 'Claude Opus 4.6 (Thinking)', tag: 'Advanced', aliases: ['opus', 'opus-4.6', 'claude-opus-4.6', 'opus-thinking'] },
];

async function getActiveModels() {
  const models = [...AVAILABLE_MODELS];
  const bridges = loadBridges();
  const existing = new Set(models.map(m => m.name.toLowerCase()));

  // Query each bridge's backend target for models, add prefixed versions
  const bridgeList = bridges.filter(b => b.enabled && b.targetUrl);
  const bridgeTargets = bridgeList.map(async bridge => {
    const targetPath = bridge.targetUrl.endsWith('/v1') ? bridge.targetUrl + '/models' : bridge.targetUrl;
    const parsed = new URL(targetPath);
    const mod = parsed.protocol === 'https:' ? require('https') : require('http');
    const url = `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}`;
    const headers = {};
    if (bridge.apiKey) {
      headers['Authorization'] = `Bearer ${bridge.apiKey}`;
    }
    return new Promise((resolveInner) => {
      const req = mod.get(url, { headers }, (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          try { resolveInner(JSON.parse(d)); } catch { resolveInner(null); }
        });
      });
      req.on('error', () => resolveInner(null));
      req.setTimeout(8000, () => { req.destroy(); resolveInner(null); });
    });
  });
  const targets = await Promise.all(bridgeTargets);

  for (let i = 0; i < targets.length; i++) {
    const bridge = bridgeList[i];
    const targetJson = targets[i];
    if (!targetJson || !Array.isArray(targetJson.data)) continue;
    for (const m of targetJson.data) {
      const id = m.id;
      const prefixedId = `${bridge.name}-${id}`;
      if (!existing.has(prefixedId.toLowerCase())) {
        let tag = 'Bridge';
        if (id.includes('claude')) tag = 'Reasoning';
        else if (id.includes('gpt')) tag = 'Standard';
        else if (id.includes('gemini')) {
          if (id.includes('flash')) tag = 'Fast';
          else tag = 'Standard';
        }
        models.push({ name: prefixedId, tag, aliases: [prefixedId.toLowerCase()] });
        existing.add(prefixedId.toLowerCase());
      }
    }
  }

  return models;
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
  ${C.cyan}reset${C.reset}                                          Clear local usage logs in sqlite db to restore model quotas.

${C.bold}MODEL EXPRESSIONS${C.reset}
  You can specify a single model, or a primary model with a fallback (supports "inherit" for Cursor):
  - Single model: "Claude Sonnet 4.6 (Thinking)"
  - With fallback: "Claude Opus 4.6 (Thinking) | Fallback when fail Gemini 3.5 Flash (Low)"

${C.bold}EXAMPLES FOR BEGINNERS${C.reset}
  ${C.dim}1. List all models and their current assignments:${C.reset}
     konoha models list

  ${C.dim}2. Reset local usage logs and model quotas:${C.reset}
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
      const agents = agentManager.loadAgents(false, true);

      log('');
      break;
    }
    case 'list': {
      const agents = agentManager.loadAgents(false, true);

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

      log('');
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
  header('🔄 Upgrading Konoha');
  log(`  Preparing to upgrade Konoha to the latest version...`);

  let confirm;
  try {
    const prompts = await import('@inquirer/prompts');
    confirm = prompts.confirm;
  } catch (e) {
    error('Could not load @inquirer/prompts. Please run "pnpm install".');
    process.exit(1);
  }

  const doUpgrade = await confirm({ message: 'Proceed with upgrading Konoha and modify ~/.gemini configurations?', default: true });
  if (!doUpgrade) {
    warn('Upgrade aborted.');
    return;
  }

  const cmd = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const cmdArgs = ['dlx', 'github:andycungkrinx91/konoha', 'init', '--force'];

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
  ${C.cyan}bridge${C.reset}        🌉 Manage Konoha Bridge Router (status, list, create, delete, enable, disable).

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
     pnpm dlx github:andycungkrinx91/konoha init

  ${C.dim}2. Search for a custom skill (e.g. Golang, Docker) on the registry and install it:${C.reset}
     konoha skill search golang

  ${C.dim}3. Interactively link/toggle skills for a subagent (e.g. teach @genin a new skill):${C.reset}
     konoha agent skill genin

  ${C.dim}5. View how many tokens (and how much context window) you have saved:${C.reset}
     konoha savings

  ${C.dim}6. View database disk space and active session size:${C.reset}
     konoha data view

`);
}

function cmdDataHelp() {
  log(`
${C.cyan}konoha data${C.reset} — Manage SQLite active session history, persona memories, and database size

${C.bold}USAGE${C.reset}
  konoha data <subcommand>

${C.bold}SUBCOMMANDS${C.reset}
  ${C.cyan}view${C.reset}              📊 See how much disk size, skills, and persona memories are in your database.
  ${C.cyan}memory [agent]${C.reset}    🧠 List saved persona rules, preferences, and episodic memory per agent.
  ${C.cyan}add <agent> <txt>${C.reset} ➕ Save a persistent rule or preference for an agent persona.
  ${C.cyan}search <query>${C.reset}    🔍 Search saved knowledge and memories across agents.
  ${C.cyan}delete <id>${C.reset}       🗑️ Remove a saved memory item by ID.
  ${C.cyan}export${C.reset}            📤 Export indexed skills and database knowledge into a Markdown report.
  ${C.cyan}prune${C.reset}             🧹 Clean up old active sessions and usage logs (preserves memories), then vacuum.
  ${C.cyan}vacuum${C.reset}            ⚡ Defragment and compress SQLite database file directly.

${C.bold}EXAMPLES${C.reset}
  ${C.dim}1. View current database statistics:${C.reset}
     konoha data view

  ${C.dim}2. List saved persona memories for an agent:${C.reset}
     konoha data memory anbu

  ${C.dim}3. Add a persistent rule for an agent:${C.reset}
     konoha data add anbu "Always use parameterized queries and WAL mode in SQLite" --type rule

  ${C.dim}4. Search saved memories across all agents:${C.reset}
     konoha data search "SQLite WAL"

  ${C.dim}5. Prune usage logs while preserving saved memories:${C.reset}
     konoha data prune

  ${C.dim}6. Export skills and persona memories to a Markdown file:${C.reset}
     konoha data export
`);
}

async function cmdData(args) {
  await chidoriTransition('data');
  const subcommand = args[0];
  const subArgs = args.slice(1);

  if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    cmdDataHelp();
    process.exit(0);
  }

  switch (subcommand) {
    case 'view':
      await cmdDataView();
      break;
    case 'memory':
    case 'memories':
    case 'list':
      await cmdDataMemory(subArgs);
      break;
    case 'add':
    case 'save':
      await cmdDataAdd(subArgs);
      break;
    case 'search':
    case 'find':
      await cmdDataSearch(subArgs);
      break;
    case 'delete':
    case 'remove':
    case 'rm':
      await cmdDataDelete(subArgs);
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

function loadBridges() {
  const python = checkPython() || 'python3';
  const dbScript = fileExists(path.join(SRC_DIR, 'db_bridges.py'))
    ? path.join(SRC_DIR, 'db_bridges.py')
    : path.join(SKILLS_DB_DIR, 'db_bridges.py');
  try {
    const res = spawnSync(python, [dbScript, '--list'], { encoding: 'utf-8' });
    if (res.status === 0 && res.stdout) {
      return JSON.parse(res.stdout);
    }
  } catch (e) {}
  return [];
}

function saveBridgeSqlite(action, data) {
  const python = checkPython() || 'python3';
  const dbScript = fileExists(path.join(SRC_DIR, 'db_bridges.py'))
    ? path.join(SRC_DIR, 'db_bridges.py')
    : path.join(SKILLS_DB_DIR, 'db_bridges.py');
  try {
    let args;
    if (action === 'upsert') {
      args = ['--upsert', JSON.stringify(data)];
    } else if (action === 'delete') {
      args = ['--delete', data];
    } else if (action === 'enable') {
      args = ['--enable', data];
    } else if (action === 'disable') {
      args = ['--disable', data];
    } else {
      return false;
    }
    const result = spawnSync(python, [dbScript, ...args], { encoding: 'utf-8', timeout: 10000 });
    if (result.error || result.status !== 0) {
      return false;
    }
    try {
      return JSON.parse((result.stdout || '').trim()).ok === true;
    } catch {
      return false;
    }
  } catch (e) {
    return false;
  }
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
  let maxPort = 11436;
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
  konoha bridge start                    Start the bridge gateway service in background (standalone daemon)
  konoha bridge stop                     Stop background bridge gateway service
  konoha bridge restart                  Stop and restart the bridge gateway service
  konoha bridge create [name]            Create a bridge - interactive: choose API Key
  konoha bridge delete <bridge name>     Delete a bridge configuration
  konoha bridge enable <bridge name>     Enable a bridge configuration
  konoha bridge disable <bridge name>    Disable a bridge configuration

Examples:
  konoha bridge start                     (Launch standalone bridge proxy on port 19999)
  konoha bridge create                    (Interactive - choose API Key, then provider)
  konoha bridge status

Provider: OpenAI Compatible (universal - works with all OpenAI-compatible APIs)
  1  OpenAI           - https://api.openai.com/v1
  2  OpenAI Compatible - any OpenAI-compatible API (Ollama, LM Studio, vLLM, ...)
  3  Antigravity Extension - IDE-owned http://127.0.0.1:1313 (disabled by default)
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
    case 'start':
    case 'daemon':
      await cmdBridgeStart();
      break;
    case 'stop':
      await cmdBridgeStop();
      break;
    case 'restart':
      await cmdBridgeRestart();
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

async function cmdBridgeStart() {
  const { spawn } = require('child_process');
  header('Starting Bridge Proxy Gateway Service');

  const gatewayActive = await checkPortActive(19999);
  if (gatewayActive) {
    warn('Proxy Gateway is already running on port 19999.');
    return;
  }

  const mcpScript = fileExists(path.join(SKILLS_DB_DIR, 'file_tools_mcp.js'))
    ? path.join(SKILLS_DB_DIR, 'file_tools_mcp.js')
    : path.join(SRC_DIR, 'file_tools_mcp.js');

  const child = spawn(process.execPath || 'node', [mcpScript], {
    detached: true,
    stdio: 'ignore',
    env: Object.assign({}, process.env, { KONOHA_DAEMON: 'true' })
  });
  child.on('error', (err) => {
    warn(`Background bridge process errored: ${err && err.message ? err.message : err}`);
  });
  child.unref();

  try {
    fs.writeFileSync(path.join(SKILLS_DB_DIR, 'bridge.pid'), String(child.pid));
  } catch (e) {
    warn(`Could not write bridge.pid: ${e && e.message ? e.message : e}`);
  }

  await new Promise((r) => setTimeout(r, 1000));
  const nowActive = await checkPortActive(19999);
  if (nowActive) {
    success('Bridge Proxy Gateway started successfully in background on port 19999.');
  } else {
    warn('Background process spawned. Run "konoha bridge status" to check binding status.');
  }
}

async function cmdBridgeStop() {
  const { execSync } = require('child_process');
  header('Stopping Bridge Proxy Gateway Service');
  const pidFile = path.join(SKILLS_DB_DIR, 'bridge.pid');
  let targeted = false;
  try {
    if (fileExists(pidFile)) {
      const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
      if (Number.isFinite(pid) && pid > 0) {
        try {
          if (process.platform === 'win32') {
            execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
          } else {
            process.kill(pid, 'SIGTERM');
          }
          targeted = true;
        } catch (e) {
          // Process already gone — fall through to the broad kill as a last resort.
        }
        try { fs.unlinkSync(pidFile); } catch (e) {}
      }
    }
    if (!targeted) {
      if (process.platform === 'win32') {
        execSync('taskkill /f /im node.exe', { stdio: 'ignore' });
      } else {
        execSync('pkill -f file_tools_mcp.js', { stdio: 'ignore' });
      }
    }
    success('Stopped background bridge proxy gateway services.');
  } catch (e) {
    warn('No active background bridge services were running.');
  }
}

async function cmdBridgeRestart() {
  header('Restarting Bridge Proxy Gateway Service');
  success('Stopping existing bridge service...');
  await cmdBridgeStop();
  success('Starting bridge service...');
  await cmdBridgeStart();
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
    const providerLabel = {
        'openai-compatible': 'OpenAI Compatible',
        'openai':            'OpenAI'
      }[b.provider] || b.provider || '-';
    rows.push([
      b.name,
      String(b.port),
      providerLabel,
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
  header('Served Models via Proxy Gateway');

  const bridges = loadBridges();
  const bridgeList = bridges.filter(b => b.enabled && b.targetUrl);

  if (bridgeList.length === 0) {
    log('  No enabled bridges found.');
    return;
  }

  const bridgeTargets = bridgeList.map(async bridge => {
    const targetPath = bridge.targetUrl.endsWith('/v1') ? bridge.targetUrl + '/models' : bridge.targetUrl;
    const parsed = new URL(targetPath);
    const mod = parsed.protocol === 'https:' ? require('https') : require('http');
    const url = `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}`;
    const headers = {};
    if (bridge.apiKey) {
      headers['Authorization'] = `Bearer ${bridge.apiKey}`;
    }
    return new Promise((resolve) => {
      const req = mod.get(url, { headers }, (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          try { resolve(JSON.parse(d)); } catch { resolve(null); }
        });
      });
      req.on('error', () => resolve(null));
      req.setTimeout(8000, () => { req.destroy(); resolve(null); });
    });
  });
  const targets = await Promise.all(bridgeTargets);

  const models = [];
  for (let i = 0; i < targets.length; i++) {
    const bridge = bridgeList[i];
    if (!targets[i] || !Array.isArray(targets[i].data)) continue;
    for (const m of targets[i].data) {
      const prefixedId = `${bridge.name}-${m.id}`;
      models.push({ id: prefixedId, owned_by: m.owned_by || bridge.name });
    }
  }

  if (models.length === 0) {
    log('  No models are currently served by any active bridges.');
    return;
  }

  const rows = [];
  for (const m of models) {
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
}

async function cmdBridgeStatus() {
  const bridges = loadBridges();
  header('Bridge Status Report');

  const gatewayActive = await checkPortActive(19999);
  const rows = [];
  
  rows.push([
    'Proxy Gateway',
    '19999',
    'Gateway Router',
    gatewayActive ? 'RUNNING' : 'STOPPED',
    'http://localhost:19999/v1'
  ]);

  let activeCount = 0;
  for (const b of bridges) {
    const active = await checkPortActive(b.port);
    if (active) activeCount++;
    const statusText = active
      ? 'RUNNING'
      : (b.enabled ? 'STOPPED' : 'DISABLED');
    rows.push([
      b.name,
      String(b.port),
      b.provider || 'custom',
      statusText,
      b.targetUrl || '-'
    ]);
  }

  const headers = ['Bridge Service', 'Port', 'Provider', 'Status', 'Target URL'];
  const widths = computeTableWidths(headers, rows, { minWidths: [18, 6, 14, 12, 25] });
  drawTable(headers, widths, ['left', 'left', 'left', 'left', 'left'], rows, [], RASENGAN_THEME, {
    columnFormatters: [
      (cell) => applyGradient(cell.trimEnd(), RASENGAN_THEME, 0.9) + cell.slice(cell.trimEnd().length),
      (cell) => applyGradient(cell, CHIDORI_THEME, 0.8),
      (cell) => cell,
      gradientStatusCell,
      (cell) => applyGradient(cell, CHIDORI_THEME, 0.7)
    ]
  });

  log('');
  if (activeCount > 0 || gatewayActive) {
    success(`${activeCount + (gatewayActive ? 1 : 0)} bridge service(s) active and listening.`);
  } else {
    warn('No active bridges running. Bridges are hosted in-process by konoha MCP.');
    log(`  ${C.dim}Tip: Start an active MCP IDE session or run ${C.cyan}konoha bridge start${C.dim} to run in background.${C.reset}`);
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
  if (!saveBridgeSqlite('delete', deleted.name)) {
    error(`Failed to delete bridge "${deleted.name}".`);
    process.exit(1);
  }
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

  if (!saveBridgeSqlite('enable', name)) {
    error(`Failed to enable bridge "${name}".`);
    process.exit(1);
  }
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

  if (!saveBridgeSqlite('disable', name)) {
    error(`Failed to disable bridge "${name}".`);
    process.exit(1);
  }
  success(`Disabled bridge "${name}". The runtime has been stopped automatically.`);
}

async function cmdBridgeCreate(name) {
  const nameRegex = /^[a-zA-Z0-9_-]+$/;
  const bridges = loadBridges();

  log('\n' + applyGradient('  Konoha Bridge — Create New Bridge', CHIDORI_THEME, 0.9) + '\n');
  log(`  Provider: OpenAI Compatible (works with OpenAI, Ollama, LMStudio, vLLM, Groq, AnyLLM, etc.)\n`);

  // Bridge name
  let bridgeName = name;
  if (!bridgeName) {
    bridgeName = await askQuestion('  Bridge name: ');
    if (!bridgeName) { error('Bridge name is required.'); process.exit(1); }
  }
  if (!nameRegex.test(bridgeName)) {
    error('Invalid bridge name. Use only alphanumeric, hyphens, underscores.');
    process.exit(1);
  }
  if (bridges.some(b => b.name === bridgeName)) {
    error(`Bridge "${bridgeName}" already exists.`);
    process.exit(1);
  }

  const providerChoice = (await askQuestion('  Provider [1=OpenAI-compatible, 2=Antigravity extension]: ')).trim() || '1';
  if (providerChoice === '2') {
    const newBridge = {
      name: bridgeName,
      port: 1313,
      provider: 'antigravity-extension',
      targetUrl: 'http://127.0.0.1:1313',
      enabled: false
    };
    if (bridges.some(b => b.port === newBridge.port)) { error(`Port ${newBridge.port} already in use.`); process.exit(1); }
    if (!saveBridgeSqlite('upsert', newBridge)) {
      error(`Failed to create bridge "${bridgeName}".`);
      process.exit(1);
    }
    log('');
    success(`Bridge "${bridgeName}" created disabled.`);
    log('  Provider : Antigravity Extension (IDE-owned, port 1313)\n  Enable with: konoha bridge enable ' + bridgeName + '\n');
    return;
  }

  // Port
  const defaultPort = getNextAvailablePort(bridges);
  const portStr = await askQuestion(`  Listen port [${defaultPort}]: `);
  const port = portStr ? parseInt(portStr, 10) : defaultPort;
  if (isNaN(port) || port <= 0 || port > 65535) { error('Invalid port.'); process.exit(1); }
  if (bridges.some(b => b.port === port)) { error(`Port ${port} already in use.`); process.exit(1); }

  // Target URL
  let targetUrl = '';
  while (!targetUrl) {
    const prompt = '  Target URL (e.g. https://api.openai.com/v1 or http://localhost:11434/v1): ';
    const input = await askQuestion(prompt);
    targetUrl = input?.trim() || '';
    if (!targetUrl) warn('  Target URL is required.');
  }

  // API Key
  const apiKey = await askQuestion('  API Key (required for most APIs): ');
  if (!apiKey?.trim()) { error('API Key is required.'); process.exit(1); }

  const newBridge = {
    name: bridgeName,
    port,
    provider: 'openai-compatible',
    targetUrl,
    apiKey: apiKey.trim(),
    enabled: true
  };

  if (!saveBridgeSqlite('upsert', newBridge)) {
    error(`Failed to create bridge "${bridgeName}".`);
    process.exit(1);
  }
  log('');
  success(`Bridge "${bridgeName}" created!`);
  log(`  Provider : OpenAI Compatible\n`);
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
        
        // Prune SearXNG logs and cache files
        const searxngDir = path.join(HOME, '.konoha', 'searxng');
        const pruneFiles = ['search.log', 'instances_cache.json', 'best_instance.json'];
        let searxngSavedBytes = 0;
        pruneFiles.forEach(f => {
          const fp = path.join(searxngDir, f);
          if (fs.existsSync(fp)) {
            searxngSavedBytes += fs.statSync(fp).size;
            try {
              fs.unlinkSync(fp);
            } catch {}
          }
        });

        const totalSavedBytes = data.saved + searxngSavedBytes;
        const sizeBeforeMb = (data.size_before / (1024 * 1024)).toFixed(2);
        const sizeAfterMb = (data.size_after / (1024 * 1024)).toFixed(2);
        const savedMb = (totalSavedBytes / (1024 * 1024)).toFixed(2);

        success('Successfully pruned active session mappings, usage logs, and SearXNG logs/caches!');
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
    try:
        agents_data = conn.execute("SELECT name, icon, model_tier, description FROM agents").fetchall()
        for name, icon, model_tier, description in agents_data:
            f.write(f"- **{icon or '👤'} {name}** (Model: {model_tier}): {description}\\n")
    except Exception:
        f.write("Failed to load agents configuration from database.\\n")
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

async function cmdDataMemory(args) {
  try {
    const python = checkPython();
    if (python && fileExists(DB_PATH)) {
      const agentFilter = args[0] || '';
      const script = `
import sqlite3, os, sys, json
sys.path.insert(0, sys.argv[2])
import persona_memory

db_path = sys.argv[1]
agent_name = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] else None
mems = persona_memory.list_memories(agent_name=agent_name, limit=50, db_path=db_path)
print(json.dumps(mems))
`.trim();
      const run = spawnSync(python, ['-c', script, DB_PATH, SRC_DIR, agentFilter], { encoding: 'utf-8', timeout: 5000 });
      if (run.status === 0) {
        const mems = JSON.parse(run.stdout.trim());
        header(`🧠 Konoha Saved Persona Memories ${agentFilter ? `(@${agentFilter})` : ''}`);
        if (!mems || mems.length === 0) {
          log(`  ${C.dim}No saved memories found. Use ${C.cyan}konoha data add <agent> <content>${C.dim} to save rules/learnings.${C.reset}\n`);
          return;
        }
        mems.forEach((m, idx) => {
          const typeBadge = `[${(m.memory_type || 'rule').toUpperCase()}]`;
          log(`  ${C.cyan}${idx + 1}.${C.reset} ${C.bold}@${m.agent_name}${C.reset} ${C.yellow}${typeBadge}${C.reset} ${C.bold}${m.title || ''}${C.reset} ${C.dim}(ID: ${m.id})${C.reset}`);
          log(`     ${m.content}`);
          if (m.tags) log(`     ${C.dim}Tags: ${m.tags}${C.reset}`);
          log('');
        });
        success(`Total: ${mems.length} saved memory item(s).`);
      } else {
        error(`Failed to list memories: ${run.stderr}`);
      }
    } else {
      error('SQLite database or python command not found.');
    }
  } catch (err) {
    error(`Failed to retrieve persona memories: ${err.message}`);
  }
}

async function cmdDataAdd(args) {
  if (args.length < 2) {
    error('Usage: konoha data add <agent> <content> [--title <title>] [--type <type>] [--tags <tags>]');
    process.exit(1);
  }
  const agent = args[0];
  let content = '';
  let title = '';
  let type = 'rule';
  let tags = '';
  let importance = 1;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--title' && i + 1 < args.length) {
      title = args[++i];
    } else if (args[i] === '--type' && i + 1 < args.length) {
      type = args[++i];
    } else if (args[i] === '--tags' && i + 1 < args.length) {
      tags = args[++i];
    } else if (args[i] === '--importance' && i + 1 < args.length) {
      importance = parseInt(args[++i], 10) || 1;
    } else {
      content += (content ? ' ' : '') + args[i];
    }
  }

  try {
    const python = checkPython();
    if (python && fileExists(DB_PATH)) {
      const script = `
import sqlite3, os, sys, json
sys.path.insert(0, sys.argv[2])
import persona_memory

db_path = sys.argv[1]
agent = sys.argv[3]
content = sys.argv[4]
title = sys.argv[5]
mtype = sys.argv[6]
tags = sys.argv[7]
imp = int(sys.argv[8])

mem_id = persona_memory.save_memory(
    agent_name=agent,
    content=content,
    title=title,
    memory_type=mtype,
    tags=tags,
    importance=imp,
    db_path=db_path
)
print(json.dumps({"id": mem_id, "agent": agent}))
`.trim();
      const run = spawnSync(python, ['-c', script, DB_PATH, SRC_DIR, agent, content, title, type, tags, String(importance)], { encoding: 'utf-8', timeout: 5000 });
      if (run.status === 0) {
        const res = JSON.parse(run.stdout.trim());
        success(`Saved persona memory for @${res.agent}! (ID: ${res.id})`);
        log(`  ${C.bold}Content:${C.reset} ${content}\n`);
      } else {
        error(`Failed to save persona memory: ${run.stderr}`);
      }
    } else {
      error('SQLite database or python command not found.');
    }
  } catch (err) {
    error(`Failed to add persona memory: ${err.message}`);
  }
}

async function cmdDataSearch(args) {
  if (args.length === 0) {
    error('Usage: konoha data search <query> [--agent <name>]');
    process.exit(1);
  }
  let query = '';
  let agentFilter = 'global';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--agent' && i + 1 < args.length) {
      agentFilter = args[++i];
    } else {
      query += (query ? ' ' : '') + args[i];
    }
  }

  try {
    const python = checkPython();
    if (python && fileExists(DB_PATH)) {
      const script = `
import sqlite3, os, sys, json
sys.path.insert(0, sys.argv[2])
import persona_memory

db_path = sys.argv[1]
agent = sys.argv[3]
query = sys.argv[4]

mems = persona_memory.query_memories(agent_name=agent, query=query, limit=10, db_path=db_path)
print(json.dumps(mems))
`.trim();
      const run = spawnSync(python, ['-c', script, DB_PATH, SRC_DIR, agentFilter, query], { encoding: 'utf-8', timeout: 5000 });
      if (run.status === 0) {
        const mems = JSON.parse(run.stdout.trim());
        header(`🔍 Search Results for "${query}"`);
        if (!mems || mems.length === 0) {
          log(`  ${C.dim}No matching memories found.${C.reset}\n`);
          return;
        }
        mems.forEach((m, idx) => {
          const typeBadge = `[${(m.memory_type || 'rule').toUpperCase()}]`;
          log(`  ${C.cyan}${idx + 1}.${C.reset} ${C.bold}@${m.agent_name}${C.reset} ${C.yellow}${typeBadge}${C.reset} ${C.bold}${m.title || ''}${C.reset} ${C.dim}(ID: ${m.id})${C.reset}`);
          log(`     ${m.content}\n`);
        });
      } else {
        error(`Failed to search persona memories: ${run.stderr}`);
      }
    } else {
      error('SQLite database or python command not found.');
    }
  } catch (err) {
    error(`Failed to search persona memories: ${err.message}`);
  }
}

async function cmdDataDelete(args) {
  if (args.length === 0) {
    error('Usage: konoha data delete <id>');
    process.exit(1);
  }
  const memId = args[0];
  try {
    const python = checkPython();
    if (python && fileExists(DB_PATH)) {
      const script = `
import sqlite3, os, sys, json
sys.path.insert(0, sys.argv[2])
import persona_memory

db_path = sys.argv[1]
mem_id = sys.argv[3]
deleted = persona_memory.delete_memory(mem_id, db_path=db_path)
print(json.dumps({"deleted": deleted, "id": mem_id}))
`.trim();
      const run = spawnSync(python, ['-c', script, DB_PATH, SRC_DIR, memId], { encoding: 'utf-8', timeout: 5000 });
      if (run.status === 0) {
        const res = JSON.parse(run.stdout.trim());
        if (res.deleted) {
          success(`Deleted memory item ID: ${memId}`);
        } else {
          warn(`Memory item ID "${memId}" not found.`);
        }
      } else {
        error(`Failed to delete persona memory: ${run.stderr}`);
      }
    } else {
      error('SQLite database or python command not found.');
    }
  } catch (err) {
    error(`Failed to delete memory: ${err.message}`);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

const [,, command, ...args] = process.argv;

async function main() {
  if (command === undefined) {
    await runSplashScreen();
  }

  // Silent auto-setup on every command (except help/uninstall)
  const skipAutoSetup = ['uninstall', 'help', '--help', '-h', '--version', '-v'].includes(command);
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
      case '--version':
      case '-v':
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
