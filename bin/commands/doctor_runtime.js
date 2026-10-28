'use strict';

const fs = require('fs');
const path = require('path');
const { fileExists, ensureDir, copyFile } = require('../../src/platform_utils');
const {
  SRC_DIR,
  SKILLS_DB_DIR,
  SERVER_PATH,
  MIGRATE_PATH,
  FILE_TOOLS_MCP_PATH,
  FILE_TOOLS_ROUTER_PATH,
  FILE_TOOLS_LAUNCHER_PATH,
  FILE_TOOLS_PY_DIR
} = require('../lib/paths');
const deployUtils = require('../../src/deploy_utils');
const { installFileTools } = require('../../src/deploy_installer');
const { smokeTestKonohaFilesMcp } = require('../lib/runtime_mcp');
const { checkPython } = require('../lib/runtime_lifecycle');

function updateOutdatedFileContent(srcPath, destPath, label, context) {
  try {
    const srcContent = fs.readFileSync(srcPath, 'utf-8');
    const destContent = fs.readFileSync(destPath, 'utf-8');
    if (srcContent !== destContent) {
      copyFile(srcPath, destPath);
      context.record(label, 'REPAIRED', 'Updated outdated file from package templates');
      context.incrementRepairs();
      return;
    }
    context.record(label, 'HEALTHY', 'File is present and healthy');
  } catch (e) {
    context.record(label, 'FAILED', `Error checking content: ${e.message}`);
    context.markError();
  }
}

function restoreMissingFile(srcPath, destPath, options) {
  const { srcExists, label, context } = options;
  try {
    ensureDir(path.dirname(destPath));
    if (srcExists) {
      copyFile(srcPath, destPath);
      context.record(label, 'REPAIRED', 'Restored missing file from package templates');
      context.incrementRepairs();
    } else {
      context.record(label, 'FAILED', `Source file ${path.basename(srcPath)} not found in package`);
      context.markError();
    }
  } catch (e) {
    context.record(label, 'FAILED', `Error: ${e.message}`);
    context.markError();
  }
}

function checkAndRepairFile(srcName, destPath, label, context) {
  const srcPath = path.join(SRC_DIR, srcName);
  const srcExists = fileExists(srcPath);

  if (fileExists(destPath)) {
    if (srcExists) {
      updateOutdatedFileContent(srcPath, destPath, label, context);
      return;
    }
    context.record(label, 'HEALTHY', 'File is present and healthy');
    return;
  }
  restoreMissingFile(srcPath, destPath, { srcExists, label, context });
}

function repairCoreModules(context) {
  checkAndRepairFile('db.js', path.join(SKILLS_DB_DIR, 'db.js'), 'DB Module (db.js)', context);
  checkAndRepairFile('vector_search.js', path.join(SKILLS_DB_DIR, 'vector_search.js'), 'Vector Search Module (vector_search.js)', context);
  checkAndRepairFile('server.js', SERVER_PATH, 'Server File (server.js)', context);
  checkAndRepairFile('migrate.js', MIGRATE_PATH, 'Migration Script (migrate.js)', context);
  checkAndRepairFile('canonical_skills.js', path.join(SKILLS_DB_DIR, 'canonical_skills.js'), 'Canonical Skills (canonical_skills.js)', context);
  checkAndRepairFile('db_stats.js', path.join(SKILLS_DB_DIR, 'db_stats.js'), 'Stats Helper Script (db_stats.js)', context);
  checkAndRepairFile('db_savings.js', path.join(SKILLS_DB_DIR, 'db_savings.js'), 'Savings Helper Script (db_savings.js)', context);
  checkAndRepairFile('agent_stats.js', path.join(SKILLS_DB_DIR, 'agent_stats.js'), 'Agent Stats Helper Script (agent_stats.js)', context);
  checkAndRepairFile('prompt_hook.js', path.join(SKILLS_DB_DIR, 'prompt_hook.js'), 'Prompt Hook Script (prompt_hook.js)', context);
  checkAndRepairFile('antigravity_subagent_hook.js', path.join(SKILLS_DB_DIR, 'antigravity_subagent_hook.js'), 'Subagent Hook Script (antigravity_subagent_hook.js)', context);
  checkAndRepairFile('antigravity_manager.js', path.join(SKILLS_DB_DIR, 'antigravity_manager.js'), 'Antigravity Manager Script (antigravity_manager.js)', context);
  checkAndRepairFile('antigravity_tool_sanitize_hook.js', path.join(SKILLS_DB_DIR, 'antigravity_tool_sanitize_hook.js'), 'Tool Sanitize Hook (antigravity_tool_sanitize_hook.js)', context);
  checkAndRepairFile('guardrails.js', path.join(SKILLS_DB_DIR, 'guardrails.js'), 'Shared Guardrails (guardrails.js)', context);
}

function syncSubdirectoryFiles(subName, destDir, labelPrefix, context) {
  const fullSrc = path.join(SRC_DIR, subName);
  if (!fileExists(fullSrc)) return;
  try {
    ensureDir(destDir);
    for (const entry of fs.readdirSync(fullSrc)) {
      if (entry === '__pycache__' || !entry.endsWith('.js')) continue;
      const srcEntry = path.join(fullSrc, entry);
      if (!fs.statSync(srcEntry).isFile()) continue;
      checkAndRepairFile(path.join(subName, entry), path.join(destDir, entry), `${labelPrefix} (${entry})`, context);
    }
  } catch (e) {
    context.record(`${labelPrefix} files`, 'FAILED', e.message);
    context.markError();
  }
}

function repairFileToolsSubsystem(context) {
  checkAndRepairFile('file_tools_mcp.js', FILE_TOOLS_MCP_PATH, 'File Tools MCP (file_tools_mcp.js)', context);
  checkAndRepairFile('file_tools_router.js', FILE_TOOLS_ROUTER_PATH, 'File Tools Router (file_tools_router.js)', context);
  checkAndRepairFile('file_tools_launcher.js', path.join(SKILLS_DB_DIR, 'file_tools_launcher.js'), 'File Tools Launcher (file_tools_launcher.js)', context);
  checkAndRepairFile('platform_utils.js', path.join(SKILLS_DB_DIR, 'platform_utils.js'), 'Platform Utils (platform_utils.js)', context);
  checkAndRepairFile('tools_savings_logger.js', path.join(SKILLS_DB_DIR, 'tools_savings_logger.js'), 'Tools Savings Logger (tools_savings_logger.js)', context);
  checkAndRepairFile('file_tools_launcher.sh', FILE_TOOLS_LAUNCHER_PATH, 'File Tools Launcher (file_tools_launcher.sh)', context);

  if (fileExists(FILE_TOOLS_LAUNCHER_PATH) && process.platform !== 'win32') {
    try { fs.chmodSync(FILE_TOOLS_LAUNCHER_PATH, 0o755); } catch { /* intentional fallback */ }
  }

  deployUtils.writeNodeExecPathRecord();
  deployUtils.writePythonCmdRecord(checkPython());

  syncSubdirectoryFiles('file_tools', FILE_TOOLS_PY_DIR, 'File Tools JS', context);
  syncSubdirectoryFiles('mcp', path.join(SKILLS_DB_DIR, 'mcp'), 'MCP Subsystem', context);
}

function installMissingFileTools(context) {
  if (fileExists(FILE_TOOLS_MCP_PATH)) return;
  try {
    installFileTools(true);
    if (fileExists(FILE_TOOLS_MCP_PATH)) {
      context.record('File Tools MCP (konoha)', 'REPAIRED', 'Installed konoha MCP server and Python helpers');
      context.incrementRepairs();
      return;
    }
  } catch (e) {
    context.record('File Tools MCP (konoha)', 'FAILED', e.message);
    context.markError();
    return;
  }
  context.record('File Tools MCP (konoha)', 'FAILED', 'file_tools_mcp.js missing after install');
  context.markError();
}

function retryRefreshLauncher(context, fileToolsSmoke, directSmoke) {
  context.record('konoha MCP smoke test', 'WARNING', `Launcher failed (${fileToolsSmoke.error}); direct node OK (${directSmoke.toolCount} tools)`);
  try {
    installFileTools(true);
    const retry = smokeTestKonohaFilesMcp(true);
    if (retry.ok) {
      context.record('konoha launcher', 'REPAIRED', 'Launcher script refreshed');
      context.incrementRepairs();
    }
  } catch { /* intentional fallback */ }
}

function testAndRepairFileToolsSmoke(context) {
  installMissingFileTools(context);

  const fileToolsSmoke = smokeTestKonohaFilesMcp(true);
  if (fileToolsSmoke.ok) {
    context.record('konoha MCP smoke test', 'HEALTHY', `${fileToolsSmoke.toolCount} tools via launcher`);
    return;
  }

  const directSmoke = smokeTestKonohaFilesMcp(false);
  if (directSmoke.ok) {
    retryRefreshLauncher(context, fileToolsSmoke, directSmoke);
    return;
  }

  context.record('konoha MCP smoke test', 'FAILED', directSmoke.error || fileToolsSmoke.error);
  context.markError();
}

function checkAndRepairRuntimeFiles(context) {
  repairCoreModules(context);
  repairFileToolsSubsystem(context);
  testAndRepairFileToolsSmoke(context);
}

module.exports = {
  checkAndRepairFile,
  checkAndRepairRuntimeFiles
};
