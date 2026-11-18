#!/usr/bin/env node
'use strict';

require('./helpers/isolate_db');

/**
 * tests/test_report_async_judge.js — The model drift judge must see real
 * report_from_agent summaries, and only on the async transport.
 *
 * reportFromAgent stays synchronous (≈60 call sites), so the model second
 * opinion lives in reportFromAgentAsync, which executeTool awaits. The sync
 * path keeps the deterministic verdict it always had.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const mrPath = require.resolve(path.join(ROOT, 'src', 'mcp', 'three_asset', 'model_router'));

let modelCalls = 0;
const fakeRouter = {
  resolveChatTargets: () => [{ target_url: 'http://127.0.0.1:1', model: 'inherit' }],
  sendChatMessage: async () => {
    modelCalls += 1;
    return {
      text: '{"drift":false,"confidence":0.9,"reason":"summary stays inside the goal"}',
      usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 }
    };
  }
};
require.cache[mrPath] = { id: mrPath, filename: mrPath, loaded: true, exports: fakeRouter, children: [], paths: [] };

const { reportFromAgent, reportFromAgentAsync } = require(path.join(ROOT, 'src', 'mcp', 'memory_project_context'));
const { executeTool, executeToolSync } = require(path.join(ROOT, 'src', 'mcp', 'tool_dispatch'));
const { getResolvedTaskDir, saveWorkflowStatus } = require(path.join(ROOT, 'src', 'mcp', 'workflow_common'));

console.log('Running test_report_async_judge.js...');

const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_report_judge_'));
const goal = 'add retry backoff to the bridge fetch call';
const summary = 'backoff plus cache layer added';
const validation = ['node --test exited 0'];

async function main() {
  // Sync path: deterministic verdict only, no model spend.
  const syncRes = JSON.parse(reportFromAgent({ agent: 'anbu', summary, status: 'completed', projectPath, validation, goal }));
  assert.strictEqual(syncRes.status, 'recorded');
  assert.strictEqual(modelCalls, 0, 'the sync report path must not consult the model');
  assert.strictEqual(syncRes.advisor_judge_tokens, undefined, 'a sync report has no judge spend to report');

  // Async path: the ambiguous summary reaches the judge, and the spend lands
  // on the report that caused it.
  const asyncRes = JSON.parse(await reportFromAgentAsync({ agent: 'anbu', summary, status: 'completed', projectPath, validation, goal }));
  assert.strictEqual(asyncRes.status, 'recorded');
  assert.strictEqual(modelCalls, 1, 'an ambiguous summary must be judged once');
  assert(asyncRes.advisor_judge_tokens > 0, `judge spend must be metered, got ${asyncRes.advisor_judge_tokens}`);

  // Real MCP traffic goes through executeTool, where the manifest is the
  // contract: report_from_agent accepts no `goal`, so the goal arrives the way
  // it does in production, through the saved workflow status in the task dir.
  const taskId = 'task-report-judge-probe';
  const taskDir = getResolvedTaskDir(taskId, projectPath);
  fs.mkdirSync(taskDir, { recursive: true });
  saveWorkflowStatus(taskDir, { task_id: taskId, prompt: goal, phase: 'execute', tasks: [], history: [] });

  const toolSummary = 'backoff plus a cache layer added now';
  const viaTool = JSON.parse(await executeTool('report_from_agent', {
    agent_name: 'anbu', summary: toolSummary, status: 'completed', project_path: projectPath, task_dir: taskDir, validation
  }));
  assert.strictEqual(viaTool.status, 'recorded');
  assert.strictEqual(modelCalls, 2, 'executeTool must reach the async report path');
  assert(viaTool.advisor_judge_tokens > 0, 'the transport path must meter its judge spend too');

  // executeToolSync keeps the old contract for callers that cannot await.
  const viaSync = JSON.parse(executeToolSync('report_from_agent', {
    agent_name: 'anbu', summary: 'backoff cache layer retry added again', status: 'completed', project_path: projectPath, task_dir: taskDir, validation
  }));
  assert.strictEqual(viaSync.status, 'recorded');
  assert.strictEqual(modelCalls, 2, 'executeToolSync must not block on the model');
  assert.strictEqual(viaSync.advisor_judge_tokens, undefined);

  console.log(`  model calls: ${modelCalls}`);
  console.log('PASS test_report_async_judge.js');
}

main().catch((err) => { console.error(err); process.exit(1); });
