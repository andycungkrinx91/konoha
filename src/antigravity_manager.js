
const { getCanonicalAgentNames } = require('./canonical_agents');
const {
  buildAgentJson,
  ensureAntigravityAgents,
  buildDefineSubagentArgs,
  removeAntigravityAgents
} = require('./antigravity_agents');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

// Self-contained: derive paths from HOME rather than importing bin/lib/paths.
const { getRtkCommand, isRtkInstalled } = require('./platform_utils');
const { ensureRtkInstalled, refreshRtk } = require('./rtk_installer');
const { KONOHA_CANONICAL_TOOLS, resolveCompatibleNode } = require('./deploy_utils');

const HOME = process.env.HOME || process.env.USERPROFILE || os.homedir();
const ANTIGRAVITY_AGENTS_GLOBAL = path.join(HOME, '.gemini', 'antigravity-cli', 'agents');
// Every location the deployer writes to. Keeping one list prevents the status
// probe from drifting away from where definitions actually land.
const ANTIGRAVITY_AGENT_DIRS = Object.freeze([
  path.join(HOME, '.gemini', 'config', 'agents'),
  path.join(HOME, '.gemini', 'antigravity-cli', 'agents'),
  path.join(HOME, '.gemini', 'antigravity-ide', 'agents')
]);

function detectAntigravityIde(options = {}) {
  const env = options.env || process.env;
  const home = options.home || HOME;
  const exists = options.fileExists || fs.existsSync;
  const commandAvailable = options.commandAvailable || ((command) => {
    const probe = process.platform === 'win32' ? 'where.exe' : 'which';
    try {
      return spawnSync(probe, [command], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).status === 0;
    } catch {
      return false;
    }
  });
  const override = env.KONOHA_ANTIGRAVITY_IDE;

  if (override === '1' || override === 'true') {
    return { present: true, source: 'override', reason: 'KONOHA_ANTIGRAVITY_IDE enables the IDE' };
  }
  if (override === '0' || override === 'false') {
    return { present: false, source: 'override', reason: 'KONOHA_ANTIGRAVITY_IDE disables the IDE' };
  }

  const ideState = path.join(home, '.gemini', 'antigravity-ide');
  const ideMarkers = [
    path.join(ideState, 'brain'),
    path.join(ideState, 'settings.json'),
    path.join(ideState, 'extensions'),
  ];
  if (ideMarkers.some(exists)) {
    return { present: true, source: 'state-directory', path: ideState, reason: 'Antigravity IDE state detected' };
  }

  for (const command of ['antigravity', 'antigravity-ide']) {
    if (commandAvailable(command)) {
      return { present: true, source: 'executable', path: command, reason: 'Antigravity IDE executable detected' };
    }
  }

  return { present: false, source: 'none', reason: 'Antigravity IDE was not detected' };
}

function _cleanExtensionsJson(extJsonPath) {
  if (!fs.existsSync(extJsonPath)) return;
  try {
    const entries = JSON.parse(fs.readFileSync(extJsonPath, 'utf8'));
    if (!Array.isArray(entries)) return;
    const filtered = entries.filter(e => e?.identifier?.id?.toLowerCase() !== 'andycungkrinx91.konoha-bridge' && !(e?.relativeLocation || '').startsWith('andycungkrinx91.konoha-bridge'));
    if (filtered.length !== entries.length) {
      fs.writeFileSync(extJsonPath, JSON.stringify(filtered, null, 2) + '\n');
    }
  } catch { /* ignore */ }
}

function _cleanObsoleteJson(obsoletePath) {
  if (!fs.existsSync(obsoletePath)) return;
  try {
    const obsolete = JSON.parse(fs.readFileSync(obsoletePath, 'utf8'));
    let modified = false;
    for (const key of Object.keys(obsolete)) {
      if (key.startsWith('andycungkrinx91.konoha-bridge')) {
        delete obsolete[key];
        modified = true;
      }
    }
    if (modified) fs.writeFileSync(obsoletePath, JSON.stringify(obsolete) + '\n');
  } catch { /* ignore */ }
}

function syncAntigravityExtensionRegistry(extensionDir) {
  if (!extensionDir || !fs.existsSync(extensionDir)) return { ok: false, reason: 'extension-dir-missing' };
  try {
    _cleanExtensionsJson(path.join(extensionDir, 'extensions.json'));
    _cleanObsoleteJson(path.join(extensionDir, '.obsolete'));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function deployAntigravityRtkRule(silent = true, options = {}) {
  const opts = typeof silent === 'object' && silent !== null ? silent : options;
  const isSilent = typeof silent === 'boolean' ? silent : (opts.silent !== false);
  const home = opts.home || process.env.HOME || process.env.USERPROFILE || HOME;
  const rtkCmd = getRtkCommand();
  if (rtkCmd) {
    try {
      spawnSync(rtkCmd, ['init', '--agent', 'antigravity', '--auto-patch', '--trust-filters'], { encoding: 'utf-8', timeout: 10000, stdio: isSilent ? 'ignore' : 'inherit', windowsHide: true });
    } catch { /* ignore */ }
  }
  const templateSrc = path.join(__dirname, 'templates', 'rules', 'rtk-rules.md');
  const src = fs.existsSync(templateSrc)
    ? templateSrc
    : path.join(__dirname, '..', '.agents', 'rules', 'rtk-rules.md');
  if (!fs.existsSync(src)) return { ok: false, reason: 'rtk-rule-template-missing' };

  const targets = [
    path.join(home, '.gemini', 'antigravity-cli', 'rules', 'rtk.md'),
    path.join(home, '.gemini', 'antigravity-ide', 'rules', 'rtk.md'),
    path.join(home, '.agents', 'rules', 'rtk-rules.md'),
    path.join(home, '.agents', 'rules', 'antigravity-rtk-rules.md')
  ];

  let deployed = 0;
  const errors = [];
  for (const dest of targets) {
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      deployed++;
    } catch (err) {
      // A silent failure here hides a broken client rule from every caller.
      errors.push({ dest, error: err && err.message ? err.message : String(err) });
    }
  }
  if (!isSilent && deployed > 0) process.stderr.write(`  ✓ Deployed RTK rule to ${deployed} Antigravity location(s)\n`);
  const result = { ok: deployed > 0, deployed };
  if (errors.length) result.errors = errors;
  return result;
}

function _updateAislopAuxiliarySchemas(aislopDir) {
  const files = {
    'aislop_scan.json': { desc: 'Scan project with aislop engines. Returns 0-100 score and top findings.', param: 'path', paramDesc: 'Project directory path.' },
    'aislop_fix.json': { desc: 'Apply mechanical fixes (formatting, unused/duplicate imports). Returns counts before/after.', param: 'path', paramDesc: 'Project directory path.' },
    'aislop_baseline.json': { desc: 'Read project baseline score. Returns score, lastScanAt, fileCount, or null.', param: 'path', paramDesc: 'Project directory path.' },
    'aislop_why.json': { desc: 'Explain an aislop rule, rationale, severity, and auto-fixability.', param: 'rule_id', paramDesc: 'Full rule ID.' }
  };
  try {
    for (const [fname, def] of Object.entries(files)) {
      const p = path.join(aislopDir, fname);
      if (!fs.existsSync(p)) continue;
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      data.description = def.desc;
      if (data.parameters?.properties?.[def.param]) data.parameters.properties[def.param].description = def.paramDesc;
      fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf8');
    }
  } catch { /* intentional best-effort fallback */ }
}

function _writeManifestAllSchemas(schemaDir) {
  const manifestPath = path.join(__dirname, 'mcp_tool_manifest.json');
  if (!fs.existsSync(manifestPath)) return;
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    for (const tool of (manifest.tools || [])) {
      if (!tool || !tool.name) continue;
      fs.writeFileSync(path.join(schemaDir, `${tool.name}.json`), JSON.stringify(tool, null, 2) + '\n', 'utf8');
    }
  } catch { /* intentional best-effort fallback */ }
}

const ANTIGRAVITY_SUBAGENTS = [
  { name: 'sannin', description: 'Sannin router agent. Resolves the task prompt, chooses the best subagent to run, and triggers it.', hasPrompt: true },
  { name: 'kage', description: 'Village Leader & Architect subagent. Focuses on architecture decisions, security audits, and critical problem solving.' },
  { name: 'jonin', description: 'UI & Frontend Specialist subagent. Focuses on UI components, SvelteKit, Next.js, and visual excellence.' },
  { name: 'anbu', description: 'Backend, DevOps & Bug Fixing subagent. Focuses on backend logic, APIs, databases, bug fixes, CI/CD, infrastructure deployment, and QA automation.' },
  { name: 'chunin', description: 'Intel & Research subagent. Focuses on web research, documentation lookup, compliance, and evidence synthesis.' },
  { name: 'tokubetsu_jonin', description: 'Technical Writer & Scribe subagent. Focuses on README, API specs, diagrams, specs, and documentation.' },
  { name: 'genin', description: 'Codebase Scout subagent. Focuses on read-only codebase navigation, symbol tracing, and dependency mapping.' },
  { name: 'akatsuki', description: 'Red-Team, Blue-Team & Security Final Gate subagent. Focuses on penetration testing, container isolation, and pre-delivery security audits.' },
  { name: 'yamanaka', description: 'Generative 3D & Spatial Subsystem Specialist subagent. Focuses on Three.js/Manifold geometry construction, Blender refinement, and 3D asset pipelines.' }
];

function ensureAntigravityMcpSchemas(options = {}) {
  const home = (options && options.home) || HOME;
  const schemaDir = path.join(home, ".gemini", "antigravity-cli", "mcp", "konoha");
  if (!fs.existsSync(schemaDir)) {
    fs.mkdirSync(schemaDir, { recursive: true });
  }

  for (const s of ANTIGRAVITY_SUBAGENTS) {
    const info = {
      name: s.name,
      description: s.description,
      parameters: {
        type: "object",
        properties: {
          ...(s.hasPrompt ? { prompt: { type: "string", description: "The task prompt directly passed from chat context or instructions." } } : {}),
          task: { type: "string", description: "Structured task payload for the subagent." },
          context: { type: "string", description: "Structured project/file context." },
          constraints: { type: "string", description: "Structured constraints." },
          skills: { type: "array", items: { type: "string" }, description: "Assigned skills." },
          project_path: { type: "string", description: "Absolute project workspace path." },
          task_dir: { type: "string", description: "Task workspace directory." }
        }
      }
    };
    fs.writeFileSync(path.join(schemaDir, `${s.name}.json`), JSON.stringify(info, null, 2) + "\n", "utf8");
  }

  _writeManifestAllSchemas(schemaDir);
  _updateAislopAuxiliarySchemas(path.join(home, ".gemini", "antigravity-cli", "mcp", "aislop"));
  return { ok: true, schemaDir };
}

function getAntigravityStatus() {
  const mcpConfigPath = path.join(HOME, '.gemini', 'config', 'mcp_config.json');
  const hooksPath = path.join(HOME, '.gemini', 'config', 'hooks.json');
  const schemaDir = path.join(HOME, '.gemini', 'antigravity-cli', 'mcp', 'konoha');

  let mcpConfigExists = fs.existsSync(mcpConfigPath), mcpSkillsDb = false, mcpAislop = false;
  if (mcpConfigExists) {
    try {
      const config = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
      if (config.mcpServers) {
        mcpSkillsDb = !!config.mcpServers.konoha;
        mcpAislop = !!config.mcpServers.aislop;
      }
    } catch { /* ignore */ }
  }

  let hasHooks = false;
  if (fs.existsSync(hooksPath)) {
    try {
      const content = fs.readFileSync(hooksPath, 'utf8');
      hasHooks = content.includes('antigravity_subagent_hook.js') || content.includes('antigravity_tool_sanitize_hook.js');
    } catch { /* ignore */ }
  }

  // Scan every directory the deployer writes to, so the doctor cannot report
  // zero agents just because it looked at a different target than the writer.
  let agentsCount = 0;
  const official = getCanonicalAgentNames();
  for (const dir of ANTIGRAVITY_AGENT_DIRS) {
    if (!fs.existsSync(dir)) continue;
    try {
      const found = fs.readdirSync(dir).filter(
        (f) => official.includes(f) && fs.existsSync(path.join(dir, f, 'agent.json'))
      ).length;
      if (found > agentsCount) agentsCount = found;
    } catch { /* ignore */ }
  }

  let schemasCount = 0;
  if (fs.existsSync(schemaDir)) {
    try {
      schemasCount = fs.readdirSync(schemaDir).filter(f => f.endsWith('.json')).length;
    } catch { /* ignore */ }
  }

  return { mcpConfigExists, mcpSkillsDb, mcpAislop, hasHooks, agentsCount, schemasCount, rtkInstalled: isRtkInstalled() };
}

function _loadAntigravitySettingsSafe(sPath) {
  if (!fs.existsSync(sPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(sPath, 'utf8')) || {};
  } catch {
    try {
      fs.copyFileSync(sPath, sPath + '.corrupt-' + Date.now());
      console.warn(`⚠ ${sPath} was invalid JSON — backed up to ${sPath}.corrupt-*`);
    } catch (_) { /* intentional best-effort fallback */ }
    return {};
  }
}

function _recordAntigravitySettingsOwnership(sPath, requiredGrants, safeAutoApprove, options = {}) {
  const backupMgr = require('./config_backup_manager');
  if (fs.existsSync(sPath)) {
    backupMgr.ensureBackupBeforeModify(sPath, { client: 'antigravity', scope: 'global', ...options });
  }
  backupMgr.recordOwnership(sPath, {
    client: 'antigravity',
    scope: 'global',
    format: 'json',
    ownedArrayItems: { 'permissions.allow': requiredGrants, autoApprove: safeAutoApprove }
  }, options);
}

function _appendMissingGrants(targetList, grants) {
  let added = false;
  for (const grant of grants) {
    if (!targetList.includes(grant)) {
      targetList.push(grant);
      added = true;
    }
  }
  return added;
}

function _syncKonohaServerNodeCommand(mcpServers) {
  if (!mcpServers || !mcpServers.konoha) return false;
  let modified = false;
  const srv = mcpServers.konoha;
  const nodeCmd = typeof resolveCompatibleNode === 'function' ? resolveCompatibleNode() : process.execPath;
  if (nodeCmd && srv.command !== nodeCmd) {
    srv.command = nodeCmd;
    modified = true;
  }
  if (_normalizeServerAutoApprove(srv, 'konoha')) modified = true;
  return modified;
}

function _updateSingleAntigravitySettings(sPath, requiredGrants, konohaToolGrants, options = {}) {
  try {
    const dir = path.dirname(sPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const settings = _loadAntigravitySettingsSafe(sPath);
    let modified = false;
    if (!settings.permissions) settings.permissions = {};
    const prevAllow = Array.isArray(settings.permissions.allow) ? settings.permissions.allow : [];
    const filteredAllow = prevAllow.filter(g =>
      typeof g !== 'string' || (!/^mcp\(konoha\/(?:delegate_to_|delegated_to_)/.test(g) && !g.includes('.konoha/tmp'))
    );
    if (filteredAllow.length !== prevAllow.length) modified = true;
    settings.permissions.allow = filteredAllow;
    if (_appendMissingGrants(settings.permissions.allow, requiredGrants)) modified = true;

    const kTools = KONOHA_CANONICAL_TOOLS || [];
    const safeAutoApprove = [
      ...konohaToolGrants,
      ...kTools.map(t => 'konoha/' + t), ...kTools.map(t => 'konoha:' + t), ...kTools,
      'mcp(aislop/aislop_scan)', 'mcp(aislop/aislop_fix)', 'mcp(aislop/aislop_why)', 'mcp(aislop/aislop_baseline)',
      'aislop/aislop_scan', 'aislop/aislop_fix', 'aislop/aislop_why', 'aislop/aislop_baseline',
      'aislop_scan', 'aislop_fix', 'aislop_why', 'aislop_baseline',
      'rtk', 'rtk *', 'konoha', 'konoha *'
    ];
    const prevAuto = Array.isArray(settings.autoApprove) ? settings.autoApprove : [];
    const filteredAuto = prevAuto.filter(g =>
      typeof g !== 'string' || (g !== '*' && !/^mcp\(konoha\/(?:delegate_to_|delegated_to_)/.test(g))
    );
    if (filteredAuto.length !== prevAuto.length) modified = true;
    settings.autoApprove = filteredAuto;
    if (_appendMissingGrants(settings.autoApprove, safeAutoApprove)) modified = true;
    if (_syncKonohaServerNodeCommand(settings.mcpServers)) modified = true;

    if (modified || !fs.existsSync(sPath)) {
      _recordAntigravitySettingsOwnership(sPath, requiredGrants, safeAutoApprove, options);
      fs.writeFileSync(sPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
      return true;
    }
  } catch (err) {
    if (err && /backup/i.test(err.message)) throw err;
  }
  return false;
}

function _normalizeServerAutoApprove(srv, serverName) {
  let modified = false;
  const canonical = serverName === 'konoha' ? [...(KONOHA_CANONICAL_TOOLS || [])]
    : ['aislop_scan', 'aislop_fix', 'aislop_why', 'aislop_baseline'];

  if (Array.isArray(srv.autoApprove)) {
    const starIdx = srv.autoApprove.indexOf('*');
    if (starIdx !== -1) { srv.autoApprove.splice(starIdx, 1); modified = true; }
  }
  if (!Array.isArray(srv.autoApprove) || srv.autoApprove.length === 0) {
    srv.autoApprove = canonical;
    modified = true;
  } else {
    for (const tool of canonical) {
      if (!srv.autoApprove.includes(tool)) {
        srv.autoApprove.push(tool);
        modified = true;
      }
    }
  }
  if (!srv.auto_approve) { srv.auto_approve = true; modified = true; }
  return modified;
}

function _updateSingleMcpConfigAutoApproves(mPath, options = {}) {
  if (!fs.existsSync(mPath)) return;
  try {
    const mConfig = JSON.parse(fs.readFileSync(mPath, 'utf8')) || {};
    if (!mConfig.mcpServers) return;
    let mModified = false;
    for (const serverName of ['konoha', 'aislop']) {
      const srv = mConfig.mcpServers[serverName];
      if (srv && _normalizeServerAutoApprove(srv, serverName)) mModified = true;
    }
    if (mModified) {
      const backupMgr = require('./config_backup_manager');
      backupMgr.ensureBackupBeforeModify(mPath, { client: 'antigravity', scope: 'global', ...options });
      fs.writeFileSync(mPath, JSON.stringify(mConfig, null, 2) + '\n', 'utf8');
    }
  } catch (err) {
    if (err && /backup/i.test(err.message)) throw err;
  }
}

function ensureAntigravityPermissions(silent = true, options = {}) {
  const opts = typeof silent === 'object' && silent !== null ? silent : options;
  const home = opts.home || process.env.HOME || process.env.USERPROFILE || HOME;
  try { fs.mkdirSync(path.join(home, '.konoha', 'tmp'), { recursive: true }); } catch (_) { /* ignore */ }
  const konohaToolGrants = (KONOHA_CANONICAL_TOOLS || []).map(t => 'mcp(konoha/' + t + ')');
  const requiredGrants = [
    'command(rtk)', 'command(rtk *)', 'command(rtk:*)', 'command(node bin/cli.js)', 'command(konoha)', 'command(konoha *)',
    'command(node "' + path.join(home, '.konoha', 'prompt_hook.js') + '")',
    'command("' + process.execPath + '" "' + path.join(home, '.konoha', 'prompt_hook.js') + '")',
    'command("' + process.execPath + '" "' + path.join(home, '.konoha', 'antigravity_subagent_hook.js') + '")',
    'command("' + process.execPath + '" "' + path.join(home, '.konoha', 'antigravity_tool_sanitize_hook.js') + '")',
    'mcp(aislop/aislop_scan)', 'mcp(aislop/aislop_fix)', 'mcp(aislop/aislop_why)', 'mcp(aislop/aislop_baseline)', 'mcp(aislop/*)',
    ...konohaToolGrants,
    'mcp(konoha/find_skills)', 'mcp(konoha/optimize_report)', 'mcp(konoha/build_with_image_design)',
    'mcp(skills-db/*)', 'mcp(konoha-files/*)', 'mcp(konoha/*)', 'mcp__konoha__*', 'mcp__aislop__*',
    'mcp:konoha:*', 'mcp:aislop:*', 'rtk', 'rtk *', 'konoha', 'konoha *'
  ];

  const settingsPaths = [
    path.join(home, '.gemini', 'antigravity-cli', 'settings.json'),
    path.join(home, '.gemini', 'antigravity-ide', 'settings.json'),
    path.join(home, '.gemini', 'config', 'settings.json'),
    path.join(home, '.gemini', 'settings.json')
  ];
  const legacyAgySettings = path.join(home, '.gemini', 'antigravity', 'settings.json');
  if (fs.existsSync(legacyAgySettings)) settingsPaths.push(legacyAgySettings);

  let updatedCount = 0;
  for (const sPath of settingsPaths) {
    if (_updateSingleAntigravitySettings(sPath, requiredGrants, konohaToolGrants, opts)) {
      updatedCount++;
    }
  }

  const mcpConfigPaths = [
    path.join(home, '.gemini', 'config', 'mcp_config.json'),
    path.join(home, '.gemini', 'antigravity-cli', 'mcp_config.json'),
    path.join(home, '.gemini', 'antigravity-ide', 'mcp_config.json')
  ];

  for (const mPath of mcpConfigPaths) {
    _updateSingleMcpConfigAutoApproves(mPath, opts);
  }

  if (!silent && updatedCount > 0) {
    process.stderr.write(`  ✓ Antigravity auto-approvals and permissions configured in ${updatedCount} settings file(s)\n`);
  }
  return { ok: true, updatedCount };
}

function _removeAntigravityMcpServers(mcpConfigPath, silent) {
  if (!fs.existsSync(mcpConfigPath)) return;
  try {
    const config = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
    if (!config?.mcpServers) return;
    let changed = false;
    for (const name of ['konoha', 'aislop', 'skills-db', 'semble']) {
      if (config.mcpServers[name]) {
        delete config.mcpServers[name];
        changed = true;
      }
    }
    if (changed) {
      fs.writeFileSync(mcpConfigPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
      if (!silent) process.stderr.write('✓ Removed Konoha MCP servers from ~/.gemini/config/mcp_config.json\n');
    }
  } catch { /* intentional best-effort fallback */ }
}

function removeAntigravityConfig(silent = true, options = {}) {
  const home = options.home || process.env.HOME || os.homedir();
  const mcpConfigPath = options.configPath || path.join(home, '.gemini', 'config', 'mcp_config.json');
  _removeAntigravityMcpServers(mcpConfigPath, silent);
  removeAntigravityAgents({ home });
  return { ok: true };
}

function _writeTargetAntigravityMcp(mcpConfigPath, isPrimary, servers, options = {}) {
  const dir = path.dirname(mcpConfigPath);
  if (!fs.existsSync(dir)) {
    if (isPrimary) fs.mkdirSync(dir, { recursive: true });
    else return;
  }
  const backupMgr = require('./config_backup_manager');
  let config = { mcpServers: {} };
  if (fs.existsSync(mcpConfigPath)) {
    backupMgr.ensureBackupBeforeModify(mcpConfigPath, { client: 'antigravity', scope: 'global', ...options });
    try {
      config = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8')) || {};
      if (!config.mcpServers) config.mcpServers = {};
    } catch { return; }
  }
  Object.assign(config.mcpServers, servers);
  fs.writeFileSync(mcpConfigPath, JSON.stringify(config, null, 2) + '\n');
  try {
    backupMgr.recordOwnership(mcpConfigPath, {
      client: 'antigravity',
      scope: 'global',
      format: 'json',
      ownedKeys: Object.keys(servers).map(k => `mcpServers.${k}`)
    }, options);
  } catch (_) { /* best-effort */ }
}

function _appendAntigravityProjectConfigs(options, agents, home) {
  const projectRoot = options.projectRoot || null;
  if (!projectRoot || !fs.existsSync(projectRoot) || path.resolve(projectRoot) === path.resolve(home)) return;
  const projSettings = path.join(projectRoot, '.gemini', 'settings.json');
  const projGeminiMd = path.join(projectRoot, 'GEMINI.md');
  const hasExisting = fs.existsSync(projSettings) || fs.existsSync(projGeminiMd);
  if (!options.appendProject && !(options.deployProject && hasExisting)) return;

  const konohaToolGrants = (KONOHA_CANONICAL_TOOLS || []).map(t => 'mcp(konoha/' + t + ')');
  if (options.appendProject || fs.existsSync(projSettings)) {
    _updateSingleAntigravitySettings(projSettings, ['command(rtk)', 'command(konoha)', ...konohaToolGrants], konohaToolGrants);
  }
  if (options.appendProject || fs.existsSync(projGeminiMd)) {
    const { generateGeminiMd, injectManagedConfig } = require('./agent_manager');
    fs.writeFileSync(
      projGeminiMd,
      injectManagedConfig(projGeminiMd, generateGeminiMd(agents), 'KONOHA', { client: 'antigravity', scope: 'project' }),
      'utf8'
    );
  }
}

function ensureAntigravitySetup(options = {}) {
  const { silent = true } = options;
  const home = options.home || process.env.HOME || os.homedir();
  const targetPaths = [
    options.configPath || path.join(home, '.gemini', 'config', 'mcp_config.json'),
    path.join(home, '.gemini', 'antigravity-ide', 'mcp_config.json'),
    path.join(home, '.gemini', 'antigravity', 'mcp_config.json')
  ];

  const { buildStdioMcpServers } = require('./mcp_clients_manager');
  const servers = buildStdioMcpServers({ client: 'antigravity' });

  targetPaths.forEach((mcpConfigPath, idx) => {
    _writeTargetAntigravityMcp(mcpConfigPath, idx === 0, servers, options);
  });

  ensureAntigravityPermissions(silent, options);
  ensureAntigravityMcpSchemas(options);
  deployAntigravityRtkRule(silent, options);

  try {
    const { loadAgents, generateGeminiMd, generateAgentsMd, injectManagedConfig } = require("./agent_manager");
    const agents = loadAgents();
    const geminiMd = path.join(home, ".gemini", "GEMINI.md");
    const agentsMd = path.join(home, ".agents", "AGENTS.md");
    const geminiConfigMd = path.join(home, ".gemini", "config", "GEMINI.md");
    const geminiConfigAgentsMd = path.join(home, ".gemini", "config", "AGENTS.md");
    fs.mkdirSync(path.dirname(geminiMd), { recursive: true });
    fs.writeFileSync(geminiMd, injectManagedConfig(geminiMd, generateGeminiMd(agents), 'KONOHA', { client: 'antigravity', scope: 'global', ...options }), "utf8");
    fs.mkdirSync(path.dirname(agentsMd), { recursive: true });
    fs.writeFileSync(agentsMd, injectManagedConfig(agentsMd, generateAgentsMd(agents), 'KONOHA', { client: 'antigravity', scope: 'global', ...options }), "utf8");
    if (fs.existsSync(geminiConfigMd)) {
      fs.writeFileSync(geminiConfigMd, injectManagedConfig(geminiConfigMd, generateGeminiMd(agents), 'KONOHA', { client: 'antigravity', scope: 'global', ...options }), "utf8");
    }
    if (fs.existsSync(geminiConfigAgentsMd)) {
      fs.writeFileSync(geminiConfigAgentsMd, injectManagedConfig(geminiConfigAgentsMd, generateAgentsMd(agents), 'KONOHA', { client: 'antigravity', scope: 'global', ...options }), "utf8");
    }
    ensureAntigravityAgents(agents, options);
    _appendAntigravityProjectConfigs(options, agents, home);
  } catch (err) {
    if (err && /backup/i.test(err.message)) throw err;
  }

  return { ok: true };
}

module.exports = {
  detectAntigravityIde,
  ANTIGRAVITY_AGENTS_GLOBAL,
  buildAgentJson,
  buildDefineSubagentArgs,
  ensureAntigravityAgents,
  ensureAntigravityMcpSchemas,
  ensureAntigravityPermissions,
  isRtkInstalled,
  ensureRtkInstalled,
  refreshRtk,
  deployAntigravityRtkRule,
  syncAntigravityExtensionRegistry,
  getAntigravityStatus,
  removeAntigravityAgents,
  removeAntigravityConfig,
  ensureAntigravitySetup,
};
