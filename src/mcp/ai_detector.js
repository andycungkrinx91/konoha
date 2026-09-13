'use strict';

const { detectWebsiteAi, detectWebsiteAiAsync } = require('../ai_detector');
const { logToolCall } = require('./skills');

// Sync variant for directory targets (MCP sync dispatch path); URL targets return null → use the async path or a subprocess.
function runWebsiteAiDetectorSync(target, agentName = null) {
  if (/^https?:\/\//i.test(String(target || '').trim())) return null;
  const result = detectWebsiteAi(target);
  const res = JSON.stringify(result);
  logToolCall('website_ai_detector', String(target || '').trim(), res, agentName);
  return res;
}

async function runWebsiteAiDetector(target, agentName = null) {
  if (!target || typeof target !== 'string' || !target.trim()) {
    return JSON.stringify({ error: 'Missing required argument: target (site directory path or http(s) URL)' });
  }
  const trimmed = target.trim();
  let result;
  if (/^https?:\/\//i.test(trimmed)) {
    result = await detectWebsiteAiAsync(trimmed);
  } else {
    result = detectWebsiteAi(trimmed);
  }
  const res = JSON.stringify(result);
  logToolCall('website_ai_detector', trimmed, res, agentName);
  return res;
}

module.exports = {
  runWebsiteAiDetector,
  runWebsiteAiDetectorSync
};
