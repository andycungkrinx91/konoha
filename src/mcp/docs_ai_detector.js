'use strict';

const { detectDocsAi } = require('../docs_ai_detector');
const { logToolCall } = require('./skills');

function runDocsAiDetectorSync(target, agentName = null) {
  if (!target || typeof target !== 'string' || !target.trim()) {
    return JSON.stringify({ error: 'Missing required argument: file_path (document file path)' });
  }
  const result = detectDocsAi(target.trim());
  const res = JSON.stringify(result);
  logToolCall('docs_ai_detector', String(target || '').trim(), res, agentName);
  return res;
}

// Unified MCP tool interface contract (sync implementation reused for async dispatch)
const runDocsAiDetector = runDocsAiDetectorSync;

module.exports = {
  runDocsAiDetector,
  runDocsAiDetectorSync
};
