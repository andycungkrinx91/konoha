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
  SKILLS_DB_DIR, SERVER_PATH, FILE_TOOLS_MCP_PATH,
  CLAUDE_JSON, CLAUDE_SETTINGS, OPENCODE_GLOBAL
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

function isCommandAvailable(cmd) {
  try {
    const probe = process.platform === 'win32' ? 'where' : 'which';
    const found = spawnSync(probe, [cmd], { encoding: 'utf-8', timeout: 5000 });
    if (found.status === 0 && (found.stdout || '').trim()) {
      return true;
    }
  } catch {}
  try {
    const version = spawnSync(cmd, ['--version'], {
      encoding: 'utf-8',
      timeout: 5000,
      shell: process.platform === 'win32'
    });
    return version.status === 0;
  } catch {
    return false;
  }
}

function isClaudeCodeInstalled() {
  return (
    isCommandAvailable('claude') ||
    fileExists(path.join(HOME, '.claude')) ||
    fileExists(CLAUDE_JSON)
  );
}

function isOpenCodeInstalled() {
  return (
    isCommandAvailable('opencode') ||
    fileExists(path.join(HOME, '.config', 'opencode'))
  );
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

function buildOpenCodeMcpEntries(options = {}) {
  const servers = buildStdioMcpServers(options);
  const mcp = {};
  for (const [name, entry] of Object.entries(servers)) {
    mcp[name] = {
      type: 'local',
      command: [entry.command, ...(entry.args || [])],
      enabled: true
    };
  }
  return mcp;
}

function mergeJsonFile(filePath, mutator, silent = true) {
  const { parseYaml, stringifyYaml } = require('./agent_manager');
  if (!fileExists(filePath)) {
    const config = {};
    const updated = mutator(config);
    if (updated) {
      ensureDir(path.dirname(filePath));
      fs.writeFileSync(filePath, stringifyYaml(config) + '\n');
      if (!silent) {
        console.log(`✓ Created ${filePath}`);
      }
    }
    return updated;
  }

  try {
    const config = parseYaml(fs.readFileSync(filePath, 'utf-8')) || {};
    const updated = mutator(config);
    if (updated) {
      fs.writeFileSync(filePath, stringifyYaml(config) + '\n');
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

function mergeOpenCodeMcpBlock(existing, entries) {
  if (!existing) existing = {};
  let updated = false;
  for (const [name, entry] of Object.entries(entries)) {
    const prev = existing[name];
    const prevCmd = JSON.stringify(prev?.command || []);
    const nextCmd = JSON.stringify(entry.command || []);
    if (!prev || prev.type !== entry.type || prevCmd !== nextCmd || prev.enabled !== entry.enabled) {
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
  const { parseYaml, stringifyYaml } = require('./agent_manager');
  const servers = buildStdioMcpServers({ pythonCmd, serverPath, uvxCmd });

  // Backup existing config once, then replace mcpServers with only Konoha servers
  backupFile(CLAUDE_JSON, silent);

  let existingConfig = {};
  if (fileExists(CLAUDE_JSON)) {
    try {
      existingConfig = parseYaml(fs.readFileSync(CLAUDE_JSON, 'utf-8')) || {};
    } catch { /* ignore parse errors, start fresh */ }
  }

  // Replace mcpServers entirely with only Konoha servers
  existingConfig.mcpServers = servers;
  ensureDir(path.dirname(CLAUDE_JSON));
  fs.writeFileSync(CLAUDE_JSON, stringifyYaml(existingConfig) + '\n');
  if (!silent) console.log(`  ✓ ${path.basename(CLAUDE_JSON)} replaced with Konoha-only MCP servers`);
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

function registerOpenCodeGlobalMcp(pythonCmd, serverPath, uvxCmd, silent = true) {
  if (!fileExists(serverPath)) return false;
  const { parseYaml, stringifyYaml } = require('./agent_manager');
  const entries = buildOpenCodeMcpEntries({ pythonCmd, serverPath, uvxCmd });

  // Backup existing config once, then replace mcp block with only Konoha servers
  backupFile(OPENCODE_GLOBAL, silent);

  let existingConfig = {};
  if (fileExists(OPENCODE_GLOBAL)) {
    try {
      existingConfig = parseYaml(fs.readFileSync(OPENCODE_GLOBAL, 'utf-8')) || {};
    } catch { /* ignore parse errors, start fresh */ }
  }

  if (!existingConfig.$schema) {
    existingConfig.$schema = 'https://opencode.ai/config.yaml';
  }
  // Replace mcp block entirely with only Konoha servers
  existingConfig.mcp = entries;
  ensureDir(path.dirname(OPENCODE_GLOBAL));
  fs.writeFileSync(OPENCODE_GLOBAL, stringifyYaml(existingConfig) + '\n');
  if (!silent) console.log(`  ✓ ${path.basename(OPENCODE_GLOBAL)} replaced with Konoha-only MCP servers`);
  return true;
}

function resolveClaudeModel(agent) {
  const val = (agent.claudeModel || '').toLowerCase();
  if (val.includes('haiku')) return 'haiku';
  if (val.includes('opus')) return 'opus';
  return 'sonnet';
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
    .replace(/semble\.search/g, 'mcp__semble__search')
    .replace(/semble\.find_related/g, 'mcp__semble__find_related')
    .replace(/read_file_head/g, 'mcp__konoha__read_file_head')
    .replace(/read_file_range/g, 'mcp__konoha__read_file_range')
    .replace(/file_info/g, 'mcp__konoha__file_info')
    .replace(/token_efficient_grep/g, 'mcp__konoha__token_efficient_grep')
    .replace(/get_file_structure/g, 'mcp__konoha__get_file_structure')
    .replace(/find_files_clean/g, 'mcp__konoha__find_files_clean')
    .replace(/search_file/g, 'mcp__konoha__search_file')
    .trim();
}

function generateClaudeCodeSubagent(agent) {
  const model = resolveClaudeModel(agent);
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
    const logPattern = /Log:\s*(['"])(.*?)\1\.\s*/i;
    const logMatch = instructions.match(logPattern);
    if (logMatch) {
      const insertIndex = logMatch.index + logMatch[0].length;
      instructions = instructions.slice(0, insertIndex) + `Before work: ${findSkillCalls} ` + instructions.slice(insertIndex);
    } else {
      instructions = `Before work: ${findSkillCalls} ` + instructions;
    }
  }

  const body = adaptInstructionsForClaudeCode(instructions);
  const sembleLine = buildSembleSearchPolicyCompact();
  const fileToolsLine = buildFileToolsPolicyCompact();

  const frontmatter = [
    '---',
    `name: ${agent.name}`,
    `description: "${description.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`,
    `model: ${model}`,
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

  if (ruleContent) {
    deployClaudeCodeRules(ruleContent, silent);
  }



  if (deployProject && projectRoot) {
    try {
      deployProjectClaudeMd(projectRoot, agents, silent, ruleContent);
    } catch {}
  }

  return { ok: true };
}

function resolveOpenCodeModel(agent) {
  return agent.opencodeModel || 'inherit';
}

function generateOpenCodeSubagent(agent) {
  const model = resolveOpenCodeModel(agent);
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
    const logPattern = /Log:\s*(['"])(.*?)\1\.\s*/i;
    const logMatch = instructions.match(logPattern);
    if (logMatch) {
      const insertIndex = logMatch.index + logMatch[0].length;
      instructions = instructions.slice(0, insertIndex) + `Before work: ${findSkillCalls} ` + instructions.slice(insertIndex);
    } else {
      instructions = `Before work: ${findSkillCalls} ` + instructions;
    }
  }

  const body = adaptInstructionsForClaudeCode(instructions);
  const sembleLine = buildSembleSearchPolicyCompact();
  const fileToolsLine = buildFileToolsPolicyCompact();

  const frontmatter = [
    '---',
    `name: ${agent.name}`,
    `description: "${description.replace(/"/g, '\\\"').replace(/\n/g, ' ')}"`,
    `model: ${model}`,
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



function ensureOpenCodeSetup(options = {}) {
  const {
    pythonCmd = 'python3',
    serverPath = SERVER_PATH,
    uvxCmd = 'uvx',
    silent = true,
    agents = []
  } = options;

  if (!isOpenCodeInstalled()) {
    return { ok: false, reason: 'opencode CLI not detected' };
  }

  deployUtils.installFileTools(silent);

  if (!fileExists(serverPath)) {
    return { ok: false, reason: 'konoha server not installed' };
  }

  registerOpenCodeGlobalMcp(pythonCmd, serverPath, uvxCmd, silent);



  return { ok: true };
}

function readMcpHealth(config, key = 'mcpServers') {
  const block = config[key] || config.mcp || {};
  return {
    konoha: !!block['konoha'],
    semble: !!block.semble,
    skillsDb: !!block['konoha']
  };
}

function getClaudeCodeStatus() {
  const status = {
    installed: isClaudeCodeInstalled(),
    globalConfig: fileExists(CLAUDE_JSON),
    mcpKonoha: false,
    mcpSemble: false,
    mcpSkillsDb: false,
    permissionsAllowed: false,
    agentsCount: 0
  };

  if (status.globalConfig) {
    try {
      const { parseYaml } = require('./agent_manager');
      const config = parseYaml(fs.readFileSync(CLAUDE_JSON, 'utf-8'));
      const health = readMcpHealth(config, 'mcpServers');
      status.mcpKonoha = health.konoha;
      status.mcpSemble = health.semble;
      status.mcpSkillsDb = health.skillsDb;
    } catch {}
  }

  if (fileExists(CLAUDE_SETTINGS)) {
    try {
      const { parseYaml } = require('./agent_manager');
      const settings = parseYaml(fs.readFileSync(CLAUDE_SETTINGS, 'utf-8'));
      const allowRaw = settings?.permissions?.allow;
      const allowed = Array.isArray(allowRaw) ? allowRaw : [];
      status.permissionsAllowed =
        allowed.includes('mcp__konoha__*') &&
        allowed.includes('mcp__semble__*');
    } catch {}
  }

  const claudeAgentsDir = path.join(HOME, '.claude', 'agents');
  const official = ['genin', 'kage', 'chunin', 'jonin', 'anbu', 'tokubetsu-jonin'];
  for (const name of official) {
    if (fileExists(path.join(claudeAgentsDir, `${name}.md`))) {
      status.agentsCount++;
    }
  }

  return status;
}

function getOpenCodeStatus() {
  const status = {
    installed: isOpenCodeInstalled(),
    globalConfig: fileExists(OPENCODE_GLOBAL),
    mcpKonoha: false,
    mcpSemble: false,
    mcpSkillsDb: false,
    agentsCount: 0
  };

  if (status.globalConfig) {
    try {
      const { parseYaml } = require('./agent_manager');
      const config = parseYaml(fs.readFileSync(OPENCODE_GLOBAL, 'utf-8'));
      const health = readMcpHealth(config, 'mcp');
      status.mcpKonoha = health.konoha;
      status.mcpSemble = health.semble;
      status.mcpSkillsDb = health.skillsDb;
    } catch {}
  }

  const opencodeAgentsDir = path.join(HOME, '.config', 'opencode', 'agents');
  const official = ['genin', 'kage', 'chunin', 'jonin', 'anbu', 'tokubetsu-jonin'];
  for (const name of official) {
    if (fileExists(path.join(opencodeAgentsDir, `${name}.md`))) {
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
  const official = ['genin', 'kage', 'chunin', 'jonin', 'anbu', 'tokubetsu-jonin'];
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

function removeOpenCodeConfig(silent = true) {
  if (fileExists(OPENCODE_GLOBAL)) {
    try {
      mergeJsonFile(
        OPENCODE_GLOBAL,
        (config) => removeKonohaFromMcpBlock(config.mcp),
        silent
      );
    } catch {}
  }

  // Remove OpenCode subagents
  const opencodeAgentsDir = path.join(HOME, '.config', 'opencode', 'agents');
  const official = ['genin', 'kage', 'chunin', 'jonin', 'anbu', 'tokubetsu-jonin'];
  for (const name of official) {
    const p = path.join(opencodeAgentsDir, `${name}.md`);
    if (fileExists(p)) {
      try {
        fs.unlinkSync(p);
      } catch {}
    }
  }
}

module.exports = {
  CLAUDE_JSON,
  CLAUDE_SETTINGS,
  OPENCODE_GLOBAL,
  KONOHA_MCP_NAMES,
  isClaudeCodeInstalled,
  isOpenCodeInstalled,
  buildStdioMcpServers,
  buildOpenCodeMcpEntries,
  registerClaudeCodeGlobalMcp,
  registerClaudeCodePermissions,
  deployClaudeCodeRules,
  deployProjectClaudeMd,
  removeProjectClaudeMd,
  registerOpenCodeGlobalMcp,
  ensureClaudeCodeSetup,
  ensureOpenCodeSetup,
  getClaudeCodeStatus,
  getOpenCodeStatus,
  removeClaudeCodeConfig,
  removeOpenCodeConfig,
  generateClaudeCodeSubagent,
  resolveOpenCodeModel,
  generateOpenCodeSubagent
};
