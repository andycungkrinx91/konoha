'use strict';

/**
 * Standalone Workflow Dispatcher for Yamanaka (3D Model Generator).
 * Delegates through the canonical LangGraph StateGraph (runYamanaka3DGraph).
 */

const { runYamanaka3DGraph } = require('./graph');

async function dispatchYamanakaWorkflow(args = {}) {
  return runYamanaka3DGraph(args);
}

module.exports = {
  dispatchYamanakaWorkflow,
  runYamanaka3DGraph
};
