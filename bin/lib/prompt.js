'use strict';

/**
 * bin/lib/prompt.js — Interactive Terminal Prompts, Spinners & File Helpers.
 *
 * Provides:
 * - Readline lifecycle: askQuestion, closeReadline, isCancel, confirmPrompt
 * - TTY animated spinners & KonohaProgressBar
 * - Safe file operation helpers: fileExists, ensureDir, copyFile, checkPython
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { C, log } = require('./format');
const platform = require('../../src/platform_utils');

let rlInstance = null;

function getReadlineInterface() {
  if (!rlInstance) {
    rlInstance = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }
  return rlInstance;
}

function setupRawEscape(onEscape) {
  const wasRaw = Boolean(process.stdin?.isRaw);
  if (process.stdin && !wasRaw && typeof process.stdin.setRawMode === 'function') {
    process.stdin.setRawMode(true);
  }
  const onData = (data) => {
    if (data.toString() === '\u001b') onEscape();
  };
  if (process.stdin) {
    process.stdin.resume();
    process.stdin.on('data', onData);
  }
  return function cleanup() {
    if (!process.stdin) return;
    process.stdin.removeListener('data', onData);
    if (!wasRaw && typeof process.stdin.setRawMode === 'function') {
      process.stdin.setRawMode(false);
    }
  };
}

function askQuestion(query) {
  return new Promise((resolve) => {
    const rl = getReadlineInterface();
    let resolved = false;

    const cleanup = setupRawEscape(() => {
      cleanup();
      resolved = true;
      closeReadline();
      process.stdout.write('\n');
      resolve('ESC');
    });

    rl.question(query, (answer) => {
      if (resolved) return;
      cleanup();
      resolved = true;
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

function isCancel(ans) {
  if (ans === 'ESC') return true;
  if (!ans) return false;
  const lower = ans.toLowerCase().trim();
  return lower === '0' || lower === 'q' || lower === 'exit' || lower === 'back';
}

async function confirmPrompt(message, defaultVal = true) {
  if (process.env.CI === 'true' || !process.stdin || !process.stdin.isTTY) {
    return defaultVal;
  }
  const suffix = defaultVal ? ' (Y/n) ' : ' (y/N) ';
  const ans = (await askQuestion(`${message}${suffix}`)).trim().toLowerCase();
  if (ans === 'esc' || ans === 'n' || ans === 'no') return false;
  if (ans === 'y' || ans === 'yes') return true;
  if (ans === '') return defaultVal;
  return defaultVal;
}

// Braille spinner frames for animated TTY feedback.
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_INTERVAL_MS = 90;

function startSpinner(text) {
  const animate = Boolean(
    process.stdout && process.stdout.isTTY &&
    !process.env.CI && !process.env.NO_COLOR && process.env.KONOHA_SPINNERS !== '0'
  );
  if (!animate) {
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

  let currentText = text;
  let frame = 0;
  let timer = setInterval(() => {
    const glyph = SPINNER_FRAMES[frame % SPINNER_FRAMES.length];
    frame++;
    process.stdout.write(`\r\x1b[2K  ${C.cyan}${glyph}${C.reset} ${currentText}`);
  }, SPINNER_INTERVAL_MS);
  if (timer && typeof timer.unref === 'function') timer.unref();

  function finish(marker, color, finalText) {
    if (timer) { clearInterval(timer); timer = null; }
    process.stdout.write('\r\x1b[2K');
    log(`  ${color}${marker}${C.reset} ${finalText || currentText}`);
  }

  return {
    stop() { finish('›', C.dim, currentText); },
    start(newText) { if (newText) currentText = newText; },
    update(newText) { if (newText) currentText = newText; },
    success(successText) { finish('✓', C.green, successText); },
    warn(warnText) { finish('⚠', C.yellow, warnText); },
    error(errText) { finish('✗', C.red, errText); },
  };
}

class KonohaProgressBar {
  constructor({ total = 100, width = 28, title = 'Progress' } = {}) {
    this.total = Math.max(1, total);
    this.width = width;
    this.title = title;
    this.current = 0;
    this.status = '';
    this.isTTY = Boolean(process.stdout && process.stdout.isTTY);
    this.timer = null;
    this._lastLoggedPercent = -1;
  }

  start(initialStatus = '') {
    this.status = initialStatus;
    this.render();
    return this;
  }

  update(current, status) {
    if (typeof current === 'number') this.current = Math.min(this.total, Math.max(0, current));
    if (typeof status === 'string') this.status = status;
    this.render();
    return this;
  }

  render() {
    const ratio = Math.min(1, Math.max(0, this.current / this.total));
    const percent = Math.round(ratio * 100);

    if (!this.isTTY) {
      if (percent >= this._lastLoggedPercent + 25 || percent === 100) {
        log(`  ${C.dim}[${this.title}]${C.reset} ${percent}% ${this.status}`);
        this._lastLoggedPercent = percent;
      }
      return;
    }

    const filledLen = Math.round(this.width * ratio);
    const emptyLen = this.width - filledLen;
    const bar = `${C.cyan}${'█'.repeat(filledLen)}${C.dim}${'░'.repeat(emptyLen)}${C.reset}`;
    const line = `\r\x1b[2K  ${C.bold}${this.title}${C.reset} [${bar}] ${C.cyan}${String(percent).padStart(3)}%${C.reset} ${C.dim}${this.status}${C.reset}`;
    process.stdout.write(line);
  }

  logStep(msg) {
    if (this.isTTY) {
      process.stdout.write('\r\x1b[2K');
      log(`  ${C.green}✓${C.reset} ${msg}`);
      this.render();
    } else {
      log(`  ${C.green}✓${C.reset} ${msg}`);
    }
    return this;
  }

  startPulse(label) {
    if (typeof label === 'string') this.status = label;
    this.stopPulse();
    if (!this.isTTY) {
      this.render();
      return this;
    }
    let pulseIdx = 0;
    this.timer = setInterval(() => {
      pulseIdx = (pulseIdx + 1) % SPINNER_FRAMES.length;
      const frame = SPINNER_FRAMES[pulseIdx];
      const ratio = Math.min(1, Math.max(0, this.current / this.total));
      const percent = Math.round(ratio * 100);
      const filledLen = Math.round(this.width * ratio);
      const emptyLen = this.width - filledLen;
      const bar = `${C.cyan}${'█'.repeat(filledLen)}${C.dim}${'░'.repeat(emptyLen)}${C.reset}`;
      const line = `\r\x1b[2K  ${C.bold}${this.title}${C.reset} [${bar}] ${C.cyan}${String(percent).padStart(3)}%${C.reset} ${C.dim}${frame} ${this.status}${C.reset}`;
      process.stdout.write(line);
    }, SPINNER_INTERVAL_MS || 80);
    return this;
  }

  stopPulse() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    return this;
  }

  finish(finalStatus = 'Complete') {
    this.stopPulse();
    return this.complete(finalStatus);
  }

  complete(finalStatus = 'Complete') {
    this.stopPulse();
    this.current = this.total;
    this.status = finalStatus;
    if (this.isTTY) {
      process.stdout.write('\r\x1b[2K');
      log(`  ${C.green}✓${C.reset} ${C.bold}${this.title}${C.reset} ${C.green}100%${C.reset} — ${finalStatus}`);
    } else {
      log(`  ${C.green}✓${C.reset} [${this.title}] 100% ${finalStatus}`);
    }
  }

  fail(reason = 'Failed') {
    this.stopPulse();
    if (this.isTTY) {
      process.stdout.write('\r\x1b[2K');
      log(`  ${C.red}✗${C.reset} ${C.bold}${this.title}${C.reset} — ${C.red}${reason}${C.reset}`);
    } else {
      log(`  ${C.red}✗${C.reset} [${this.title}] ${reason}`);
    }
  }
}

function fileExists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest) {
  try {
    if (path.resolve(src) === path.resolve(dest)) return;
  } catch (_) { /* intentional fallback */ }
  try {
    fs.copyFileSync(src, dest);
  } catch (err) {
    if (process.platform === 'win32' && (err.code === 'EBUSY' || err.code === 'EPERM')) {
      try {
        fs.chmodSync(dest, 0o666);
        fs.unlinkSync(dest);
        fs.copyFileSync(src, dest);
      } catch (_) { /* non-fatal best effort */ }
    } else {
      throw err;
    }
  }
}

function checkPython() {
  return platform.detectPython();
}

module.exports = {
  askQuestion,
  closeReadline,
  isCancel,
  confirmPrompt,
  startSpinner,
  SPINNER_FRAMES,
  SPINNER_INTERVAL_MS,
  KonohaProgressBar,
  fileExists,
  ensureDir,
  copyFile,
  checkPython,
};
