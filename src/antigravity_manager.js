const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

// Self-contained: derive paths from HOME rather than importing bin/lib/paths.
const { buildSubagentContract } = require('./agent_contract');
const { getRtkCommand, isRtkInstalled } = require('./platform_utils');

const HOME = os.homedir();
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
      return spawnSync(probe, [command], { encoding: 'utf8', shell: process.platform === 'win32' }).status === 0;
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
  'send_message',
  'find_by_name',
  'grep_search',
  'view_file',
  'list_dir',
  'read_url_content',
  'search_web',
  'schedule',
  'call_mcp_tool',
];

const WRITE_TOOLS = [
  'multi_replace_file_content',
  'replace_file_content',
  'write_to_file',
  'run_command',
  'manage_task',
];

const SYSTEM_PROMPT_SECTIONS = [
  'user_information',
  'mcp_servers',
  'skills',
  'subagent_reminder',
  'messaging',
  'artifacts',
  'user_rules',
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

  return {
    name: agent.name,
    description: agent.description,
    config: {
      customAgent: {
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
      },
    },
  };
}

function deployAgentsToDir(agents, baseDir) {
  if (!agents || agents.length === 0) return { deployed: 0, dir: baseDir };

  // Sync directory: delete any subdirectory that does not match an agent name
  try {
    if (fs.existsSync(baseDir)) {
      const existingDirs = fs.readdirSync(baseDir, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name);
      const agentNames = new Set(agents.map(a => a.name));
      for (const dirName of existingDirs) {
        if (!agentNames.has(dirName)) {
          const staleDir = path.join(baseDir, dirName);
          fs.rmSync(staleDir, { recursive: true, force: true });
        }
      }
    }
  } catch (err) {}

  let deployed = 0;
  for (const agent of agents) {
    const agentDir = path.join(baseDir, agent.name);
    const agentPath = path.join(agentDir, 'agent.json');
    try {
      fs.mkdirSync(agentDir, { recursive: true });
      const payload = JSON.stringify(buildAgentJson(agent), null, 2) + '\n';
      const existing = fs.existsSync(agentPath) ? fs.readFileSync(agentPath, 'utf8') : null;
      if (existing !== payload) {
        fs.writeFileSync(agentPath, payload, 'utf8');
        deployed += 1;
      }
    } catch (err) {}
  }
  return { deployed, dir: baseDir };
}

function ensureAntigravityAgents(agents, options = {}) {
  const globalResult = deployAgentsToDir(agents, ANTIGRAVITY_AGENTS_GLOBAL);

  deployAgentsToDir(agents, path.join(ANTIGRAVITY_CLI_GLOBAL, 'agents'));
  deployAgentsToDir(agents, path.join(ANTIGRAVITY_IDE_GLOBAL, 'agents'));

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

function removeAntigravityAgents() {
  const official = ['genin', 'kage', 'chunin', 'jonin', 'anbu', 'tokubetsu-jonin', 'sannin'];
  const dirs = [
    ANTIGRAVITY_AGENTS_GLOBAL,
    path.join(ANTIGRAVITY_CLI_GLOBAL, 'agents'),
    path.join(ANTIGRAVITY_IDE_GLOBAL, 'agents')
  ];

  for (const baseDir of dirs) {
    for (const name of official) {
      const agentDir = path.join(baseDir, name);
      if (fs.existsSync(agentDir)) {
        try {
          fs.rmSync(agentDir, { recursive: true, force: true });
        } catch {}
      }
    }
  }
}

function syncAntigravityExtensionRegistry(extensionDir, targetDirName, pkg) {
  if (!extensionDir || !fs.existsSync(extensionDir)) return { ok: false, reason: 'extension-dir-missing' };
  try {
    const extJsonPath = path.join(extensionDir, 'extensions.json');
    if (fs.existsSync(extJsonPath)) {
      let entries = [];
      try {
        entries = JSON.parse(fs.readFileSync(extJsonPath, 'utf8'));
      } catch {}
      if (Array.isArray(entries)) {
        entries = entries.filter(e => {
          const id = e?.identifier?.id?.toLowerCase();
          const rel = e?.relativeLocation || '';
          if (id === 'andycungkrinx91.konoha-bridge' || rel.startsWith('andycungkrinx91.konoha-bridge-')) {
            return rel === targetDirName;
          }
          return true;
        });

        const targetPath = path.join(extensionDir, targetDirName);
        const existing = entries.find(e => e?.relativeLocation === targetDirName || e?.identifier?.id?.toLowerCase() === 'andycungkrinx91.konoha-bridge');
        if (existing) {
          existing.identifier = { id: 'andycungkrinx91.konoha-bridge' };
          existing.version = pkg?.version || '1.4.0';
          existing.location = {
            $mid: 1,
            fsPath: targetPath,
            path: targetPath,
            scheme: 'file'
          };
          existing.relativeLocation = targetDirName;
        } else {
          entries.push({
            identifier: { id: 'andycungkrinx91.konoha-bridge' },
            version: pkg?.version || '1.4.0',
            location: {
              $mid: 1,
              fsPath: targetPath,
              path: targetPath,
              scheme: 'file'
            },
            relativeLocation: targetDirName,
            metadata: {
              isApplicationScoped: false,
              isMachineScoped: false,
              isBuiltin: false,
              installedTimestamp: Date.now(),
              pinned: false,
              source: 'custom',
              publisherDisplayName: 'andycungkrinx91',
              targetPlatform: 'universal',
              updated: true,
              private: false,
              isPreReleaseVersion: false,
              hasPreReleaseVersion: false,
              preRelease: false
            }
          });
        }
        fs.writeFileSync(extJsonPath, JSON.stringify(entries, null, 2) + '\n');
      }
    }

    const obsoletePath = path.join(extensionDir, '.obsolete');
    if (fs.existsSync(obsoletePath)) {
      try {
        const obsolete = JSON.parse(fs.readFileSync(obsoletePath, 'utf8'));
        let modified = false;
        for (const key of Object.keys(obsolete)) {
          if (key.startsWith('andycungkrinx91.konoha-bridge')) {
            delete obsolete[key];
            modified = true;
          }
        }
        if (modified) {
          fs.writeFileSync(obsoletePath, JSON.stringify(obsolete) + '\n');
        }
      } catch {}
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function deployAntigravityRtkRule(silent = true) {
  const rtkCmd = getRtkCommand();
  if (!rtkCmd) {
    return { ok: false, reason: 'rtk-not-installed' };
  }
  try {
    spawnSync(rtkCmd, ['init', '--agent', 'antigravity', '--auto-patch', '--trust-filters'], {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: silent ? 'ignore' : 'inherit'
    });
  } catch {}
  const src = path.join(__dirname, '..', '.agents', 'rules', 'rtk-rules.md');
  if (!fs.existsSync(src)) {
    return { ok: false, reason: 'rtk-rule-template-missing' };
  }

  const targets = [
    path.join(HOME, '.gemini', 'antigravity-cli', 'rules', 'rtk.md'),
    path.join(HOME, '.gemini', 'antigravity-ide', 'rules', 'rtk.md'),
    path.join(HOME, '.agents', 'rules', 'rtk-rules.md'),
    path.join(HOME, '.agents', 'rules', 'antigravity-rtk-rules.md')
  ];

  let deployed = 0;
  for (const dest of targets) {
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      deployed++;
    } catch (e) {
      // ignore
    }
  }

  if (!silent && deployed > 0) {
    console.log(`  ✓ Deployed RTK rule to ${deployed} Antigravity location(s)`);
  }

  return { ok: deployed > 0, deployed };
}

function ensureAntigravityMcpSchemas(agents) {
  const schemaDir = path.join(HOME, '.gemini', 'antigravity-cli', 'mcp', 'konoha');
  if (!fs.existsSync(schemaDir)) {
    fs.mkdirSync(schemaDir, { recursive: true });
  }

  const subagentsInfo = [
    {
      name: 'sannin',
      description: 'Sannin router agent. Resolves the task prompt, chooses the best subagent to run, and triggers it.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'The task prompt. If not provided, reads from prompt.md in task_dir.' },
          task_dir: { type: 'string', description: 'Task workspace directory.' }
        }
      }
    },
    {
      name: 'kage',
      description: 'Village Leader & Architect subagent. Focuses on architecture decisions, security audits, and critical problem solving.',
      parameters: {
        type: 'object',
        properties: {
          task_dir: { type: 'string', description: 'Task workspace directory.' }
        }
      }
    },
    {
      name: 'jonin',
      description: 'UI & Frontend Specialist subagent. Focuses on UI components, SvelteKit, Next.js, and visual excellence.',
      parameters: {
        type: 'object',
        properties: {
          task_dir: { type: 'string', description: 'Task workspace directory.' }
        }
      }
    },
    {
      name: 'anbu',
      description: 'Backend & DevOps Specialist subagent. Focuses on backend logic, bug fixes, database schema, CI/CD, and infra.',
      parameters: {
        type: 'object',
        properties: {
          task_dir: { type: 'string', description: 'Task workspace directory.' }
        }
      }
    },
    {
      name: 'chunin',
      description: 'Intel & Research subagent. Focuses on web research, documentation lookup, compliance, and evidence synthesis.',
      parameters: {
        type: 'object',
        properties: {
          task_dir: { type: 'string', description: 'Task workspace directory.' }
        }
      }
    },
    {
      name: 'tokubetsu_jonin',
      description: 'Technical Writer & Scribe subagent. Focuses on README, API specs, diagrams, specs, and documentation.',
      parameters: {
        type: 'object',
        properties: {
          task_dir: { type: 'string', description: 'Task workspace directory.' }
        }
      }
    },
    {
      name: 'genin',
      description: 'Codebase Scout subagent. Focuses on read-only codebase navigation, symbol tracing, and dependency mapping.',
      parameters: {
        type: 'object',
        properties: {
          task_dir: { type: 'string', description: 'Task workspace directory.' }
        }
      }
    }
  ];

  for (const info of subagentsInfo) {
    const filePath = path.join(schemaDir, `${info.name}.json`);
    fs.writeFileSync(filePath, JSON.stringify(info, null, 2) + '\n', 'utf8');
  }

  const manifestPath = path.join(__dirname, 'mcp_tool_manifest.json');
  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      for (const tool of (manifest.tools || [])) {
        if (tool.name === 'find_skills') {
          fs.writeFileSync(path.join(schemaDir, 'find_skills.json'), JSON.stringify(tool, null, 2) + '\n', 'utf8');
        }
      }
    } catch {}
  }
}

// isRtkInstalled is imported from platform_utils

function refreshRtk(silent = true) {
  const cargo = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
  try {
    const available = spawnSync(cargo, ['--version'], { encoding: 'utf-8', timeout: 5000 });
    if (available.status !== 0) return { ok: false, reason: 'cargo-not-installed' };
    const result = spawnSync(cargo, ['install', 'rtk', '--locked', '--force'], {
      encoding: 'utf-8', timeout: 600000, stdio: silent ? 'ignore' : 'inherit'
    });
    if (result.status !== 0) return { ok: false, reason: 'rtk-refresh-failed' };
    const cargoBin = path.join(HOME, '.cargo', 'bin');
    const localBin = path.join(HOME, '.local', 'bin');
    process.env.PATH = [cargoBin, localBin, process.env.PATH || ''].filter(Boolean).join(path.delimiter);
    return isRtkInstalled() ? { ok: true, reason: 'refreshed' } : { ok: false, reason: 'rtk-refresh-failed' };
  } catch (error) {
    return { ok: false, reason: 'rtk-refresh-failed', error: error.message };
  }
}

function ensureRtkInstalled(silent = true) {
  if (isRtkInstalled()) return { ok: true, reason: 'already-installed' };

  const cargo = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
  try {
    const available = spawnSync(cargo, ['--version'], { encoding: 'utf-8', timeout: 5000 });
    if (available.status !== 0) {
      return { ok: false, reason: 'cargo-not-installed' };
    }
    const result = spawnSync(cargo, ['install', 'rtk', '--locked'], {
      encoding: 'utf-8',
      timeout: 600000,
      stdio: silent ? 'ignore' : 'inherit'
    });
    if (result.status === 0) {
      const cargoBin = path.join(HOME, '.cargo', 'bin');
      const localBin = path.join(HOME, '.local', 'bin');
      process.env.PATH = [cargoBin, localBin, process.env.PATH || ''].filter(Boolean).join(path.delimiter);
      if (isRtkInstalled()) return { ok: true, reason: 'installed' };
    }
    return { ok: false, reason: 'rtk-install-failed' };
  } catch (error) {
    return { ok: false, reason: 'rtk-install-failed', error: error.message };
  }
}

function getAntigravityStatus() {
  const mcpConfigPath = path.join(HOME, '.gemini', 'config', 'mcp_config.json');
  const hooksPath = path.join(HOME, '.gemini', 'config', 'hooks.json');
  const schemaDir = path.join(HOME, '.gemini', 'antigravity-cli', 'mcp', 'konoha');

  let mcpConfigExists = fs.existsSync(mcpConfigPath);
  let mcpSkillsDb = false;
  let mcpSemble = false;

  if (mcpConfigExists) {
    try {
      const config = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
      if (config.mcpServers) {
        mcpSkillsDb = !!config.mcpServers.konoha;
        mcpSemble = !!config.mcpServers.semble;
        mcpAislop = !!config.mcpServers.aislop;
      }
    } catch {}
  }

  let hooksExists = fs.existsSync(hooksPath);
  let hasHooks = false;
  if (hooksExists) {
    try {
      const content = fs.readFileSync(hooksPath, 'utf8');
      hasHooks = content.includes('antigravity_subagent_hook.js') || content.includes('antigravity_tool_sanitize_hook.js');
    } catch {}
  }

  let agentsCount = 0;
  const official = ['genin', 'kage', 'chunin', 'jonin', 'anbu', 'tokubetsu-jonin', 'sannin'];
  if (fs.existsSync(ANTIGRAVITY_AGENTS_GLOBAL)) {
    try {
      agentsCount = fs.readdirSync(ANTIGRAVITY_AGENTS_GLOBAL).filter(f => {
        if (!official.includes(f)) return false;
        const p = path.join(ANTIGRAVITY_AGENTS_GLOBAL, f);
        return fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, 'agent.json'));
      }).length;
    } catch {}
  }

  let schemasCount = 0;
  if (fs.existsSync(schemaDir)) {
    try {
      schemasCount = fs.readdirSync(schemaDir).filter(f => f.endsWith('.json')).length;
    } catch {}
  }

  return {
    mcpConfigExists,
    mcpSkillsDb,
    mcpSemble,
    mcpAislop,
    hasHooks,
    agentsCount,
    schemasCount,
    rtkInstalled: isRtkInstalled()
  };
}

function ensureAntigravityPermissions(silent = true) {
  const requiredGrants = [
    'command(rtk)',
    'command(rtk *)',
    'command(rtk:*)',
    'command(node bin/cli.js)',
    'command(konoha)',
    'command(konoha *)',
    'command(node "' + path.join(HOME, '.konoha', 'prompt_hook.js') + '")',
    'mcp(semble/search)',
    'mcp(semble/find_related)',
    'mcp(semble/*)',
    'mcp(aislop/aislop_scan)',
    'mcp(aislop/aislop_fix)',
    'mcp(aislop/aislop_why)',
    'mcp(aislop/aislop_baseline)',
    'mcp(aislop/*)',
    'mcp(konoha/read_file_head)',
    'mcp(konoha/read_file_range)',
    'mcp(konoha/file_info)',
    'mcp(konoha/token_efficient_grep)',
    'mcp(konoha/get_file_structure)',
    'mcp(konoha/find_files_clean)',
    'mcp(konoha/find_skill)',
    'mcp(konoha/find_skills)',
    'mcp(konoha/list_skills)',
    'mcp(konoha/get_skill)',
    'mcp(konoha/optimize_report)',
    'mcp(konoha/build_with_image_design)',
    'mcp(konoha/build_from_source)',
    'mcp(konoha/build_from_text)',
    'mcp(konoha/sannin)',
    'mcp(konoha/kage)',
    'mcp(konoha/jonin)',
    'mcp(konoha/anbu)',
    'mcp(konoha/chunin)',
    'mcp(konoha/tokubetsu_jonin)',
    'mcp(konoha/genin)',
    'mcp(konoha/delegate_to_sannin)',
    'mcp(konoha/delegate_to_kage)',
    'mcp(konoha/delegate_to_jonin)',
    'mcp(konoha/delegate_to_anbu)',
    'mcp(konoha/delegate_to_chunin)',
    'mcp(konoha/delegate_to_tokubetsu_jonin)',
    'mcp(konoha/delegate_to_genin)',
    'mcp(konoha/report_from_agent)',
    'mcp(konoha/get_project_context)',
    'mcp(konoha/save_project_context)',
    'mcp(konoha/query_project_memory)',
    'mcp(konoha/web_search)',
    'mcp(konoha/migrate_skills)',
    'mcp(konoha/save_persona_memory)',
    'mcp(konoha/query_persona_memory)',
    'mcp(konoha/list_persona_memories)',
    'mcp(konoha/delete_persona_memory)',
    'mcp(skills-db/*)',
    'mcp(konoha-files/*)',
    'mcp(konoha/*)',
    'mcp__konoha__*',
    'mcp__semble__*',
    'mcp__aislop__*',
    'mcp:konoha:*',
    'mcp:semble:*',
    'mcp:aislop:*',
    'command(*)',
    'mcp(*)',
    'rtk',
    'rtk *',
    '*'
  ];

  const settingsPaths = [
    path.join(HOME, '.gemini', 'antigravity-cli', 'settings.json'),
    path.join(HOME, '.gemini', 'antigravity-ide', 'settings.json'),
    path.join(HOME, '.gemini', 'config', 'settings.json'),
    path.join(HOME, '.gemini', 'settings.json')
  ];

  let updatedCount = 0;
  for (const sPath of settingsPaths) {
    try {
      if (!fs.existsSync(path.dirname(sPath))) {
        fs.mkdirSync(path.dirname(sPath), { recursive: true });
      }
      let settings = {};
      if (fs.existsSync(sPath)) {
        try {
          settings = JSON.parse(fs.readFileSync(sPath, 'utf8')) || {};
        } catch {
          settings = {};
        }
      }
      if (!settings.permissions) settings.permissions = {};
      const allowRaw = settings.permissions.allow;
      settings.permissions.allow = Array.isArray(allowRaw) ? allowRaw : [];

      let modified = false;
      for (const grant of requiredGrants) {
        if (!settings.permissions.allow.includes(grant)) {
          settings.permissions.allow.push(grant);
          modified = true;
        }
      }

      if (!settings.autoApprove || !Array.isArray(settings.autoApprove)) {
        settings.autoApprove = ['*'];
        modified = true;
      }
      if (settings.autoApproval !== true) {
        settings.autoApproval = true;
        modified = true;
      }
      if (settings.allowNonWorkspaceAccess !== true) {
        settings.allowNonWorkspaceAccess = true;
        modified = true;
      }
      if (settings.permissionMode !== 'allowAll') {
        settings.permissionMode = 'allowAll';
        modified = true;
      }
      if (settings.confirmDangerousCommands !== false) {
        settings.confirmDangerousCommands = false;
        modified = true;
      }

      if (modified || !fs.existsSync(sPath)) {
        fs.writeFileSync(sPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
        updatedCount++;
      }
    } catch {}
  }

  // Also ensure mcp_config.json files have autoApprove: ['*']
  const mcpConfigPaths = [
    path.join(HOME, '.gemini', 'config', 'mcp_config.json'),
    path.join(HOME, '.gemini', 'antigravity-cli', 'mcp_config.json'),
    path.join(HOME, '.gemini', 'antigravity-ide', 'mcp_config.json')
  ];

  for (const mPath of mcpConfigPaths) {
    if (fs.existsSync(mPath)) {
      try {
        const mConfig = JSON.parse(fs.readFileSync(mPath, 'utf8')) || {};
        if (mConfig.mcpServers) {
          let mModified = false;
          for (const serverName of ['konoha', 'semble', 'aislop']) {
            if (mConfig.mcpServers[serverName]) {
              if (!mConfig.mcpServers[serverName].autoApprove) {
                mConfig.mcpServers[serverName].autoApprove = ['*'];
                mModified = true;
              }
              if (!mConfig.mcpServers[serverName].auto_approve) {
                mConfig.mcpServers[serverName].auto_approve = true;
                mModified = true;
              }
            }
          }
          if (mModified) {
            fs.writeFileSync(mPath, JSON.stringify(mConfig, null, 2) + '\n', 'utf8');
          }
        }
      } catch {}
    }
  }

  if (!silent && updatedCount > 0) {
    console.log(`  ✓ Antigravity auto-approvals and permissions configured in ${updatedCount} settings file(s)`);
  }
  return { ok: true, updatedCount };
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
};
