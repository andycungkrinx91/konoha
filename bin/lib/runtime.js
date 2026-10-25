'use strict';

/**
 * bin/lib/runtime.js — Konoha Core Runtime, MCP Registration & Auto-Setup Lifecycle (Facade)
 * Modularized into:
 * - bin/lib/runtime_mcp.js
 * - bin/lib/runtime_install.js
 * - bin/lib/runtime_lifecycle.js
 */

const {
  ensureCoreDirectories,
  purgePackageCaches,
  registerMcp,
  registerPermissions,
  unregisterPermissions,
  registerHooks,
  smokeTestKonohaFilesMcp,
  installFileTools
} = require('./runtime_mcp');

const {
  copyIfDifferent,
  copyRecursive,
  copyRecursiveIfDifferent,
  installCliRuntime,
  reconcileGlobalCommand
} = require('./runtime_install');

const {
  hasCompleteDatabaseSchema,
  detectSkillsDirs,
  detectCustomSkills,
  hasCanonicalGeninSkill,
  verifySkillDatabaseContract,
  syncTemplateSkills,
  copySkillsDirFast,
  ensureAutoSetup,
  updateGeminiMd,
  moveUnusedSkills
} = require('./runtime_lifecycle');

module.exports = {
  hasCompleteDatabaseSchema,
  detectSkillsDirs,
  detectCustomSkills,
  hasCanonicalGeninSkill,
  verifySkillDatabaseContract,
  ensureCoreDirectories,
  purgePackageCaches,
  registerMcp,
  registerPermissions,
  unregisterPermissions,
  registerHooks,
  copyIfDifferent,
  copyRecursive,
  copyRecursiveIfDifferent,
  installCliRuntime,
  reconcileGlobalCommand,
  syncTemplateSkills,
  copySkillsDirFast,
  smokeTestKonohaFilesMcp,
  installFileTools,
  ensureAutoSetup,
  updateGeminiMd,
  moveUnusedSkills
};
