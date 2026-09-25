#!/usr/bin/env node
'use strict';

/**
 * scripts/measure_realistic_tasks.js
 * Pure Node.js implementation of realistic multi-task token footprint measurement.
 * Measures artifact token sizes across 3 production task scenarios using cl100k_base tiktoken.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const server = require('../src/mcp/workflow');
const { countTiktoken } = require('../src/token_sampler');

const dataFile = path.join(__dirname, 'tasks_data.json');
const { tasks: realisticTasks, gate_block: gateBlock } = JSON.parse(fs.readFileSync(dataFile, 'utf8'));

const files = [
  'prompt.md',
  'findings.md',
  'plan.md',
  'result.md',
  'research_results.json',
  'final_docs.md',
  'kage_review.json',
  'final_report.md'
];

function runWorkflowTask(taskData, tdir) {
  // Step 1: Prompt
  fs.writeFileSync(path.join(tdir, 'prompt.md'), taskData.prompt, 'utf8');
  server.runMcpWorkflow(tdir);

  // Step 2: Findings
  fs.writeFileSync(path.join(tdir, 'findings.md'), taskData.findings, 'utf8');
  fs.writeFileSync(path.join(tdir, 'result.md'), 'Exploration complete', 'utf8');
  server.runMcpWorkflow(tdir);

  // Step 3: Plan
  fs.writeFileSync(path.join(tdir, 'plan.md'), taskData.plan, 'utf8');
  fs.writeFileSync(path.join(tdir, 'result.md'), 'Plan generated', 'utf8');
  server.runMcpWorkflow(tdir);

  // Step 4: Research
  fs.writeFileSync(path.join(tdir, 'research_results.json'), taskData.research, 'utf8');
  fs.writeFileSync(path.join(tdir, 'result.md'), 'Research complete', 'utf8');
  server.runMcpWorkflow(tdir);

  // Step 5: Execution result
  fs.writeFileSync(path.join(tdir, 'result.md'), taskData.exec_result, 'utf8');
  server.runMcpWorkflow(tdir);

  // Step 6: Documentation
  fs.writeFileSync(path.join(tdir, 'final_docs.md'), taskData.docs, 'utf8');
  fs.writeFileSync(path.join(tdir, 'result.md'), 'Documentation completed.', 'utf8');
  server.runMcpWorkflow(tdir);

  // Step 7: Kage review
  fs.writeFileSync(path.join(tdir, 'kage_review.json'), JSON.stringify(taskData.review), 'utf8');
  fs.writeFileSync(path.join(tdir, 'result.md'), 'Kage approved all work.', 'utf8');

  // Step 8: Synthesis and completion
  server.runMcpWorkflow(tdir); // review -> synthesize
  server.runMcpWorkflow(tdir); // synthesize -> done
}

function measureRealisticTasks() {
  const resultsOpt = {};
  const resultsUnopt = {};

  for (const t of realisticTasks) {
    const tdir = fs.mkdtempSync(path.join(os.tmpdir(), `real_opt_${t.id}_`));
    try {
      runWorkflowTask(t, tdir);

      const taskMetrics = {};
      let total = 0;
      for (const fname of files) {
        const fpath = path.join(tdir, fname);
        const content = fs.existsSync(fpath) ? fs.readFileSync(fpath, 'utf8') : '';
        const toks = countTiktoken(content);
        taskMetrics[fname] = toks;
        total += toks;
      }
      taskMetrics.total = total;
      resultsOpt[t.id] = taskMetrics;

      // Calculate unoptimized report size
      const firstLinePlan = t.plan.trim().split('\n')[0];
      const unoptReport = [
        '# Final Report',
        '',
        gateBlock,
        '## Task',
        t.prompt,
        '',
        '## Exploration Findings',
        t.findings,
        '',
        '## Implementation Plan',
        t.plan,
        '',
        '## Research',
        t.research,
        '',
        '## Documentation',
        t.docs,
        '',
        '## Executor Results',
        '',
        `- **task-1 / executor**: ${firstLinePlan}`,
        '',
        `Result: ${t.exec_result}`,
        ''
      ].join('\n');

      const unoptRepToks = countTiktoken(unoptReport);
      const unoptMetrics = { ...taskMetrics };
      unoptMetrics['final_report.md'] = unoptRepToks;
      unoptMetrics.total = files.reduce((acc, f) => acc + (unoptMetrics[f] || 0), 0);
      resultsUnopt[t.id] = unoptMetrics;
    } finally {
      try {
        fs.rmSync(tdir, { recursive: true, force: true });
      } catch (_) { /* ignore */ }
    }
  }

  const out = { optimized: resultsOpt, unoptimized: resultsUnopt };
  return out;
}

if (require.main === module) {
  const output = measureRealisticTasks();
  console.log(JSON.stringify(output, null, 2));
}

module.exports = { measureRealisticTasks };
