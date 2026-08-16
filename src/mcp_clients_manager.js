const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const deployUtils = require('./deploy_utils');
const {
  buildSembleSearchPolicyCompact,
  buildFileToolsPolicyCompact
} = require('./search_policy');
const {
  buildSubagentContract,
  buildMainAgentContract
} = require('./agent_contract');

const {
  SKILLS_DB_DIR, SERVER_PATH, FILE_TOOLS_MCP_PATH,
  CLAUDE_JSON, CLAUDE_SETTINGS, COMMANDCODE_JSON, HOME,
} = require('../bin/lib/paths');

const KONOHA_MCP_NAMES = ['konoha', 'semble'];

function fileExists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function ensureDir(d) {
  if (!fileExists(d)) {
    fs.mkdirSync(d, { recursive: true });
  }
}

const __cmdAvailCache = new Map();
const __fileExistCache = new Map();

function fileExistsCached(p) {
  if (__fileExistCache.has(p)) return __fileExistCache.get(p);
  let v;
  try { v = fs.existsSync(p); } catch { v = false; }
  __fileExistCache.set(p, v);
  return v;
}

function isCommandAvailable(cmd) {
  if (__cmdAvailCache.has(cmd)) return __cmdAvailCache.get(cmd);
  let result = false;
  try {
    const probe = process.platform === 'win32' ? 'where' : 'which';
    const found = spawnSync(probe, [cmd], { encoding: 'utf-8', timeout: 5000 });
    if (found.status === 0 && (found.stdout || '').trim()) {
      result = true;
    }
  } catch {}
  if (!result) {
    try {
      const version = spawnSync(cmd, ['--version'], {
        encoding: 'utf-8',
        timeout: 5000,
        shell: process.platform === 'win32'
      });
      result = version.status === 0;
    } catch {
      result = false;
    }
  }
  __cmdAvailCache.set(cmd, result);
  return result;
}

function isClaudeCodeInstalled() {
  return (
    isCommandAvailable('claude') ||
    fileExistsCached(path.join(HOME, '.claude')) ||
    fileExistsCached(CLAUDE_JSON)
  );
}

function isCommandCodeInstalled() {
  return (
    isCommandAvailable('commandcode') ||
    isCommandAvailable('cmd') ||
    fileExistsCached(path.join(HOME, '.commandcode')) ||
    fileExistsCached(COMMANDCODE_JSON)
  );
}

function isRtkInstalled() {
  if (__cmdAvailCache.has('rtk')) return __cmdAvailCache.get('rtk');
  let result = false;
  try {
    const res = spawnSync('rtk', ['--version'], {
      encoding: 'utf-8',
      timeout: 5000
    });
    result = res.status === 0;
  } catch {
    result = false;
  }
  __cmdAvailCache.set('rtk', result);
  return result;
}


function deployCommandCodeRtkRule(silent = true) {
  if (!isRtkInstalled()) {
    return { ok: false, reason: 'rtk-not-installed' };
  }
  const src = path.join(__dirname, '..', '.claude', 'rules', 'rtk.md');
  if (!fileExists(src)) {
    return { ok: false, reason: 'rtk-rule-template-missing' };
  }
  const dest = path.join(HOME, '.commandcode', 'rules', 'rtk.md');
  try {
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
    if (!silent) console.log('  ✓ Deployed RTK rule to ' + dest);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'copy-failed', error: e.message };
  }
}

function deployClaudeCodeRtkRule(silent = true) {
  if (!isRtkInstalled()) {
    return { ok: false, reason: 'rtk-not-installed' };
  }
  const src = path.join(__dirname, '..', '.claude', 'rules', 'rtk.md');
  if (!fileExists(src)) {
    return { ok: false, reason: 'rtk-rule-template-missing' };
  }
  const dest = path.join(HOME, '.claude', 'rules', 'rtk.md');
  try {
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
    if (!silent) console.log(`  ✓ Deployed RTK rule to ${dest}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'copy-failed', error: e.message };
  }
}

function initRtkHook(silent = true) {
  if (!isRtkInstalled()) {
    return { ok: false, reason: 'rtk-not-installed' };
  }
  try {
    const res = spawnSync('rtk', ['init', '-g'], {
      encoding: 'utf-8',
      timeout: 10000,
      input: 'y\nN\n',
      stdio: silent ? ['pipe', 'ignore', 'ignore'] : ['pipe', 'pipe', 'pipe']
    });
    if (res.status === 0) {
      if (!silent) console.log('  ✓ RTK hook initialized globally for Claude Code');
      return { ok: true };
    }
    // Non-zero exit — usually already set up; treat as success
    if (!silent) console.log(`  ✓ RTK hook already initialized (exit ${res.status})`);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'rtk-init-failed', error: e.message };
  }
}


function buildStdioMcpServers(options = {}) {
  const {
    pythonCmd = 'python3',
    serverPath = SERVER_PATH,
    uvxCmd = 'uvx',
    nodeCmd = process.execPath || 'node'
  } = options;

  const servers = {
    semble: {
      type: 'stdio',
      command: uvxCmd,
      args: ['--from', 'semble[mcp]@latest', 'semble', '--content', 'all']
    }
  };
  if (fileExists(FILE_TOOLS_MCP_PATH)) {
    const entry = deployUtils.buildKonohaFilesMcpEntry('cursor');
    if (entry) {
      servers['konoha'] = entry;
    }
  }

  return servers;
}


function mergeJsonFile(filePath, mutator, silent = true) {
  const { parseYaml, stringifyYaml } = require('./agent_manager');
  if (!fileExists(filePath)) {
    const isJson = filePath.endsWith('.json');
    const config = {};
    const updated = mutator(config);
    if (updated) {
      ensureDir(path.dirname(filePath));
      fs.writeFileSync(filePath, isJson ? JSON.stringify(config, null, 2) + '\n' : stringifyYaml(config) + '\n');
      if (!silent) {
        console.log(`✓ Created ${filePath}`);
      }
    }
    return updated;
  }

  try {
    const isJson = filePath.endsWith('.json');
    const config = isJson ? JSON.parse(fs.readFileSync(filePath, 'utf-8')) || {} : parseYaml(fs.readFileSync(filePath, 'utf-8')) || {};
    const updated = mutator(config);
    if (updated) {
      fs.writeFileSync(filePath, isJson ? JSON.stringify(config, null, 2) + '\n' : stringifyYaml(config) + '\n');
      if (!silent) {
        console.log(`✓ Updated ${filePath}`);
      }
    }
    return updated;
  } catch {
    if (!silent) {
      console.warn(`Skipped ${filePath}: invalid YAML (not overwritten)`);
    }
    return false;
  }
}

function mergeMcpServersBlock(existing, servers) {
  if (!existing) existing = {};
  let updated = false;
  for (const [name, entry] of Object.entries(servers)) {
    const prev = existing[name];
    if (
      !prev ||
      prev.command !== entry.command ||
      JSON.stringify(prev.args || []) !== JSON.stringify(entry.args || [])
    ) {
      existing[name] = entry;
      updated = true;
    }
  }
  return updated;
}


function backupFile(filePath, silent = true) {
  const backPath = filePath + '.back';
  if (fileExists(filePath) && !fileExists(backPath)) {
    fs.copyFileSync(filePath, backPath);
    if (!silent) console.log(`  ✓ Backed up ${path.basename(filePath)} → ${path.basename(backPath)}`);
  }
}

function registerClaudeCodeGlobalMcp(pythonCmd, serverPath, uvxCmd, silent = true) {
  if (!fileExists(serverPath)) return false;
  const servers = buildStdioMcpServers({ pythonCmd, serverPath, uvxCmd });

  // Backup existing config once, then replace mcpServers with only Konoha servers
  backupFile(CLAUDE_JSON, silent);

  let existingConfig = {};
  if (fileExists(CLAUDE_JSON)) {
    try {
      existingConfig = JSON.parse(fs.readFileSync(CLAUDE_JSON, 'utf-8')) || {};
    } catch { /* ignore parse errors, start fresh */ }
  }

  // Replace mcpServers entirely with only Konoha servers
  existingConfig.mcpServers = servers;
  ensureDir(path.dirname(CLAUDE_JSON));
  const tempFile = CLAUDE_JSON + '.tmp';
  fs.writeFileSync(tempFile, JSON.stringify(existingConfig, null, 2) + '\n');
  fs.renameSync(tempFile, CLAUDE_JSON);
  if (!silent) console.log(`  ✓ ${path.basename(CLAUDE_JSON)} replaced with Konoha-only MCP servers`);
  return true;
}

function registerCommandCodeGlobalMcp(pythonCmd, serverPath, uvxCmd, silent = true) {
  if (!fileExists(serverPath)) return false;
  const servers = buildStdioMcpServers({ pythonCmd, serverPath, uvxCmd });

  backupFile(COMMANDCODE_JSON, silent);

  let existingConfig = {};
  if (fileExists(COMMANDCODE_JSON)) {
    try {
      existingConfig = JSON.parse(fs.readFileSync(COMMANDCODE_JSON, 'utf-8')) || {};
    } catch { /* ignore parse errors, start fresh */ }
  }

  if (!existingConfig.mcpServers) {
    existingConfig.mcpServers = {};
  }

  // Merge Konoha servers into CommandCode config
  mergeMcpServersBlock(existingConfig.mcpServers, servers);

  ensureDir(path.dirname(COMMANDCODE_JSON));
  const tempFile = COMMANDCODE_JSON + '.tmp';
  fs.writeFileSync(tempFile, JSON.stringify(existingConfig, null, 2) + '\n');
  fs.renameSync(tempFile, COMMANDCODE_JSON);
  if (!silent) console.log(`  ✓ ${path.basename(COMMANDCODE_JSON)} updated with Konoha MCP servers`);
  return true;
}

function registerClaudeCodePermissions(silent = true) {
  const grants = [
    'mcp__konoha__*',
    'mcp__semble__*'
  ];

  return mergeJsonFile(
    CLAUDE_SETTINGS,
    (config) => {
      if (!config.permissions) config.permissions = {};
      const allowRaw = config.permissions.allow;
      config.permissions.allow = Array.isArray(allowRaw) ? allowRaw : [];

      let updated = false;

      // Remove invalid wildcard rtk* if present (Claude Code no longer supports it)
      const rtkIndex = config.permissions.allow.indexOf('rtk*');
      if (rtkIndex !== -1) {
        config.permissions.allow.splice(rtkIndex, 1);
        updated = true;
      }

      for (const grant of grants) {
        if (!config.permissions.allow.includes(grant)) {
          config.permissions.allow.push(grant);
          updated = true;
        }
      }
      return updated;
    },
    silent
  );
}


function adaptInstructionsForClaudeCode(instructions) {
  if (!instructions) return '';
  return instructions
    .replace(/Always set RequestFeedback:\s*false\s+and\s+UserFacing:\s*false\s+in\s+ArtifactMetadata\s+when\s+writing\s+files\.?\s*/gi, '')
    .replace(/view_file/g, 'Read')
    .replace(/write_to_file/g, 'Write')
    .replace(/replace_file_content/g, 'Edit')
    .replace(/run_command/g, 'Bash')
    // MCP tool mapping for Claude Code double underscore format
    .replace(/(?:skills-db|konoha)\.find_skill/g, 'mcp__konoha__find_skill')
    .replace(/(?:skills-db|konoha)\.get_skill/g, 'mcp__konoha__get_skill')
    .replace(/(?:skills-db|konoha)\.list_skills/g, 'mcp__konoha__list_skills')
    .replace(/(?:skills-db|konoha)\.optimize_report/g, 'mcp__konoha__optimize_report')
    .replace(/(?:skills-db|konoha)\.build_from_source/g, 'mcp__konoha__build_from_source')
    .replace(/(?:skills-db|konoha)\.build_from_text/g, 'mcp__konoha__build_from_text')
    .replace(/(?:skills-db|konoha)\.get_resolved_task_dir/g, 'mcp__konoha__get_resolved_task_dir')
    .replace(/(?:skills-db|konoha)\.migrate_skills/g, 'mcp__konoha__migrate_skills')
    .replace(/(?:skills-db|konoha)\.web_search/g, 'mcp__konoha__web_search')
    .replace(/(?:skills-db|konoha)\.sannin/g, 'mcp__konoha__sannin')
    .replace(/(?:skills-db|konoha)\.kage/g, 'mcp__konoha__kage')
    .replace(/(?:skills-db|konoha)\.jonin/g, 'mcp__konoha__jonin')
    .replace(/(?:skills-db|konoha)\.anbu/g, 'mcp__konoha__anbu')
    .replace(/(?:skills-db|konoha)\.chunin/g, 'mcp__konoha__chunin')
    .replace(/(?:skills-db|konoha)\.tokubetsu_jonin/g, 'mcp__konoha__tokubetsu_jonin')
    .replace(/(?:skills-db|konoha)\.genin/g, 'mcp__konoha__genin')
    .replace(/semble\.search/g, 'mcp__semble__search')
    .replace(/semble\.find_related/g, 'mcp__semble__find_related')
    // Bare tool names → mcp__konoha__ prefix. Negative lookbehind avoids double-prefixing.
.replace(/(?<!mcp__konoha__)\boptimize_report\b/g, 'mcp__konoha__optimize_report')
     .replace(/(?<!mcp__konoha__)\bkage\b(?!-)/g, 'mcp__konoha__kage')
     .replace(/(?<!mcp__konoha__)\bjonin\b(?!-)/g, 'mcp__konoha__jonin')
     .replace(/(?<!mcp__konoha__)\banbu\b(?!-)/g, 'mcp__konoha__anbu')
     .replace(/(?<!mcp__konoha__)\bchunin\b(?!-)/g, 'mcp__konoha__chunin')
     .replace(/(?<!mcp__konoha__)\bgenin\b(?!-)/g, 'mcp__konoha__genin')
     .replace(/(?<!mcp__konoha__)\btokubetsu_jonin\b(?!-)/g, 'mcp__konoha__tokubetsu_jonin')
     .replace(/(?<!mcp__konoha__)\bsannin\b(?!-)/g, 'mcp__konoha__sannin')
    .replace(/(?<!mcp__konoha__)\bfind_skill\b/g, 'mcp__konoha__find_skill')
    .replace(/(?<!mcp__konoha__)\bget_skill\b/g, 'mcp__konoha__get_skill')
    .replace(/(?<!mcp__konoha__)\blist_skills\b/g, 'mcp__konoha__list_skills')
    .replace(/(?<!mcp__konoha__)\bread_file_head\b/g, 'mcp__konoha__read_file_head')
    .replace(/(?<!mcp__konoha__)\bread_file_range\b/g, 'mcp__konoha__read_file_range')
    .replace(/(?<!mcp__konoha__)\bfile_info\b/g, 'mcp__konoha__file_info')
    .replace(/(?<!mcp__konoha__)\btoken_efficient_grep\b/g, 'mcp__konoha__token_efficient_grep')
    .replace(/(?<!mcp__konoha__)\bget_file_structure\b/g, 'mcp__konoha__get_file_structure')
    .replace(/(?<!mcp__konoha__)\bfind_files_clean\b/g, 'mcp__konoha__find_files_clean')
    .trim();
}

function generateClaudeCodeSubagent(agent) {
  const description = `${agent.description || ''} Use proactively when tasks match: ${agent.delegationKeywords || agent.purpose || agent.name}.`;

  let instructions = agent.instructions || '';
  instructions = instructions.replace(/\bBefore work:\s*find_skill\([^)]*\)(?:\.\s*find_skill\([^)]*\))*\.?\s*/gi, '');
  instructions = instructions.replace(/If delegate\.md specifies exact reference names,\s*load\s+them\s+via\s+the\s+skills-db\.get_skill\s+tool\.?/gi, '');
  instructions = instructions.replace(/Follow\s+full\s+protocol\s+in\s+~\/\.agents\/AGENTS\.md\.?/gi, '');
  instructions = instructions.trim();
  if (instructions && !instructions.endsWith('.')) {
    instructions += '.';
  }

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

  instructions = `${instructions}\n\n${buildSubagentContract('claude')}`;
  const body = adaptInstructionsForClaudeCode(instructions);
  const sembleLine = buildSembleSearchPolicyCompact();
  const fileToolsLine = buildFileToolsPolicyCompact();

  const frontmatter = [
    '---',
    `name: ${agent.name}`,
    `description: "${description.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`,
    'allowed-tools:',
    '  - Write',
    '  - Edit',
    '  - Bash',
    '  - TodoRead',
    '  - TodoWrite',
    '  - WebSearch',
    '  - mcp__semble__*',
    '  - mcp__konoha__*',
    '---',
    ''
  ];

  return frontmatter.join('\n') + body + '\n\n' + sembleLine + '\n' + fileToolsLine + '\n';
}

function deployCommandCodeRules(silent = true) {
  const dest = path.join(HOME, '.commandcode', 'rules', 'konoha.md');
  try {
    ensureDir(path.dirname(dest));
    const content = buildMainAgentContract('commandcode') + '\n';
    if (!fileExists(dest) || fs.readFileSync(dest, 'utf8') !== content) {
      fs.writeFileSync(dest, content, 'utf8');
    }
    if (!silent) console.log(`  ✓ Deployed Konoha contract to ${dest}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: 'copy-failed', error: error.message };
  }
}

function ensureClaudeCodeSetup(options = {}) {
  const {
    pythonCmd = 'python3',
    serverPath = SERVER_PATH,
    uvxCmd = 'uvx',
    ruleContent = null,
    silent = true,
    agents = [],
    projectRoot = null,
    deployProject = false
  } = options;

  if (!isClaudeCodeInstalled()) {
    return { ok: false, reason: 'claude CLI not detected' };
  }

  deployUtils.installFileTools(silent);

  if (!fileExists(serverPath)) {
    return { ok: false, reason: 'konoha server not installed' };
  }

  registerClaudeCodeGlobalMcp(pythonCmd, serverPath, uvxCmd, silent);
  registerClaudeCodePermissions(silent);
  registerClaudeCodeNativeBlocker();
  deployClaudeCodeRtkRule(silent);
  initRtkHook(silent);

  if (ruleContent) {
    deployClaudeCodeRules(ruleContent, silent);
  }

  // Deploy agents to ~/.claude/agents
  if (agents && agents.length > 0) {
    const claudeAgentsDir = path.join(HOME, '.claude', 'agents');
    ensureDir(claudeAgentsDir);
    for (const agent of agents) {
      if (agent.name.startsWith('mcp_')) continue; // Skip if it has mcp_ (which it shouldn't anymore)
      const mdContent = generateClaudeCodeSubagent(agent);
      const targetPath = path.join(claudeAgentsDir, agent.name + '.md');
      fs.writeFileSync(targetPath, mdContent);
    }

    // Cleanup old mcp_ prefixed agents
    try {
      const files = fs.readdirSync(claudeAgentsDir);
      for (const file of files) {
        if (file.startsWith('mcp_') && file.endsWith('.md')) {
          fs.unlinkSync(path.join(claudeAgentsDir, file));
        }
      }
    } catch (e) {}
  }



  if (deployProject && projectRoot) {
    try {
      deployProjectClaudeMd(projectRoot, agents, silent, ruleContent);
    } catch {}
  }

  return { ok: true };
}

function registerCommandCodePermissions(silent = true) {
  const settingsPath = path.join(HOME, '.commandcode', 'settings.json');
  return mergeJsonFile(
    settingsPath,
    (config) => {
      if (!config.permissions) config.permissions = {};
      const allow = Array.isArray(config.permissions.allow) ? config.permissions.allow : [];
      const grants = [
        'mcp__konoha__*',
        'mcp__semble__*',
        'Shell(rtk *)'
      ];
      let updated = false;
      for (const grant of grants) {
        if (!allow.includes(grant)) {
          allow.push(grant);
          updated = true;
        }
      }
      config.permissions.allow = allow;
      return updated;
    },
    silent
  );
}

function ensureCommandCodeSetup(options = {}) {
  const {
    pythonCmd = 'python3',
    serverPath = SERVER_PATH,
    uvxCmd = 'uvx',
    silent = false
  } = options;

  if (!isCommandCodeInstalled()) {
    return { ok: false, reason: 'Command Code not detected' };
  }

  if (!fileExists(serverPath)) {
    return { ok: false, reason: 'konoha server not installed' };
  }

  if (!registerCommandCodeGlobalMcp(pythonCmd, serverPath, uvxCmd, silent)) {
    return { ok: false, reason: 'commandcode-mcp-registration-failed' };
  }
  registerCommandCodePermissions(silent);
  const rtkRule = deployCommandCodeRtkRule(silent);
  const contractRule = deployCommandCodeRules(silent);
  const status = getCommandCodeStatus();
  if (!status.mcpKonoha || !status.mcpSemble) {
    return { ok: false, reason: 'commandcode-mcp-verification-failed' };
  }
  return {
    ok: true,
    rtk: status.rtkInstalled ? 'already-installed' : 'rtk-not-installed',
    rtkRule: rtkRule.ok ? 'deployed' : rtkRule.reason,
    contractRule: contractRule.ok ? 'deployed' : contractRule.reason
  };
}






function readMcpHealth(config, key = 'mcpServers') {
  const block = config[key] || config.mcp || {};
  return {
    konoha: !!block['konoha'],
    semble: !!block.semble,
    skillsDb: !!block['konoha']
  };
}

function registerClaudeCodeNativeBlocker() {
  if (!fileExists(CLAUDE_SETTINGS)) return;
  const blockerPath = path.join(HOME, ".local", "bin", "konoha-native-blocker");
  try {
    fs.mkdirSync(path.join(HOME, ".local", "bin"), { recursive: true });
    const scriptContent = `#!/usr/bin/env bash
# Output JSON rejecting the tool use
cat << 'JSON'
{
  "decision": "reject",
  "reason": "⚠️ MANDATORY RULE VIOLATION: Using built-in/native file tools (Read, Glob, Grep, View, ReadFile, ls, cat, etc.) is STRICTLY FORBIDDEN! You MUST use the konoha MCP tools (read_file_head, read_file_range, token_efficient_grep, get_file_structure, find_files_clean, etc.) or semble MCP for codebase search! Retry using ONLY konoha or semble MCP tools."
}
JSON
`;
    fs.writeFileSync(blockerPath, scriptContent, { mode: 0o755 });
  } catch (e) {
    // Ignore permissions errors
  }

  mergeJsonFile(
    CLAUDE_SETTINGS,
    (config) => {
      if (!config.hooks) config.hooks = {};
      if (!config.hooks.PreToolUse) config.hooks.PreToolUse = [];
      const blockerRegex = "^(Read|Glob|Grep|View|ReadFile|Replace)$";
      let found = false;
      for (const hook of config.hooks.PreToolUse) {
        if (hook.matcher === blockerRegex) {
          found = true;
          break;
        }
      }
      if (!found) {
        const blockerPath = path.join(HOME, ".local", "bin", "konoha-native-blocker");
        config.hooks.PreToolUse.push({
          matcher: blockerRegex,
          hooks: [
            {
              type: "command",
              command: blockerPath
            }
          ]
        });
        return true;
      }
      return false;
    }
  );
}

function getClaudeCodeStatus() {
  const status = {
    installed: isClaudeCodeInstalled(),
    globalConfig: fileExists(CLAUDE_JSON),
    mcpKonoha: false,
    mcpSemble: false,
    mcpSkillsDb: false,
    permissionsAllowed: false,
    agentsCount: 0,
    rtkInstalled: isRtkInstalled(),
    rtkRuleDeployed: fileExists(path.join(HOME, '.claude', 'rules', 'rtk.md'))
  };

  if (status.globalConfig) {
    try {
      let config = {};
      try {
        config = JSON.parse(fs.readFileSync(CLAUDE_JSON, 'utf-8'));
      } catch (e) {
        const { parseYaml } = require('./agent_manager');
        config = parseYaml(fs.readFileSync(CLAUDE_JSON, 'utf-8'));
      }
      const health = readMcpHealth(config, 'mcpServers');
      status.mcpKonoha = health.konoha;
      status.mcpSemble = health.semble;
      status.mcpSkillsDb = health.skillsDb;
    } catch {}
  }

  if (fileExists(CLAUDE_SETTINGS)) {
    try {
      let settings = {};
      try {
        settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf-8'));
      } catch (e) {
        const { parseYaml } = require('./agent_manager');
        settings = parseYaml(fs.readFileSync(CLAUDE_SETTINGS, 'utf-8'));
      }
      const allowRaw = settings?.permissions?.allow;
      const allowed = Array.isArray(allowRaw) ? allowRaw : [];
      status.permissionsAllowed =
        allowed.includes('mcp__konoha__*') &&
        allowed.includes('mcp__semble__*');
    } catch {}
  }

  const claudeAgentsDir = path.join(HOME, '.claude', 'agents');
  const official = ['genin', 'kage', 'chunin', 'jonin', 'anbu', 'tokubetsu-jonin', 'sannin'];
  for (const name of official) {
    if (fileExists(path.join(claudeAgentsDir, `${name}.md`))) {
      status.agentsCount++;
    }
  }

  return status;
}


function removeKonohaFromMcpBlock(block) {
  if (!block) return false;
  let updated = false;
  for (const name of KONOHA_MCP_NAMES) {
    if (block[name]) {
      delete block[name];
      updated = true;
    }
  }
  return updated;
}

function deployClaudeCodeRules(ruleContent, silent = true) {
  if (!ruleContent) return false;
  const CLAUDE_MD = path.join(HOME, '.claude', 'CLAUDE.md');
  ensureDir(path.dirname(CLAUDE_MD));

  const startMarker = '\n<!-- KONOHA-START -->\n';
  const endMarker = '\n<!-- KONOHA-END -->\n';
  const wrapper = startMarker + ruleContent + endMarker;

  let existing = '';
  if (fileExists(CLAUDE_MD)) {
    try {
      existing = fs.readFileSync(CLAUDE_MD, 'utf-8');
    } catch {}
  }

  // Strip existing Konoha rules if present
  let cleanContent = existing;
  const startIndex = existing.indexOf(startMarker);
  const endIndex = existing.indexOf(endMarker);
  if (startIndex !== -1 && endIndex !== -1) {
    cleanContent = existing.slice(0, startIndex) + existing.slice(endIndex + endMarker.length);
  }

  const finalContent = cleanContent.trim() + '\n' + wrapper;

  try {
    fs.writeFileSync(CLAUDE_MD, finalContent, 'utf-8');
    if (!silent) {
      console.log(`✓ Deployed Konoha instructions to ${CLAUDE_MD}`);
    }
    return true;
  } catch {
    return false;
  }
}

function deployProjectClaudeMd(projectRoot, _agents, silent = true, ruleContent = null) {
  if (!projectRoot || !fileExists(projectRoot)) return false;
  if (!ruleContent) return false;

  const CLAUDE_MD = path.join(projectRoot, 'CLAUDE.md');
  ensureDir(path.dirname(CLAUDE_MD));

  const startMarker = '\n<!-- KONOHA-START -->\n';
  const endMarker = '\n<!-- KONOHA-END -->\n';
  const wrapper = startMarker + ruleContent + endMarker;

  let existing = '';
  if (fileExists(CLAUDE_MD)) {
    try {
      existing = fs.readFileSync(CLAUDE_MD, 'utf-8');
    } catch {}
  }

  // Strip existing Konoha rules if present
  let cleanContent = existing;
  const startIndex = existing.indexOf(startMarker);
  const endIndex = existing.indexOf(endMarker);
  if (startIndex !== -1 && endIndex !== -1) {
    cleanContent = existing.slice(0, startIndex) + existing.slice(endIndex + endMarker.length);
  }

  const finalContent = cleanContent.trim() + '\n' + wrapper;

  // Only write if content would actually change
  let hadExistingBlock = (startIndex !== -1 && endIndex !== -1);
  if (!hadExistingBlock && fileExists(CLAUDE_MD)) {
    try {
      const currentFile = fs.readFileSync(CLAUDE_MD, 'utf-8');
      if (currentFile === finalContent) {
        return false; // Nothing changed
      }
    } catch {}
  }

  try {
    fs.writeFileSync(CLAUDE_MD, finalContent, 'utf-8');
    if (!silent) {
      console.log(`✓ Deployed Konoha instructions to ${CLAUDE_MD}`);
    }
    return true;
  } catch {
    return false;
  }
}

function removeProjectClaudeMd(projectRoot, silent = true) {
  if (!projectRoot || !fileExists(projectRoot)) return false;

  const CLAUDE_MD = path.join(projectRoot, 'CLAUDE.md');
  if (!fileExists(CLAUDE_MD)) return false;

  try {
    const content = fs.readFileSync(CLAUDE_MD, 'utf-8');
    const startMarker = '\n<!-- KONOHA-START -->\n';
    const endMarker = '\n<!-- KONOHA-END -->\n';
    const startIndex = content.indexOf(startMarker);
    const endIndex = content.indexOf(endMarker);
    if (startIndex !== -1 && endIndex !== -1) {
      const cleanContent = content.slice(0, startIndex) + content.slice(endIndex + endMarker.length);
      fs.writeFileSync(CLAUDE_MD, cleanContent.trim() + '\n', 'utf-8');
      if (!silent) {
        console.log(`✓ Removed Konoha instructions from ${CLAUDE_MD}`);
      }
      return true;
    }
  } catch {}
  return false;
}

function removeClaudeCodeConfig(silent = true, options = {}) {
  const { projectRoot = null, removeProject = false } = options;

  if (fileExists(CLAUDE_JSON)) {
    try {
      mergeJsonFile(
        CLAUDE_JSON,
        (config) => removeKonohaFromMcpBlock(config.mcpServers),
        silent
      );
    } catch {}
  }
  if (fileExists(CLAUDE_SETTINGS)) {
    try {
      mergeJsonFile(
        CLAUDE_SETTINGS,
        (config) => {
          const allowArr = config.permissions && Array.isArray(config.permissions.allow) ? config.permissions.allow : [];
          if (allowArr.length > 0) {
            const initialLength = allowArr.length;
            const filtered = allowArr.filter(
              (p) => p !== 'mcp__skills-db__*' && p !== 'mcp__konoha-files__*' && p !== 'mcp__konoha__*' && p !== 'mcp__semble__*'
            );
            config.permissions.allow = filtered;
            return filtered.length !== initialLength;
          }
          return false;
        },
        silent
      );
    } catch {}
  }

  // Remove per-project CLAUDE.md if specified
  if (removeProject && projectRoot) {
    try {
      removeProjectClaudeMd(projectRoot, silent);
    } catch {}
  }

  const CLAUDE_MD = path.join(HOME, '.claude', 'CLAUDE.md');
  if (fileExists(CLAUDE_MD)) {
    try {
      const content = fs.readFileSync(CLAUDE_MD, 'utf-8');
      const startMarker = '\n<!-- KONOHA-START -->\n';
      const endMarker = '\n<!-- KONOHA-END -->\n';
      const startIndex = content.indexOf(startMarker);
      const endIndex = content.indexOf(endMarker);
      if (startIndex !== -1 && endIndex !== -1) {
        const cleanContent = content.slice(0, startIndex) + content.slice(endIndex + endMarker.length);
        fs.writeFileSync(CLAUDE_MD, cleanContent.trim() + '\n', 'utf-8');
        if (!silent) {
          console.log(`✓ Removed Konoha instructions from ${CLAUDE_MD}`);
        }
      }
    } catch {}
  }

  // Remove Claude Code subagents
  const claudeAgentsDir = path.join(HOME, '.claude', 'agents');
  const backupDir = path.join(HOME, '.claude', 'agents_backup');
  const official = ['genin', 'kage', 'chunin', 'jonin', 'anbu', 'tokubetsu-jonin', 'sannin'];
  for (const name of official) {
    const p = path.join(claudeAgentsDir, `${name}.md`);
    if (fileExists(p)) {
      try {
        fs.unlinkSync(p);
      } catch {}
    }
  }

  // Restore backed up agents
  if (fileExists(backupDir)) {
    try {
      const files = fs.readdirSync(backupDir);
      files.forEach((file) => {
        if (file.endsWith('.md')) {
          const srcPath = path.join(backupDir, file);
          const destPath = path.join(claudeAgentsDir, file);
          fs.copyFileSync(srcPath, destPath);
          fs.unlinkSync(srcPath);
          if (!silent) {
            console.log(`✓ Restored original agent: ${file}`);
          }
        }
      });
      fs.rmdirSync(backupDir);
    } catch (e) {
      if (!silent) {
        console.warn(`Warning during agent restore: ${e.message}`);
      }
    }
  }
}


function getCommandCodeStatus() {
  const status = {
    installed: isCommandCodeInstalled(),
    globalConfig: fileExists(COMMANDCODE_JSON),
    mcpKonoha: false,
    mcpSemble: false,
    mcpSkillsDb: false,
    path: COMMANDCODE_JSON,
    status: 'missing',
    rtkInstalled: isRtkInstalled(),
    rtkRuleDeployed: fileExists(path.join(HOME, '.commandcode', 'rules', 'rtk.md')),
    permissionsAllowed: false
  };

  if (!status.installed) {
    status.status = 'missing';
    return status;
  }

  if (status.globalConfig) {
    try {
      let config = {};
      try {
        config = JSON.parse(fs.readFileSync(COMMANDCODE_JSON, 'utf-8'));
      } catch (e) {
        const { parseYaml } = require('./agent_manager');
        config = parseYaml(fs.readFileSync(COMMANDCODE_JSON, 'utf-8'));
      }
      const health = readMcpHealth(config, 'mcpServers');
      status.mcpKonoha = health.konoha;
      status.mcpSemble = health.semble;
      status.mcpSkillsDb = health.skillsDb;
      status.mcpServers = config.mcpServers || {};

      const settingsPath = path.join(HOME, '.commandcode', 'settings.json');
      if (fileExists(settingsPath)) {
        try {
          const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
          const allow = settings.permissions && Array.isArray(settings.permissions.allow) ? settings.permissions.allow : [];
          status.permissionsAllowed = allow.includes('mcp__konoha__*') && allow.includes('mcp__semble__*');
        } catch {}
      }
      if (health.konoha && health.semble) {
        status.status = 'ok';
      }
    } catch {}
  }

  return status;
}


module.exports = {
  CLAUDE_JSON,
  COMMANDCODE_JSON,
  CLAUDE_SETTINGS,
  KONOHA_MCP_NAMES,
  isClaudeCodeInstalled,
  isCommandCodeInstalled,
  isRtkInstalled,
  buildStdioMcpServers,
  registerClaudeCodeGlobalMcp,
  registerCommandCodeGlobalMcp,
  registerCommandCodePermissions,
  registerClaudeCodePermissions,
  deployClaudeCodeRules,
  deployClaudeCodeRtkRule,
  deployCommandCodeRtkRule,
  deployCommandCodeRules,
  initRtkHook,
  deployProjectClaudeMd,
  removeProjectClaudeMd,
  ensureClaudeCodeSetup,
  ensureCommandCodeSetup,
  getClaudeCodeStatus,
  getCommandCodeStatus,
  removeClaudeCodeConfig,
  generateClaudeCodeSubagent,
};
