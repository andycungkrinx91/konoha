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
  CLAUDE_JSON, CLAUDE_SETTINGS, HOME,
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
    .replace(/(?<!mcp__konoha__)\bmcp_kage\b/g, 'mcp__konoha__mcp_kage')
    .replace(/(?<!mcp__konoha__)\bmcp_jonin\b/g, 'mcp__konoha__mcp_jonin')
    .replace(/(?<!mcp__konoha__)\bmcp_anbu\b/g, 'mcp__konoha__mcp_anbu')
    .replace(/(?<!mcp__konoha__)\bmcp_chunin\b/g, 'mcp__konoha__mcp_chunin')
    .replace(/(?<!mcp__konoha__)\bmcp_genin\b/g, 'mcp__konoha__mcp_genin')
    .replace(/(?<!mcp__konoha__)\bmcp_tokubetsu_jonin\b/g, 'mcp__konoha__mcp_tokubetsu_jonin')
    .replace(/(?<!mcp__konoha__)\bmcp_sannin\b/g, 'mcp__konoha__mcp_sannin')
    .replace(/(?<!mcp__konoha__)\bfind_skill\b/g, 'mcp__konoha__find_skill')
    .replace(/(?<!mcp__konoha__)\bget_skill\b/g, 'mcp__konoha__get_skill')
    .replace(/(?<!mcp__konoha__)\blist_skills\b/g, 'mcp__konoha__list_skills')
    .replace(/(?<!mcp__konoha__)\bread_file_head\b/g, 'mcp__konoha__read_file_head')
    .replace(/(?<!mcp__konoha__)\bread_file_range\b/g, 'mcp__konoha__read_file_range')
    .replace(/(?<!mcp__konoha__)\bfile_info\b/g, 'mcp__konoha__file_info')
    .replace(/(?<!mcp__konoha__)\btoken_efficient_grep\b/g, 'mcp__konoha__token_efficient_grep')
    .replace(/(?<!mcp__konoha__)\bget_file_structure\b/g, 'mcp__konoha__get_file_structure')
    .replace(/(?<!mcp__konoha__)\bfind_files_clean\b/g, 'mcp__konoha__find_files_clean')
    .replace(/(?<!mcp__konoha__)\bsearch_file\b/g, 'mcp__konoha__search_file')
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
  deployClaudeCodeRtkRule(silent);

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
    agentsCount: 0,
    rtkInstalled: isRtkInstalled(),
    rtkRuleDeployed: fileExists(path.join(HOME, '.claude', 'rules', 'rtk.md'))
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


module.exports = {
  CLAUDE_JSON,
  CLAUDE_SETTINGS,
  KONOHA_MCP_NAMES,
  isClaudeCodeInstalled,
  isRtkInstalled,
  buildStdioMcpServers,
  registerClaudeCodeGlobalMcp,
  registerClaudeCodePermissions,
  deployClaudeCodeRules,
  deployClaudeCodeRtkRule,
  deployProjectClaudeMd,
  removeProjectClaudeMd,
  ensureClaudeCodeSetup,
  getClaudeCodeStatus,
  removeClaudeCodeConfig,
  generateClaudeCodeSubagent,
};
