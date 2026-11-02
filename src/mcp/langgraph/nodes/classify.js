'use strict';

const { classifyExecutionTrack, computeFlowHash } = require('../../workflow_sannin');
const { isPentestTask } = require('../../workflow_common');
const { finalizeNodeResult } = require('../budget');

async function classifyNode(state, config) {
  const prompt = state.prompt || '';
  const threadId = state.threadId || config?.configurable?.thread_id || '';
  const explicitTrack = state.intent === 'full_sdlc' ? 'full_sdlc' : (state.isFastTrack ? 'fast_track' : null);
  const track = explicitTrack || classifyExecutionTrack(prompt);
  const isPentest = isPentestTask(prompt);
  const isFastTrack = track === 'fast_track' && !isPentest;
  const flowHash = state.flowHash || computeFlowHash(prompt, state.taskDir || '');

  const payload = {
    threadId,
    intent: isFastTrack ? 'fast_track' : (isPentest ? 'pentest' : 'full_sdlc'),
    isFastTrack,
    phase: isFastTrack ? 'fast_track' : 'plan',
    flowHash,
  };

  const nextNode = isFastTrack ? 'node_complete' : 'node_plan';
  return finalizeNodeResult(state, payload, nextNode);
}

module.exports = { classifyNode };
