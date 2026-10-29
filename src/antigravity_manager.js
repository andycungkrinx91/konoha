const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

// Self-contained: derive paths from HOME rather than importing bin/lib/paths.
const { buildSubagentContract } = require('./agent_contract');
const { getRtkCommand, isRtkInstalled } = require('./platform_utils');
const { ensureRtkInstalled, refreshRtk } = require('./rtk_installer');
const { KONOHA_CANONICAL_TOOLS } = require('./deploy_utils');

const HOME = process.env.HOME || process.env.USERPROFILE || os.homedir();
const ANTIGRAVITY_AGENTS_GLOBAL = path.join(HOME, '.gemini', 'antigravity-cli', 'agents');
const ANTIGRAVITY_CLI_GLOBAL = path.join(HOME, '.gemini', 'antigravity-cli');
const ANTIGRAVITY_IDE_GLOBAL = path.join(HOME, '.gemini', 'antigravity-ide');

function detectAntigravityIde(options = {}) {
  const env = options.env || process.env;
  const home = options.home || HOME;
  const exists = options.fileExists || fs.existsSync;
  const commandAvailable = options.commandAvailable || ((command) => {
    const probe = process.platform === 'win32' ? 'where' : 'which';
    try {
      return spawnSync(probe, [command], { encoding: 'utf8', shell: process.platform === 'win32', windowsHide: true }).status === 0;
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

const BASE_TOOLS = [
  'send_message', 'find_by_name', 'grep_search', 'view_file', 'list_dir',
  'read_url_content', 'search_web', 'schedule', 'call_mcp_tool'
];

const WRITE_TOOLS = [
  'multi_replace_file_content', 'replace_file_content', 'write_to_file',
  'run_command', 'manage_task'
];

const SYSTEM_PROMPT_SECTIONS = [
  'user_information', 'mcp_servers', 'skills', 'subagent_reminder',
  'messaging', 'artifacts', 'user_rules'
];

function agentAllowsWriteTools(agent) {
  return !/read-only/i.test(agent.constraints || '');
}

function processAgentInstructions(agent) {
  let instructions = agent.instructions || '';
  // Strip any existing Before work: find_skill(...) checklist calls
  instructions = instructions.replace(/\bBefore work:\s*find_skill\([^)]*\)(?:\.\s*find_skill\([^)]*\))*\.?\s*/gi, '');

  if (agent.skills && agent.skills.length > 0) {
    const findSkillCalls = agent.skills.map(s => `find_skill("${s}", agent='${agent.name}')`).join('. ') + '.';
    const getSkillCalls = agent.skills.map(s => `get_skill("${s}", agent='${agent.name}')`).join('. ') + '.';
    const loadingInstruction = `After discovery, load the full skill content with ${getSkillCalls}`;
    const logPattern = /Log:\s*(['"])(.*?)\1\.\s*/i;
    const logMatch = instructions.match(logPattern);
    if (logMatch) {
      const insertIndex = logMatch.index + logMatch[0].length;
      instructions = instructions.slice(0, insertIndex) + `Before work: ${findSkillCalls} ${loadingInstruction} ` + instructions.slice(insertIndex);
    } else {
      instructions = `Before work: ${findSkillCalls} ${loadingInstruction} ` + instructions;
    }
  }
  return `${instructions}\n\n${buildSubagentContract('antigravity')}`;
}

function buildAgentJson(agent) {
  const tools = agentAllowsWriteTools(agent)
    ? [...BASE_TOOLS, ...WRITE_TOOLS]
    : [...BASE_TOOLS];

  const processedInstructions = processAgentInstructions(agent);

  const customAgent = {
    systemPromptSections: [
      {
        title: 'Agent System Instructions',
        content: processedInstructions,
      },
    ],
    toolNames: tools,
    systemPromptConfig: {
      includeSections: SYSTEM_PROMPT_SECTIONS,
    },
  };
  if (agent.model) {
    customAgent.model = agent.model;
  }

  return {
    name: agent.name,
    description: agent.description,
    config: {
      customAgent,
    },
  };
}

function validateAgentName(name) {
  if (typeof name !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(name)) {
    return false;
  }
  return true;
}

function _pruneStaleAgentDirs(resolvedBaseDir, agentNames) {
  if (!fs.existsSync(resolvedBaseDir)) return;
  try {
    const existingDirs = fs.readdirSync(resolvedBaseDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);
    for (const dirName of existingDirs) {
      if (!validateAgentName(dirName) || agentNames.has(dirName)) continue;
      const staleDir = path.resolve(resolvedBaseDir, dirName);
      if (staleDir.startsWith(resolvedBaseDir + path.sep)) {
        fs.rmSync(staleDir, { recursive: true, force: true });
      }
    }
  } catch (_) { /* intentional best-effort fallback */ }
}

function _writeSingleAgentJson(resolvedBaseDir, agent) {
  if (!agent || !validateAgentName(agent.name)) return 0;
  const agentDir = path.resolve(resolvedBaseDir, agent.name);
  if (!agentDir.startsWith(resolvedBaseDir + path.sep)) return 0;
  const agentPath = path.join(agentDir, 'agent.json');
  try {
    fs.mkdirSync(agentDir, { recursive: true });
    const payload = JSON.stringify(buildAgentJson(agent), null, 2) + '\n';
    const existing = fs.existsSync(agentPath) ? fs.readFileSync(agentPath, 'utf8') : null;
    if (existing !== payload) {
      fs.writeFileSync(agentPath, payload, 'utf8');
      return 1;
    }
  } catch (_) { /* intentional best-effort fallback */ }
  return 0;
}

function deployAgentsToDir(agents, baseDir) {
  if (!agents || agents.length === 0) return { deployed: 0, dir: baseDir };
  const resolvedBaseDir = path.resolve(baseDir);
  _pruneStaleAgentDirs(resolvedBaseDir, new Set(agents.map(a => a.name)));

  let deployed = 0;
  for (const agent of agents) {
    deployed += _writeSingleAgentJson(resolvedBaseDir, agent);
  }
  return { deployed, dir: resolvedBaseDir };
}

function ensureAntigravityAgents(agents, options = {}) {
  const home = options.home || HOME;
  const globalTarget = options.home ? path.join(home, ".gemini", "config", "agents") : ANTIGRAVITY_AGENTS_GLOBAL;
  const cliTarget = options.home ? path.join(home, ".gemini", "antigravity-cli", "agents") : path.join(ANTIGRAVITY_CLI_GLOBAL, "agents");
  const ideTarget = options.home ? path.join(home, ".gemini", "antigravity-ide", "agents") : path.join(ANTIGRAVITY_IDE_GLOBAL, "agents");
  const globalResult = deployAgentsToDir(agents, globalTarget);
  deployAgentsToDir(agents, cliTarget);
  deployAgentsToDir(agents, ideTarget);

  let projectResult = null;
  if (options.projectDir) {
    const projectAgentsDir = path.join(options.projectDir, '.agents', 'agents');
    projectResult = deployAgentsToDir(agents, projectAgentsDir);
  }

  return { global: globalResult, project: projectResult };
}

function buildDefineSubagentArgs(agent) {
  const processedInstructions = processAgentInstructions(agent);
  return {
    name: agent.name,
    description: agent.description,
    system_prompt: processedInstructions,
    enable_mcp_tools: true,
    enable_write_tools: agentAllowsWriteTools(agent),
    enable_subagent_tools: false,
  };
}

function _removeSingleAgentDir(resolvedBase, name) {
  if (!validateAgentName(name)) return;
  const agentDir = path.resolve(resolvedBase, name);
  if (!agentDir.startsWith(resolvedBase + path.sep) || !fs.existsSync(agentDir)) return;
  try {
    fs.rmSync(agentDir, { recursive: true, force: true });
  } catch { /* intentional best-effort fallback */ }
}

function removeAntigravityAgents(options = {}) {
  const home = options.home || process.env.HOME || os.homedir();
  const official = ['genin', 'kage', 'chunin', 'jonin', 'anbu', 'tokubetsu-jonin', 'sannin', 'akatsuki'];
  const dirs = [
    path.join(home, '.gemini', 'antigravity-cli', 'agents'),
    path.join(home, '.gemini', 'antigravity-ide', 'agents')
  ];

  for (const baseDir of dirs) {
    const resolvedBase = path.resolve(baseDir);
    for (const name of official) {
      _removeSingleAgentDir(resolvedBase, name);
    }
  }
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
  for (const dest of targets) {
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      deployed++;
    } catch (_) { /* ignore */ }
  }
  if (!isSilent && deployed > 0) process.stderr.write(`  ✓ Deployed RTK rule to ${deployed} Antigravity location(s)\n`);
  return { ok: deployed > 0, deployed };
}

function _updateSembleAuxiliarySchemas(sembleDir) {
  const searchJson = path.join(sembleDir, 'search.json');
  const findRelatedJson = path.join(sembleDir, 'find_related.json');
  if (!fs.existsSync(searchJson) || !fs.existsSync(findRelatedJson)) return;
  try {
    const s1 = JSON.parse(fs.readFileSync(searchJson, 'utf8'));
    const s2 = JSON.parse(fs.readFileSync(findRelatedJson, 'utf8'));
    s1.description = 'Search codebase with focused query. Returns file paths and line numbers. Pass local path or git URL as repo.';
    if (s1.parameters?.properties?.max_snippet_lines) s1.parameters.properties.max_snippet_lines.description = 'Lines of source to include per result (default: 10, 0: location only).';
    if (s1.parameters?.properties?.repo) s1.parameters.properties.repo.description = 'Local directory path or git URL to index and search.';
    fs.writeFileSync(searchJson, JSON.stringify(s1, null, 2) + '\n', 'utf8');

    s2.description = 'Find code similar to a known location. Pass file_path and line from prior search result.';
    if (s2.parameters?.properties?.max_snippet_lines) s2.parameters.properties.max_snippet_lines.description = 'Lines of source per result (default: 10, 0: location only).';
    if (s2.parameters?.properties?.repo) s2.parameters.properties.repo.description = 'Local directory path or git URL to index and search.';
    fs.writeFileSync(findRelatedJson, JSON.stringify(s2, null, 2) + '\n', 'utf8');
  } catch { /* intentional best-effort fallback */ }
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

function _writeManifestFindSkillsSchema(schemaDir) {
  const manifestPath = path.join(__dirname, 'mcp_tool_manifest.json');
  if (!fs.existsSync(manifestPath)) return;
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    for (const tool of (manifest.tools || [])) {
      if (tool.name === 'find_skills') {
        fs.writeFileSync(path.join(schemaDir, 'find_skills.json'), JSON.stringify(tool, null, 2) + '\n', 'utf8');
      }
    }
  } catch { /* intentional best-effort fallback */ }
}

const ANTIGRAVITY_SUBAGENTS = [
  { name: 'sannin', description: 'Sannin router agent. Resolves the task prompt, chooses the best subagent to run, and triggers it.', hasPrompt: true },
  { name: 'kage', description: 'Village Leader & Architect subagent. Focuses on architecture decisions, security audits, and critical problem solving.' },
  { name: 'jonin', description: 'UI & Frontend Specialist subagent. Focuses on UI components, SvelteKit, Next.js, and visual excellence.' },
  { name: 'anbu', description: 'Backend Specialist & Cyber Black Ops subagent. Focuses on backend logic, bug fixes, CI/CD, infra, cyber defense, and dev/local penetration testing.' },
  { name: 'chunin', description: 'Intel & Research subagent. Focuses on web research, documentation lookup, compliance, and evidence synthesis.' },
  { name: 'tokubetsu_jonin', description: 'Technical Writer & Scribe subagent. Focuses on README, API specs, diagrams, specs, and documentation.' },
  { name: 'genin', description: 'Codebase Scout subagent. Focuses on read-only codebase navigation, symbol tracing, and dependency mapping.' },
  { name: 'akatsuki', description: 'Red-Team, Blue-Team & Security Final Gate subagent. Focuses on penetration testing, container isolation, and pre-delivery security audits.' }
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
          task_dir: { type: "string", description: "Task workspace directory." }
        }
      }
    };
    fs.writeFileSync(path.join(schemaDir, `${s.name}.json`), JSON.stringify(info, null, 2) + "\n", "utf8");
  }

  _writeManifestFindSkillsSchema(schemaDir);
  _updateSembleAuxiliarySchemas(path.join(home, ".gemini", "antigravity-cli", "mcp", "semble"));
  _updateAislopAuxiliarySchemas(path.join(home, ".gemini", "antigravity-cli", "mcp", "aislop"));
}

function getAntigravityStatus() {
  const mcpConfigPath = path.join(HOME, '.gemini', 'config', 'mcp_config.json');
  const hooksPath = path.join(HOME, '.gemini', 'config', 'hooks.json');
  const schemaDir = path.join(HOME, '.gemini', 'antigravity-cli', 'mcp', 'konoha');

  let mcpConfigExists = fs.existsSync(mcpConfigPath), mcpSkillsDb = false, mcpSemble = false, mcpAislop = false;
  if (mcpConfigExists) {
    try {
      const config = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
      if (config.mcpServers) {
        mcpSkillsDb = !!config.mcpServers.konoha;
        mcpSemble = !!config.mcpServers.semble;
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

  let agentsCount = 0;
  const official = ['genin', 'kage', 'chunin', 'jonin', 'anbu', 'tokubetsu-jonin', 'sannin', 'akatsuki'];
  if (fs.existsSync(ANTIGRAVITY_AGENTS_GLOBAL)) {
    try {
      agentsCount = fs.readdirSync(ANTIGRAVITY_AGENTS_GLOBAL).filter(f =>
        official.includes(f) && fs.existsSync(path.join(ANTIGRAVITY_AGENTS_GLOBAL, f, 'agent.json'))
      ).length;
    } catch { /* ignore */ }
  }

  let schemasCount = 0;
  if (fs.existsSync(schemaDir)) {
    try {
      schemasCount = fs.readdirSync(schemaDir).filter(f => f.endsWith('.json')).length;
    } catch { /* ignore */ }
  }

  return { mcpConfigExists, mcpSkillsDb, mcpSemble, mcpAislop, hasHooks, agentsCount, schemasCount, rtkInstalled: isRtkInstalled() };
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

function _updateSingleAntigravitySettings(sPath, requiredGrants, konohaToolGrants) {
  try {
    const dir = path.dirname(sPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const settings = _loadAntigravitySettingsSafe(sPath);
    let modified = false;
    if (!settings.permissions) settings.permissions = {};
    const prevAllow = Array.isArray(settings.permissions.allow) ? settings.permissions.allow : [];
    const filteredAllow = prevAllow.filter(g =>
      typeof g !== 'string' || !/^mcp\(konoha\/(?:delegate_to_|delegated_to_)/.test(g)
    );
    if (filteredAllow.length !== prevAllow.length) modified = true;
    settings.permissions.allow = filteredAllow;
    for (const grant of requiredGrants) {
      if (!settings.permissions.allow.includes(grant)) {
        settings.permissions.allow.push(grant);
        modified = true;
      }
    }

    const kTools = KONOHA_CANONICAL_TOOLS || [];
    const safeAutoApprove = [
      ...konohaToolGrants,
      ...kTools.map(t => 'konoha/' + t), ...kTools.map(t => 'konoha:' + t), ...kTools,
      'mcp(semble/search)', 'mcp(semble/find_related)', 'semble/search', 'semble/find_related', 'search', 'find_related',
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
    for (const grant of safeAutoApprove) {
      if (!settings.autoApprove.includes(grant)) {
        settings.autoApprove.push(grant);
        modified = true;
      }
    }
    if (settings.permissionMode === 'allowAll') { delete settings.permissionMode; modified = true; }
    if (settings.confirmDangerousCommands === false) { delete settings.confirmDangerousCommands; modified = true; }

    if (modified || !fs.existsSync(sPath)) {
      fs.writeFileSync(sPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
      return true;
    }
  } catch { /* intentional best-effort fallback */ }
  return false;
}

function _normalizeServerAutoApprove(srv, serverName) {
  let modified = false;
  const canonical = serverName === 'konoha' ? [...(KONOHA_CANONICAL_TOOLS || [])]
    : (serverName === 'semble' ? ['search', 'find_related'] : ['aislop_scan', 'aislop_fix', 'aislop_why', 'aislop_baseline']);

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

function _updateSingleMcpConfigAutoApproves(mPath) {
  if (!fs.existsSync(mPath)) return;
  try {
    const mConfig = JSON.parse(fs.readFileSync(mPath, 'utf8')) || {};
    if (!mConfig.mcpServers) return;
    let mModified = false;
    for (const serverName of ['konoha', 'semble', 'aislop']) {
      const srv = mConfig.mcpServers[serverName];
      if (srv && _normalizeServerAutoApprove(srv, serverName)) mModified = true;
    }
    if (mModified) fs.writeFileSync(mPath, JSON.stringify(mConfig, null, 2) + '\n', 'utf8');
  } catch { /* intentional best-effort fallback */ }
}

function ensureAntigravityPermissions(silent = true, options = {}) {
  const opts = typeof silent === 'object' && silent !== null ? silent : options;
  const home = opts.home || process.env.HOME || process.env.USERPROFILE || HOME;
  const konohaToolGrants = (KONOHA_CANONICAL_TOOLS || []).map(t => 'mcp(konoha/' + t + ')');
  const requiredGrants = [
    'command(rtk)', 'command(rtk *)', 'command(rtk:*)', 'command(node bin/cli.js)', 'command(konoha)', 'command(konoha *)',
    'command(node "' + path.join(home, '.konoha', 'prompt_hook.js') + '")',
    'command("' + process.execPath + '" "' + path.join(home, '.konoha', 'prompt_hook.js') + '")',
    'command("' + process.execPath + '" "' + path.join(home, '.konoha', 'antigravity_subagent_hook.js') + '")',
    'command("' + process.execPath + '" "' + path.join(home, '.konoha', 'antigravity_tool_sanitize_hook.js') + '")',
    'mcp(semble/search)', 'mcp(semble/find_related)', 'mcp(semble/*)',
    'mcp(aislop/aislop_scan)', 'mcp(aislop/aislop_fix)', 'mcp(aislop/aislop_why)', 'mcp(aislop/aislop_baseline)', 'mcp(aislop/*)',
    ...konohaToolGrants,
    'mcp(konoha/find_skills)', 'mcp(konoha/optimize_report)', 'mcp(konoha/build_with_image_design)',
    'mcp(skills-db/*)', 'mcp(konoha-files/*)', 'mcp(konoha/*)', 'mcp__konoha__*', 'mcp__semble__*', 'mcp__aislop__*',
    'mcp:konoha:*', 'mcp:semble:*', 'mcp:aislop:*', 'rtk', 'rtk *', 'konoha', 'konoha *'
  ];

  const settingsPaths = [
    path.join(home, '.gemini', 'antigravity-cli', 'settings.json'),
    path.join(home, '.gemini', 'antigravity-ide', 'settings.json'),
    path.join(home, '.gemini', 'config', 'settings.json'),
    path.join(home, '.gemini', 'settings.json')
  ];

  let updatedCount = 0;
  for (const sPath of settingsPaths) {
    if (_updateSingleAntigravitySettings(sPath, requiredGrants, konohaToolGrants)) {
      updatedCount++;
    }
  }

  const mcpConfigPaths = [
    path.join(home, '.gemini', 'config', 'mcp_config.json'),
    path.join(home, '.gemini', 'antigravity-cli', 'mcp_config.json'),
    path.join(home, '.gemini', 'antigravity-ide', 'mcp_config.json')
  ];

  for (const mPath of mcpConfigPaths) {
    _updateSingleMcpConfigAutoApproves(mPath);
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
    for (const name of ['konoha', 'semble', 'aislop', 'skills-db']) {
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

function _writeTargetAntigravityMcp(mcpConfigPath, isPrimary, servers) {
  const dir = path.dirname(mcpConfigPath);
  if (!fs.existsSync(dir)) {
    if (isPrimary) fs.mkdirSync(dir, { recursive: true });
    else return;
  }
  let config = { mcpServers: {} };
  if (fs.existsSync(mcpConfigPath)) {
    try {
      config = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8')) || {};
      if (!config.mcpServers) config.mcpServers = {};
    } catch { config = { mcpServers: {} }; }
  }
  Object.assign(config.mcpServers, servers);
  fs.writeFileSync(mcpConfigPath, JSON.stringify(config, null, 2) + '\n');
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
    _writeTargetAntigravityMcp(mcpConfigPath, idx === 0, servers);
  });

  ensureAntigravityPermissions(silent, options);
  ensureAntigravityMcpSchemas(options);
  deployAntigravityRtkRule(silent, options);

  try {
    const { loadAgents, generateGeminiMd, generateAgentsMd } = require("./agent_manager");
    const agents = loadAgents();
    const geminiMd = path.join(home, ".gemini", "GEMINI.md");
    const agentsMd = path.join(home, ".agents", "AGENTS.md");
    fs.mkdirSync(path.dirname(geminiMd), { recursive: true });
    fs.writeFileSync(geminiMd, generateGeminiMd(agents), "utf8");
    fs.mkdirSync(path.dirname(agentsMd), { recursive: true });
    fs.writeFileSync(agentsMd, generateAgentsMd(agents), "utf8");
  } catch (_) { /* best-effort */ }

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
