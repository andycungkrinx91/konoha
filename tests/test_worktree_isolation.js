#!/usr/bin/env node
// DB isolation: keep test writes out of the production ~/.konoha/konoha.db
require('./helpers/isolate_db');

'use strict';

/**
 * tests/test_worktree_isolation.js — per-subagent git worktree + branch isolation.
 *
 * Everything that touches git happens inside a throwaway repository created in
 * os.tmpdir(); the Konoha checkout itself is never used as a fixture.
 *
 * Controls (the suite fails if the control stops failing, i.e. if the guard
 * under test is removed):
 *   (g) merge --abort removed        -> conflict leaves the main worktree MERGING
 *   (h) syntax gate moved post-commit -> broken file lands in main history
 *
 * Correction-targeted controls:
 *   (i) group anchoring: all members share baseSha after a sibling commits
 *   (j) dirty main: colliding pre-existing change -> 'main_dirty', bytes intact
 *   (k) zero-commit branch -> 'no_commits', no empty merge commit
 *   (l) instruction channel present in dispatch payloads
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const worktree = require('../src/mcp/worktree_isolation');
const {
  _dispatchExecutePhase,
  _dispatchParallelGroup,
  _applyWorktreePayload
} = require('../src/mcp/workflow_runner');

const FIXTURES = [];

function git(cwd, args) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 30000 });
  return {
    code: res.status,
    ok: res.status === 0,
    out: (res.stdout || '').trim(),
    err: (res.stderr || '').trim()
  };
}

function makeRepo(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `konoha_wt_${label}_`));
  FIXTURES.push(dir);
  fs.writeFileSync(path.join(dir, 'lib.js'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'a\nb\nc\n');
  fs.writeFileSync(path.join(dir, 'other.txt'), 'untouched\n');
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'test@konoha.local']);
  git(dir, ['config', 'user.name', 'Konoha Test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  // Some sandboxes install a git wrapper via core.hooksPath. Disabling it for
  // this throwaway repo keeps `git worktree add` runnable inside the suite.
  const hooks = git(dir, ['config', '--get', 'core.hooksPath']);
  if (hooks.code === 0 && hooks.out) git(dir, ['config', '--unset', 'core.hooksPath']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'base']);
  return dir;
}

function commitInWorktree(worktreePath, file, content, message) {
  fs.writeFileSync(path.join(worktreePath, file), content);
  assert.ok(git(worktreePath, ['add', '-A']).ok, 'git add in worktree failed');
  const res = git(worktreePath, ['-c', 'user.name=Agent', '-c', 'user.email=a@k.local', 'commit', '-q', '-m', message || 'agent work']);
  assert.ok(res.ok, `git commit in worktree failed: ${res.err}`);
  return git(worktreePath, ['rev-parse', 'HEAD']).out;
}

function makeTaskRepo(label) {
  const repo = makeRepo(label);
  const taskDir = path.join(repo, '.konoha', 'workflow', 'tasks', label);
  fs.mkdirSync(taskDir, { recursive: true });
  fs.writeFileSync(path.join(taskDir, 'status.json'), JSON.stringify({
    schema_version: 2,
    phase: 'execute',
    project_path: repo,
    tasks: []
  }, null, 2));
  return { repo, taskDir };
}

function loadStatus(taskDir) {
  return JSON.parse(fs.readFileSync(path.join(taskDir, 'status.json'), 'utf8'));
}

function saveStatus(taskDir, status) {
  fs.writeFileSync(path.join(taskDir, 'status.json'), JSON.stringify(status, null, 2));
}

function branchExists(repo, branch) {
  return git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).ok;
}

const ENV_ON = { ...process.env, KONOHA_WORKTREE_ISOLATION: '1' };

async function run() {
  console.log('Running test_worktree_isolation tests...');
  const savedFlag = process.env.KONOHA_WORKTREE_ISOLATION;

  try {
    // ------------------------------------------------------------------
    // (a) feature flag: non-git directory falls back instead of failing
    // ------------------------------------------------------------------
    {
      const nonGit = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_wt_nongit_'));
      FIXTURES.push(nonGit);
      const off = worktree.getIsolationState(nonGit, { KONOHA_WORKTREE_ISOLATION: '0' });
      assert.strictEqual(off.enabled, false);
      assert.strictEqual(off.reason, 'disabled');
      const auto = worktree.getIsolationState(nonGit, {});
      assert.strictEqual(auto.enabled, false);
      assert.strictEqual(auto.reason, 'not_git_repo');
      const forced = worktree.getIsolationState(nonGit, { KONOHA_WORKTREE_ISOLATION: '1' });
      assert.strictEqual(forced.enabled, false);
      assert.strictEqual(forced.reason, 'not_git_repo');

      const dispatch = { id: 'ffffffffffffffff', phase: 'execute', agent: 'anbu', task_id: 'task-1' };
      const status = { tasks: [{ id: 'task-1', agent: 'anbu', status: 'pending' }] };
      const [prepared] = worktree.prepareDispatchesWorktrees({
        status, repoRoot: null, groupBaseSha: null,
        items: [{ dispatch, agent: 'anbu', taskId: 'task-1' }]
      });
      assert.strictEqual(prepared.fallback, true);
      const payload = _applyWorktreePayload({ task_id: 'task-1', task: 'do it' }, prepared.workspace, prepared.reason);
      assert.strictEqual(payload.worktree_isolated, false);
      assert.strictEqual(payload.worktree_path, undefined);
      assert.strictEqual(status.worktree_isolations[dispatch.id].reason, 'not_git_repo');
      console.log('✓ (a) feature flag disables and non-git repo falls back');
    }

    // ------------------------------------------------------------------
    // (b) parallel dispatch: one worktree + branch per member
    // ------------------------------------------------------------------
    {
      const { repo, taskDir } = makeTaskRepo('parallel');
      const status = loadStatus(taskDir);
      status.tasks = [
        { id: 'task-1', agent: 'anbu', task: 'backend', parallel_group: 'g1', status: 'pending' },
        { id: 'task-2', agent: 'jonin', task: 'frontend', parallel_group: 'g1', status: 'pending' }
      ];
      saveStatus(taskDir, status);
      const prev = process.env.KONOHA_WORKTREE_ISOLATION;
      process.env.KONOHA_WORKTREE_ISOLATION = '1';
      let payloads;
      try {
        payloads = JSON.parse(_dispatchExecutePhase(loadStatus(taskDir), taskDir));
      } finally {
        if (prev === undefined) delete process.env.KONOHA_WORKTREE_ISOLATION;
        else process.env.KONOHA_WORKTREE_ISOLATION = prev;
      }
      assert.strictEqual(payloads.length, 2);
      for (const p of payloads) {
        assert.strictEqual(p.worktree_isolated, true, 'parallel member must be isolated');
        assert.ok(p.worktree_path && fs.existsSync(p.worktree_path), `worktree missing: ${p.worktree_path}`);
        assert.ok(worktree.isOrchestratedBranch(p.branch), `unexpected branch ${p.branch}`);
        const wtHead = git(p.worktree_path, ['rev-parse', 'HEAD']).out;
        assert.strictEqual(wtHead, p.base_sha);
      }
      assert.notStrictEqual(payloads[0].worktree_path, payloads[1].worktree_path);
      assert.notStrictEqual(payloads[0].branch, payloads[1].branch);
      const list = git(repo, ['worktree', 'list', '--porcelain']).out;
      assert.ok(list.includes(payloads[0].worktree_path) && list.includes(payloads[1].worktree_path));
      console.log('✓ (b) parallel dispatch creates one worktree + branch per member');
    }

    // ------------------------------------------------------------------
    // (c) single dispatch gets its own worktree
    // ------------------------------------------------------------------
    {
      const { taskDir } = makeTaskRepo('single');
      const status = loadStatus(taskDir);
      status.tasks = [{ id: 'task-1', agent: 'anbu', task: 'solo', status: 'pending' }];
      saveStatus(taskDir, status);
      const prev = process.env.KONOHA_WORKTREE_ISOLATION;
      process.env.KONOHA_WORKTREE_ISOLATION = '1';
      let payload;
      try {
        payload = JSON.parse(_dispatchExecutePhase(loadStatus(taskDir), taskDir));
      } finally {
        if (prev === undefined) delete process.env.KONOHA_WORKTREE_ISOLATION;
        else process.env.KONOHA_WORKTREE_ISOLATION = prev;
      }
      assert.strictEqual(payload.status, 'ready');
      assert.strictEqual(payload.worktree_isolated, true);
      assert.ok(fs.existsSync(payload.worktree_path));
      assert.ok(worktree.isOrchestratedBranch(payload.branch));
      console.log('✓ (c) single dispatch gets its own worktree');
    }

    // ------------------------------------------------------------------
    // (l) instruction channel: payload tells the agent where to work and to commit
    // ------------------------------------------------------------------
    {
      const { taskDir } = makeTaskRepo('instruction');
      const status = loadStatus(taskDir);
      status.tasks = [{ id: 'task-1', agent: 'anbu', task: 'solo', status: 'pending' }];
      saveStatus(taskDir, status);
      const prev = process.env.KONOHA_WORKTREE_ISOLATION;
      process.env.KONOHA_WORKTREE_ISOLATION = '1';
      let payload;
      try {
        payload = JSON.parse(_dispatchExecutePhase(loadStatus(taskDir), taskDir));
      } finally {
        if (prev === undefined) delete process.env.KONOHA_WORKTREE_ISOLATION;
        else process.env.KONOHA_WORKTREE_ISOLATION = prev;
      }
      assert.ok(payload.worktree_path, 'payload must carry the worktree path');
      assert.ok(payload.worktree_directive.includes(payload.worktree_path), 'directive must name the worktree path');
      assert.ok(payload.worktree_directive.includes(payload.branch), 'directive must name the branch');
      assert.ok(payload.constraints.includes(worktree.WORKTREE_COMMIT_INSTRUCTION), 'constraints must carry the commit instruction');
      assert.ok(/git commit/.test(payload.constraints));

      // A subagent that ignores the instruction writes to the main checkout.
      // assertBelongsToWorktree is how that is detected server-side.
      const strayWrite = path.join(path.dirname(payload.worktree_path), '..', '..', 'stray.js');
      assert.strictEqual(worktree.assertBelongsToWorktree(strayWrite, payload.worktree_path).ok, false);
      assert.strictEqual(worktree.assertBelongsToWorktree(path.join(payload.worktree_path, 'lib.js'), payload.worktree_path).ok, true);
      console.log('✓ (l) dispatch payload carries worktree path + commit instruction');
    }

    // ------------------------------------------------------------------
    // (d) merge-back: commit lands on the main branch, worktree does not
    // ------------------------------------------------------------------
    {
      const repo = makeRepo('merge');
      const base = worktree.captureBaseSha(repo).base_sha;
      const created = worktree.createAgentWorktree({ repoRoot: repo, dispatchId: 'aaaaaaaaaaaaaaa1', agent: 'anbu', baseSha: base });
      assert.ok(created.ok, created.reason);
      const sha = commitInWorktree(created.worktree_path, 'feature.js', 'module.exports = 42;\n', 'add feature');
      const res = worktree.mergeAgentWorktree({ repoRoot: repo, branch: created.branch, baseSha: base });
      assert.ok(res.ok && res.merged, `merge failed: ${res.reason} ${res.error || ''}`);
      assert.ok(fs.existsSync(path.join(repo, 'feature.js')), 'merged file must exist in main worktree');
      const log = git(repo, ['log', '--oneline', '-1']).out;
      assert.ok(log.includes('worktree isolation'));
      const merged = git(repo, ['merge-base', '--is-ancestor', sha, 'HEAD']);
      assert.strictEqual(merged.code, 0, 'agent commit must be an ancestor of main HEAD');
      assert.strictEqual(git(repo, ['merge-base', '--is-ancestor', created.branch, 'HEAD']).code, 0);
      assert.strictEqual(git(repo, ['rev-parse', 'HEAD^2']).out, sha, 'merge commit must have two parents');
      assert.strictEqual(git(repo, ['status', '--porcelain']).out, '');
      console.log('✓ (d) merge-back integrates the branch commit into main');
    }

    // ------------------------------------------------------------------
    // (i) anchoring: same-group members share baseSha after one commits
    // ------------------------------------------------------------------
    {
      const { taskDir, repo } = makeTaskRepo('anchor');
      const status = loadStatus(taskDir);
      const group = [
        { id: 'task-1', agent: 'anbu', task: 'one', parallel_group: 'g1', status: 'pending' },
        { id: 'task-2', agent: 'jonin', task: 'two', parallel_group: 'g1', status: 'pending' }
      ];
      const groupBase = worktree.captureBaseSha(repo);
      assert.ok(groupBase.ok);
      const originalHead = groupBase.base_sha;
      const dispatches = group.map((t, i) => ({
        id: `bbbbbbbbbbbbbbb${i}`, phase: 'execute', agent: t.agent, task_id: t.id, task: t.task
      }));
      status.tasks = group.map((t, i) => ({ ...t, dispatch_id: dispatches[i].id }));
      const prepared = worktree.prepareDispatchesWorktrees({
        status, repoRoot: repo, groupBaseSha: groupBase,
        items: group.map((t, i) => ({ dispatch: dispatches[i], agent: t.agent, taskId: t.id }))
      });
      assert.strictEqual(prepared[0].workspace.base_sha, prepared[1].workspace.base_sha);
      assert.strictEqual(prepared[0].workspace.base_sha, originalHead);

      // Member 1 commits, merges, and moves HEAD forward.
      commitInWorktree(prepared[0].workspace.worktree_path, 'one.js', 'module.exports=1;\n', 'one');
      const merge1 = worktree.mergeAgentWorktree({ repoRoot: repo, branch: prepared[0].workspace.branch, baseSha: prepared[0].workspace.base_sha });
      assert.ok(merge1.merged, merge1.reason);
      const movedHead = git(repo, ['rev-parse', 'HEAD']).out;
      assert.notStrictEqual(movedHead, originalHead, 'HEAD must have advanced');

      // Member 2's worktree must still sit on the shared anchor.
      assert.strictEqual(git(prepared[1].workspace.worktree_path, ['rev-parse', 'HEAD']).out, originalHead);
      commitInWorktree(prepared[1].workspace.worktree_path, 'two.js', 'module.exports=2;\n', 'two');
      const merge2 = worktree.mergeAgentWorktree({ repoRoot: repo, branch: prepared[1].workspace.branch, baseSha: prepared[1].workspace.base_sha });
      assert.ok(merge2.merged, merge2.reason);
      assert.ok(fs.existsSync(path.join(repo, 'one.js')) && fs.existsSync(path.join(repo, 'two.js')));
      console.log('✓ (i) group members branch from one baseSha; sibling commit/merge does not move it');
    }

    // ------------------------------------------------------------------
    // (e) syntax gate blocks a file that no longer parses
    // ------------------------------------------------------------------
    {
      const repo = makeRepo('syntax');
      const base = worktree.captureBaseSha(repo).base_sha;
      const created = worktree.createAgentWorktree({ repoRoot: repo, dispatchId: 'cccccccccccccc01', agent: 'anbu', baseSha: base });
      commitInWorktree(created.worktree_path, 'broken.js', 'function broken( {\n  return 1\n', 'broken');
      const headBefore = git(repo, ['rev-parse', 'HEAD']).out;
      const res = worktree.mergeAgentWorktree({ repoRoot: repo, branch: created.branch, baseSha: base });
      assert.strictEqual(res.ok, false);
      assert.strictEqual(res.reason, 'syntax_gate_failed');
      assert.ok(res.syntax_gate.failed.some(f => f.file === 'broken.js'));
      assert.ok(res.aborted && res.aborted.ok, 'merge must be aborted after the gate fails');
      assert.strictEqual(git(repo, ['rev-parse', 'HEAD']).out, headBefore, 'no commit may be created');
      assert.strictEqual(fs.existsSync(path.join(repo, 'broken.js')), false, 'broken file must not land in main');
      assert.deepStrictEqual(worktree.readPorcelainStatus(repo), []);
      assert.ok(branchExists(repo, created.branch), 'branch must be preserved for the agent fix');
      assert.ok(fs.existsSync(created.worktree_path), 'worktree must be preserved');
      console.log('✓ (e) pre-commit syntax gate blocks non-parsing file and aborts merge');
    }

    // ------------------------------------------------------------------
    // (h) CONTROL: syntax gate moved after commit -> broken file reaches main
    // ------------------------------------------------------------------
    {
      const repo = makeRepo('control_h');
      const base = worktree.captureBaseSha(repo).base_sha;
      const created = worktree.createAgentWorktree({ repoRoot: repo, dispatchId: 'cccccccccccccc02', agent: 'anbu', baseSha: base });
      commitInWorktree(created.worktree_path, 'broken.js', 'function broken( {\n  return 1\n', 'broken');

      // Negative control: the gate runs AFTER the commit and can only annotate.
      const merge = git(repo, ['merge', '--no-ff', '--no-commit', '--no-edit', created.branch]);
      assert.ok(merge.ok, 'control merge tree must build');
      const commit = git(repo, ['-c', 'user.name=C', '-c', 'user.email=c@k.local', 'commit', '--no-verify', '--no-edit', '-m', 'control: commit before gate']);
      assert.ok(commit.ok, commit.err);
      const lateGate = worktree.syntaxGateForFiles(repo, ['broken.js']);
      assert.strictEqual(lateGate.ok, false, 'gate must still detect the break');
      assert.ok(fs.existsSync(path.join(repo, 'broken.js')), 'CONTROL FAILED: broken file did not land in main — gate is not post-commit-sensitive');
      const showAtHead = git(repo, ['show', 'HEAD:broken.js']);
      assert.strictEqual(showAtHead.code, 0, 'CONTROL FAILED: broken content not in main history');
      console.log('✓ (h) control: post-commit gate lets the broken file into main history');
    }

    // ------------------------------------------------------------------
    // (g) CONTROL: merge --abort removed -> conflict leaves main MERGING
    // ------------------------------------------------------------------
    {
      const repo = makeRepo('control_g');
      const base = worktree.captureBaseSha(repo).base_sha;
      const created = worktree.createAgentWorktree({ repoRoot: repo, dispatchId: 'cccccccccccccc03', agent: 'jonin', baseSha: base });
      commitInWorktree(created.worktree_path, 'lib.js', 'module.exports = "from-agent";\n', 'agent lib');

      // Advance main on the same file so the merge conflicts.
      fs.writeFileSync(path.join(repo, 'lib.js'), 'module.exports = "from-main";\n');
      git(repo, ['-c', 'user.name=M', '-c', 'user.email=m@k.local', 'commit', '-q', '-am', 'main lib']);

      // Negative control: no `git merge --abort` in the failure path.
      const merge = git(repo, ['merge', '--no-ff', '--no-commit', '--no-edit', created.branch]);
      assert.notStrictEqual(merge.code, 0, 'control merge must conflict');
      assert.ok(fs.existsSync(path.join(repo, '.git', 'MERGE_HEAD')), 'CONTROL FAILED: expected a merge in progress');

      // Clean up only this fixture so later tests are unaffected.
      const abort = git(repo, ['merge', '--abort']);
      assert.ok(abort.ok, 'control cleanup abort must succeed');
      assert.strictEqual(fs.existsSync(path.join(repo, '.git', 'MERGE_HEAD')), false);

      // Real behaviour: conflict -> aborted, main untouched, branch preserved.
      const real = worktree.mergeAgentWorktree({ repoRoot: repo, branch: created.branch, baseSha: base });
      assert.strictEqual(real.ok, false);
      assert.strictEqual(real.reason, 'merge_conflict');
      assert.ok(real.aborted && real.aborted.attempted && real.aborted.ok, 'production path must run merge --abort');
      assert.strictEqual(fs.existsSync(path.join(repo, '.git', 'MERGE_HEAD')), false, 'no merge may stay in progress');
      assert.strictEqual(git(repo, ['status', '--porcelain']).out, '', 'main worktree must be clean after abort');
      assert.strictEqual(fs.readFileSync(path.join(repo, 'lib.js'), 'utf8'), 'module.exports = "from-main";\n');
      assert.ok(branchExists(repo, created.branch));
      assert.ok(fs.existsSync(created.worktree_path));
      console.log('✓ (g) control: conflict stays MERGING without abort; production path aborts cleanly');
    }

    // ------------------------------------------------------------------
    // (j) dirty main: colliding uncommitted change -> 'main_dirty', bytes intact
    // ------------------------------------------------------------------
    {
      const repo = makeRepo('dirty');
      const base = worktree.captureBaseSha(repo).base_sha;
      const created = worktree.createAgentWorktree({ repoRoot: repo, dispatchId: 'dddddddddddddd01', agent: 'anbu', baseSha: base });
      commitInWorktree(created.worktree_path, 'lib.js', 'module.exports = "agent";\n', 'agent lib');

      // Pre-existing work-in-progress in main: one colliding, one unrelated.
      fs.writeFileSync(path.join(repo, 'lib.js'), 'module.exports = "wip";\n');
      fs.appendFileSync(path.join(repo, 'other.txt'), 'local edit\n');
      const dirtyBefore = {
        'lib.js': worktree.fileSha256(path.join(repo, 'lib.js')),
        'other.txt': worktree.fileSha256(path.join(repo, 'other.txt'))
      };
      const headBefore = git(repo, ['rev-parse', 'HEAD']).out;

      const res = worktree.mergeAgentWorktree({ repoRoot: repo, branch: created.branch, baseSha: base });
      assert.strictEqual(res.ok, false);
      assert.strictEqual(res.reason, 'main_dirty');
      assert.deepStrictEqual(res.conflicting_paths, ['lib.js']);
      assert.ok(branchExists(repo, created.branch), 'branch must be preserved');
      assert.ok(fs.existsSync(created.worktree_path), 'worktree must be preserved');
      assert.strictEqual(git(repo, ['rev-parse', 'HEAD']).out, headBefore, 'no commit may be created');
      assert.strictEqual(fs.existsSync(path.join(repo, '.git', 'MERGE_HEAD')), false, 'no merge may start');
      assert.strictEqual(worktree.fileSha256(path.join(repo, 'lib.js')), dirtyBefore['lib.js'], 'colliding WIP must be byte-identical');
      assert.strictEqual(worktree.fileSha256(path.join(repo, 'other.txt')), dirtyBefore['other.txt'], 'unrelated WIP must be byte-identical');
      assert.strictEqual(git(repo, ['stash', 'list']).out, '', 'nothing may be stashed');

      console.log('✓ (j) main_dirty collision aborts, preserves branch/worktree, WIP bytes identical');
    }

    // ------------------------------------------------------------------
    // (j3) non-colliding pre-existing WIP survives a successful merge
    // ------------------------------------------------------------------
    {
      const repo = makeRepo('dirty_noncollide');
      const base = worktree.captureBaseSha(repo).base_sha;
      const created = worktree.createAgentWorktree({ repoRoot: repo, dispatchId: 'dddddddddddddd03', agent: 'anbu', baseSha: base });
      commitInWorktree(created.worktree_path, 'lib.js', 'module.exports = "agent";\n', 'agent lib');
      fs.appendFileSync(path.join(repo, 'other.txt'), 'local edit\n');
      const survivor = worktree.fileSha256(path.join(repo, 'other.txt'));
      const clean = worktree.mergeAgentWorktree({ repoRoot: repo, branch: created.branch, baseSha: base });
      assert.ok(clean.merged, `merge with non-colliding WIP must succeed: ${clean.reason}`);
      assert.strictEqual(worktree.fileSha256(path.join(repo, 'other.txt')), survivor, 'non-colliding WIP must survive the merge');
      assert.deepStrictEqual(worktree.readPorcelainStatus(repo).map(e => [e.index_status, e.worktree_status, e.file]), [[' ', 'M', 'other.txt']]);
      console.log('✓ (j3) non-colliding WIP is untouched by a merge');
    }

    // ------------------------------------------------------------------
    // (j2) staged (index) collision on an incoming path is also main_dirty
    // ------------------------------------------------------------------
    {
      const repo = makeRepo('dirty_index');
      const base = worktree.captureBaseSha(repo).base_sha;
      const created = worktree.createAgentWorktree({ repoRoot: repo, dispatchId: 'dddddddddddddd02', agent: 'anbu', baseSha: base });
      commitInWorktree(created.worktree_path, 'lib.js', 'module.exports = "agent";\n', 'agent lib');
      fs.writeFileSync(path.join(repo, 'lib.js'), 'module.exports = "staged";\n');
      assert.ok(git(repo, ['add', 'lib.js']).ok);
      const stagedSha = worktree.fileSha256(path.join(repo, 'lib.js'));
      const res = worktree.mergeAgentWorktree({ repoRoot: repo, branch: created.branch, baseSha: base });
      assert.strictEqual(res.reason, 'main_dirty', 'a staged edit that would enter the merge commit must be refused');
      assert.strictEqual(worktree.fileSha256(path.join(repo, 'lib.js')), stagedSha);
      assert.strictEqual(git(repo, ['diff', '--cached', '--name-only']).out, 'lib.js', 'staged edit must still be staged, not reset');
      console.log('✓ (j2) staged collision refuses the merge without resetting the index');
    }

    // ------------------------------------------------------------------
    // (k) zero-commit branch -> 'no_commits', no empty merge commit
    // ------------------------------------------------------------------
    {
      const repo = makeRepo('nocommit');
      const base = worktree.captureBaseSha(repo).base_sha;
      const created = worktree.createAgentWorktree({ repoRoot: repo, dispatchId: 'eeeeeeeeeeeeee01', agent: 'anbu', baseSha: base });
      const headBefore = git(repo, ['rev-parse', 'HEAD']).out;
      const res = worktree.mergeAgentWorktree({ repoRoot: repo, branch: created.branch, baseSha: base });
      assert.strictEqual(res.ok, false);
      assert.strictEqual(res.reason, 'no_commits');
      assert.strictEqual(git(repo, ['rev-parse', 'HEAD']).out, headBefore, 'no merge commit may be created');
      assert.strictEqual(git(repo, ['rev-list', '--count', 'HEAD']).out, '1');
      console.log('✓ (k) branch with zero commits aborts with no_commits');
    }

    // ------------------------------------------------------------------
    // (m) branches not created by this orchestration are refused
    // ------------------------------------------------------------------
    {
      const repo = makeRepo('foreign');
      const base = worktree.captureBaseSha(repo).base_sha;
      git(repo, ['branch', 'feature/outside', base]);
      const foreign = worktree.mergeAgentWorktree({ repoRoot: repo, branch: 'feature/outside', baseSha: base });
      assert.strictEqual(foreign.reason, 'not_orchestrated_branch');
      const foreignMaster = worktree.mergeAgentWorktree({ repoRoot: repo, branch: 'master', baseSha: base });
      assert.strictEqual(foreignMaster.reason, 'not_orchestrated_branch');
      assert.strictEqual(git(repo, ['rev-parse', 'HEAD']).out, base);
      console.log('✓ (m) non-orchestrated branches are refused');
    }

    // ------------------------------------------------------------------
    // (f) parallel barrier: merge-back runs before the group is released
    // ------------------------------------------------------------------
    {
      const { repo, taskDir } = makeTaskRepo('barrier');
      const seed = loadStatus(taskDir);
      seed.tasks = [
        { id: 'task-1', agent: 'anbu', task: 'one', parallel_group: 'gs', status: 'pending' },
        { id: 'task-2', agent: 'jonin', task: 'two', parallel_group: 'gs', status: 'pending' }
      ];
      saveStatus(taskDir, seed);
      const prev = process.env.KONOHA_WORKTREE_ISOLATION;
      process.env.KONOHA_WORKTREE_ISOLATION = '1';
      let payloads;
      try {
        payloads = JSON.parse(_dispatchExecutePhase(loadStatus(taskDir), taskDir));
      } finally {
        if (prev === undefined) delete process.env.KONOHA_WORKTREE_ISOLATION;
        else process.env.KONOHA_WORKTREE_ISOLATION = prev;
      }
      assert.strictEqual(payloads.length, 2, 'barrier fixture must dispatch the whole group');
      assert.ok(payloads.every(p => p.worktree_isolated), 'barrier fixture must run isolated');
      for (const p of payloads) commitInWorktree(p.worktree_path, `part-${p.task_id}.js`, `module.exports = "${p.task_id}";\n`, p.task_id);
      const st = loadStatus(taskDir);
      st.completed_dispatches = payloads.map(p => p.dispatch_id);
      for (const t of st.tasks) t.status = 'completed';
      saveStatus(taskDir, st);

      const barrierRaw = _dispatchExecutePhase(loadStatus(taskDir), taskDir);
      // null == every task is complete, so the workflow left the execute phase;
      // the merge-back still ran before the barrier released.
      if (barrierRaw !== null) {
        const barrier = JSON.parse(barrierRaw);
        assert.notStrictEqual(barrier.status, 'in_progress', 'barrier must release after merge-back');
      }
      const after = loadStatus(taskDir);
      assert.strictEqual(after.active_parallel_group, null);
      assert.strictEqual(after.last_group_merge.group, 'gs');
      assert.ok(after.last_group_merge.results.every(r => r.merged), 'every member must be merged at the barrier');
      for (const p of payloads) {
        assert.ok(fs.existsSync(path.join(repo, `part-${p.task_id}.js`)), `merged file for ${p.task_id} missing`);
      }
      console.log('✓ (f) parallel barrier merges every member branch before release');
    }

    // ------------------------------------------------------------------
    // (n) barrier blocks (does not silently skip) when one branch fails
    // ------------------------------------------------------------------
    {
      const { repo, taskDir } = makeTaskRepo('barrier_fail');
      let status = loadStatus(taskDir);
      status.tasks = [
        { id: 'task-1', agent: 'anbu', task: 'one', parallel_group: 'gx', status: 'pending' },
        { id: 'task-2', agent: 'jonin', task: 'two', parallel_group: 'gx', status: 'pending' }
      ];
      saveStatus(taskDir, status);
      const prev = process.env.KONOHA_WORKTREE_ISOLATION;
      process.env.KONOHA_WORKTREE_ISOLATION = '1';
      let payloads;
      try {
        payloads = JSON.parse(_dispatchExecutePhase(loadStatus(taskDir), taskDir));
      } finally {
        if (prev === undefined) delete process.env.KONOHA_WORKTREE_ISOLATION;
        else process.env.KONOHA_WORKTREE_ISOLATION = prev;
      }
      commitInWorktree(payloads[0].worktree_path, 'ok.js', 'module.exports=1;\n', 'ok');
      commitInWorktree(payloads[1].worktree_path, 'bad.js', 'function ( {\n', 'bad');
      status = loadStatus(taskDir);
      status.completed_dispatches = payloads.map(p => p.dispatch_id);
      status.tasks.forEach(t => { t.status = 'completed'; });
      saveStatus(taskDir, status);

      const res = JSON.parse(_dispatchExecutePhase(loadStatus(taskDir), taskDir));
      assert.strictEqual(res.status, 'merge_blocked');
      assert.ok(res.failures.some(f => f.reason === 'syntax_gate_failed'));
      const after = loadStatus(taskDir);
      assert.strictEqual(after.active_parallel_group, 'gx', 'group must stay active until merge-back succeeds');
      assert.ok(fs.existsSync(path.join(repo, 'ok.js')), 'earlier member still merged');
      assert.strictEqual(fs.existsSync(path.join(repo, 'bad.js')), false, 'broken member must not be merged');
      console.log('✓ (n) barrier blocks on a failed merge-back instead of stepping over it');
    }

    // ------------------------------------------------------------------
    // (o) merge path must not use checkout/stash/reset on the main worktree
    // ------------------------------------------------------------------
    {
      const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'mcp', 'worktree_isolation.js'), 'utf8');
      const mergeFn = src.slice(src.indexOf('function mergeAgentWorktree'), src.indexOf('function removeAgentWorktree'));
      for (const forbidden of ["'stash'", "'checkout'", "'reset'", "'restore'", "'clean'"]) {
        assert.ok(!mergeFn.includes(forbidden), `mergeAgentWorktree must not invoke ${forbidden}`);
      }
      assert.ok(mergeFn.includes("'merge', '--abort'"), 'mergeAgentWorktree must abort on failure');
      const gateIdx = mergeFn.indexOf('syntaxGateForFiles');
      const commitIdx = mergeFn.indexOf("'commit', '--no-verify'");
      assert.ok(gateIdx > 0 && commitIdx > 0 && gateIdx < commitIdx, 'syntax gate must run BEFORE the merge commit');
      console.log('✓ (o) merge path is commit-only and gated before commit');
    }

    // ------------------------------------------------------------------
    // (p) cleanup removes worktree + branch
    // ------------------------------------------------------------------
    {
      const repo = makeRepo('cleanup');
      const base = worktree.captureBaseSha(repo).base_sha;
      const created = worktree.createAgentWorktree({ repoRoot: repo, dispatchId: 'ffffffffffffff01', agent: 'anbu', baseSha: base });
      commitInWorktree(created.worktree_path, 'x.js', 'module.exports=1;\n', 'x');
      worktree.mergeAgentWorktree({ repoRoot: repo, branch: created.branch, baseSha: base });
      const removed = worktree.removeAgentWorktree({ repoRoot: repo, worktreePath: created.worktree_path, branch: created.branch });
      assert.strictEqual(removed.removed_worktree, true, removed.errors.join('; '));
      assert.strictEqual(removed.deleted_branch, true, removed.errors.join('; '));
      assert.strictEqual(fs.existsSync(created.worktree_path), false);
      assert.strictEqual(branchExists(repo, created.branch), false);
      console.log('✓ (p) cleanup removes worktree and branch');
    }

    console.log('All test_worktree_isolation tests passed.');
  } finally {
    if (savedFlag === undefined) delete process.env.KONOHA_WORKTREE_ISOLATION;
    else process.env.KONOHA_WORKTREE_ISOLATION = savedFlag;
    for (const dir of FIXTURES) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
    }
  }
}

run().catch(err => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});

module.exports = { run };
