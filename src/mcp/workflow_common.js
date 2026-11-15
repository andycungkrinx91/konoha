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
const { getConfigValue } = require('../config_access');

const AISLOP_GATE_TIMEOUT_MS = getConfigValue('aislop_gate_timeout_ms');
const MINIMUM_CONFIDENCE = getConfigValue('minimum_confidence');

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

function _realpathExistingPrefix(targetPath) {
  let cur = path.resolve(targetPath);
  const tail = [];
  while (!fs.existsSync(cur)) {
    const parent = path.dirname(cur);
    if (parent === cur) return path.resolve(targetPath);
    tail.unshift(path.basename(cur));
    cur = parent;
  }
  const realBase = fs.realpathSync(cur);
  return tail.length > 0 ? path.join(realBase, ...tail) : realBase;
}

function _isSubpathWithin(candidate, root) {
  const rel = path.relative(path.resolve(root), path.resolve(candidate));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function _assertNoSymlinkedTaskPath(targetPath, rawTaskDir, allowedRoots) {
  if (fs.existsSync(targetPath) && fs.lstatSync(targetPath).isSymbolicLink()) {
    throw new Error(`Invalid task_dir "${rawTaskDir}": symlink task directories are not permitted.`);
  }
  const realTarget = _realpathExistingPrefix(targetPath);
  const realRoots = allowedRoots.map(_realpathExistingPrefix);
  if (!realRoots.some((root) => _isSubpathWithin(realTarget, root))) {
    throw new Error(`Invalid task_dir "${rawTaskDir}": symlinked ancestor escapes permitted task roots.`);
  }
  const resolvedTarget = path.resolve(targetPath);
  const deepestRoot = allowedRoots
    .map((r) => path.resolve(r))
    .filter((r) => _isSubpathWithin(resolvedTarget, r))
    .sort((a, b) => b.length - a.length)[0];
  if (deepestRoot) {
    let cur = resolvedTarget;
    while (cur && cur.length > deepestRoot.length && cur !== path.dirname(cur)) {
      if (fs.existsSync(cur) && fs.lstatSync(cur).isSymbolicLink()) {
        throw new Error(`Invalid task_dir "${rawTaskDir}": symlinked ancestor inside task root is not permitted.`);
      }
      cur = path.dirname(cur);
    }
  }
}

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
  const rawTaskDir = String(taskDir);
  if (rawTaskDir.includes('\0')) {
    throw new Error('Invalid task_dir: null byte not allowed.');
  }
  const absTasksDir = path.resolve(tasksDir);
  if (!path.isAbsolute(rawTaskDir)) {
    const resolved = path.resolve(absTasksDir, rawTaskDir);
    const rel = path.relative(absTasksDir, resolved);
    if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
      throw new Error(`Invalid relative task_dir "${rawTaskDir}": escapes tasks root.`);
    }
    _assertNoSymlinkedTaskPath(resolved, rawTaskDir, [absTasksDir]);
    return resolved;
  }
  const resolvedAbs = path.resolve(rawTaskDir);
  const os = require('os');
  const absTmp = path.resolve(tmpRoot);
  const absKonohaTmpBase = path.resolve(process.env.KONOHA_TMP_ROOT || path.join(os.homedir(), '.konoha', 'tmp'));
  const absOsTmp = path.resolve(os.tmpdir());
  const insideRoot = (candidate, rootDir) => {
    const rel = path.relative(rootDir, candidate);
    return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
  };
  if (!insideRoot(resolvedAbs, absTasksDir) && !insideRoot(resolvedAbs, absTmp) && !insideRoot(resolvedAbs, absKonohaTmpBase) && !insideRoot(resolvedAbs, absOsTmp)) {
    throw new Error(`Invalid task_dir "${rawTaskDir}": must reside inside Konoha tasks root or system temp directory.`);
  }
  _assertNoSymlinkedTaskPath(resolvedAbs, rawTaskDir, [absTasksDir, absTmp, absKonohaTmpBase, absOsTmp]);
  return resolvedAbs;
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
  const statusPath = path.join(path.resolve(taskDir), 'status.json');
  if (fs.existsSync(statusPath) && fs.lstatSync(statusPath).isSymbolicLink()) {
    throw new Error(`Refusing to write symlinked workflow status file: ${statusPath}`);
  }
  fs.mkdirSync(path.dirname(statusPath), { recursive: true });
  const tmpPath = `${statusPath}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 8)}`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(status, null, 2), { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(tmpPath, statusPath);
  } catch (err) {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) { /* ignore */ }
    throw err;
  }
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
  if (!taskObj) return false;
  const text = (typeof taskObj === 'string' ? taskObj : `${taskObj.task || ''} ${taskObj.agent || ''}`).toLowerCase();
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
        .replace(/\b0\s+fail(?:ed|ures?)?\b/g, '')
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
      let rawTask = match[2].trim();
      let parallelGroup = null;
      const pgMatch = rawTask.match(/\s+parallel_group:([A-Za-z0-9_-]+)$/i);
      if (pgMatch) {
        parallelGroup = pgMatch[1];
        rawTask = rawTask.slice(0, pgMatch.index).trim();
      }
      tasks.push({
        id: `task-${tasks.length + 1}`,
        agent,
        task: rawTask,
        parallel_group: parallelGroup,
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
