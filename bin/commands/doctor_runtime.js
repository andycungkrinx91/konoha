'use strict';

const fs = require('fs');
const path = require('path');
const { fileExists, ensureDir } = require('../../src/platform_utils');
const { copyFile } = require('../lib/prompt');
const {
  SRC_DIR,
  SKILLS_DB_DIR,
  FILE_TOOLS_MCP_PATH,
  FILE_TOOLS_ROUTER_PATH,
  FILE_TOOLS_LAUNCHER_PATH
} = require('../lib/paths');
const deployUtils = require('../../src/deploy_utils');
const { installFileTools } = require('../../src/deploy_installer');
const { copyRuntimeAssets, copyRecursive } = require('../lib/runtime_install');
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
  try {
    const entries = fs.readdirSync(SRC_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && (entry.name.endsWith('.js') || entry.name === 'mcp_tool_manifest.json')) {
        checkAndRepairFile(entry.name, path.join(SKILLS_DB_DIR, entry.name), `Runtime Module (${entry.name})`, context);
      }
    }
  } catch (e) {
    context.record('Runtime Modules', 'FAILED', e.message);
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
  checkAndRepairFile('mcp_tool_manifest.json', path.join(SKILLS_DB_DIR, 'mcp_tool_manifest.json'), 'MCP Tool Manifest (mcp_tool_manifest.json)', context);

  if (fileExists(FILE_TOOLS_LAUNCHER_PATH) && process.platform !== 'win32') {
    try { fs.chmodSync(FILE_TOOLS_LAUNCHER_PATH, 0o755); } catch { /* intentional fallback */ }
  }

  deployUtils.writeNodeExecPathRecord();
  deployUtils.writePythonCmdRecord(checkPython());

  const pkgAssetsDir = path.join(path.resolve(SRC_DIR, '..'), 'assets');
  const pkgGrammarsDir = path.join(pkgAssetsDir, 'grammars');
  if (fileExists(pkgAssetsDir)) {
    const grammarsDest = path.join(SKILLS_DB_DIR, 'assets', 'grammars');
    const hadGrammars =
      fileExists(pkgGrammarsDir) &&
      fs.readdirSync(pkgGrammarsDir).every((entry) => fileExists(path.join(grammarsDest, entry)));
    copyRuntimeAssets(pkgAssetsDir, copyRecursive);
    context.record(
      'Runtime Grammars (assets/grammars)',
      hadGrammars ? 'HEALTHY' : 'REPAIRED',
      hadGrammars
        ? 'Runtime assets and grammars verified'
        : 'Restored runtime assets and grammars from package'
    );
    if (!hadGrammars) context.incrementRepairs();
  }

  purgeInvalidRuntimeMirrors(context);
}

// Earlier releases mirrored src/<sub>/*.js flattened into ~/.konoha/<sub>/, which
// dropped nested trees (langgraph/{nodes,edges}/, qa-automation/) while the
// deployed file_tools_router.js still requires ./mcp/runtime_state and
// ./workflow/qa-automation/qa_tools from the runtime root. A complete copy is
// legitimate and load-bearing; only a flattened one is broken. Detect flattening
// by the absence of the nested directory the mirrored code itself requires.
const RUNTIME_MIRROR_REQUIREMENTS = [
  { sub: 'mcp', required: path.join('langgraph', 'index.js') },
  { sub: 'workflow', required: path.join('qa-automation', 'qa_tools.js') }
];

function isFlattenedMirror(mirrorDir, requiredRelPath) {
  if (!fileExists(mirrorDir)) return false;
  if (fileExists(path.join(mirrorDir, requiredRelPath))) return false;
  try {
    const entries = fs.readdirSync(mirrorDir, { withFileTypes: true });
    const hasFiles = entries.some(e => e.isFile());
    const hasDirs = entries.some(e => e.isDirectory());
    // A tree that lost its required nested path but still holds loose files is
    // the flattened mirror produced by the retired syncSubdirectoryFiles pass.
    return hasFiles && !hasDirs;
  } catch {
    return false;
  }
}

function purgeInvalidRuntimeMirrors(context) {
  for (const { sub, required } of RUNTIME_MIRROR_REQUIREMENTS) {
    const dir = path.join(SKILLS_DB_DIR, sub);
    if (!isFlattenedMirror(dir, required)) continue;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      context.record(`${sub} legacy mirror`, 'REPAIRED', `Removed flattened mirror missing ${required}`);
      context.incrementRepairs();
    } catch (e) {
      context.record(`${sub} legacy mirror`, 'FAILED', e.message);
      context.markError();
    }
  }
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

/**
 * `konoha doctor --clean-cyber-pack`
 *
 * Removes the opt-in cyber pack from an existing install: DB backup, indexed
 * rows, on-disk copies, then state `removed`. Idempotent.
 */
function cleanCyberPack(context) {
  const cyberPack = require('../../src/cyber_pack');
  const db = require('../../src/db');
  let conn = null;
  try {
    conn = db.getConnection(null, false);
    const before = cyberPack.status(conn);
    if (before.state === 'removed' && before.rows === 0) {
      context.record('Cyber pack', 'HEALTHY', 'already clean');
      return;
    }
    const result = cyberPack.remove({ conn });
    context.record(
      'Cyber pack',
      'REPAIRED',
      `removed ${result.removedRows} rows, ${result.removedChunks} chunks, ${result.removedDirs.length} dirs; backup ${result.backupPath}`
    );
    context.incrementRepairs();
  } catch (e) {
    context.record('Cyber pack', 'FAILED', e.message);
    context.markError();
  } finally {
    try { if (conn) conn.close(); } catch (_) { /* ignore */ }
  }
}

/**
 * `konoha doctor --restore-anbu`
 *
 * Re-copies the ANBU skill template and its agents.yaml row. Never restores the
 * cyber pack.
 */
function restoreAnbu(context) {
  const { syncTemplateSkills } = require('../lib/runtime_lifecycle');
  const anbuSrc = path.join(SRC_DIR, 'templates', 'skills', 'anbu-skill');
  if (!fileExists(anbuSrc)) {
    context.record('ANBU skill', 'FAILED', `Template missing: ${anbuSrc}`);
    context.markError();
    return;
  }
  try {
    const synced = syncTemplateSkills();
    context.record('ANBU skill', 'REPAIRED', `Re-synced ${synced} skill file(s) from package templates`);
    context.incrementRepairs();
  } catch (e) {
    context.record('ANBU skill', 'FAILED', e.message);
    context.markError();
  }
}

module.exports = {
  checkAndRepairFile,
  checkAndRepairRuntimeFiles,
  repairFileToolsSubsystem,
  purgeInvalidRuntimeMirrors,
  cleanCyberPack,
  restoreAnbu
};
