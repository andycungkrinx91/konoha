'use strict';

const path = require('path');
const { classifyExecutionTrack, computeFlowHash } = require('../../workflow_sannin');
const { isPentestTask } = require('../../workflow_common');
const { finalizeNodeResult } = require('../budget');

async function classifyNode(state, config) {
  const prompt = state.prompt || '';
  const threadId = state.threadId || config?.configurable?.thread_id || '';
  const explicitTrack = state.isFastTrack ? 'fast_track' : (
    (state.intent === 'full_sdlc' || state.intent === 'pentest' || state.intent === 'fast_track') ? state.intent : null
  );
  const isPentest = isPentestTask(prompt) || explicitTrack === 'pentest';
  const track = isPentest ? 'pentest' : (explicitTrack || classifyExecutionTrack(prompt));
  const isFastTrack = track === 'fast_track';
  const taskId = path.basename(state.taskDir || 'default');
  const flowHash = state.flowHash || computeFlowHash(state.sessionId || threadId || 'default', taskId, prompt);

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
