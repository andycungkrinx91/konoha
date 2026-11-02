'use strict';

const path = require('path');
const { StateGraph } = require('@langchain/langgraph');
const { KonohaWorkflowState } = require('./state');
const { KonohaCheckpointSaver } = require('./checkpointer');
const { getDb } = require('../../db');
const { normalizeTokenBudget } = require('./token_guard');
const { wrapGuardedNode } = require('./node_guard');

const { classifyNode } = require('./nodes/classify');
const { planNode } = require('./nodes/plan');
const { briefNode } = require('./nodes/brief');
const { todoNode } = require('./nodes/todo');
const { dispatchNode } = require('./nodes/dispatch');
const { executeNode } = require('./nodes/execute');
const { reviewNode } = require('./nodes/review');
const { remediateNode } = require('./nodes/remediate');
const { completeNode } = require('./nodes/complete');
const { budgetExceededNode } = require('./nodes/budget_exceeded');
const { errorNode } = require('./nodes/error');

const {
  entryRouter,
  classifyRouter,
  planRouter,
  briefRouter,
  todoRouter,
  dispatchRouter,
  executeRouter,
  reviewRouter,
  remediateRouter,
} = require('./edges/router');

function createGraphBuilder() {
  const workflow = new StateGraph(KonohaWorkflowState)
    .addNode('node_classify', wrapGuardedNode('node_classify', classifyNode))
    .addNode('node_plan', wrapGuardedNode('node_plan', planNode))
    .addNode('node_brief', wrapGuardedNode('node_brief', briefNode))
    .addNode('node_todo', wrapGuardedNode('node_todo', todoNode))
    .addNode('node_dispatch', wrapGuardedNode('node_dispatch', dispatchNode))
    .addNode('node_execute', wrapGuardedNode('node_execute', executeNode))
    .addNode('node_review', wrapGuardedNode('node_review', reviewNode))
    .addNode('node_remediate', wrapGuardedNode('node_remediate', remediateNode))
    .addNode('node_complete', wrapGuardedNode('node_complete', completeNode))
    .addNode('node_budget_exceeded', budgetExceededNode)
    .addNode('node_error', errorNode)

    .addConditionalEdges('__start__', entryRouter, {
      node_classify: 'node_classify',
      node_plan: 'node_plan',
      node_brief: 'node_brief',
      node_todo: 'node_todo',
      node_dispatch: 'node_dispatch',
      node_execute: 'node_execute',
      node_review: 'node_review',
      node_remediate: 'node_remediate',
      node_complete: 'node_complete',
    })

    .addConditionalEdges('node_classify', classifyRouter, {
      node_error: 'node_error',
      node_budget_exceeded: 'node_budget_exceeded',
      node_complete: 'node_complete',
      node_plan: 'node_plan',
    })

    .addConditionalEdges('node_plan', planRouter, {
      node_error: 'node_error',
      node_budget_exceeded: 'node_budget_exceeded',
      __end__: '__end__',
      node_brief: 'node_brief',
    })

    .addConditionalEdges('node_brief', briefRouter, {
      node_error: 'node_error',
      node_budget_exceeded: 'node_budget_exceeded',
      node_todo: 'node_todo',
    })

    .addConditionalEdges('node_todo', todoRouter, {
      node_error: 'node_error',
      node_budget_exceeded: 'node_budget_exceeded',
      node_dispatch: 'node_dispatch',
    })

    .addConditionalEdges('node_dispatch', dispatchRouter, {
      node_error: 'node_error',
      node_budget_exceeded: 'node_budget_exceeded',
      node_complete: 'node_complete',
      node_execute: 'node_execute',
    })

    .addConditionalEdges('node_execute', executeRouter, {
      node_error: 'node_error',
      node_budget_exceeded: 'node_budget_exceeded',
      node_dispatch: 'node_dispatch',
      node_review: 'node_review',
    })

    .addConditionalEdges('node_review', reviewRouter, {
      node_error: 'node_error',
      node_budget_exceeded: 'node_budget_exceeded',
      __end__: '__end__',
      node_complete: 'node_complete',
      node_remediate: 'node_remediate',
    })

    .addConditionalEdges('node_remediate', remediateRouter, {
      node_error: 'node_error',
      node_budget_exceeded: 'node_budget_exceeded',
      node_complete: 'node_complete',
      node_dispatch: 'node_dispatch',
    })

    .addEdge('node_complete', '__end__')
    .addEdge('node_budget_exceeded', '__end__')
    .addEdge('node_error', '__end__');

  return workflow;
}

let defaultSaver = null;

function getDefaultCheckpointer() {
  if (!defaultSaver) {
    try {
      const db = getDb();
      defaultSaver = new KonohaCheckpointSaver(db);
    } catch {
      defaultSaver = null;
    }
  }
  return defaultSaver;
}

function buildKonohaGraph(options = {}) {
  const builder = createGraphBuilder();
  const checkpointer = options.checkpointer !== undefined
    ? options.checkpointer
    : getDefaultCheckpointer();

  const compileOptions = {};
  if (checkpointer) {
    compileOptions.checkpointer = checkpointer;
  }

  const compiled = builder.compile(compileOptions);
  const defaultRecursionLimit = options.recursionLimit || 60;
  const origInvoke = compiled.invoke.bind(compiled);
  const origStream = compiled.stream.bind(compiled);

  compiled.invoke = (input, config = {}) => {
    return origInvoke(input, {
      recursionLimit: config.recursionLimit || defaultRecursionLimit,
      ...config,
    });
  };

  compiled.stream = (input, config = {}) => {
    return origStream(input, {
      recursionLimit: config.recursionLimit || defaultRecursionLimit,
      ...config,
    });
  };

  return compiled;
}

let compiledGraphInstance = null;

function getWorkflowGraph(options = {}) {
  if (!compiledGraphInstance || options.fresh) {
    compiledGraphInstance = buildKonohaGraph(options);
  }
  return compiledGraphInstance;
}

const inMemoryTurnCounters = new Map();

async function resolveTurnIndex(graph, config, threadId) {
  let prevTurnIndex = 0;
  try {
    const snapshot = await graph.getState(config);
    if (snapshot && snapshot.values && typeof snapshot.values.turnIndex === 'number') {
      prevTurnIndex = snapshot.values.turnIndex;
    }
  } catch (_) {}

  if (!prevTurnIndex && inMemoryTurnCounters.has(threadId)) {
    prevTurnIndex = inMemoryTurnCounters.get(threadId);
  }

  const nextTurnIndex = prevTurnIndex + 1;
  inMemoryTurnCounters.set(threadId, nextTurnIndex);
  return nextTurnIndex;
}

function formatGraphOutput(graphRes) {
  if (!graphRes || typeof graphRes !== 'object') return graphRes;

  const resultPayload = (graphRes.result && typeof graphRes.result === 'object')
    ? graphRes.result
    : {};

  const isComplete = graphRes.phase === 'done' || resultPayload.status === 'completed';
  const isPaused = Boolean(graphRes.budgetExceeded || resultPayload.status === 'paused_budget_exceeded');
  const isError = Boolean(graphRes.error || resultPayload.status === 'error');

  const resumeNode = graphRes.resumeNode || resultPayload.resume_node || (graphRes.phase ? `node_${graphRes.phase}` : 'node_classify');
  const nextAction = resultPayload.next_action || (
    isPaused
      ? `Continue with another turn: the next sannin/workflow_gate_choice call resumes at ${resumeNode}. Do not resupply token_budget unless you want a different ceiling.`
      : (isError
        ? `Turn halted on error. Next call will retry at ${resumeNode}.`
        : (isComplete ? 'Workflow complete.' : (graphRes.hitlPending ? 'Awaiting human in the loop input.' : `In progress at ${resumeNode}.`)))
  );

  const status = resultPayload.status || (isPaused ? 'paused_budget_exceeded' : (isError ? 'error' : (isComplete ? 'completed' : (graphRes.status?.phase || graphRes.phase || 'in_progress'))));

  return {
    ...graphRes,
    status,
    resume_node: resumeNode,
    next_action: nextAction,
    workflow_complete: isComplete,
  };
}

async function runKonohaGraph(input, options = {}) {
  const graph = getWorkflowGraph(options);
  const taskDir = options.taskDir || input.taskDir || '';
  const taskDirBasename = taskDir ? path.basename(taskDir) : '';
  const threadId = options.threadId || input.threadId || input.flowHash || taskDirBasename || 'default-thread';

  const config = {
    recursionLimit: options.recursionLimit || 60,
    configurable: {
      thread_id: threadId,
      ...options.configurable,
    },
  };

  const hasExplicitBudget = options.tokenBudget != null || input.tokenBudget != null || options.turnBudget != null;
  const explicitBudget = hasExplicitBudget
    ? normalizeTokenBudget(options.tokenBudget || input.tokenBudget || options.turnBudget)
    : undefined;

  const turnIndex = await resolveTurnIndex(graph, config, threadId);

  const { resumeNode: _stripResume, ...restInput } = input || {};

  const invokeInput = {
    ...restInput,
    taskDir: taskDir || restInput.taskDir || '',
    threadId,
    turnTokensUsed: 0,
    budgetExceeded: false,
    error: null,
    turnIndex,
  };

  if (explicitBudget !== undefined) {
    invokeInput.tokenBudget = explicitBudget;
  }

  const rawResult = await graph.invoke(invokeInput, config);
  return formatGraphOutput(rawResult);
}

module.exports = {
  createGraphBuilder,
  buildKonohaGraph,
  getWorkflowGraph,
  runKonohaGraph,
  formatGraphOutput,
  KonohaWorkflowState,
  KonohaCheckpointSaver,
};
