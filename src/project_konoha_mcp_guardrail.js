'use strict';

/**
 * src/project_konoha_mcp_guardrail.js
 *
 * Konoha-repository-only JavaScript guardrail interaction across all 8 coding
 * agent harnesses. Inside the Konoha repository, native file-read, search,
 * glob, outline, shell-bypass, and legacy IPC/MCP calls are rejected unless
 * routed through Konoha MCP and Konoha maintenance skills. Outside the Konoha
 * repository, this guardrail stays completely inactive (Rule 19 scope safety).
 */

const fs = require('fs');
const path = require('path');
const { isKonohaRepository, KONOHA_CANONICAL_TOOLS } = require('./deploy_utils');
const { checkCommandGuardrails } = require('./guardrails');
const { isTrustedKonohaTaskReadPath } = require('./hook-base');
const { isReadOnlyAgent } = require('./agent_file_safety');

const SUPPORTED_HARNESSES = Object.freeze([
  'antigravity',
  'claudecode',
  'cursor',
  'commandcode',
  'opencode',
  'codex',
  'omp',
  'pi'
]);

const HARNESS_ALIASES = Object.freeze({
  agy: 'antigravity',
  claude: 'claudecode',
  'claude-code': 'claudecode',
  'command-code': 'commandcode',
  'open-code': 'opencode',
  'pi-dev': 'pi',
  'pi.dev': 'pi'
});

const READ_TOOLS = new Set(['read', 'read_file', 'view_file', 'view', 'file_read']);
const SEARCH_TOOLS = new Set([
  'grep', 'grep_search', 'ripgrep', 'rg', 'search_code', 'find_in_files', 'search'
]);
const DISCOVERY_TOOLS = new Set([
  'glob', 'find_by_name', 'list_dir', 'ls', 'find_files', 'file_search', 'list_directory'
]);
const OUTLINE_TOOLS = new Set(['view_file_outline', 'view_code_item', 'view_symbol', 'outline']);
const SHELL_TOOLS = new Set(['bash', 'run_command', 'shell', 'execute_command', 'terminal', 'command']);
const WRITE_TOOLS = new Set([
  'write', 'edit', 'multiedit', 'notebookedit', 'write_file', 'edit_file',
  'replace_file_content', 'multi_replace_file_content', 'write_to_file'
]);

const RETIRED_IPC_FILES = new Set(['prompt.md', 'delegate.md', 'delegated.md', 'result.md']);
const RETIRED_MCP_TOOLS = new Set(['build_with_image_design', 'find_skills']);
const BINARY_READ_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.bmp',
  '.pdf', '.mp3', '.wav', '.mp4', '.woff', '.woff2', '.wasm', '.db', '.sqlite'
]);

const CANONICAL_KONOHA_SET = new Set([
  ...(Array.isArray(KONOHA_CANONICAL_TOOLS) ? KONOHA_CANONICAL_TOOLS : []),
  'aislop_scan', 'aislop_fix', 'aislop_why', 'aislop_baseline'
]);

function normalizeHarness(harness) {
  if (!harness || typeof harness !== 'string') return 'antigravity';
  const norm = harness.toLowerCase().trim();
  return HARNESS_ALIASES[norm] || norm;
}

function findKonohaRepoRoot(candidatePath) {
  if (!candidatePath || typeof candidatePath !== 'string') return null;
  let current;
  try {
    current = path.resolve(candidatePath);
    if (fs.existsSync(current)) {
      const st = fs.statSync(current);
      if (st.isFile()) current = path.dirname(current);
      current = fs.realpathSync(current);
    } else {
      const parent = path.dirname(current);
      current = fs.existsSync(parent) ? fs.realpathSync(parent) : parent;
    }
  } catch (_) {
    return null;
  }

  for (let depth = 0; depth < 32 && current; depth++) {
    if (isKonohaRepository(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

const TARGET_PATH_KEYS = new Set([
  'path', 'file_path', 'filepath', 'target_file', 'targetfile',
  'absolutepath', 'absolute_path', 'searchpath', 'search_path',
  'searchdirectory', 'search_directory', 'directorypath', 'directory_path',
  'target_directory', 'targetdirectory', 'dir', 'pattern', 'root'
]);

function _extractTargetPath(toolInput = {}) {
  if (!toolInput || typeof toolInput !== 'object') return '';
  for (const [k, v] of Object.entries(toolInput)) {
    if (TARGET_PATH_KEYS.has(k.toLowerCase()) && typeof v === 'string' && v.trim()) {
      return v.trim();
    }
  }
  return '';
}

function resolveKonohaProjectScope(payload = {}, options = {}) {
  const explicitCwd = options.projectRoot || options.cwd || payload.cwd
    || payload.workspacePath || payload.workspace_path
    || payload.projectPath || payload.project_path || null;
  const targetPath = _extractTargetPath(payload.tool_input || payload.toolInput || payload.input || payload.args || {});

  if (targetPath) {
    const absTarget = explicitCwd && !path.isAbsolute(targetPath)
      ? path.resolve(explicitCwd, targetPath)
      : targetPath;
    const targetRepo = findKonohaRepoRoot(absTarget);
    if (targetRepo) {
      return { inKonohaRepo: true, repoRoot: targetRepo, targetPath: absTarget };
    }
  }

  if (explicitCwd) {
    const explicitRepo = findKonohaRepoRoot(explicitCwd);
    return { inKonohaRepo: Boolean(explicitRepo), repoRoot: explicitRepo, targetPath };
  }

  const fallbackCwd = process.env.WORKSPACE_ROOT || process.env.KONOHA_WORKSPACE || process.cwd();
  const fallbackRepo = findKonohaRepoRoot(fallbackCwd);
  return { inKonohaRepo: Boolean(fallbackRepo), repoRoot: fallbackRepo, targetPath };
}

function _isAllowedRuntimeBypassPath(rawPath, repoRoot) {
  if (!rawPath) return false;
  if (isTrustedKonohaTaskReadPath(rawPath)) return true;
  const resolved = repoRoot && !path.isAbsolute(rawPath) ? path.resolve(repoRoot, rawPath) : path.resolve(rawPath);
  const norm = resolved.replace(/\\/g, '/');
  if (BINARY_READ_EXTENSIONS.has(path.extname(norm).toLowerCase())) return true;
  if (norm.includes('/.system_generated/') || norm.includes('/.konoha/tmp/')) return true;
  if (repoRoot) {
    const rel = path.relative(repoRoot, resolved);
    if (rel && (rel.startsWith('..') || path.isAbsolute(rel))) return true;
  }
  return false;
}

function _extractCommandText(toolInput = {}) {
  if (!toolInput || typeof toolInput !== 'object') return '';
  for (const [k, v] of Object.entries(toolInput)) {
    const lk = k.toLowerCase();
    if ((lk === 'command' || lk === 'commandline' || lk === 'cmd' || lk === 'script') && typeof v === 'string') {
      return v.trim();
    }
  }
  return '';
}

function _hasRtkWrapper(command) {
  const segments = String(command || '').split(/&&|\|\||;/).map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) return true;
  for (const seg of segments) {
    const tokens = seg.split(/\s+/).filter(Boolean);
    while (tokens.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) {
      tokens.shift();
    }
    if (tokens.length === 0) continue;
    const first = tokens[0].replace(/^.*\//, '');
    if (first === 'rtk') continue;
    if ((first === 'node' || first === 'node.exe') && tokens[1] && tokens[1].endsWith('rtk_exec.js')) continue;
    if (first === 'echo' || first === 'true' || first === 'pwd') continue;
    return false;
  }
  return true;
}

function isKonohaMcpTool(toolName, toolInput = {}) {
  if (!toolName || typeof toolName !== 'string') return { isKonoha: false, retired: false };
  const raw = toolName.trim();
  const lower = raw.toLowerCase();

  if (lower.startsWith('mcp__semble__') || lower.startsWith('mcp__skills-db__') || lower === 'semble') {
    return { isKonoha: false, retired: true, reason: `Legacy MCP "${raw}" is retired; use Konoha MCP tools instead.` };
  }
  if (RETIRED_MCP_TOOLS.has(lower) || lower.endsWith('__build_with_image_design') || lower.endsWith(':build_with_image_design')) {
    return { isKonoha: false, retired: true, reason: `Retired tool "${raw}" is blocked; use konoha:build_from_source instead.` };
  }

  if (lower === 'call_mcp_tool' || lower === 'use_mcp_tool' || lower === 'mcp_tool') {
    const server = String(toolInput.ServerName || toolInput.serverName || toolInput.server || toolInput.server_name || '').toLowerCase().trim();
    const mcpTool = String(toolInput.ToolName || toolInput.toolName || toolInput.tool || '').toLowerCase().trim();
    if (server === 'semble' || server === 'skills-db') {
      return { isKonoha: false, retired: true, reason: `Retired MCP server "${server}" is blocked; use ServerName: "konoha".` };
    }
    if (RETIRED_MCP_TOOLS.has(mcpTool)) {
      return { isKonoha: false, retired: true, reason: `Retired Konoha alias "${mcpTool}" is blocked; use build_from_source or find_skill.` };
    }
    if (server === 'konoha' || server === 'aislop') {
      return { isKonoha: true, retired: false };
    }
    return { isKonoha: false, retired: false };
  }

  if (
    lower.startsWith('mcp__konoha__') || lower.startsWith('mcp_konoha_') ||
    lower.startsWith('konoha/') || lower.startsWith('konoha:') || lower.startsWith('konoha.') ||
    lower.startsWith('mcp__aislop__') || lower.startsWith('mcp_aislop_') ||
    lower.startsWith('aislop/') || lower.startsWith('aislop:')
  ) {
    return { isKonoha: true, retired: false };
  }

  if (CANONICAL_KONOHA_SET.has(lower)) {
    return { isKonoha: true, retired: false };
  }

  return { isKonoha: false, retired: false };
}

function _allowResult(harness, inKonohaRepo, repoRoot, reason, extra = {}) {
  return {
    allowed: true,
    decision: 'allow',
    enforced: inKonohaRepo,
    in_konoha_repo: inKonohaRepo,
    repo_root: repoRoot || null,
    harness,
    code: extra.code || 'ALLOWED',
    reason,
    ...extra
  };
}

function _denyResult(harness, repoRoot, code, reason) {
  return {
    allowed: false,
    decision: 'deny',
    enforced: true,
    in_konoha_repo: true,
    repo_root: repoRoot,
    harness,
    code,
    reason
  };
}

function evaluateProjectMcpGuardrail(payload = {}, options = {}) {
  const harness = normalizeHarness(options.harness || payload.harness || payload.client);
  const scope = resolveKonohaProjectScope(payload, options);

  if (!scope.inKonohaRepo) {
    return _allowResult(harness, false, null, 'Outside Konoha repository scope; project-only guardrail inactive.');
  }

  const toolName = String(payload.tool_name || payload.toolName || payload.tool || '').trim();
  const toolInput = payload.tool_input || payload.toolInput || payload.input || payload.args || {};
  const lowerTool = toolName.toLowerCase();

  const mcpCheck = isKonohaMcpTool(toolName, toolInput);
  if (mcpCheck.retired) {
    return _denyResult(harness, scope.repoRoot, 'RETIRED_LEGACY_MCP', mcpCheck.reason);
  }
  if (mcpCheck.isKonoha) {
    return _allowResult(harness, true, scope.repoRoot, 'Approved Konoha MCP tool call.', { konoha_mcp: true });
  }

  const targetPath = _extractTargetPath(toolInput);
  if (READ_TOOLS.has(lowerTool)) {
    if (_isAllowedRuntimeBypassPath(targetPath, scope.repoRoot)) {
      return _allowResult(harness, true, scope.repoRoot, 'Allowed non-repo/binary/trusted-task read.');
    }
    const isSkillTarget = /(?:^|\/)(?:skills\/|SKILL\.md$)/i.test(targetPath);
    const suggestion = isSkillTarget
      ? 'konoha:find_skill / konoha:get_skill / konoha:use_skills'
      : 'konoha:read_file_range / konoha:read_file_head / konoha:file_info';
    return _denyResult(
      harness,
      scope.repoRoot,
      'KONOHA_MCP_REQUIRED_READ',
      `[${harness}] Raw tool "${toolName}" is rejected in the Konoha repository. Use ${suggestion} via Konoha MCP.`
    );
  }

  if (SEARCH_TOOLS.has(lowerTool)) {
    return _denyResult(
      harness,
      scope.repoRoot,
      'KONOHA_MCP_REQUIRED_SEARCH',
      `[${harness}] Raw search "${toolName}" is rejected in the Konoha repository. Use konoha:code_search, konoha:code_symbol, konoha:code_impact, or konoha:token_efficient_grep.`
    );
  }

  if (DISCOVERY_TOOLS.has(lowerTool)) {
    return _denyResult(
      harness,
      scope.repoRoot,
      'KONOHA_MCP_REQUIRED_DISCOVERY',
      `[${harness}] Raw file/dir discovery "${toolName}" is rejected in the Konoha repository. Use konoha:find_files_clean.`
    );
  }

  if (OUTLINE_TOOLS.has(lowerTool)) {
    return _denyResult(
      harness,
      scope.repoRoot,
      'KONOHA_MCP_REQUIRED_STRUCTURE',
      `[${harness}] Raw outline/symbol inspection "${toolName}" is rejected in the Konoha repository. Use konoha:get_file_structure or konoha:code_symbol.`
    );
  }

  if (WRITE_TOOLS.has(lowerTool)) {
    const agentIdentity = options.agent || payload.agent || process.env.KONOHA_CHILD_AGENT || '';
    if (agentIdentity && isReadOnlyAgent(agentIdentity)) {
      return _denyResult(
        harness,
        scope.repoRoot,
        'READ_ONLY_AGENT_WRITE_DENIED',
        `[${harness}] Read-only agent @${agentIdentity} cannot invoke "${toolName}" in the Konoha repository.`
      );
    }
    const baseName = targetPath ? path.basename(targetPath).toLowerCase() : '';
    if (RETIRED_IPC_FILES.has(baseName)) {
      return _denyResult(
        harness,
        scope.repoRoot,
        'RETIRED_LEGACY_IPC',
        `[${harness}] Writing retired IPC file "${baseName}" is forbidden; use JSONL transcripts and structured MCP tool arguments.`
      );
    }
    if (/^\.env(?:\.|$)/i.test(baseName)) {
      return _denyResult(
        harness,
        scope.repoRoot,
        'SECRET_FILE_WRITE_DENIED',
        `[${harness}] Writing secret file "${baseName}" is forbidden in the Konoha repository.`
      );
    }
    return _allowResult(harness, true, scope.repoRoot, 'File modification tool permitted in Konoha repository.');
  }

  if (SHELL_TOOLS.has(lowerTool)) {
    const command = _extractCommandText(toolInput);
    const guardViolation = checkCommandGuardrails(command);
    if (guardViolation) {
      return _denyResult(
        harness,
        scope.repoRoot,
        'SHELL_GUARDRAIL_VIOLATION',
        `[${harness}] ${guardViolation.reason} Use Konoha MCP tools inside the Konoha repository.`
      );
    }
    if (options.requireRtkPrefix !== false && !_hasRtkWrapper(command)) {
      return _denyResult(
        harness,
        scope.repoRoot,
        'RTK_REQUIRED',
        `[${harness}] Shell command without rtk wrapper is rejected in the Konoha repository: prefix with "rtk <command>".`
      );
    }
    return _allowResult(harness, true, scope.repoRoot, 'Approved rtk-wrapped shell command.');
  }

  return _allowResult(harness, true, scope.repoRoot, `Tool "${toolName || 'unknown'}" permitted by project guardrail.`);
}

function formatHarnessDecision(harness, evalResult) {
  const client = normalizeHarness(harness || evalResult.harness);
  const allowed = Boolean(evalResult && evalResult.allowed);
  const reason = (evalResult && evalResult.reason) || '';

  switch (client) {
    case 'claudecode':
    case 'commandcode':
      return {
        decision: allowed ? 'allow' : 'deny',
        reason,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: allowed ? 'allow' : 'deny',
          permissionDecisionReason: reason
        }
      };
    case 'cursor':
      return {
        continue: allowed,
        permission: allowed ? 'allow' : 'deny',
        decision: allowed ? 'allow' : 'deny',
        userMessage: allowed ? undefined : reason,
        agentMessage: allowed ? undefined : reason,
        reason
      };
    case 'opencode':
      return {
        allowed,
        decision: allowed ? 'allow' : 'deny',
        reason,
        ...(allowed ? {} : { error: reason })
      };
    case 'omp':
    case 'pi':
      return allowed
        ? { decision: 'allow', reason }
        : { block: true, decision: 'deny', reason };
    case 'codex':
      return {
        approve: allowed,
        block: !allowed,
        decision: allowed ? 'allow' : 'deny',
        reason
      };
    case 'antigravity':
    default:
      return {
        decision: allowed ? 'allow' : 'deny',
        reason
      };
  }
}

function handleHarnessToolCall(harness, payload = {}, options = {}) {
  const evalResult = evaluateProjectMcpGuardrail(payload, { ...options, harness });
  return {
    evaluation: evalResult,
    response: formatHarnessDecision(harness, evalResult)
  };
}

function createHarnessInterceptor(harness, defaults = {}) {
  const canonical = normalizeHarness(harness);
  return function konohaProjectMcpInterceptor(payload = {}, overrides = {}) {
    const mergedOpts = { ...defaults, ...overrides, harness: canonical };
    const { evaluation, response } = handleHarnessToolCall(canonical, payload, mergedOpts);
    if (!evaluation.allowed && canonical === 'opencode' && mergedOpts.throwOnDeny !== false) {
      const err = new Error(evaluation.reason);
      err.code = evaluation.code;
      err.guardrailResponse = response;
      throw err;
    }
    return response;
  };
}

const PLUGIN_MANIFEST_JSON = JSON.stringify({
  name: 'konoha-mcp-guard',
  description: 'Konoha repository-only JS guardrail enforcing Konoha MCP tools and maintenance skills across all 8 harnesses.',
  version: '1.0.0'
}, null, 2) + '\n';

const PLUGIN_HOOKS_JSON = JSON.stringify({
  'konoha-mcp-guard': {
    enabled: true,
    PreToolUse: [
      {
        matcher: 'Read|read|read_file|view_file|view_file_outline|view_code_item|view_symbol|Grep|grep|grep_search|Glob|glob|find_by_name|list_dir|LS|Bash|bash|run_command|shell|Write|Edit|edit_file|write_file|replace_file_content|write_to_file|call_mcp_tool|mcp__semble__.*|mcp__skills-db__.*',
        hooks: [
          {
            type: 'command',
            command: 'node scripts/konoha_project_mcp_guard.js --harness antigravity',
            timeout: 10
          }
        ]
      }
    ]
  }
}, null, 2) + '\n';

const PLUGIN_GUARD_BRIDGE_JS = `'use strict';

/**
 * .agents/plugins/konoha-mcp-guard/guard.js
 *
 * Project-local JS bridge exposing the Konoha-MCP-only guardrail for all
 * 8 supported harnesses inside the Konoha repository only.
 */

const path = require('path');
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const {
  SUPPORTED_HARNESSES,
  createHarnessInterceptor,
  evaluateProjectMcpGuardrail,
  handleHarnessToolCall
} = require(path.join(repoRoot, 'src', 'project_konoha_mcp_guardrail'));

const interceptors = Object.freeze(
  Object.fromEntries(
    SUPPORTED_HARNESSES.map((harness) => [
      harness,
      createHarnessInterceptor(harness, {
        projectRoot: repoRoot,
        throwOnDeny: harness === 'opencode'
      })
    ])
  )
);

module.exports = {
  SUPPORTED_HARNESSES,
  interceptors,
  evaluateProjectMcpGuardrail,
  handleHarnessToolCall,
  createHarnessInterceptor
};
`;

function _writeTextIfDifferent(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath)) {
    try {
      if (fs.readFileSync(filePath, 'utf8') === content) return false;
    } catch (_) { /* rewrite unreadable target */ }
  }
  fs.writeFileSync(filePath, content, 'utf8');
  return true;
}

/**
 * Materialize `.agents/plugins/konoha-mcp-guard/` strictly inside the Konoha
 * repository so PreToolUse plugin hooks always find `scripts/konoha_project_mcp_guard.js`.
 */
function ensureProjectKonohaGuardPlugin(projectRoot) {
  const repoRoot = findKonohaRepoRoot(projectRoot);
  if (!repoRoot) {
    return { ok: true, skipped: true, reason: 'not_konoha_repository' };
  }
  const guardCliSrc = path.join(repoRoot, 'scripts', 'konoha_project_mcp_guard.js');
  if (!fs.existsSync(guardCliSrc)) {
    return { ok: false, skipped: true, reason: 'guard_cli_source_missing' };
  }

  const pluginDir = path.join(repoRoot, '.agents', 'plugins', 'konoha-mcp-guard');
  const scriptDest = path.join(pluginDir, 'scripts', 'konoha_project_mcp_guard.js');
  const cliContent = fs.readFileSync(guardCliSrc, 'utf8');

  const updated = [];
  if (_writeTextIfDifferent(path.join(pluginDir, 'plugin.json'), PLUGIN_MANIFEST_JSON)) updated.push('plugin.json');
  if (_writeTextIfDifferent(path.join(pluginDir, 'hooks.json'), PLUGIN_HOOKS_JSON)) updated.push('hooks.json');
  if (_writeTextIfDifferent(path.join(pluginDir, 'guard.js'), PLUGIN_GUARD_BRIDGE_JS)) updated.push('guard.js');
  if (_writeTextIfDifferent(scriptDest, cliContent)) updated.push('scripts/konoha_project_mcp_guard.js');

  return { ok: true, skipped: false, repoRoot, pluginDir, updated };
}

module.exports = {
  SUPPORTED_HARNESSES,
  normalizeHarness,
  findKonohaRepoRoot,
  resolveKonohaProjectScope,
  isKonohaMcpTool,
  evaluateProjectMcpGuardrail,
  formatHarnessDecision,
  handleHarnessToolCall,
  createHarnessInterceptor,
  ensureProjectKonohaGuardPlugin
};
