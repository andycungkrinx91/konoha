'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getKonohaTmpRoot } = require('./client_detection');

const WORKFLOW_PHASES = Object.freeze([
  'route',
  'explore',
  'plan',
  'research',
  'execute',
  'document',
  'review',
  'synthesize',
  'done'
]);
const HITL_GATES = Object.freeze(['plan_approval', 'delivery_signoff']);
const AISLOP_GATE_TIMEOUT_MS = 180000;
const MINIMUM_CONFIDENCE = 98;

const VALIDATION_EVIDENCE_PATTERN = new RegExp(
  '(exit(?:ed)?(?:\\s+with)?(?:\\s+code)?\\s*[:=]?\\s*0\\b' +
  '|0\\s+errors?(?:\\s+and\\s+0\\s+warnings?)?' +
  '|\\bpassed\\b' +
  '|\\bpassthrough\\b' +
  '|✓' +
  '|\\bOK\\b' +
  '|\\bsucceeded\\b' +
  '|\\bcompleted successfully\\b' +
  '|\\bpentest(?:ing)?\\s+completed\\b' +
  '|\\bscan(?:ning)?\\s+completed\\b' +
  '|\\bsecurity\\s+audit\\s+completed\\b' +
  '|\\bvulnerability\\s+assessment\\s+completed\\b' +
  '|\\b0\\s+critical\\s+vulnerabilities\\b' +
  '|\\b0\\s+unhandled\\s+exploits\\b)',
  'i'
);

function getResolvedTaskDir(taskDir = null, projectPath = null, sessionId = null) {
  const tmpRoot = getKonohaTmpRoot(projectPath, sessionId);
  const tasksDir = path.join(tmpRoot, 'scratch', 'tasks');
  if (!taskDir) {
    if (fs.existsSync(tasksDir) && fs.statSync(tasksDir).isDirectory()) {
      const subdirs = fs.readdirSync(tasksDir)
        .map(d => path.join(tasksDir, d))
        .filter(p => fs.existsSync(p) && fs.statSync(p).isDirectory());
      if (subdirs.length > 0) {
        subdirs.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
        return subdirs[0];
      }
    }
    return path.join(tasksDir, 'default');
  }
  if (!path.isAbsolute(taskDir)) {
    return path.resolve(path.join(tasksDir, taskDir));
  }
  return taskDir;
}

function readFileSafe(filePath) {
  try {
    if (fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf8');
  } catch (_) { /* ignore */ }
  return null;
}

function loadWorkflowStatus(taskDir) {
  const statusPath = path.join(taskDir, 'status.json');
  if (fs.existsSync(statusPath)) {
    try {
      return JSON.parse(fs.readFileSync(statusPath, 'utf8'));
    } catch (_) { /* ignore */ }
  }
  return {
    schema_version: 2,
    created_at: new Date().toISOString(),
    phase: 'route',
    assigned_agent: 'sannin',
    current_dispatch: null,
    completed_dispatches: [],
    dispatch_results: {},
    tasks: [],
    history: []
  };
}

function saveWorkflowStatus(taskDir, status) {
  const statusPath = path.join(taskDir, 'status.json');
  fs.writeFileSync(statusPath, JSON.stringify(status, null, 2), 'utf8');
}

function workflowHash(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    }
  } catch (_) { /* ignore */ }
  return null;
}

function isPentestTask(taskObj) {
  if (!taskObj || typeof taskObj !== 'object') return false;
  const text = `${taskObj.task || ''} ${taskObj.agent || ''}`.toLowerCase();
  return ['pentest', 'penetration test', 'penetration testing', 'vulnerability scan', 'security audit', 'security test', 'vuln scan', 'devsecops'].some(k => text.includes(k));
}

function isCleanValidation(validationList, isPentest = false, allowEmpty = true) {
  if (!validationList || validationList.length === 0) return allowEmpty;
  if (isPentest) {
    const evidence = validationList.map(item => String(item).toLowerCase());
    const hasCompletion = evidence.some(item => VALIDATION_EVIDENCE_PATTERN.test(item) || ['completed', 'passed', 'finished', 'reported', 'clean', 'done'].some(m => item.includes(m)));
    const hasFatal = evidence.some(item => ['fatal error', 'unhandled exception', 'segmentation fault', 'traceback (most recent call last)'].some(m => item.includes(m)));
    return hasCompletion && !hasFatal;
  } else {
    return !validationList.some(item => {
      let s = String(item).toLowerCase();
      s = s
        .replace(/\b0\s+errors?\s*(?:and|&)?\s*(?:0\s+warnings?)?/g, '')
        .replace(/\b0\s+warnings?/g, '')
        .replace(/\b0\s+(?:critical\s+)?vulnerabilities\b/g, '')
        .replace(/\b0\s+unhandled\s+exploits\b/g, '')
        .replace(/exit(?:ed)?(?:\s+with)?(?:\s+code)?\s*[:=]?\s*0\b/g, '');
      return ['error', 'warning', 'fail'].some(w => s.includes(w));
    });
  }
}

function workflowParseTasks(planContent) {
  const tasks = [];
  const lines = (planContent || '').split(/\r?\n/);
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx].trim();
    const match = line.match(/^- \[([A-Za-z0-9_-]+)\]:\s*(.+)$/);
    if (match) {
      const agent = match[1].replace(/_/g, '-');
      const task = match[2].trim();
      tasks.push({
        id: `task-${tasks.length + 1}`,
        agent,
        task,
        line: idx + 1,
        status: 'pending',
        result: '',
        validation: []
      });
    }
  }
  return tasks;
}

function isTransientFile(file) {
  return file.startsWith('debug_') || file.startsWith('temp_') ||
         file === 'test_patch.py' || file.endsWith('.tmp');
}

function _unlinkIfTransient(taskDir, file) {
  if (!isTransientFile(file)) return;
  try { fs.unlinkSync(path.join(taskDir, file)); } catch (_) { /* ignore */ }
}

function cleanupTransientScratchFiles(taskDir = null) {
  if (!taskDir || !fs.existsSync(taskDir) || !fs.statSync(taskDir).isDirectory()) return;
  try {
    for (const file of fs.readdirSync(taskDir)) {
      _unlinkIfTransient(taskDir, file);
    }
  } catch (_) { /* ignore */ }
}

module.exports = {
  WORKFLOW_PHASES,
  HITL_GATES,
  AISLOP_GATE_TIMEOUT_MS,
  MINIMUM_CONFIDENCE,
  VALIDATION_EVIDENCE_PATTERN,
  getResolvedTaskDir,
  readFileSafe,
  loadWorkflowStatus,
  saveWorkflowStatus,
  workflowHash,
  isPentestTask,
  isCleanValidation,
  workflowParseTasks,
  cleanupTransientScratchFiles
};
