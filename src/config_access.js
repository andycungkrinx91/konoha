'use strict';

/**
 * src/config_access.js — layout-tolerant access to bin/lib/config_defaults.js.
 *
 * Top-level src/*.js are mirrored FLAT into ~/.konoha/, where `../bin/lib/...`
 * escapes to ~/bin/lib/... and does not exist. Nested src files see a real
 * ../bin. Resolve both, same candidate list canonical_agents.js already uses.
 *
 * A mirror without bin/lib is a broken install, not a degraded mode: throwing
 * here surfaces it at startup instead of silently running on wrong tunables.
 */

const CANDIDATES = ['../bin/lib/config_defaults', './bin/lib/config_defaults', '../../bin/lib/config_defaults'];

function load() {
  for (const candidate of CANDIDATES) {
    try {
      return require(candidate);
    } catch (_) { /* candidate unavailable in this layout */ }
  }
  throw new Error(
    `config_defaults is unreachable (tried ${CANDIDATES.join(', ')}); ` +
    'the install is incomplete — re-run `konoha upgrade` or reinstall.'
  );
}

const configDefaults = load();

module.exports = {
  CONFIG_DEFAULTS: configDefaults.CONFIG_DEFAULTS,
  DEFAULT_KEYS: configDefaults.DEFAULT_KEYS,
  getConfigValue: configDefaults.getConfigValue,
  getConfig: configDefaults.getConfig,
  readUserConfig: configDefaults.readUserConfig
};