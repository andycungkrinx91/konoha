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

    .addEdge('__start__', 'node_classify')

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

  return builder.compile(compileOptions);
}

let compiledGraphInstance = null;

function getWorkflowGraph(options = {}) {
  if (!compiledGraphInstance || options.fresh) {
    compiledGraphInstance = buildKonohaGraph(options);
  }
  return compiledGraphInstance;
}

async function runKonohaGraph(input, options = {}) {
  const graph = getWorkflowGraph(options);
  const taskDir = options.taskDir || input.taskDir || '';
  const taskDirBasename = taskDir ? path.basename(taskDir) : '';
  const threadId = options.threadId || input.threadId || input.flowHash || taskDirBasename || 'default-thread';
  const tokenBudget = normalizeTokenBudget(
    options.tokenBudget || input.tokenBudget || options.turnBudget || 8192
  );

  const config = {
    configurable: {
      thread_id: threadId,
      tokenBudget,
      ...options.configurable,
    },
  };

  const invokeInput = {
    ...input,
    taskDir: taskDir || input.taskDir || '',
    threadId,
    tokenBudget,
    turnTokensUsed: 0,
  };

  return graph.invoke(invokeInput, config);
}

module.exports = {
  createGraphBuilder,
  buildKonohaGraph,
  getWorkflowGraph,
  runKonohaGraph,
  KonohaWorkflowState,
  KonohaCheckpointSaver,
};
