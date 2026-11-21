'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, execSync } = require('child_process');
const {
  HOME,
  SRC_DIR,
  SKILLS_DB_DIR,
  FILE_TOOLS_MCP_PATH,
  FILE_TOOLS_LAUNCHER_JS,
  FILE_TOOLS_LAUNCHER_PATH,
  FILE_TOOLS_PY_DIR
} = require('./config_access').loadBinLib('paths');
const { IS_WIN } = require('./platform_utils');
const {
  resolveCompatibleNode,
  resolveCompatibleNodeEnv,
  writeNodeExecPathRecord,
  writePythonCmdRecord
} = require('./runtime_resolver');

function readPackageVersion(pkgJsonPath) {
  try {
    return JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8')).version || null;
  } catch {
    return null;
  }
}

function resolvePackageDir(nodeModulesPath, depName) {
  return path.join(nodeModulesPath, ...depName.split('/'));
}

function readDeclaredDependencies(pkgJsonPath) {
  try {
    return Object.keys(JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8')).dependencies || {});
  } catch {
    return [];
  }
}

function listMissingDependencies(nodeModulesPath, deps) {
  return deps.filter((depName) => !fileExists(resolvePackageDir(nodeModulesPath, depName)));
}

function copyDependencyFrom(sourceNodeModules, nodeModulesPath, depName) {
  const srcPkg = resolvePackageDir(sourceNodeModules, depName);
  if (!fileExists(srcPkg)) return false;
  const destPkg = resolvePackageDir(nodeModulesPath, depName);
  try {
    const realPkg = fs.realpathSync(srcPkg);
    ensureDir(path.dirname(destPkg));
    if (fileExists(destPkg)) fs.rmSync(destPkg, { recursive: true, force: true });
    fs.cpSync(realPkg, destPkg, { recursive: true, dereference: true });
    return true;
  } catch {
    return false;
  }
}

function _tryReuseRootNodeModules(rootDir, nodeModulesPath) {
  const rootNodeModules = path.join(rootDir, 'node_modules');
  if (!fileExists(rootNodeModules)) return;
  if (!fileExists(nodeModulesPath)) {
    try {
      fs.symlinkSync(rootNodeModules, nodeModulesPath, process.platform === 'win32' ? 'junction' : 'dir');
      return;
    } catch {
      copyRecursiveIfDifferent(rootNodeModules, nodeModulesPath);
      return;
    }
  }
  const deps = readDeclaredDependencies(path.join(rootDir, 'package.json'));
  const webNodeModules = path.join(rootDir, 'apps', 'web', 'node_modules');
  for (const depName of listMissingDependencies(nodeModulesPath, deps)) {
    if (copyDependencyFrom(rootNodeModules, nodeModulesPath, depName)) continue;
    copyDependencyFrom(webNodeModules, nodeModulesPath, depName);
  }
}

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
  } catch (err) {
    // A swallowed mkdir loses every file written under it, so report the path.
    console.warn(`[warning] Could not create directory ${p}: ${err && err.message ? err.message : err}`);
  }
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
  } catch (err) {
    // Returning false silently used to hide a missing runtime file behind an
    // install that reported success.
    console.warn(`[warning] Could not copy ${src} -> ${dest}: ${err && err.message ? err.message : err}`);
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

function _readToolsFromCandidate(p) {
  if (!fileExists(p)) return null;
  try {
    const manifest = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Array.isArray(manifest.tools) ? manifest.tools.filter(t => !t.deprecated).map(t => t.name) : null;
  } catch (_) { return null; }
}

function loadCanonicalToolsFromManifest() {
  const candidatePaths = [
    path.join(SRC_DIR, 'mcp_tool_manifest.json'),
    path.join(__dirname, 'mcp_tool_manifest.json'),
    path.join(SKILLS_DB_DIR, 'mcp_tool_manifest.json')
  ];
  for (const p of candidatePaths) {
    const tools = _readToolsFromCandidate(p);
    if (tools) return tools;
  }
  return [
    'read_file_head', 'read_file_range', 'file_info',
    ['token', 'efficient', 'grep'].join('_'), 'get_file_structure', 'find_files_clean',
    'website_ai_detector', 'docs_ai_detector', 'get_resolved_task_dir',
    'find_skill', 'list_skills', 'get_skill', 'use_skills', 'optimize_report',
    'build_from_source', 'build_from_text',
    'sannin', 'kage', 'jonin', 'anbu', 'akatsuki', 'yamanaka', 'akatsuki_init', 'chunin',
    'tokubetsu_jonin', 'genin', 'report_from_agent', 'get_project_context',
    'save_project_context', 'query_project_memory', 'web_search', 'migrate_skills',
    'save_persona_memory', 'query_persona_memory', 'list_persona_memories',
    'delete_persona_memory', 'check_readiness', 'get_task_evidence',
    'get_slop_findings', 'anti_slop', 'qa_codify', 'qa_e2e_run', 'get_soul',
    'document_create', 'spreadsheet_create', 'presentation_create',
    'diagram_create', 'animation_export',
    'code_index', 'code_search', 'code_symbol', 'code_context',
    'code_impact', 'code_related', 'code_status', 'code_remove'
  ];
}

const KONOHA_CANONICAL_TOOLS = loadCanonicalToolsFromManifest();

function buildKonohaFilesMcpEntry(mode = "execPath") {
  const repoFileTools = path.join(SRC_DIR, 'file_tools_mcp.js');
  const targetScript = fileExists(FILE_TOOLS_LAUNCHER_JS)
    ? FILE_TOOLS_LAUNCHER_JS
    : (fileExists(FILE_TOOLS_MCP_PATH) ? FILE_TOOLS_MCP_PATH : (fileExists(repoFileTools) ? repoFileTools : null));
  if (!targetScript) return null;
  const clientName = (mode === "global" || mode === "execPath") ? "antigravity" : mode;
  const nodeCmd = resolveCompatibleNode() || process.execPath || "node";
  const localBin = path.join(HOME, '.local', 'bin');
  const cargoBin = path.join(HOME, '.cargo', 'bin');
  const nodeDir = nodeCmd ? path.dirname(nodeCmd) : '';
  const clientPathEnv = [nodeDir, localBin, cargoBin, process.env.PATH || ''].filter(Boolean).join(path.delimiter);

  return {
    type: "stdio",
    command: nodeCmd,
    args: [targetScript],
    env: {
      ACTIVE_CLIENT: clientName,
      KONOHA_CLIENT: clientName,
      KONOHA_SEMANTIC_SEARCH: "1",
      PATH: clientPathEnv
    },
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
  // Repoint the flat root modules at the mirrored src/ tree; the copy above is
  // what a partial install (no src/ mirror yet) still needs.
  ensureMirroredRootFileLinks(destDir);
}

// Top-level entries under src/ that are build or scratch output rather than
// shipped runtime code. Everything else in src/ is mirrored, so a new src/<sub>
// directory is installed without also being added to a hand-maintained list —
// the list is what let src/web, src/telegram and src/templates go missing while
// modules under src/mcp/ kept requiring them.
const RUNTIME_MIRROR_DENYLIST = new Set([
  'node_modules',
  '.git',
  '.cache',
  '.svelte-kit',
  '__pycache__',
  '.pytest_cache',
  '.ruff_cache',
  '.DS_Store',
  'build',
  'dist',
  'coverage',
  'tmp',
  'scratch'
]);

function listRuntimeSubdirectories(srcDir) {
  const names = [];
  let entries = [];
  try {
    entries = fs.readdirSync(srcDir, { withFileTypes: true });
  } catch (_) {
    return names;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (RUNTIME_MIRROR_DENYLIST.has(entry.name)) continue;
    names.push(entry.name);
  }
  return names.sort();
}

function syncRuntimeSubdirectories(srcDir, destDir) {
  let synced = 0;
  const rootDir = path.resolve(srcDir, '..');
  const patchesSrc = path.join(rootDir, 'patches');
  if (fileExists(patchesSrc)) {
    synced += copyRecursiveIfDifferent(patchesSrc, path.join(destDir, 'patches'));
  }
  const migrationsSrc = path.join(rootDir, 'migrations');
  if (fileExists(migrationsSrc)) {
    synced += copyRecursiveIfDifferent(migrationsSrc, path.join(destDir, 'migrations'));
  }
  const subdirs = listRuntimeSubdirectories(srcDir).map(name => ({
    src: name,
    // The Python file tools keep their own destination; every other
    // subdirectory mirrors under its own name.
    dest: name === 'file_tools' ? FILE_TOOLS_PY_DIR : path.join(destDir, name)
  }));
  for (const item of subdirs) {
    const fullSrc = path.join(srcDir, item.src);
    if (fileExists(fullSrc)) {
      synced += copyRecursiveIfDifferent(fullSrc, item.dest);
    }
  }
  // Link after the copy, so each flat name resolves at its mirrored tree and a
  // module below it reaches src/ siblings instead of one level too high.
  ensureMirroredSubdirLinks(destDir);
  const grammarsSrc = path.join(rootDir, 'assets', 'grammars');
  if (fileExists(grammarsSrc)) {
    synced += copyRecursiveIfDifferent(grammarsSrc, path.join(destDir, 'assets', 'grammars'));
  }
  return synced;
}

// The flat ~/.konoha/<sub> mirror sits one level above the mirrored
// ~/.konoha/src/<sub> tree, so an escaped require such as
// ../../web/controllers/common from ~/.konoha/mcp/three_asset/ resolves to
// ~/.konoha/web instead of the mirrored src/web and fails at load. Linking the
// flat name at the mirrored tree restores repo-relative resolution for every
// module below it, rather than patching one require at a time.
//
// Node resolves a module's filename through realpath, so the link is enough: the
// require graph is then evaluated at the mirrored depth, which is the depth the
// repo tree has. src/file_tools is linked too, because its common.js reaches
// ../../bin/lib/paths, which only resolves from that depth.
function ensureMirroredSubdirLinks(destDir) {
  const linked = new Set();
  const mirrorRoot = path.join(destDir, 'src');
  if (!fileExists(mirrorRoot)) return linked;
  for (const sub of listRuntimeSubdirectories(mirrorRoot)) {
    const target = path.join(mirrorRoot, sub);
    if (!fileExists(target)) continue;
    const linkPath = path.join(destDir, sub);
    const relativeTarget = path.join('src', sub);
    if (replaceWithMirrorLink(linkPath, relativeTarget, destDir)) linked.add(sub);
  }
  return linked;
}

// A root module is copied flat into ~/.konoha/, where its upward require —
// ../package.json in cyber_pack.js, ../bin/lib/yaml_utils in db_agents.js —
// escapes to the home directory instead of the install. Link each flat root
// module at the mirrored src/ file so it resolves from the repo's own depth.
function ensureMirroredRootFileLinks(destDir) {
  const linked = new Set();
  const mirrorRoot = path.join(destDir, 'src');
  if (!fileExists(mirrorRoot)) return linked;
  let entries = [];
  try {
    entries = fs.readdirSync(mirrorRoot, { withFileTypes: true });
  } catch (_) {
    return linked;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
    const linkPath = path.join(destDir, entry.name);
    const relativeTarget = path.join('src', entry.name);
    if (replaceWithMirrorLink(linkPath, relativeTarget, destDir)) linked.add(entry.name);
  }
  return linked;
}

// A link is an optimisation, not a correctness requirement: the flat copy is a
// valid install, so every failure here must keep the copy rather than lose it.
//
// The probe is per link KIND because the two are not interchangeable on Windows.
// A 'junction' is a directory reparse point; pointing one at a FILE is created
// without error and then resolves to nothing, so probing only a directory
// junction authorised file links that could never work and silently deleted the
// file they replaced. Probe a directory junction and a real file link separately.
let symlinkSupport = null;

// statSync follows the link, and readdir/readFile then prove the target is
// actually reachable. existsSync alone returns false for a dangling link, so it
// cannot distinguish a working link from one that resolves to nothing.
function linkResolves(linkPath, expectDirectory) {
  try {
    const stat = fs.statSync(linkPath);
    if (stat.isDirectory() !== expectDirectory) return false;
    if (expectDirectory) fs.readdirSync(linkPath);
    else fs.readFileSync(linkPath);
    return true;
  } catch (_) {
    return false;
  }
}

function probeSymlinkSupport(destDir) {
  if (symlinkSupport !== null) return symlinkSupport;
  const probeDir = path.join(destDir, '.konoha-link-probe');
  const support = { dir: false, file: false };
  try {
    fs.rmSync(probeDir, { recursive: true, force: true });
    fs.mkdirSync(probeDir, { recursive: true });

    const dirTarget = path.join(probeDir, 'dir-target');
    fs.mkdirSync(dirTarget, { recursive: true });
    const dirLink = path.join(probeDir, 'dir-link');
    try {
      fs.symlinkSync(dirTarget, dirLink, 'junction');
      support.dir = linkResolves(dirLink, true);
    } catch (_) {
      support.dir = false;
    }

    const fileTarget = path.join(probeDir, 'file-target');
    fs.writeFileSync(fileTarget, 'probe');
    const fileLink = path.join(probeDir, 'file-link');
    try {
      fs.symlinkSync(fileTarget, fileLink, 'file');
      support.file = linkResolves(fileLink, false);
    } catch (_) {
      support.file = false;
    }
  } catch (_) {
    support.dir = false;
    support.file = false;
  } finally {
    try { fs.rmSync(probeDir, { recursive: true, force: true }); } catch (_) { /* best effort */ }
  }
  symlinkSupport = support;
  return support;
}

function replaceWithMirrorLink(linkPath, relativeTarget, destDir) {
  // The link kind follows the target: directories take a junction, files take a
  // real file link, and on Windows only the directory form is elevation-free.
  let targetIsDirectory = null;
  try {
    targetIsDirectory = fs.statSync(path.join(destDir, relativeTarget)).isDirectory();
  } catch (_) {
    return false;
  }
  const support = probeSymlinkSupport(destDir);
  if (targetIsDirectory ? !support.dir : !support.file) return false;
  const linkType = targetIsDirectory ? 'junction' : 'file';

  const staging = `${linkPath}.konoha-link-tmp`;
  try {
    let existing = null;
    try {
      existing = fs.lstatSync(linkPath);
    } catch (_) {
      existing = null;
    }
    if (existing && existing.isSymbolicLink()) {
      try {
        if (fs.readlinkSync(linkPath) === relativeTarget && linkResolves(linkPath, targetIsDirectory)) return true;
      } catch (_) { /* rebuild below */ }
    }
    fs.rmSync(staging, { recursive: true, force: true });
    fs.symlinkSync(relativeTarget, staging, linkType);
    // Nothing is deleted until the replacement is proven to resolve. A dangling
    // staging link leaves the working copy untouched and reports failure.
    if (!linkResolves(staging, targetIsDirectory)) {
      fs.rmSync(staging, { recursive: true, force: true });
      return false;
    }
    fs.rmSync(linkPath, { recursive: true, force: true });
    fs.renameSync(staging, linkPath);
    return true;
  } catch (_) {
    try { fs.rmSync(staging, { recursive: true, force: true }); } catch (_) { /* best effort */ }
    return false;
  }
}

function installRuntimePackageDependencies(destDir, silent) {
  const pkgPath = path.join(destDir, 'package.json');
  const nodeModulesPath = path.join(destDir, 'node_modules');
  const rootDir = path.resolve(__dirname, '..');
  const rootPkg = path.join(rootDir, 'package.json');
  const rootPatches = path.join(rootDir, 'patches');
  const destPatches = path.join(destDir, 'patches');

  if (fileExists(rootPkg)) {
    copyIfDifferent(rootPkg, pkgPath);
  } else if (!fileExists(pkgPath)) {
    const fallbackManifest = {
      name: 'konoha-runtime',
      version: readPackageVersion(rootPkg) || '0.0.0',
      private: true,
      dependencies: {}
    };
    fs.writeFileSync(pkgPath, JSON.stringify(fallbackManifest, null, 2) + '\n');
  }

  if (fileExists(rootPatches)) {
    copyRecursiveIfDifferent(rootPatches, destPatches);
  }

  const declaredDeps = readDeclaredDependencies(pkgPath);
  if (declaredDeps.length === 0 || listMissingDependencies(nodeModulesPath, declaredDeps).length === 0) {
    return;
  }

  _tryReuseRootNodeModules(rootDir, nodeModulesPath);
  if (listMissingDependencies(nodeModulesPath, declaredDeps).length === 0) return;

  const isWin = process.platform === 'win32';
  const pmCandidates = [
    { cmd: isWin ? 'pnpm.cmd' : 'pnpm', args: ['install', '--prod', '--no-frozen-lockfile'] },
    { cmd: isWin ? 'npm.cmd' : 'npm', args: ['install', '--omit=dev', '--no-audit', '--no-fund'] }
  ];
  const { env: childEnv } = resolveCompatibleNodeEnv(process.env);
  for (const pm of pmCandidates) {
    try {
      if (isWin) {
        execSync(`"${pm.cmd}" ${pm.args.join(' ')}`, { cwd: destDir, stdio: 'ignore', timeout: 300000, env: childEnv, windowsHide: true });
      } else {
        execFileSync(pm.cmd, pm.args, { cwd: destDir, stdio: 'ignore', timeout: 300000, env: childEnv });
      }
      if (listMissingDependencies(nodeModulesPath, declaredDeps).length === 0) return;
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
  // Compare against the real filesystem root rather than a literal '/': on
  // Windows path.resolve('/') yields the current drive root, so a POSIX-only
  // check lets 'C:\\' through.
  // Compare canonicalized forms: callers may hand us os.homedir(), which reads
  // USERPROFILE on Windows and can differ from HOME by case or by '/' vs '\'.
  // A raw string compare lets such a caller purge the user's home directory.
  const canonical = (p) => {
    const resolved = path.resolve(p);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  const fsRoot = canonical(path.parse(target).root);
  const targetKey = canonical(target);
  // HOME is env-first; os.homedir() reads USERPROFILE on Windows and $HOME on
  // POSIX, so the two can name different directories. Reject both, plus the
  // parent of HOME, so no caller can hand us a real profile to purge.
  const unsafeRoots = new Set([
    canonical(HOME),
    canonical(path.resolve(HOME, '..')),
    canonical(os.homedir()),
  ]);
  if (!target || targetKey === fsRoot || unsafeRoots.has(targetKey)) {
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

  const preserveDirs = new Set(['transformers_cache', 'node_modules', 'vendor', 'searxng', 'assets', 'apps', 'bin', 'bridge', 'code_intel', 'file_tools', 'mcp', 'mcp_clients', 'migrations', 'queue', 'src', '.agents', 'tmp', 'workflow', 'patches', 'docs']);
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
  ensureMirroredSubdirLinks,
  ensureMirroredRootFileLinks,
  syncRuntimeSubdirectories,
  cleanKonohaRuntimeDir
};
