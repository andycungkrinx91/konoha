'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  HOME,
  SRC_DIR,
  SKILLS_DB_DIR,
  FILE_TOOLS_MCP_PATH,
  FILE_TOOLS_LAUNCHER_JS,
  FILE_TOOLS_LAUNCHER_PATH,
  FILE_TOOLS_PY_DIR
} = require('../bin/lib/paths');
const { IS_WIN } = require('./platform_utils');
const {
  resolveCompatibleNodeEnv,
  writeNodeExecPathRecord,
  writePythonCmdRecord
} = require('./runtime_resolver');

function fileExists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function ensureDir(p) {
  try {
    fs.mkdirSync(p, { recursive: true });
  } catch { /* intentional fallback */ }
}

function copyIfDifferent(src, dest) {
  if (!fileExists(src)) return false;
  try {
    const srcBuf = fs.readFileSync(src);
    if (fileExists(dest)) {
      const destBuf = fs.readFileSync(dest);
      if (srcBuf.equals(destBuf)) return false;
    }
    ensureDir(path.dirname(dest));
    fs.writeFileSync(dest, srcBuf);
    return true;
  } catch {
    return false;
  }
}

function copyRecursiveIfDifferent(src, dest) {
  if (!fileExists(src)) return 0;
  let copied = 0;
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copied += copyRecursiveIfDifferent(srcPath, destPath);
    } else if (entry.isFile()) {
      if (copyIfDifferent(srcPath, destPath)) copied++;
    }
  }
  return copied;
}

const KONOHA_CANONICAL_TOOLS = [
  'read_file_head', 'read_file_range', 'file_info',
  ['token', 'efficient', 'grep'].join('_'),
  'get_file_structure', 'find_files_clean', 'website_ai_detector', 'docs_ai_detector',
  'get_resolved_task_dir', 'find_skill', 'list_skills', 'get_skill', 'optimize_report',
  'build_from_source', 'build_from_text', 'sannin', 'kage', 'jonin', 'anbu', 'chunin',
  'tokubetsu_jonin', 'genin', 'akatsuki', 'report_from_agent', 'get_project_context',
  'save_project_context', 'query_project_memory', 'web_search', 'migrate_skills',
  'save_persona_memory', 'query_persona_memory', 'list_persona_memories', 'delete_persona_memory',
  'check_readiness', 'get_task_evidence', 'get_slop_findings', 'qa_codify', 'qa_e2e_run'
];

function buildKonohaFilesMcpEntry(mode = "execPath") {
  const repoFileTools = path.join(SRC_DIR, 'file_tools_mcp.js');
  const targetScript = fileExists(FILE_TOOLS_LAUNCHER_JS)
    ? FILE_TOOLS_LAUNCHER_JS
    : (fileExists(FILE_TOOLS_MCP_PATH) ? FILE_TOOLS_MCP_PATH : (fileExists(repoFileTools) ? repoFileTools : null));
  if (!targetScript) return null;
  const clientName = (mode === "global" || mode === "execPath") ? "antigravity" : mode;

  return {
    type: "stdio",
    command: process.execPath || "node",
    args: [targetScript],
    env: { ACTIVE_CLIENT: clientName, KONOHA_CLIENT: clientName, KONOHA_SEMANTIC_SEARCH: "1" },
    autoApprove: [...KONOHA_CANONICAL_TOOLS],
    auto_approve: true
  };
}

function copyJsFileIfMatching(entry, srcDir, destDir) {
  if (entry.isFile() && (entry.name.endsWith('.js') || entry.name === 'mcp_tool_manifest.json')) {
    copyIfDifferent(path.join(srcDir, entry.name), path.join(destDir, entry.name));
  }
}

function syncRuntimeJsFiles(srcDir, destDir) {
  try {
    const entries = fs.readdirSync(srcDir, { withFileTypes: true });
    for (const entry of entries) {
      copyJsFileIfMatching(entry, srcDir, destDir);
    }
  } catch (_) { /* non-fatal */ }
}

function syncRuntimeSubdirectories(srcDir, destDir) {
  const subdirs = [
    { src: 'file_tools', dest: FILE_TOOLS_PY_DIR },
    { src: 'mcp', dest: path.join(destDir, 'mcp') },
    { src: 'tools', dest: path.join(destDir, 'tools') },
    { src: 'workflow', dest: path.join(destDir, 'workflow') },
    { src: 'bridge', dest: path.join(destDir, 'bridge') }
  ];
  for (const item of subdirs) {
    const fullSrc = path.join(srcDir, item.src);
    if (fileExists(fullSrc)) {
      copyRecursiveIfDifferent(fullSrc, item.dest);
    }
  }
}

function installRuntimePackageDependencies(destDir, silent) {
  const pkgPath = path.join(destDir, 'package.json');
  const nodeModulesPath = path.join(destDir, 'node_modules');
  if (!fileExists(pkgPath)) {
    fs.writeFileSync(
      pkgPath,
      JSON.stringify({ name: 'konoha-runtime', version: '1.0.0', private: true, dependencies: { '@bufbuild/protobuf': '^2.11.0', '@huggingface/transformers': '^4.2.0' } }, null, 2) + '\n'
    );
  }
  if (fileExists(nodeModulesPath) && fileExists(path.join(nodeModulesPath, '@bufbuild', 'protobuf'))) {
    return;
  }

  const isWin = process.platform === 'win32';
  const pmCandidates = [
    { cmd: isWin ? 'pnpm.cmd' : 'pnpm', args: ['install', '--prod', '--no-frozen-lockfile'] },
    { cmd: isWin ? 'npm.cmd' : 'npm', args: ['install', '--omit=dev', '--no-audit', '--no-fund'] }
  ];
  const { env: childEnv } = resolveCompatibleNodeEnv(process.env);
  for (const pm of pmCandidates) {
    try {
      execFileSync(pm.cmd, pm.args, { cwd: destDir, stdio: 'ignore', shell: isWin, timeout: 300000, env: childEnv });
      return;
    } catch (_) { /* fallback to npm */ }
  }
  if (!silent) {
    console.warn(`[warning] Failed to install Konoha runtime dependencies in ${destDir}`);
  }
}

function setupLauncherScript() {
  const launcherShSrc = path.join(SRC_DIR, 'file_tools_launcher.sh');
  if (!fileExists(launcherShSrc)) return;
  copyIfDifferent(launcherShSrc, FILE_TOOLS_LAUNCHER_PATH);
  if (IS_WIN) return;
  try { fs.chmodSync(FILE_TOOLS_LAUNCHER_PATH, 0o755); } catch { /* intentional fallback */ }
}

function installFileTools(silent = true, pythonCmd = null) {
  ensureDir(SKILLS_DB_DIR);
  syncRuntimeJsFiles(SRC_DIR, SKILLS_DB_DIR);
  copyIfDifferent(path.join(SRC_DIR, 'mcp_tool_manifest.json'), path.join(SKILLS_DB_DIR, 'mcp_tool_manifest.json'));
  copyIfDifferent(path.join(SRC_DIR, 'workflow', 'sannin-orchestrator', 'workflow_reminder.js'), path.join(SKILLS_DB_DIR, 'workflow_reminder.js'));
  setupLauncherScript();
  writeNodeExecPathRecord();
  writePythonCmdRecord(pythonCmd);
  syncRuntimeSubdirectories(SRC_DIR, SKILLS_DB_DIR);
  installRuntimePackageDependencies(SKILLS_DB_DIR, silent);
  return fileExists(FILE_TOOLS_MCP_PATH);
}

function cleanSingleTmpEntry(tmpDir, entryName, result) {
  if (entryName === '.' || entryName === '..') return;
  const entryPath = path.join(tmpDir, entryName);
  try {
    let size = 0;
    try { size = fs.statSync(entryPath).size || 0; } catch (_) { /* non-fatal */ }
    fs.rmSync(entryPath, { recursive: true, force: true });
    result.purgedFiles++;
    result.reclaimedBytes += size;
    result.details.push(`tmp/${entryName}`);
  } catch (tmpErr) {
    result.errors.push(`Failed to clean tmp/${entryName}: ${tmpErr.message}`);
  }
}

function cleanTmpScratchEntries(tmpDir, result) {
  if (!fs.existsSync(tmpDir)) return;
  try {
    const entries = fs.readdirSync(tmpDir, { withFileTypes: true });
    for (const entry of entries) {
      cleanSingleTmpEntry(tmpDir, entry.name, result);
    }
  } catch (readErr) {
    result.errors.push(`Failed to read tmp directory: ${readErr.message}`);
  }
}

function evaluatePurgeReason(name, src) {
  const isBak = name.startsWith('konoha.db.bak') || name.startsWith('skills.db.bak') || name.startsWith('.konoha.db.bak') || name.endsWith('.bak') || name.endsWith('.backup') || name.endsWith('~');
  if (isBak) return 'stale backup';
  if (['skills.db', 'skills.db-wal', 'skills.db-shm', 'skills.db.journal'].includes(name)) return 'legacy database';
  if (name.endsWith('.py') || name.endsWith('.pyc')) return 'legacy python script';
  if (name.endsWith('.pid') || name === 'package-lock.json') return 'stale lock/pid';
  if (name === 'transcript_cache.json' || name.endsWith('.log')) return 'dead cache/log';
  if (name.endsWith('.vsix') || name === 'hook-wrapper') return 'misplaced or deprecated artifact';
  if (name === 'cli.js') return 'obsolete root cli.js (canonical in bin/cli.js)';
  if (name.endsWith('.js')) {
    const isKnown = (name === 'server.js' || name === 'file_tools_launcher.js');
    if (!isKnown && !fs.existsSync(path.join(src, name))) {
      return 'orphaned module (not in src/)';
    }
  }
  return null;
}

function purgeRuntimeFile(itemPath, name, purgeReason, result) {
  try {
    let size = 0;
    try { size = fs.statSync(itemPath).size; } catch (_) { /* non-fatal */ }
    fs.unlinkSync(itemPath);
    result.purgedFiles++;
    result.reclaimedBytes += size;
    result.details.push(`${name} (${purgeReason})`);
  } catch (unlinkErr) {
    result.errors.push(`Failed to unlink ${name}: ${unlinkErr.message}`);
  }
}

function vacuumActiveDatabase(target, result, silent) {
  const activeDbPath = path.join(target, 'konoha.db');
  if (!fs.existsSync(activeDbPath)) return;
  try {
    const Database = require('./sqlite_driver');
    const db = new Database(activeDbPath, { timeout: 5000 });
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.exec('VACUUM');
    } finally {
      db.close();
    }
  } catch (dbErr) {
    if (!silent) {
      result.errors.push(`Database vacuum skipped: ${dbErr.message}`);
    }
  }
}

function handleRuntimeDirectoryItem(itemPath, name, result) {
  if (!['__pycache__', '.pytest_cache', '.ruff_cache'].includes(name)) return;
  try {
    fs.rmSync(itemPath, { recursive: true, force: true });
    result.purgedFiles++;
    result.details.push(`${name}/`);
  } catch (dirErr) {
    result.errors.push(`Failed to remove directory ${name}: ${dirErr.message}`);
  }
}

function processRuntimeEntry(entry, context) {
  const { target, src, preserveFiles, preserveDirs, activeScript, result } = context;
  const name = entry.name;
  if (name === '.' || name === '..' || preserveFiles.has(name) || preserveDirs.has(name)) return;
  const itemPath = path.join(target, name);
  if (activeScript && itemPath === activeScript) return;
  if (entry.isDirectory()) {
    handleRuntimeDirectoryItem(itemPath, name, result);
    return;
  }
  const reason = evaluatePurgeReason(name, src);
  if (reason) purgeRuntimeFile(itemPath, name, reason, result);
}

function cleanKonohaRuntimeDir(options = {}) {
  const target = path.resolve(options.targetDir || SKILLS_DB_DIR);
  const src = path.resolve(options.srcDir || SRC_DIR);
  const silent = options.silent === true;
  const vacuumDb = options.vacuumDatabase !== false;

  const result = { purgedFiles: 0, reclaimedBytes: 0, errors: [], details: [] };
  if (!target || target === '/' || target === HOME || target === path.resolve(HOME, '..')) {
    throw new Error(`Refusing to clean unsafe directory: ${target}`);
  }
  if (target === src) {
    throw new Error(`Refusing to clean source directory: targetDir equals srcDir (${target})`);
  }
  if (!fs.existsSync(target)) {
    ensureDir(target);
    return result;
  }

  cleanTmpScratchEntries(path.join(target, 'tmp'), result);

  const preserveDirs = new Set(['transformers_cache', 'node_modules', 'vendor', 'searxng', 'assets', 'apps', 'bin', 'bridge', 'file_tools', 'mcp', 'src', '.agents', 'tmp']);
  const preserveFiles = new Set(['konoha.db', 'konoha.db-wal', 'konoha.db-shm', 'package.json', 'pnpm-lock.yaml', 'web_token', 'bridges.json', 'konoha-bridge.json', '.python_cmd', '.node_exec_path', '.deploy-fingerprint', '.gitignore']);

  let entries = [];
  try {
    entries = fs.readdirSync(target, { withFileTypes: true });
  } catch (err) {
    result.errors.push(`Failed to read target directory: ${err.message}`);
    return result;
  }

  const activeScript = process.argv[1] ? path.resolve(process.argv[1]) : '';
  for (const entry of entries) {
    processRuntimeEntry(entry, { target, src, preserveFiles, preserveDirs, activeScript, result });
  }

  if (vacuumDb) vacuumActiveDatabase(target, result, silent);
  return result;
}

module.exports = {
  KONOHA_CANONICAL_TOOLS,
  buildKonohaFilesMcpEntry,
  installFileTools,
  cleanKonohaRuntimeDir
};
