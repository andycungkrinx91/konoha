'use strict';

/**
 * Extracts the first balanced JSON value from a stream that may carry a banner, a progress
 * line, or a second document around it. Shared by the mandatory dependency audit
 * (`tests/test_dependency_audit.js`) and the opt-in Socket integration
 * (`scripts/socket_audit_optional.js`), both of which read `--json` output from a CLI.
 */
function firstJsonValue(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;
  const end = text.length;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < end; i += 1) {
    const ch = text[i];
    if (inString && escaped) { escaped = false; continue; }
    if (inString && ch === '\\') { escaped = true; continue; }
    if (inString && ch === '"') { inString = false; continue; }
    if (inString) continue;
    if (ch === '"') { inString = true; continue; }
    if (ch !== '{' && ch !== '}') continue;
    depth += ch === '{' ? 1 : -1;
    if (depth > 0) continue;
    try {
      return JSON.parse(text.slice(start, i + 1));
    } catch (_) {
      return null;
    }
  }
  return null;
}

module.exports = { firstJsonValue };
