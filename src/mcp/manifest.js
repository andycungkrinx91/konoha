/**
 * Single loader for the installed MCP tool manifest.
 *
 * Both file_tools_router.js and arg_validation.js need it and cannot require
 * each other, so the candidate search lives here instead of being copied.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

function loadManifest() {
  const candidates = [
    path.join(__dirname, '..', 'mcp_tool_manifest.json'),
    path.resolve(__dirname, '..', '..', 'src', 'mcp_tool_manifest.json'),
    path.join(os.homedir(), '.konoha', 'mcp_tool_manifest.json'),
  ];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      return JSON.parse(fs.readFileSync(candidate, 'utf8'));
    } catch (_) {
      /* unreadable candidate: fall through to the next one */
    }
  }
  return { protocol_versions: ['2024-11-05'], tools: [] };
}

module.exports = { loadManifest };