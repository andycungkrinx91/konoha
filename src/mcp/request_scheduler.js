'use strict';

/**
 * Narrow JSON-RPC request scheduler for MCP stdio listeners.
 *
 * Serializes only stateful workflow-graph tools (e.g. `sannin`) while letting
 * control methods (`initialize`, `tools/list`, `ping`), `code_*`, and file
 * tools run concurrently.
 */
function createRequestScheduler(options = {}) {
  const serializedTools = new Set(Array.isArray(options.serializedTools) ? options.serializedTools : ['sannin']);
  const handleRequest = options.handleRequest;
  const writeLine = options.writeLine || ((obj) => process.stdout.write(`${JSON.stringify(obj)}\n`));
  const onIdleClose = typeof options.onIdleClose === 'function' ? options.onIdleClose : null;

  let workflowQueue = Promise.resolve();
  const inFlight = new Set();
  let closing = false;

  function _maybeClose() {
    if (closing && inFlight.size === 0 && onIdleClose) {
      onIdleClose();
    }
  }

  function isSerializedRequest(req) {
    return Boolean(
      req
      && req.method === 'tools/call'
      && req.params
      && serializedTools.has(req.params.name)
    );
  }

  async function _runOne(req) {
    try {
      const response = await handleRequest(req);
      if (response) writeLine(response);
    } catch (err) {
      writeLine({
        jsonrpc: '2.0',
        id: req && req.id !== undefined ? req.id : null,
        error: { code: -32603, message: err && err.message ? err.message : String(err) }
      });
    }
  }

  function _parseLine(trimmed) {
    try {
      return JSON.parse(trimmed);
    } catch (err) {
      writeLine({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: `Parse error: ${err.message}` }
      });
      return null;
    }
  }

  function _scheduleTask(req) {
    if (!isSerializedRequest(req)) return _runOne(req);
    const task = workflowQueue.then(() => _runOne(req));
    workflowQueue = task.catch(() => {});
    return task;
  }

  function enqueueLine(line) {
    const trimmed = String(line || '').trim();
    if (!trimmed) return null;
    const req = _parseLine(trimmed);
    if (!req) return null;

    const task = _scheduleTask(req);
    inFlight.add(task);
    task.finally(() => {
      inFlight.delete(task);
      _maybeClose();
    });
    return task;
  }

  function markClosing() {
    closing = true;
    _maybeClose();
  }

  return {
    enqueueLine,
    markClosing,
    isSerializedRequest,
    pendingCount: () => inFlight.size
  };
}

module.exports = { createRequestScheduler };
