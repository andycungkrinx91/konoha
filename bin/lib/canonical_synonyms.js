'use strict';

/**
 * Removed subcommand synonyms and the canonical form that replaced each one.
 *
 * The rejection is evaluated from argv alone, before any bootstrap or deploy
 * work, so a mistyped command fails instantly and identically no matter what
 * install state the machine is in. Command handlers reuse the same table so
 * there is one source of truth for the wording.
 */
const REMOVED_SYNONYMS = {
  task: { rm: 'delete' },
  project: { show: 'context', rm: 'delete' },
  telegram: { edit: 'config' },
  data: { rm: 'delete', remove: 'delete', save: 'add', find: 'search', list: 'memory', memories: 'memory' }
};

/**
 * Build the canonical rejection message for a removed synonym.
 *
 * @param {string} command Top-level command, e.g. `task`.
 * @param {string} sub Subcommand as typed by the user.
 * @returns {string|null} Message, or null when the pair is not a removed synonym.
 */
function removedSynonymMessage(command, sub) {
  if (!command || !sub) return null;
  const table = REMOVED_SYNONYMS[command];
  if (!table) return null;
  const canonical = table[sub];
  if (!canonical) return null;
  return `Unknown subcommand '${sub}' for 'konoha ${command}'. `
    + `Use canonical subcommand 'konoha ${command} ${canonical}'.`;
}

module.exports = { REMOVED_SYNONYMS, removedSynonymMessage };
