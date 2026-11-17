'use strict';

const { confirmPrompt } = require('./prompt');

/**
 * Prompt user during upgrade for external service and client injection choices.
 * Under --yes, -y, or CI environment (when no custom probe is passed), defaults all choices to true without prompting.
 *
 * @param {string[]} args CLI arguments
 * @param {object} [options]
 * @param {(msg: string, def?: boolean) => Promise<boolean>} [options.probe] Prompt function (defaults to confirmPrompt)
 * @returns {Promise<{ injectConfigs: boolean, rtk: boolean, aislop: boolean }>}
 */
async function collectUpgradeChoices(args = [], { probe } = {}) {
  const autoYes = Boolean(
    (Array.isArray(args) && (args.includes('--yes') || args.includes('-y'))) ||
    (!probe && process.env.CI === 'true')
  );

  if (autoYes) {
    return {
      injectConfigs: false,
      rtk: true,
      aislop: true
    };
  }

  const promptFn = probe || confirmPrompt;
  const injectConfigs = false;
  const rtk = await promptFn(
    'Install RTK (Rust Token Killer) shell filter and rules?',
    true
  );
  const aislop = await promptFn(
    'Enable aislop MCP (npx aislop-mcp) for the quality gate?',
    true
  );
  return {
    injectConfigs: Boolean(injectConfigs),
    rtk: Boolean(rtk),
    aislop: Boolean(aislop)
  };
}

module.exports = {
  collectUpgradeChoices
};
