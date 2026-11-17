'use strict';

/**
 * .agents/plugins/konoha-mcp-guard/guard.js
 *
 * Project-local JS bridge exposing the Konoha-MCP-only guardrail for all
 * 8 supported harnesses inside the Konoha repository only.
 */

const path = require('path');
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const {
  SUPPORTED_HARNESSES,
  createHarnessInterceptor,
  evaluateProjectMcpGuardrail,
  handleHarnessToolCall
} = require(path.join(repoRoot, 'src', 'project_konoha_mcp_guardrail'));

const interceptors = Object.freeze(
  Object.fromEntries(
    SUPPORTED_HARNESSES.map((harness) => [
      harness,
      createHarnessInterceptor(harness, {
        projectRoot: repoRoot,
        throwOnDeny: harness === 'opencode'
      })
    ])
  )
);

module.exports = {
  SUPPORTED_HARNESSES,
  interceptors,
  evaluateProjectMcpGuardrail,
  handleHarnessToolCall,
  createHarnessInterceptor
};
