'use strict';

/**
 * src/mcp/worktree_isolation.js — per-subagent git worktree + branch isolation.
 *
 * Gives each parallel subagent dispatch its own git worktree and branch so
 * concurrent working trees cannot collide.
 *
 * SCOPE / LIMITS:
 * - Isolation relies on the client honouring buildWorktreeDirective (see assertBelongsToWorktree).
 * - Only committed changes are merged back via mergeAgentWorktree.
 * - Merge-back refuses when pre-existing dirty paths overlap ('main_dirty'),
 *   when no commit exists ('no_commits'), or on non-orchestrated branches.
 * - Pre-commit syntax gate verifies incoming JS/Python files parse cleanly.
 *
 * FEATURE FLAG:
 * KONOHA_WORKTREE_ISOLATION: '1'/'true' force-enable, '0'/'false' disable.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { normCase } = require('./runtime_state');

const BRANCH_PREFIX = 'konoha/agent/';
const FLAG_ENV = 'KONOHA_WORKTREE_ISOLATION';
const { getConfigValue } = require('../config_access');

const GIT_TIMEOUT_MS = getConfigValue('git_timeout_ms');
const MAX_DIRTY_PATHS_REPORTED = 20;

const SUPPORTED_SYNTAX = Object.freeze({
  '.js': 'node',
  '.cjs': 'node',
  '.mjs': 'node',
  '.json': 'json',
  '.py': 'python'
});

const CONFLICT_MARKER_REGEX = /^(<<<<<<<|=======|>>>>>>>)(\s|$)/m;

function _isEnabledFlag(value) {
  if (value === undefined || value === null || value === '') return null;
  return !['0', 'false', 'off', 'no', 'disabled'].includes(String(value).trim().toLowerCase());
}

function isIsolationEnabled(env = process.env) {
  const flag = _isEnabledFlag(env[FLAG_ENV]);
  return flag === null ? null : flag;
}

function _git(cwd, args, options = {}) {
  const res = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: options.timeoutMs || GIT_TIMEOUT_MS,
    input: options.input,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true' }
  });
  const stdout = (res.stdout || '').trim();
  const stderr = (res.stderr || '').trim();
  return {
    ok: res.status === 0 && !res.error,
    code: res.status,
    stdout,
    stderr,
    error: res.error ? res.error.message : null
  };
}

function resolveRepoRoot(projectPath) {
  if (!projectPath) return null;
  const cwd = path.resolve(projectPath);
  if (!fs.existsSync(cwd)) return null;
  const res = _git(cwd, ['rev-parse', '--show-toplevel']);
  if (!res.ok || !res.stdout) return null;
  return path.resolve(res.stdout);
}

function getIsolationState(projectPath, env = process.env) {
  const flag = isIsolationEnabled(env);
  if (flag === false) {
    return { feature: 'worktree_isolation', enabled: false, repo_root: null, reason: 'disabled' };
  }
  const repoRoot = resolveRepoRoot(projectPath);
  if (!repoRoot) {
    return { feature: 'worktree_isolation', enabled: false, repo_root: null, reason: 'not_git_repo' };
  }
  return { feature: 'worktree_isolation', enabled: true, repo_root: repoRoot, reason: null };
}

function _worktreeBaseDir(repoRoot, env = process.env) {
  const configured = env.KONOHA_WORKTREE_DIR;
  if (configured && String(configured).trim()) return path.resolve(String(configured).trim());
  // Inside the repo only when it is gitignored; otherwise keep it out of the
  // checkout entirely so it can never surface as a dirty path.
  const gitignorePath = path.join(repoRoot, '.gitignore');
  try {
    if (fs.existsSync(gitignorePath) && /^\/?\.konoha\/?\s*$/m.test(fs.readFileSync(gitignorePath, 'utf8'))) {
      return path.join(repoRoot, '.konoha', 'worktrees');
    }
  } catch (_) { /* fall through to tmp */ }
  const name = path.basename(repoRoot).replace(/[^A-Za-z0-9._-]/g, '_');
  const id = crypto.createHash('sha256').update(normCase(repoRoot)).digest('hex').slice(0, 8);
  return path.join(os.tmpdir(), 'konoha-worktrees', `${name}-${id}`);
}

function branchSlug(value) {
  return String(value || 'agent').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'agent';
}

function buildAgentBranchName(dispatchId, agent) {
  return `${BRANCH_PREFIX}${branchSlug(agent)}/${String(dispatchId).slice(0, 16)}`;
}

function isOrchestratedBranch(branch) {
  return typeof branch === 'string' && branch.startsWith(BRANCH_PREFIX);
}

/**
 * Capture the integration anchor. Every member of one parallel group must be
 * created from this exact SHA so later members never inherit earlier members'
 * work through a moving HEAD.
 */
function captureBaseSha(repoRoot) {
  const res = _git(repoRoot, ['rev-parse', 'HEAD']);
  if (!res.ok || !res.stdout) {
    return { ok: false, reason: 'base_capture_failed', error: res.stderr || res.error };
  }
  return { ok: true, base_sha: res.stdout };
}

function createAgentWorktree(options) {
  const { repoRoot, dispatchId, agent, baseSha } = options || {};
  if (!repoRoot) return { ok: false, reason: 'not_git_repo' };
  const branch = buildAgentBranchName(dispatchId, agent);
  if (!isOrchestratedBranch(branch)) return { ok: false, reason: 'not_orchestrated_branch', branch };
  if (!baseSha) return { ok: false, reason: 'no_base_sha', branch };

  const verify = _git(repoRoot, ['cat-file', '-e', `${baseSha}^{commit}`]);
  if (!verify.ok) return { ok: false, reason: 'base_sha_unknown', branch, error: verify.stderr };

  const worktreePath = path.join(_worktreeBaseDir(repoRoot), branchSlug(String(dispatchId).slice(0, 16)));
  if (fs.existsSync(worktreePath)) {
    return { ok: false, reason: 'worktree_path_exists', branch, worktree_path: worktreePath };
  }
  fs.mkdirSync(path.dirname(worktreePath), { recursive: true });

  const add = _git(repoRoot, ['worktree', 'add', '--quiet', '-b', branch, worktreePath, baseSha]);
  if (!add.ok) {
    return { ok: false, reason: 'worktree_add_failed', branch, worktree_path: worktreePath, error: add.stderr || add.error };
  }
  return { ok: true, branch, worktree_path: worktreePath, base_sha: baseSha, repo_root: repoRoot };
}

function countBranchCommits(worktreePath, baseSha) {
  const res = _git(worktreePath, ['rev-list', '--count', `${baseSha}..HEAD`]);
  if (!res.ok) return -1;
  const n = parseInt(res.stdout, 10);
  return Number.isNaN(n) ? -1 : n;
}

/** Commit any work the subagent left uncommitted inside its own worktree. */
function commitWorktreeChanges(worktreePath, message) {
  const dirty = _git(worktreePath, ['status', '--porcelain']);
  if (!dirty.ok) return { ok: false, reason: 'git_status_failed', error: dirty.stderr };
  if (!dirty.stdout) return { ok: true, committed: false, reason: 'clean' };
  const add = _git(worktreePath, ['add', '-A']);
  if (!add.ok) return { ok: false, reason: 'git_add_failed', error: add.stderr };
  const commit = _git(worktreePath, [
    '-c', 'user.name=Konoha Agent',
    '-c', 'user.email=agent@konoha.local',
    'commit', '--no-verify', '-m', message || 'konoha: agent work'
  ]);
  if (!commit.ok) return { ok: false, reason: 'git_commit_failed', error: commit.stderr };
  const sha = _git(worktreePath, ['rev-parse', 'HEAD']);
  return { ok: true, committed: true, commit_sha: sha.stdout };
}

function getChangedPaths(worktreePath, baseSha) {
  const res = _git(worktreePath, ['diff', '--name-only', `${baseSha}...HEAD`]);
  if (!res.ok) return null;
  return res.stdout ? res.stdout.split('\n').map(s => s.trim()).filter(Boolean) : [];
}

function _splitPorcelainZ(out) {
  // With `--porcelain -z` entries are NUL separated: "XY <path>" and, for
  // renames/copies, the old path follows as its own NUL-terminated field.
  // NUL framing is required because a plain line split loses the leading
  // space of " M path" when the path itself starts with a space.
  const fields = out.split('\0');
  const entries = [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (!field || field.length < 4) continue;
    const x = field[0];
    const y = field[1];
    let file = field.slice(3);
    if (x === 'R' || x === 'C') {
      i += 1; // skip the original path field
    }
    entries.push({
      file,
      index_status: x,
      worktree_status: y,
      from_index: x !== ' ' && x !== '?',
      from_worktree: y !== ' ' && y !== '?'
    });
  }
  return entries;
}

function readPorcelainStatus(worktreePath) {
  // Raw spawn (no output trimming): the first byte of an entry can be a space
  // (" M path"), which whitespace handling would corrupt.
  const res = spawnSync('git', ['status', '--porcelain', '-z'], {
    cwd: worktreePath,
    encoding: 'utf8',
    timeout: GIT_TIMEOUT_MS,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  });
  if (res.status !== 0 || res.error) return null;
  return _splitPorcelainZ(res.stdout || '');
}

function fileSha256(filePath) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch (_) {
    return null;
  }
}

function _hasConflictMarkersInFile(abs) {
  try {
    const stat = fs.statSync(abs);
    if (!stat.isFile() || stat.size > 1024 * 1024) return false;
    return CONFLICT_MARKER_REGEX.test(fs.readFileSync(abs, 'utf8'));
  } catch (_) {
    return false;
  }
}

function syntaxGateForFiles(worktreePath, files) {
  const checked = [];
  const failed = [];
  for (const file of files) {
    const abs = path.join(worktreePath, file);
    if (!fs.existsSync(abs)) continue;
    if (_hasConflictMarkersInFile(abs)) {
      failed.push({ file, error: 'unresolved git conflict markers (<<<<<<< / ======= / >>>>>>>) detected' });
      continue;
    }
    const ext = path.extname(file).toLowerCase();
    const mode = SUPPORTED_SYNTAX[ext];
    if (!mode) continue;
    if (mode === 'json') {
      try {
        JSON.parse(fs.readFileSync(abs, 'utf8'));
        checked.push(file);
      } catch (jsonErr) {
        failed.push({ file, error: `json parse failed: ${jsonErr.message}` });
      }
      continue;
    }
    const res = mode === 'node'
      ? spawnSync(process.execPath, ['--check', abs], { encoding: 'utf8', timeout: GIT_TIMEOUT_MS })
      : spawnSync('python3', ['-m', 'py_compile', abs], { encoding: 'utf8', timeout: GIT_TIMEOUT_MS });
    if (res.error) {
      failed.push({ file, error: `cannot execute ${mode} check: ${res.error.message}` });
    } else if (res.status !== 0) {
      failed.push({ file, error: (res.stderr || res.stdout || `${mode} check failed`).trim().slice(0, 2000) });
    } else {
      checked.push(file);
    }
  }
  return { ok: failed.length === 0, checked, failed };
}

function assertBelongsToWorktree(filePath, worktreePath) {
  if (!worktreePath || !filePath) return { ok: false, reason: 'missing_path' };
  const root = normCase(worktreePath);
  const target = normCase(path.resolve(filePath));
  const sep = path.sep;
  const inside = target === root || target.startsWith(root.endsWith(sep) ? root : root + sep);
  return { ok: inside, reason: inside ? null : 'outside_worktree', file: target, worktree: root };
}

function _isMergeInProgress(repoRoot) {
  const res = _git(repoRoot, ['rev-parse', '--verify', '--quiet', 'MERGE_HEAD']);
  return res.ok;
}

function _abortMergeIfNeeded(repoRoot, mergeResult) {
  if (mergeResult.ok || !_isMergeInProgress(repoRoot)) {
    return { attempted: false, ok: true };
  }
  const abort = _git(repoRoot, ['merge', '--abort']);
  return { attempted: true, ok: abort.ok, error: abort.ok ? null : (abort.stderr || abort.error) };
}

function _refuseMerge(repoRoot, details) {
  return { ok: false, merged: false, ...details };
}

/**
 * Integrate one agent branch into the main worktree — COMMITS ONLY.
 *
 * Order matters and is pinned by tests:
 *   1. branch ownership check          -> 'not_orchestrated_branch'
 *   2. branch exists / has commits     -> 'no_commits'
 *   3. dirty-main collision check      -> 'main_dirty' (nothing is stashed,
 *                                         checked out or reset)
 *   4. merge --no-ff --no-commit
 *   5. syntax gate on staged files     -> 'syntax_gate_failed'
 *   6. commit (stage 4-6 repeat once if the syntax gate first fails)
 * Any failure after step 4 runs `git merge --abort` so the main worktree is
 * returned to its pre-merge state (pre-existing changes included).
 */
function mergeAgentWorktree(options) {
  const { repoRoot, branch, baseSha, env: _env = process.env } = options || {};
  const _gitOpts = { env: _env };
  if (!repoRoot) return _refuseMerge(repoRoot, { reason: 'not_git_repo' });
  if (!isOrchestratedBranch(branch)) return _refuseMerge(repoRoot, { reason: 'not_orchestrated_branch', branch });

  const branchCheck = _git(repoRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], _gitOpts);
  if (!branchCheck.ok) return _refuseMerge(repoRoot, { reason: 'no_commits', branch, detail: 'branch_missing' });

  const baseRes = baseSha ? { ok: true, stdout: baseSha } : _git(repoRoot, ['merge-base', 'HEAD', branch]);
  if (!baseRes.ok || !baseRes.stdout) return _refuseMerge(repoRoot, { reason: 'no_base_sha', branch });
  const effBase = baseRes.stdout;

  const committed = _git(repoRoot, ['rev-list', '--count', `${effBase}..${branch}`]);
  if (!committed.ok) return _refuseMerge(repoRoot, { reason: 'merge_failed', branch, error: committed.stderr });
  if (parseInt(committed.stdout, 10) === 0) {
    return _refuseMerge(repoRoot, { reason: 'no_commits', branch, detail: 'no_commits_beyond_base' });
  }

  const incoming = _git(repoRoot, ['diff', '--name-only', `${effBase}...${branch}`]);
  if (!incoming.ok) return _refuseMerge(repoRoot, { reason: 'merge_failed', branch, error: incoming.stderr });
  const incomingPaths = incoming.stdout ? incoming.stdout.split('\n').map(s => s.trim()).filter(Boolean) : [];

  const status = readPorcelainStatus(repoRoot);
  if (status === null) return _refuseMerge(repoRoot, { reason: 'merge_failed', branch, error: 'git status failed' });
  const incomingSet = new Set(incomingPaths);
  const collisions = status.filter(e => incomingSet.has(e.file)).map(e => ({
    file: e.file,
    index_status: e.index_status,
    worktree_status: e.worktree_status
  }));
  if (collisions.length > 0) {
    return _refuseMerge(repoRoot, {
      reason: 'main_dirty',
      branch,
      conflicting_paths: collisions.slice(0, MAX_DIRTY_PATHS_REPORTED).map(c => c.file),
      collisions: collisions.slice(0, MAX_DIRTY_PATHS_REPORTED),
      conflicting_path_count: collisions.length,
      message: 'Main worktree has uncommitted changes to incoming files. Branch and worktree were preserved; nothing was stashed, checked out or reset.'
    });
  }

  const result = {
    ok: true,
    merged: false,
    branch,
    base_sha: effBase,
    incoming_paths: incomingPaths,
    attempts: 0,
    syntax_gate: null,
    merge_commit: null
  };

  for (let attempt = 1; attempt <= 2; attempt++) {
    result.attempts = attempt;
    const merge = _git(repoRoot, ['merge', '--no-ff', '--no-commit', '--no-edit', branch]);
    if (!merge.ok) {
      const aborted = _abortMergeIfNeeded(repoRoot, merge);
      return { ...result, ok: false, reason: 'merge_conflict', error: merge.stderr || merge.error, aborted };
    }

    const staged = _git(repoRoot, ['diff', '--cached', '--name-only']);
    const stagedFiles = staged.ok && staged.stdout ? staged.stdout.split('\n').map(s => s.trim()).filter(Boolean) : incomingPaths;

    const gate = syntaxGateForFiles(repoRoot, stagedFiles);
    result.syntax_gate = gate;
    if (!gate.ok) {
      const abort = _git(repoRoot, ['merge', '--abort']);
      if (!abort.ok) {
        return { ...result, ok: false, reason: 'syntax_gate_failed', syntax_gate: gate, aborted: { attempted: true, ok: false, error: abort.stderr } };
      }
      if (attempt === 1) {
        // Give the agent one chance to repair its own code on its branch.
        return {
          ...result,
          ok: false,
          reason: 'syntax_gate_failed',
          branch_preserved: true,
          worktree_preserved: true,
          message: 'Incoming files do not parse. Branch and worktree were preserved. The subagent must commit a fix on its branch.',
          aborted: { attempted: true, ok: true }
        };
      }
      return { ...result, ok: false, reason: 'syntax_gate_failed', aborted: { attempted: true, ok: true } };
    }

    const commit = _git(repoRoot, [
      '-c', 'user.name=Konoha Merge',
      '-c', 'user.email=merge@konoha.local',
      '-c', 'commit.gpgsign=false',
      'commit', '--no-verify', '--no-edit', '-m', `konoha: merge ${branch} (worktree isolation)`
    ]);
    if (!commit.ok) {
      const abort = _git(repoRoot, ['merge', '--abort']);
      return { ...result, ok: false, reason: 'merge_commit_failed', error: commit.stderr, aborted: { attempted: true, ok: abort.ok } };
    }
    const head = _git(repoRoot, ['rev-parse', 'HEAD']);
    result.merged = true;
    result.merge_commit = head.stdout;
    return result;
  }
  return { ...result, ok: false, reason: 'merge_conflict' };
}

function removeAgentWorktree(options) {
  const { repoRoot, worktreePath, branch } = options || {};
  const out = { removed_worktree: false, deleted_branch: false, errors: [] };
  if (!repoRoot) { out.errors.push('not_git_repo'); return out; }
  if (worktreePath) {
    const rm = _git(repoRoot, ['worktree', 'remove', '--force', worktreePath]);
    if (rm.ok) out.removed_worktree = true;
    else out.errors.push(`worktree remove: ${rm.stderr}`);
  }
  _git(repoRoot, ['worktree', 'prune']);
  if (branch && isOrchestratedBranch(branch)) {
    const del = _git(repoRoot, ['branch', '-D', branch]);
    if (del.ok) out.deleted_branch = true;
    else out.errors.push(`branch -D: ${del.stderr}`);
  }
  return out;
}

/**
 * The instruction channel. Worktree creation alone isolates nothing: the
 * client must be told, in the dispatch payload and in the subagent prompt, to
 * work inside the worktree and commit there. These strings are asserted by
 * tests (control (l)).
 */
const WORKTREE_COMMIT_INSTRUCTION = 'Commit your work on your branch before reporting completion: `git add -A && git commit -m "<summary>"`';

function buildWorktreeDirective(workspace) {
  if (!workspace || !workspace.worktree_path) return '';
  return [
    '### 🔒 WORKTREE ISOLATION (mandatory)',
    `- Operate ONLY inside ${workspace.worktree_path} — treat it as the working directory for every read, write and command (cd into it first).`,
    `- Do NOT read or write files in the main checkout (${workspace.main_checkout || workspace.repo_root}); another agent may be editing it concurrently.`,
    `- Your branch is ${workspace.branch} (base ${String(workspace.base_sha || '').slice(0, 12)}). Work on it; do not switch branches.`,
    `- ${WORKTREE_COMMIT_INSTRUCTION}. Uncommitted work in the worktree is NOT merged back.`,
    `- The orchestrator merges the commit(s) on ${workspace.branch} after a syntax check; if that check fails the branch is returned to you for a fix.`
  ].join('\n');
}

function applyWorktreeInstruction(instructions, workspace) {
  const directive = buildWorktreeDirective(workspace);
  if (!directive) return instructions;
  return `${instructions}\n\n${directive}`;
}

function buildFallbackDirective(reason) {
  return [
    '### ⚠️ WORKTREE ISOLATION UNAVAILABLE',
    `- Reason: ${reason}. All agents share one checkout; only serialize your edits and report every file you touched via report_from_agent.`
  ].join('\n');
}

function _addTaskToStatus(status, taskId) {
  if (!taskId) return null;
  status.tasks = status.tasks || [];
  let task = status.tasks.find(t => t.id === taskId);
  if (!task) {
    task = { id: taskId, agent: '', task: '', status: 'pending', result: '', validation: [] };
    status.tasks.push(task);
  }
  return task;
}

function _recordWorkspace(status, dispatch, workspace) {
  status.worktree_isolations = status.worktree_isolations || {};
  status.worktree_isolations[dispatch.id] = { ...workspace, dispatch_id: dispatch.id, recorded_at: new Date().toISOString() };
  dispatch.worktree = {
    branch: workspace.branch,
    worktree_path: workspace.worktree_path,
    base_sha: workspace.base_sha
  };
  const task = (status.tasks || []).find(t => t.id === dispatch.task_id);
  if (task) {
    task.branch = workspace.branch;
    task.worktree_path = workspace.worktree_path;
    task.base_sha = workspace.base_sha;
  }
}

function _recordFallback(status, dispatch, reason) {
  status.worktree_isolations = status.worktree_isolations || {};
  status.worktree_isolations[dispatch.id] = { enabled: false, fallback: true, reason, dispatch_id: dispatch.id, recorded_at: new Date().toISOString() };
  dispatch.worktree = { enabled: false, fallback: true, reason };
}

/**
 * Prepare worktrees for a dispatch group. `groupBaseSha` is captured once by
 * the caller so every member starts from the same commit. When base capture
 * itself fails every member falls back with the same reason.
 */
function prepareDispatchesWorktrees(options) {
  const { status, repoRoot, groupBaseSha, items, env: _env = process.env } = options || {};
  const results = [];
  for (const item of items || []) {
    const { dispatch, agent, taskId } = item;
    const task = _addTaskToStatus(status, taskId);
    if (!repoRoot) {
      const reason = (groupBaseSha && groupBaseSha.reason) || 'not_git_repo';
      _recordFallback(status, dispatch, reason);
      results.push({ dispatch, workspace: null, fallback: true, reason });
      continue;
    }
    const created = createAgentWorktree({ repoRoot, dispatchId: dispatch.id, agent, baseSha: groupBaseSha && groupBaseSha.base_sha, env: _env });
    if (!created.ok) {
      _recordFallback(status, dispatch, created.reason);
      results.push({ dispatch, workspace: null, fallback: true, reason: created.reason, error: created.error });
      continue;
    }
    const workspace = {
      enabled: true,
      fallback: false,
      repo_root: repoRoot,
      main_checkout: repoRoot,
      branch: created.branch,
      worktree_path: created.worktree_path,
      base_sha: created.base_sha,
      task_id: taskId || null,
      agent: agent || null,
      status: 'active'
    };
    if (task) task.agent = task.agent || agent;
    _recordWorkspace(status, dispatch, workspace);
    results.push({ dispatch, workspace, fallback: false });
  }
  return results;
}

function findWorkspaceForDispatch(status, dispatchId) {
  const rec = status && status.worktree_isolations && status.worktree_isolations[dispatchId];
  if (rec && rec.enabled && !rec.fallback) return rec;
  return null;
}

/**
 * Executor side: commit the agent's work in its own worktree, then integrate.
 * Idempotent — a dispatch already marked merged/skipped is returned as-is.
 */
function integrateDispatchWorktree(options) {
  const { status, dispatchId, message, commit = true, env = process.env } = options || {};
  const ws = findWorkspaceForDispatch(status, dispatchId);
  if (!ws) {
    const rec = status && status.worktree_isolations && status.worktree_isolations[dispatchId];
    return { ok: true, merged: false, skipped: true, reason: rec ? rec.reason : 'no_workspace' };
  }
  if (ws.status === 'merged') return { ok: true, merged: true, skipped: true, reason: 'already_merged', workspace: ws };
  if (ws.status === 'failed') return { ok: false, merged: false, skipped: true, reason: ws.last_reason, workspace: ws };

  const repoRoot = ws.repo_root;
  if (commit) {
    const res = commitWorktreeChanges(ws.worktree_path, message || `konoha: ${ws.agent} work for ${ws.task_id || dispatchId}`);
    if (!res.ok) {
      ws.status = 'failed';
      ws.last_reason = res.reason;
      return { ok: false, merged: false, reason: res.reason, error: res.error, workspace: ws };
    }
  }

  const merge = mergeAgentWorktree({ repoRoot, branch: ws.branch, baseSha: ws.base_sha, env });
  ws.last_merge = { reason: merge.reason || null, ok: merge.ok, merged: merge.merged, at: new Date().toISOString() };
  if (merge.ok && merge.merged) {
    ws.status = 'merged';
    ws.merge_commit = merge.merge_commit;
    delete ws.last_reason;
  } else {
    ws.status = 'failed';
    ws.last_reason = merge.reason;
    if (merge.conflicting_paths) ws.conflicting_paths = merge.conflicting_paths;
  }
  const out = { ...merge, workspace: ws };
  return out;
}

/**
 * Merge-back step for a parallel-group barrier. Members merge in dispatch
 * order; the first failure short-circuits the rest ('blocked_by') so a broken
 * branch does not get silently skipped over.
 */
function mergeBackParallelGroup(options) {
  const { status, groupName, env = process.env } = options || {};
  const tasks = (status && status.tasks) || [];
  const members = tasks.filter(t => t.parallel_group === groupName);
  const order = (status && status.active_parallel_group_order) || [];
  members.sort((a, b) => {
    const ia = order.indexOf(a.id);
    const ib = order.indexOf(b.id);
    return (ia === -1 ? Number.MAX_SAFE_INTEGER : ia) - (ib === -1 ? Number.MAX_SAFE_INTEGER : ib);
  });

  const results = [];
  let blockedReason = null;
  for (const task of members) {
    if (blockedReason) {
      results.push({ task_id: task.id, ok: false, merged: false, reason: 'blocked_by', blocked_by: blockedReason });
      continue;
    }
    if (!task.dispatch_id) {
      results.push({ task_id: task.id, ok: true, merged: false, skipped: true, reason: 'no_dispatch' });
      continue;
    }
    const res = integrateDispatchWorktree({ status, dispatchId: task.dispatch_id, env });
    results.push({ task_id: task.id, dispatch_id: task.dispatch_id, ...res, workspace: undefined });
    if (!res.ok && !res.skipped) {
      blockedReason = `${task.id}:${res.reason}`;
      status.worktree_merge_failures = status.worktree_merge_failures || [];
      status.worktree_merge_failures.push({ group: groupName, task_id: task.id, dispatch_id: task.dispatch_id, reason: res.reason, at: new Date().toISOString() });
    }
  }
  const ok = !blockedReason && results.every(r => r.ok || r.skipped);
  return {
    ok,
    group: groupName,
    results,
    failed: results.filter(r => !r.ok && !r.skipped),
    reason: ok ? null : 'merge_back_failed'
  };
}

/**
 * Escape hatch for Kage remediation: when the syntax gate rejected a branch,
 * forget the failed attempt so the retried remediation gets a FRESH anchored
 * worktree. The branch and worktree are preserved for inspection; cleanup is
 * left to removeAgentWorktree.
 */
function resetDispatchWorkspace(status, dispatchId) {
  if (!status || !status.worktree_isolations) return { ok: false, reason: 'no_registry' };
  const rec = status.worktree_isolations[dispatchId];
  if (!rec) return { ok: false, reason: 'unknown_dispatch' };
  delete status.worktree_isolations[dispatchId];
  return { ok: true, released: rec };
}

module.exports = {
  BRANCH_PREFIX,
  FLAG_ENV,
  WORKTREE_COMMIT_INSTRUCTION,
  isIsolationEnabled,
  getIsolationState,
  resolveRepoRoot,
  buildAgentBranchName,
  isOrchestratedBranch,
  captureBaseSha,
  createAgentWorktree,
  countBranchCommits,
  commitWorktreeChanges,
  getChangedPaths,
  syntaxGateForFiles,
  readPorcelainStatus,
  splitPorcelainStatus: _splitPorcelainZ,
  assertBelongsToWorktree,
  mergeAgentWorktree,
  removeAgentWorktree,
  buildWorktreeDirective,
  applyWorktreeInstruction,
  buildFallbackDirective,
  prepareDispatchesWorktrees,
  findWorkspaceForDispatch,
  integrateDispatchWorktree,
  mergeBackParallelGroup,
  resetDispatchWorkspace,
  fileSha256
};
