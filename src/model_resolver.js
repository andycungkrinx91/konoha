/**
 * @fileoverview Model resolution helpers for CLI models management.
 * Extracted from cli.js so they can be unit-tested independently.
 */

/**
 * Resolve a user-facing model expression (alias, name, or fallback pair)
 * into a canonical "Primary | Fallback when fail Fallback" string.
 *
 * @param {string} input - User-provided expression (e.g. 'sonnet', 'flash-high')
 * @param {{ name: string, aliases: string[] }[]} activeModelsList
 * @returns {string} Resolved canonical model expression
 * @throws {Error} If the input does not match any known model
 */
function resolveModelString(input, activeModelsList) {
  const searchStr = input.trim();

  if (searchStr.toLowerCase() === 'inherit') {
    return 'inherit';
  }

  if (!searchStr.includes('|')) {
    const foundModel = activeModelsList.find(m =>
      m.name.toLowerCase() === searchStr.toLowerCase() ||
      m.aliases.includes(searchStr.toLowerCase())
    );
    if (!foundModel) throw new Error(`Unknown model: "${input}"`);

    const defaultFallbackModelName = 'Gemini 3.1 Flash-Lite';
    if (foundModel.name !== defaultFallbackModelName) {
      return `${foundModel.name} | Fallback when fail ${defaultFallbackModelName}`;
    }
    return foundModel.name;
  }

  const parts = searchStr.split('|');
  const left = parts[0].trim();
  const right = parts[1].trim();

  const foundPrimary = activeModelsList.find(m =>
    m.name.toLowerCase() === left.toLowerCase() ||
    m.aliases.includes(left.toLowerCase())
  );
  if (!foundPrimary) throw new Error(`Unknown primary model: "${left}"`);

  let foundFallback = null;
  const sortedModels = [...activeModelsList].sort((a, b) => b.name.length - a.name.length);
  for (const m of sortedModels) {
    if (right.toLowerCase().includes(m.name.toLowerCase())) {
      foundFallback = m;
      break;
    }
    for (const alias of m.aliases) {
      if (right.toLowerCase().includes(alias.toLowerCase())) {
        foundFallback = m;
        break;
      }
    }
    if (foundFallback) break;
  }

  if (!foundFallback) throw new Error(`Could not identify fallback model in: "${right}"`);

  return `${foundPrimary.name} | Fallback when fail ${foundFallback.name}`;
}

/**
 * Detect which IDE/client is installed by checking for known binaries.
 */
function detectClientType() {
  const cursorManager = require('./cursor_manager');
  const mcpClientsManager = require('./mcp_clients_manager');

  try {
    if (cursorManager.isCursorInstalled()) return 'cursor';
    if (mcpClientsManager.isClaudeCodeInstalled()) return 'claude';
  } catch {
    // fall through to default
  }
  return 'antigravity';
}

module.exports = {
  resolveModelString,
  detectClientType,
};
