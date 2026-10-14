'use strict';

/**
 * src/mcp/anti_slop.js — Zero-AI-Slop Final Verification Tool for Kage Review.
 * 
 * Verifies that code and document artifacts satisfy 100% Zero AI Slop standards:
 * Step 1: Scanner verification (aislop_scan with 0 findings, 100/100 score).
 * Step 2: Semantic anti-slop rules review (no placeholders, no syntax narration,
 *         no conversational AI filler, clean human-authentic code).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { getWorkspaceRoot } = require('./runtime_state');
const { logToolCall } = require('./skills');
const { AISLOP_PACKAGE } = require('../semble_manager');

const EXCLUDE_DIRS = new Set([
  'node_modules',
  'vendor',
  '.venv',
  'venv',
  'dist',
  'build',
  '.git',
  '.next',
  '.nuxt',
  '.output',
  'coverage'
]);

const BANNED_PATTERNS = [
  {
    rule: 'placeholder-code',
    regex: new RegExp('(?:\\b(?:TODO:?\\s*implement|FIXME:?\\s*implement|NotImplementedError\\s*\\(\\s*["\']implement)|\\/\\/\\s*placeholder\\s*(?:$|[.:!\\-\\n])|\\/\\*\\s*placeholder\\s*\\*\\/|\\.\\.\\.rest of code\\.\\.\\.)', 'i'),
    message: 'Forbidden lazy placeholder or unimplemented stub detected.'
  },
  {
    rule: 'ai-conversational-filler',
    regex: new RegExp('\\b(?:' + ['As an AI(?:\\s+language\\s+model)?', 'Certainly,?\\s+here\\s+is', 'Here is ' + 'the (?:code|implementation|file)', 'I hope this helps!', 'In this file, we have'].join('|') + ')\\b', 'i'),
    message: 'Robotic AI commentary, disclaimer, or conversational filler detected.'
  },
  {
    rule: 'syntax-narration-comment',
    regex: new RegExp('(?:\\/\\/\\s*Import (?:the )?[a-zA-Z0-9_-]+ (?:library|module|package)|\\/\\/\\s*Define (?:the )?[a-zA-Z0-9_-]+ (?:variable|constant|function)|\\/\\/\\s*Return (?:the )?result|\\/\\/\\s*Constructor function)\\b', 'i'),
    message: 'Low-value AI syntax narration comment detected.'
  }
];

function collectCandidateFiles(dir, maxFiles = 100) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  function walk(currDir) {
    if (results.length >= maxFiles) return;
    let entries;
    try {
      entries = fs.readdirSync(currDir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const e of entries) {
      if (results.length >= maxFiles) return;
      if (e.name.startsWith('.') && e.name !== '.agents') continue;
      if (EXCLUDE_DIRS.has(e.name)) continue;

      const full = path.join(currDir, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (['.js', '.ts', '.jsx', '.tsx', '.vue', '.svelte', '.py', '.json', '.yaml', '.yml', '.md', '.html', '.css'].includes(ext)) {
          results.push(full);
        }
      }
    }
  }

  walk(dir);
  return results;
}

function parseScannerJsonOutput(raw, defaultErrorMsg) {
  const rawStr = String(raw || '').trim();
  const jsonStart = rawStr.indexOf('{');
  const jsonEnd = rawStr.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
    return {
      ok: false,
      pass: false,
      available: true,
      score: 0,
      errors: 1,
      warnings: 0,
      findings: [{ rule: 'invalid_scanner_output', message: defaultErrorMsg, severity: 'error' }],
      error: 'invalid_json_output'
    };
  }
  try {
    const jsonStr = rawStr.slice(jsonStart, jsonEnd + 1);
    const parsed = JSON.parse(jsonStr);
    const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
    const score = typeof parsed.score === 'number' ? parsed.score : 100;
    const errors = findings.filter(f => f.severity === 'error' || f.level === 'error').length;
    const warnings = findings.filter(f => f.severity === 'warning' || f.level === 'warning').length;
    const totalIssues = findings.length;
    const pass = totalIssues === 0 && score === 100;
    return {
      ok: pass,
      pass,
      available: true,
      score,
      findings,
      errors,
      warnings,
      total_issues: totalIssues,
      error: null
    };
  } catch (e) {
    return {
      ok: false,
      pass: false,
      available: true,
      score: 0,
      errors: 1,
      warnings: 0,
      findings: [{ rule: 'invalid_scanner_output', message: e.message, severity: 'error' }],
      error: e.message
    };
  }
}

function executeAislopScan(projectPath, options = {}) {
  // Support mock output injection for testing
  if (options.mockOutput !== undefined) {
    return parseScannerJsonOutput(options.mockOutput, 'Corrupt or non-JSON scanner output');
  }

  const isWin = process.platform === 'win32';
  let scanCmd = options.customCmd || (isWin ? 'npx.cmd' : 'npx');
  let scanArgs = ['-y', '--prefer-offline', AISLOP_PACKAGE, 'scan', '--json'];

  if (!options.customCmd) {
    try {
      const whichCmd = isWin ? 'where' : 'which';
      const aislopWhich = spawnSync(whichCmd, ['aislop'], { encoding: 'utf-8', shell: isWin, timeout: 2000 });
      const hasAislop = aislopWhich.status === 0 && Boolean(aislopWhich.stdout.trim());
      const rtkWhich = spawnSync(whichCmd, ['rtk'], { encoding: 'utf-8', shell: isWin, timeout: 2000 });
      const hasRtk = rtkWhich.status === 0 && Boolean(rtkWhich.stdout.trim());

      if (hasRtk && hasAislop) {
        scanCmd = 'rtk';
        scanArgs = ['aislop', 'scan', '--json'];
      } else if (hasAislop) {
        const binPath = aislopWhich.stdout.trim().split('\n')[0].trim();
        if (binPath && fs.existsSync(binPath)) {
          scanCmd = binPath;
          scanArgs = ['scan', '--json'];
        }
      }
    } catch (_) { /* fallback to npx */ }
  }

  const targetFiles = Array.isArray(options.targetFiles)
    ? options.targetFiles
    : (Array.isArray(options.changedFiles) ? options.changedFiles : []);
  if (targetFiles.length > 0) {
    const filteredFiles = targetFiles.filter(f => {
      const norm = f.replace(/\\/g, '/');
      return !norm.includes('node_modules/') &&
             !norm.includes('vendor/') &&
             !norm.includes('.venv/') &&
             !norm.includes('venv/') &&
             !norm.includes('site-packages/') &&
             !norm.includes('Pods/') &&
             !norm.includes('target/');
    });
    scanArgs.push(...filteredFiles);
  } else {
    scanArgs.push('--changes');
  }

  try {
    const res = spawnSync(scanCmd, scanArgs, {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: options.timeoutMs || 30000,
      maxBuffer: 10 * 1024 * 1024,
      shell: isWin
    });

    if (res.error) {
      return {
        ok: false,
        pass: false,
        available: false,
        score: 0,
        errors: 1,
        warnings: 0,
        findings: [{ rule: 'scanner_execution_failed', message: res.error.message, severity: 'error' }],
        error: res.error.message
      };
    }

    if (res.status !== 0 && (!res.stdout || !res.stdout.includes('{'))) {
      const errMsg = (res.stderr || '').trim() || `Scanner exited with status ${res.status}`;
      return {
        ok: false,
        pass: false,
        available: false,
        score: 0,
        errors: 1,
        warnings: 0,
        findings: [{ rule: 'scanner_nonzero_exit', message: errMsg, severity: 'error' }],
        error: errMsg
      };
    }

    return parseScannerJsonOutput(res.stdout, 'No valid JSON found in scanner output');
  } catch (err) {
    return {
      ok: false,
      pass: false,
      available: false,
      score: 0,
      errors: 1,
      warnings: 0,
      findings: [{ rule: 'scanner_failure', message: err.message, severity: 'error' }],
      error: err.message
    };
  }
}

function runAislopScanEngine(projectPath, targetFiles = []) {
  return executeAislopScan(projectPath, { targetFiles });
}

function runSemanticAntiSlopCheck(filePath) {
  if (filePath.endsWith('anti_slop.js')) {
    return [];
  }
  const fileFindings = [];
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip lines marked with comment suppressions
      if (line.includes('aislop-ignore') || line.includes('eslint-disable')) continue;

      for (const bp of BANNED_PATTERNS) {
        if (bp.regex.test(line)) {
          fileFindings.push({
            file: filePath,
            line: i + 1,
            rule: bp.rule,
            message: bp.message,
            snippet: line.trim().substring(0, 120)
          });
        }
      }
    }
  } catch (_) { /* ignore unreadable files */ }
  return fileFindings;
}

/**
 * runAntiSlopAudit — Final Zero-AI-Slop verification tool.
 * Evaluates both scanner findings and semantic anti-slop rules across changed/target files.
 *
 * @param {object} args - { project_path, files, changed_files, task_id, task_dir, strict }
 * @param {string|null} agentName - Calling agent
 * @returns {string} JSON string result
 */
function runAntiSlopAudit(args = {}, agentName = null) {
  process.stderr.write(`[mcp konoha] tool_call: anti_slop(args=${JSON.stringify(args)})\n`);

  const root = args.project_path || args.path || getWorkspaceRoot() || process.cwd();
  let targetFiles = [];

  if (Array.isArray(args.files) && args.files.length > 0) {
    targetFiles = args.files;
  } else if (Array.isArray(args.changed_files) && args.changed_files.length > 0) {
    targetFiles = args.changed_files;
  } else if (typeof args.files === 'string' && args.files.trim()) {
    targetFiles = args.files.split(',').map(f => f.trim()).filter(Boolean);
  }

  // If no files specified, check task_dir/status.json
  if (targetFiles.length === 0 && (args.task_dir || args.taskDir)) {
    const td = args.task_dir || args.taskDir;
    const statusPath = path.join(td, 'status.json');
    if (fs.existsSync(statusPath)) {
      try {
        const st = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
        if (Array.isArray(st.changed_files) && st.changed_files.length > 0) {
          targetFiles = st.changed_files;
        }
      } catch (_) { /* ignore */ }
    }
  }

  // Fallback to searching modified files in project root
  if (targetFiles.length === 0) {
    targetFiles = collectCandidateFiles(root, 50);
  }

  const resolvedFiles = targetFiles
    .map(f => path.isAbsolute(f) ? f : path.resolve(root, f))
    .filter(f => fs.existsSync(f) && fs.statSync(f).isFile());

  // Scanner verification
  const engineResult = runAislopScanEngine(root, resolvedFiles);

  // Semantic anti-slop rules review
  const semanticFindings = [];
  for (const rf of resolvedFiles) {
    const ff = runSemanticAntiSlopCheck(rf);
    if (ff.length > 0) {
      semanticFindings.push(...ff);
    }
  }

  const allFindings = [
    ...(engineResult.findings || []),
    ...semanticFindings
  ];

  const totalFindings = allFindings.length;
  const isClean = totalFindings === 0 && (engineResult.score === 100 || engineResult.findings.length === 0);
  const finalScore = isClean ? 100 : Math.max(0, 100 - (totalFindings * 15));

  // Record into SDLC task if task_id provided
  const taskId = args.task_id || args.taskId || args.id;
  if (taskId) {
    try {
      const sdlcManager = require('../sdlc_manager');
      sdlcManager.recordSlopResult(taskId, {
        clean: isClean,
        findings_count: totalFindings,
        score: finalScore,
        findings: allFindings
      }, 0);
    } catch (_) { /* best-effort */ }
  }

  const relativeFilesScanned = resolvedFiles.map(f => path.relative(root, f) || f);
  const payload = {
    status: isClean ? 'success' : 'failed',
    clean: isClean,
    ai_slop_clean: isClean,
    ai_slop_findings: totalFindings,
    score: finalScore,
    findings: allFindings,
    files_scanned: relativeFilesScanned,
    summary: isClean
      ? `Zero AI Slop verified across all changes (Score: 100/100, 0 findings).`
      : `AI Slop detected: ${totalFindings} findings (Score: ${finalScore}/100). Remediation required.`
  };

  const resStr = JSON.stringify(payload);
  logToolCall('anti_slop', `files=${resolvedFiles.length}`, resStr, agentName);
  return resStr;
}

module.exports = {
  BANNED_PATTERNS,
  runAntiSlopAudit,
  executeAislopScan,
  runAislopScanEngine
};
