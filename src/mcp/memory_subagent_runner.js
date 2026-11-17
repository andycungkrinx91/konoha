'use strict';

const fs = require('fs');
const { buildDisciplineContract, COMPACT_REMINDER } = require('./discipline_contract');
const { REMEDIATION_INVARIANT } = require('./remediation_contract');
const path = require('path');
const db = require('../db');
const { getDb } = db;
const personaMemory = require('../persona_memory');
const {
  formatProjectContext: _formatProjectContext,
  loadBaseProjectContext: _loadBaseProjectContext
} = require('./project_context_prompt');
const { getWorkspaceRoot, getActiveClient } = require('./runtime_state');
const {
  detectActiveClient,
  resolveFirstSpawnClient,
  getSessionKey,
  getAndIncrementSessionTurn
} = require('./client_detection');
const { fuzzyResolveSkill, logToolCall } = require('./skills');
const { getResolvedTaskDir, loadWorkflowStatus, saveWorkflowStatus } = require('./workflow_common');
const { prepareAgentTurnEnvelope } = require('../context_compaction');
const { syncTodoAndWalkthrough, formatTodoSyncBlock, markAgentTodoInProgress } = require('./todo_walkthrough_sync');
const { buildSpawnDirective } = require('./lazy_subagent');
const { isResidentSupervisorAgent, getAdvisorAgentDefinition } = require('../canonical_agents');
const { buildSubagentMcpBlock } = require('./subagent_tool_contract');
const { consumeAdvisorSteerContext } = require('../workflow/kage-reviewer/advisor_monitor');
const { resolveTaskId, readSharedContext, formatSharedContextBlock } = require('./shared_context');
const { authorizeSkillAccess, lookupSkillTags, findUnauthorizedSkill } = require('../skill_authorization');
const {
  slicePreservingHeadMiddleTail,
  sliceBytesPreservingHeadMiddleTail
} = require('../context_budget');

function getMainModel() {
  let conn = null;
  try {
    conn = getDb();
    const row1 = conn.prepare('SELECT model_tier FROM agents WHERE name = ?').get('sannin');
    if (row1 && row1.model_tier) return row1.model_tier;
    const row2 = conn.prepare('SELECT model_tier FROM agents WHERE name = ?').get('kage');
    if (row2 && row2.model_tier) return row2.model_tier;
  } catch (_) { /* ignore */ }
  finally {
    // Windows keeps the database file locked while a handle is open, which makes
    // temp-dir teardown fail with EPERM. Every getDb() handle is closed here.
    try { if (conn) conn.close(); } catch (_) { /* best-effort */ }
  }
  return 'Gemini 3.1 Pro (High)';
}

function applySingleDiffMatch(filePath, original, replacement) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!original.trim()) {
    fs.writeFileSync(filePath, replacement, 'utf8');
    return;
  }
  if (!fs.existsSync(filePath)) return;
  const fileContent = fs.readFileSync(filePath, 'utf8');
  if (fileContent.includes(original)) {
    fs.writeFileSync(filePath, fileContent.replace(original, () => replacement), 'utf8');
    return;
  }
  const origLf = original.replace(/\r\n/g, '\n');
  const fileLf = fileContent.replace(/\r\n/g, '\n');
  if (fileLf.includes(origLf)) {
    fs.writeFileSync(filePath, fileLf.replace(origLf, () => replacement), 'utf8');
  }
}

function applyFileEdits(content) {
  const workspace = getWorkspaceRoot() || process.cwd();
  const pattern = /FILE:\s*(.*?)\r?\n<<<<<<<\s*original\r?\n([\s\S]*?)\r?\n=======\r?\n([\s\S]*?)\r?\n>>>>>>>/gi;
  let match;
  while ((match = pattern.exec(content)) !== null) {
    let filePath = match[1].trim();
    if (!path.isAbsolute(filePath)) filePath = path.resolve(workspace, filePath);
    applySingleDiffMatch(filePath, match[2], match[3]);
  }
}

const AUTOLOAD_SKILL_STOPWORDS = new Set([
  'with', 'from', 'this', 'that', 'have', 'make', 'into', 'then', 'more', 'some',
  'when', 'will', 'also', 'about', 'your', 'using', 'need', 'want', 'only', 'after',
  'before', 'first', 'last', 'each', 'every', 'both', 'between', 'under', 'over',
  'task', 'build', 'create', 'setup', 'update', 'test', 'help', 'work', 'code'
]);

function autoloadSkillsFromPrompt(prompt, conn, maxMatches = 3) {
  if (!prompt || !prompt.trim()) return [];
  const tokens = prompt.toLowerCase().replace(/[^a-z0-9_-]/g, ' ').split(/\s+/).filter(t => t.length > 3 && !AUTOLOAD_SKILL_STOPWORDS.has(t));
  if (tokens.length === 0) return [];

  const rows = conn.prepare("SELECT skill_name, content FROM skills WHERE type = 'skill'").all();
  const scored = [];
  for (const row of rows) {
    if (row.skill_name.startsWith('antislop') || row.skill_name === 'i-have-adhd') continue;
    const nameLower = row.skill_name.toLowerCase();
    const haystack = (nameLower + ' ' + (row.content || '').substring(0, 300)).toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (nameLower === t || nameLower.includes(t)) {
        score += 5;
      } else if (haystack.includes(t)) {
        score += 1;
      }
    }
    if (score > 0) scored.push({ score, name: row.skill_name });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxMatches).map(x => x.name);
}

const RESEARCH_AGENTS = new Set(['chunin']);

/**
 * Web research must be retrieved through RTK so the provider receives compressed,
 * citation-bearing text instead of raw markup. Non-research agents get no extra
 * bytes: their template contract is unchanged.
 */
function buildResearchFetchRule(agentName) {
  if (!RESEARCH_AGENTS.has(agentName)) return '';
  return '- RESEARCH RETRIEVAL: Fetch every source through `rtk curl <url>`; never bare curl, wget, or raw fetch. Keep URLs and citation ids verbatim.' + '\n';
}

/** Whole-prompt token guardrail and the floor the system prompt may not shrink below. */
const PROMPT_CEILING_BYTES = 8000;
const SYSTEM_PROMPT_FLOOR_BYTES = 1500;
/** Bytes of skill SOP kept before the budget may drop skill bodies entirely. */
const MIN_SKILL_PREVIEW_BYTES = 600;

const REMEDIATION_FALLBACK = `${REMEDIATION_INVARIANT} ${COMPACT_REMINDER}`;

/**
 * Pick the largest discipline block the remaining prompt budget can carry.
 * The remediation loop is invariant, so every tier keeps it: the full
 * contract (loop first), then loop plus compact reminder, then the loop line.
 *
 * @param {number} headroomBytes
 * @returns {string}
 */
function resolveDisciplineBlock(headroomBytes) {
  if (headroomBytes > COMPACT_REMINDER.length) {
    const contract = buildDisciplineContract({ maxBytes: headroomBytes });
    if (contract) return contract;
  }
  for (const candidate of [REMEDIATION_FALLBACK, REMEDIATION_INVARIANT]) {
    if (Buffer.byteLength(candidate, 'utf8') + 1 <= headroomBytes) return candidate;
  }
  return '';
}
/**
 * Hard byte ceiling for the assembled prompt. `truncateAtBoundary` works in
 * characters, so a multi-byte body could still overshoot; this converges on the
 * byte budget and is the last line of defence for the token guardrail.
 *
 * @param {string} text
 * @param {number} maxBytes
 * @returns {string}
 */
function clampToBytes(text, maxBytes) {
  return sliceBytesPreservingHeadMiddleTail(text || '', maxBytes, { markerLabel: 'prompt-cap' });
}

function truncateAtBoundary(text, maxChars) {
  const s = text || '';
  if (s.length <= maxChars) return s;
  return slicePreservingHeadMiddleTail(s, maxChars, { markerLabel: 'truncated' });
}

function cleanRedundantPersonaText(text) {
  if (!text) return '';
  return text
    .replace(/Base personality: High Effort \+ Instruct Style —[^.]+\./gi, '')
    .replace(/and adhere strictly to base personality:[^.]+\./gi, '')
    .replace(/Call konoha\.find_skill for skills\.[\s\S]*?(?=Call the code_search|\. [A-Z]|$)/gi, '')
    .replace(/Call the code_search tools? \(code_search\/code_symbol\) directly for codebase search\. Do NOT mix them\.?/gi, '')
    .replace(/Do NOT call `?code_search`? tools[^.]+./gi, '')
    .replace(/NEVER use `?code_search`? for skills\.?/gi, '')
    .replace(/NEVER use grep, glob, find[^.]+\./gi, '')
    .replace(/Always use `?konoha`? MCP tools[^.]+\./gi, '')
    .replace(/\s*\.\s*\./g, '.')
    .replace(/^\s*\.\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function queryAgentRow(rowConn, name) {
  try {
    return rowConn.prepare('SELECT name, title, purpose, skills, constraints_text, instructions, model FROM agents WHERE name = ?').get(name) ||
           rowConn.prepare('SELECT name, title, purpose, skills, constraints_text, instructions, model FROM agents WHERE name = ?').get(`mcp_${name}`);
  } catch (colErr) {
    if (colErr?.message?.includes('no such column: model')) {
      return rowConn.prepare('SELECT name, title, purpose, skills, constraints_text, instructions FROM agents WHERE name = ?').get(name) ||
             rowConn.prepare('SELECT name, title, purpose, skills, constraints_text, instructions FROM agents WHERE name = ?').get(`mcp_${name}`);
    }
    throw colErr;
  }
}

function safeParseSkills(skillsRaw) {
  if (!skillsRaw) return [];
  try {
    const parsed = JSON.parse(skillsRaw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function _resolveAgentDbMetadata(dbAgentName) {
  let title = dbAgentName;
  let purpose = '';
  let agentConstraints = '';
  let personaInstructions = '';
  let skillsList = [];
  let assignedModel = 'inherit';

  let rowConn = null;
  let hasRow = false;
  try {
    rowConn = getDb();
    const row = queryAgentRow(rowConn, dbAgentName);
    if (row) {
      hasRow = true;
      title = row.title || title;
      purpose = row.purpose || purpose;
      agentConstraints = cleanRedundantPersonaText(row.constraints_text || agentConstraints);
      personaInstructions = cleanRedundantPersonaText(row.instructions || personaInstructions);
      if (row.model) assignedModel = row.model;
      skillsList = safeParseSkills(row.skills);
    }
  } catch (e) {
    process.stderr.write(`[mcp konoha] Error reading agent row from DB: ${e.message}\n`);
  } finally {
    if (rowConn) {
      try { rowConn.close(); } catch (_) { /* best-effort */ }
    }
  }

  // Resident supervisors are deployable but deliberately outside the 9-ninja
  // roster, so `seedAgents` never writes their row. Without this fallback the
  // spawned child gets `Purpose: ` and no constraints, and does nothing.
  if (!hasRow && isResidentSupervisorAgent(dbAgentName)) {
    const def = getAdvisorAgentDefinition();
    title = def.title || title;
    purpose = def.purpose || purpose;
    agentConstraints = cleanRedundantPersonaText(def.constraints || '');
    personaInstructions = cleanRedundantPersonaText(def.instructions || '');
  }

  return { title, purpose, agentConstraints, personaInstructions, skillsList, assignedModel };
}

function _resolveJoninSkills(resolvedProjPath, instructions, context, currentSkills) {
  if (currentSkills.length > 0) return currentSkills;
  let targetFw = null;
  const combinedText = `${instructions} ${context || ''}`.toLowerCase();
  if (resolvedProjPath && fs.existsSync(resolvedProjPath)) {
    const pkgPath = path.join(resolvedProjPath, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkgContent = fs.readFileSync(pkgPath, 'utf8').toLowerCase();
        if (pkgContent.includes('next')) targetFw = 'nextjs';
        else if (pkgContent.includes('svelte')) targetFw = 'svelte';
        else if (pkgContent.includes('nuxt')) targetFw = 'nuxt';
        else if (pkgContent.includes('angular') || pkgContent.includes('@angular')) targetFw = 'angular';
      } catch (_) { /* ignore */ }
    }
  }
  if (!targetFw) {
    if (combinedText.includes('next') || combinedText.includes('react')) targetFw = 'nextjs';
    else if (combinedText.includes('svelte')) targetFw = 'svelte';
    else if (combinedText.includes('nuxt') || combinedText.includes('vue')) targetFw = 'nuxt';
    else if (combinedText.includes('angular') || combinedText.includes('ng')) targetFw = 'angular';
    else targetFw = 'nextjs';
  }
  return [
    'jonin-skill',
    `jonin-skill/${targetFw}-code-expert`,
    `jonin-skill/${targetFw}-ui-expert`,
    'jonin-skill/taste-skill-frontend-expert'
  ];
}

function _buildTasteSkillBlock(tasteDials) {
  const dials = tasteDials || {};
  const varDial = dials.design_variance !== undefined ? dials.design_variance : 8;
  const motDial = dials.motion_intensity !== undefined ? dials.motion_intensity : 7;
  const densDial = dials.visual_density !== undefined ? dials.visual_density : 6;
  return (
    '### Taste-Skill Design Engine: Design Brief & Anti-Template Directives:\n' +
    '- Author the 9-field design brief (product, industry, audience, primary_objective, user_outcome, information_architecture, interactions, visual_identity, technical_constraints) before any layout or palette decision.\n' +
    `- Dials: DESIGN_VARIANCE=${varDial}/10 | MOTION_INTENSITY=${motDial}/10 | VISUAL_DENSITY=${densDial}/10 (exploration breadth, not a house style)\n` +
    '- Derive art direction, IA, navigation, theme, and motion from the brief; commerce/SaaS/catalog sections only when the brief requires them.\n' +
    '- Anti-Template Gate: every section maps to a brief objective; no recycled layout; justified motion; responsive 375/768/1440.\n' +
    '- Anti-Slop: zero AI-purple gradients, zero boilerplate sections, zero emojis (Phosphor or inline SVG).\n' +
    '- Branding & QA: `<meta name="generator" content="Build by konoha">`, visible `Build by konoha` footer, pnpm only, zero errors/warnings, `rtk aislop scan --changes`.\n'
  );
}

function _buildTokubetsuDocBlock() {
  return (
    '### Tokubetsu-Jonin Document Engineering & Design Directives:\n' +
    '- Native Tools: document_create (DOCX/PDF), spreadsheet_create (XLSX), presentation_create (PPTX), diagram_create (SVG), animation_export (WebP).\n' +
    '- Skills via FTS5/RAG: Query konoha.find_skill and konoha.get_skill; never read raw markdown directly.\n' +
    '- Fonts & Themes: Inter, JetBrains Mono. 20 Production Themes (T01-T20). Pure light mode, zero dark fills.\n' +
    '- Quality Gate: Strict AI score < 3.0% (ZeroGPT risk < 3.0%), sentence CV >= 0.85, active voice, zero robotic clichés, metadata scrubbed.\n'
  );
}

function _loadSkillsContent(skillsList, agentName) {
  if (!Array.isArray(skillsList) || skillsList.length === 0) return [];
  let skillConn = null;
  const skillsContent = [];
  try {
    skillConn = getDb();
    const queryStmt = skillConn.prepare('SELECT content, type FROM skills WHERE name = ?');
    for (const skillName of skillsList.slice(0, 3)) {
      if (!skillName) continue;
      const resolved = fuzzyResolveSkill(skillName, skillConn) || skillName;
      const tags = lookupSkillTags(skillConn, resolved);
      if (!authorizeSkillAccess({ skillName: resolved, tags, agentName }).authorized) continue;
      const row = queryStmt.get(resolved);
      if (row?.content) {
        const preview = row.content.substring(0, 45).trim() + (row.content.length > 45 ? '... (Call konoha.get_skill)' : '');
        const label = row.type === 'skill' ? 'Skill' : 'Reference';
        skillsContent.push(`### ${label}: ${resolved}\n\n${preview}`);
      }
    }
  } catch (e) {
    process.stderr.write(`[mcp ${agentName}] Error loading skill definitions: ${e.message}\n`);
  } finally {
    if (skillConn) {
      try { skillConn.close(); } catch (_) { /* best-effort */ }
    }
  }
  return skillsContent;
}

function _resolveSpawnDirective({ isChildWorker, client, agent, skills, projectPath, prompt, worktree, piSubagentSupported }) {
  if (isChildWorker) return { spawnDirective: undefined, spawnError: undefined };
  const raw = buildSpawnDirective({ client, agent, skills, projectPath, prompt, worktree: worktree || null, piSubagentSupported });
  if (raw && raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && (parsed.error_code === 'UNSUPPORTED_NATIVE_SPAWN' || parsed.code === 'SKILL_AUTHORIZATION_DENIED')) {
        return { spawnDirective: undefined, spawnError: parsed };
      }
    } catch (_) { /* keep raw directive */ }
  }
  return { spawnDirective: raw || undefined, spawnError: undefined };
}

function _buildTaskInstructions(opts, dorResult) {
  let out = opts.task.trim();
  if (dorResult && !dorResult.ready && dorResult.missing.length > 0) {
    out += '\n\n### Definition-of-Readiness (DoR) Advisory Hints:\n' + dorResult.missing.map(m => `- ${m}`).join('\n');
  }
  const addSection = (title, val) => {
    const text = typeof val === 'string' ? val.trim() : (Array.isArray(val) ? val.join('\n') : '');
    if (text) out += `\n\n### ${title}:\n${text}`;
  };
  addSection('Context & Relevant Code Paths', opts.context);
  addSection('Execution Constraints', opts.constraints);
  if (opts.worktree) {
    try {
      const { buildWorktreeDirective } = require('./worktree_isolation');
      const d = buildWorktreeDirective(typeof opts.worktree === 'string' ? { worktree_path: opts.worktree } : opts.worktree);
      if (d) out += `\n\n${d}`;
    } catch (_) { /* isolation is best-effort; never block the dispatch */ }
  }
  return out;
}

function _assembleSystemPrompt(data) {
  const { dbAgentName, title, purpose, agentConstraints, personaInstructions, projectContextBlock, soulBehaviorBlock, tasteSkillBlock, docDesignBlock, skillsList, skillsContent, effFlowHash, agentName, client, resolvedProjPath, instructions, isChildWorker = false, piSubagentSupported } = data;
  const staticHeader = (
    '[Konoha Token Preservation: Active - High-Efficiency Context]\n\n' +
    'IMPORTANT: The TASK INSTRUCTIONS at the bottom of this prompt are the complete, ' +
    'authoritative task. Never reinterpret, narrow, or replace them with a newly ' +
    'discovered error. If you find an additional bug while fixing, fix the ORIGINAL ' +
    'task first, then report the new finding — do not abandon or delete prior work.\n\n'
  );
  const MAX_PERSONA_BYTES = 1100;
  const ceilingBytes = Number.isFinite(data.maxBytes) ? Math.floor(data.maxBytes) : PROMPT_CEILING_BYTES;
  const prefix = `${staticHeader}You are @${dbAgentName} (${title}).\nPurpose: ${purpose}\n`;
  const truncatedConstraints = truncateAtBoundary(agentConstraints, 600);
  const constraintsBlock = `Constraints: ${truncatedConstraints}\n\n`;

  const instructionsPrefix = 'Instructions: ';
  const TRUNCATE_SUFFIX_LEN = 16;
  const baseOverhead = prefix.length + constraintsBlock.length + instructionsPrefix.length + 1;
  const personaCap = Math.max(0, MAX_PERSONA_BYTES - baseOverhead - TRUNCATE_SUFFIX_LEN);

  const DIFF_FOOTER = 'Conflict Diff Format:\nFILE: path/to/file\n<<<<<<< original\n[orig]\n=======\n[replacement]\n>>>>>>>\n';
  let flowSkillsHeader = '';
  if (effFlowHash && skillsList.length > 0) {
    flowSkillsHeader = `Active Flow Skills (Bound to Flow ${effFlowHash}): ${skillsList.join(', ')}\n\n`;
  }
  let skillsSection = '';
  if (skillsContent.length > 0) {
    skillsSection = (flowSkillsHeader || 'Available Skills:\n') + skillsContent.join('\n\n') + '\n\n';
  } else if (skillsList.length > 0) {
    skillsSection = flowSkillsHeader || `Available Skills:\nOn-Demand Reference Skills: ${skillsList.join(', ')}\n\n`;
  }

  const effectiveClient = resolveFirstSpawnClient([client, getActiveClient(), detectActiveClient()], 'universal');
  const mcpBlock = buildSubagentMcpBlock(effectiveClient, agentName);
  const { spawnDirective = '' } = _resolveSpawnDirective({
    isChildWorker, client: effectiveClient, agent: dbAgentName, skills: skillsList,
    projectPath: resolvedProjPath, prompt: data.rawTask || instructions, piSubagentSupported
  });
  const buildBody = ({ personaChars, taste, doc, compactContext = false }) => {
    let body = prefix;
    const personaBody = personaChars > 0 ? truncateAtBoundary(personaInstructions, personaChars) : '';
    body += `${instructionsPrefix}${personaBody || '(see TASK INSTRUCTIONS)'}\n`;
    body += constraintsBlock;
    if (projectContextBlock) {
      body += (compactContext ? truncateAtBoundary(projectContextBlock, 150) : projectContextBlock) + '\n';
    }
    if (soulBehaviorBlock) body += soulBehaviorBlock + '\n';
    if (taste && tasteSkillBlock) body += tasteSkillBlock + '\n';
    if (doc && docDesignBlock) body += docDesignBlock + '\n';
    body += mcpBlock + '\n';
    if (spawnDirective) body += spawnDirective + '\n';
    return body;
  };
  // Disciplines and a skill preview are non-negotiable, so the body uses the
  // richest variant that still leaves room for both. Persona prose is trimmed
  // first because the soul block already carries the archetype voice.
  const requiredSkillReserve = Math.min(Buffer.byteLength(skillsSection, 'utf8'), MIN_SKILL_PREVIEW_BYTES);
  const tailReserve = Buffer.byteLength(DIFF_FOOTER, 'utf8') + 2 + requiredSkillReserve;
  const reserve = Buffer.byteLength(buildDisciplineContract(), 'utf8') + tailReserve;
  const minDisciplineBytes = Buffer.byteLength(buildDisciplineContract({ includeAdhd: false, includeAntislop: true }), 'utf8');
  const minReserve = Math.min(minDisciplineBytes, 420) + tailReserve;
  const bodyLadder = [
    { personaChars: personaCap, taste: true, doc: true },
    { personaChars: Math.min(personaCap, 600), taste: true, doc: true },
    { personaChars: Math.min(personaCap, 600), taste: true, doc: false },
    { personaChars: Math.min(personaCap, 400), taste: true, doc: false },
    { personaChars: Math.min(personaCap, 200), taste: true, doc: false },
    { personaChars: 0, taste: true, doc: false },
    { personaChars: 0, taste: dbAgentName === 'jonin', doc: false, compactContext: true }
  ];
  const candidates = bodyLadder.map(buildBody);
  const fitsCeiling = candidate => ceilingBytes - Buffer.byteLength(candidate, 'utf8') >= reserve;
  const fitsMinimumInvariant = candidate => ceilingBytes - Buffer.byteLength(candidate, 'utf8') >= minReserve;
  let prompt = candidates.find(fitsCeiling) || candidates.find(fitsMinimumInvariant);
  if (!prompt) prompt = buildBody({ personaChars: 0, taste: false, doc: false, compactContext: true });

  const disciplineHeadroom = ceilingBytes - Buffer.byteLength(prompt, 'utf8')
    - Buffer.byteLength(DIFF_FOOTER, 'utf8') - requiredSkillReserve - 1;
  const disciplineBlock = resolveDisciplineBlock(disciplineHeadroom);
  if (disciplineBlock) prompt += `${disciplineBlock}\n`;
  const skillsBudget = ceilingBytes - Buffer.byteLength(prompt, 'utf8')
    - Buffer.byteLength(DIFF_FOOTER, 'utf8');
  if (Buffer.byteLength(skillsSection, 'utf8') > skillsBudget) {
    skillsSection = skillsBudget > TRUNCATE_SUFFIX_LEN
      ? `${truncateAtBoundary(skillsSection, skillsBudget - TRUNCATE_SUFFIX_LEN)}\n`
      : '';
  }
  return clampToBytes(prompt + skillsSection + DIFF_FOOTER, ceilingBytes);
}

function _parseTaskOptions(task, context, constraints, rest) {
  let [skills = null, tasteDials = null, projectPath = null, taskDir = null, sessionId = null, flowHash = null, taskId = null, client = null, worktree = null] = rest;
  if (typeof task === 'object' && task !== null) {
    const opts = task;
    return {
      task: opts.task || null,
      context: opts.context || null,
      constraints: opts.constraints || null,
      skills: opts.skills || null,
      tasteDials: opts.tasteDials || opts.taste_dials || null,
      projectPath: opts.projectPath || opts.project_path || projectPath,
      taskDir: opts.taskDir || opts.task_dir || taskDir,
      sessionId: opts.sessionId || opts.session_id || sessionId,
      flowHash: opts.flowHash || opts.flow_hash || flowHash,
      taskId: opts.taskId || opts.task_id || taskId,
      client: opts.client || client,
      worktree: opts.worktree || opts.worktree_path || worktree,
      isChildWorker: Boolean(opts.isChildWorker),
      observedInputTokens: opts.observedInputTokens ?? opts.input_tokens,
      agentInputTokenQuota: opts.agentInputTokenQuota ?? opts.agent_input_token_quota,
      piSubagentSupported: typeof opts.piSubagentSupported === 'boolean'
        ? opts.piSubagentSupported
        : (typeof opts.pi_subagent_supported === 'boolean' ? opts.pi_subagent_supported : undefined)
    };
  }
  return { task, context, constraints, skills, tasteDials, projectPath, taskDir, sessionId, flowHash, taskId, client, worktree };
}

function _buildFixedTailBlocks(dbAgentName, skillsList, flowHash) {
  const dualBoundaryAnchor = (
    '## Critical Invariants & Non-Negotiables (Dual-Boundary Anchor)\n\n' +
    '- STRICT FACTUAL TRUTH: Never fabricate test results or simulated tool outputs.\n' +
    '- STRICT NO-PUSH / NO-PUBLISH: Never run git push, npm publish, or create remote tags.\n' +
    '- REQUIRED LOCAL COMMIT IDENTITY: If explicitly committing, use author `andycungkrinx91 <andy.silva270114@gmail.com>`.\n' +
    '- PRESERVE PROXY GATEWAY: Never modify or disable local OpenAI proxy gateway (port 19999).\n' +
    '- BOUNDED FILE ACCESS: Always use konoha MCP bounded file tools. Never use shell cat/head/grep.\n' +
    '- CODE INTELLIGENCE IS MANDATORY: Use `mcp__konoha__code_search`, `code_symbol`, and `code_impact` with the absolute repo root.\n' +
    '- RTK IS MANDATORY: Prefix shell and test runs with `rtk <command>`; fetch web pages with `rtk curl <url>`, never bare curl, wget, or raw fetch.\n' +
    '- SOUL ARCHETYPE MANDATORY: Strictly embody your ninja soul archetype behavior directives, voice, and tenets.\n' +
    (RESEARCH_AGENTS.has(dbAgentName) ? buildResearchFetchRule(dbAgentName) : '') +
    (dbAgentName === 'genin' ? '- GENIN READ-ONLY MANDATE: As @genin, strictly read-only mode. Never write, create, overwrite, modify, or delete files.\n' : '') +
    '- ZERO-AI-SLOP DELIVERY: Before delivery, run `rtk aislop scan --changes` to verify score 100/100 and 0 findings.\n' +
    '- KAGE 98% CONFIDENCE GATE: Delivery blocked if confidence < 98%.\n\n'
  );
  const executionProtocol = (
    `You are ${dbAgentName}. The payload below is the subagent contract the caller must hand to the spawned \`${dbAgentName}\` subagent; the caller must not execute it.\n\n` +
    '## Execution Protocol\n\n' +
    `0. Mandatory Skills Activation: Before taking actions, Spawn \`konoha.use_skills(skills=${JSON.stringify(skillsList)}${flowHash ? `, flow_hash="${flowHash}"` : ''})\` to load and bind references.\n` +
    '1. Search with konoha code_search and prefix shell commands with `rtk` (see anchor).\n' +
    `2. Embody the ${dbAgentName} soul; no filler or ungrounded claims.\n` +
    (dbAgentName === 'genin' ? '3. Genin Strict Read-Only Mode: Strictly explore and inspect. Never create, edit, overwrite, or delete files.\n' : '3. Context Preservation: Preserve all intermediate context, architectural boundaries, and constraints. Never omit context in execution.\n') +
    '4. Execute the task directly as described in TASK INSTRUCTIONS below, inside the spawned subagent.\n' +
    '5. Validate your work: execute framework validation checks and verify 0 errors and 0 warnings.\n' +
    '6. Run `rtk aislop scan --changes`; zero findings required.\n' +
    '7. When complete, report results and validation evidence via `report_from_agent`, followed by mandatory `@kage` review before final delivery.\n\n'
  );
  return `${dualBoundaryAnchor}${executionProtocol}`;
}

function _prepareAgentRun(agentName, task = null, context = null, constraints = null, rest = []) {
  const opts = _parseTaskOptions(task, context, constraints, rest);
  const resolvedProjPath = opts.projectPath || getWorkspaceRoot() || process.cwd();
  const cd = require('./client_detection');
  const rawClient = cd.pickRawClient([opts.client, getActiveClient(), cd.detectActiveClient()]);
  const spawnClient = cd.resolveDetectedSpawnClient(rawClient, 'universal');
  const resolvedSessionId = opts.sessionId || cd.getActiveSessionId(resolvedProjPath, rawClient);
  getAndIncrementSessionTurn(getSessionKey(resolvedProjPath, resolvedSessionId));

  if (!opts.task || typeof opts.task !== 'string' || !opts.task.trim() || /\b(read|check|load|process|open)\s+(prompt\.md|delegate\.md)\b/i.test(opts.task)) {
    return {
      earlyReturn: JSON.stringify({
        status: 'error',
        reason: 'retired_file_ipc',
        error: 'File-based IPC (delegate.md / prompt.md) is retired and rejected. Pass task instructions, context, constraints, and skills via direct structured MCP arguments.'
      })
    };
  }

  const sdlcManager = require('../workflow/kage-reviewer/sdlc_manager');
  const sdlcConfig = sdlcManager.getProjectSdlcConfig(resolvedProjPath);
  const dorResult = sdlcManager.checkReadiness(opts.task, resolvedProjPath);
  if (sdlcConfig.dor_mode === 'enforced' && !dorResult.ready) {
    return { earlyReturn: JSON.stringify({ status: 'blocked', phase: 'dor', message: 'DoR check failed in enforced mode.', missing: dorResult.missing, dor_result: dorResult }) };
  }

  let instructions = _buildTaskInstructions(opts, dorResult);

  let dbAgentName = agentName.startsWith('mcp_') ? agentName.substring(4) : agentName;
  dbAgentName = dbAgentName.replace(/_/g, '-');
  const effTaskDir = getResolvedTaskDir(opts.taskDir, resolvedProjPath, resolvedSessionId);
  const steerCtx = consumeAdvisorSteerContext(effTaskDir, dbAgentName);
  if (steerCtx.block) instructions = `${steerCtx.block}\n\n${instructions}`;
  // Sibling findings for this task: cheaper than re-deriving another agent's work.
  // Rendered in _finalizeAgentRun once the prompt size (and thus the remaining
  // headroom under the ceiling) is known.
  const sharedRows = readSharedContext({
    taskId: resolveTaskId({ taskDir: effTaskDir }),
    excludeAgent: dbAgentName,
    projectPath: resolvedProjPath,
    sessionId: resolvedSessionId
  });
  const meta = _resolveAgentDbMetadata(dbAgentName);
  let skillsList = Array.isArray(opts.skills) && opts.skills.length > 0 ? [...opts.skills] : meta.skillsList;
  if (opts.flowHash) {
    try {
      const flowSkills = personaMemory.getFlowSkills(opts.flowHash);
      if (Array.isArray(flowSkills) && flowSkills.length > 0) {
        skillsList = Array.isArray(opts.skills) && opts.skills.length > 0
          ? Array.from(new Set([...skillsList, ...flowSkills]))
          : flowSkills;
      }
    } catch (_) { /* ignore */ }
  }
  let conn = null;
  let deniedSkillBlock = null;
  try { conn = getDb(); } catch (_) { /* no DB */ }
  try {
    if (conn && skillsList.length === 0 && instructions) {
      try {
        const auto = autoloadSkillsFromPrompt(instructions, conn).filter(
          (skillName) => authorizeSkillAccess({ skillName, tags: lookupSkillTags(conn, skillName), agentName: dbAgentName }).authorized
        );
        if (auto.length > 0) skillsList = auto;
      } catch (_) { /* skills table may not exist yet */ }
    }
    if (dbAgentName === 'jonin') skillsList = _resolveJoninSkills(resolvedProjPath, instructions, opts.context, skillsList);
    deniedSkillBlock = findUnauthorizedSkill(skillsList, dbAgentName, conn);
  } finally {
    try { if (conn) conn.close(); } catch (_) { /* best-effort */ }
  }
  if (deniedSkillBlock) {
    return {
      earlyReturn: JSON.stringify({
        status: 'blocked', phase: 'skill_authorization', agent: dbAgentName,
        flow_hash: opts.flowHash || undefined, project_path: resolvedProjPath, session_id: resolvedSessionId,
        ...deniedSkillBlock.denied
      })
    };
  }

  if (opts.taskId) {
    try {
      const existingTask = sdlcManager.getTask(opts.taskId);
      const existingEvidence = (existingTask && typeof existingTask.evidence === 'object' && existingTask.evidence !== null) ? existingTask.evidence : {};
      sdlcManager.updateTask(opts.taskId, {
        status: 'in_progress',
        evidence: { ...existingEvidence, active_agent: dbAgentName, phase: 'execution', project_path: resolvedProjPath, skills_bound: skillsList }
      });
    } catch (_) { /* ignore */ }
  }
  let soulBehaviorBlock = '';
  try {
    const soulInfo = personaMemory.getSoul({ agentName: dbAgentName, projectPath: resolvedProjPath });
    if (soulInfo?.behavior_directive) soulBehaviorBlock = `${soulInfo.behavior_directive}\n`;
  } catch (_) { /* ignore */ }
  return {
    agentName, opts, dbAgentName, spawnClient, resolvedProjPath, resolvedSessionId, sdlcConfig, effTaskDir, steerCtx, meta, skillsList,
    instructions, skillsContent: _loadSkillsContent(skillsList, agentName), soulBehaviorBlock, sharedRows,
    tasteSkillBlock: dbAgentName === 'jonin' ? _buildTasteSkillBlock(opts.tasteDials) : '',
    docDesignBlock: dbAgentName.includes('tokubetsu') ? _buildTokubetsuDocBlock() : ''
  };
}

function _finalizeAgentRun(p, projectContextBlock) {
  let { instructions } = p;
  const turnEnvelope = prepareAgentTurnEnvelope({
    opts: p.opts, dbAgentName: p.dbAgentName, spawnClient: p.spawnClient, resolvedProjPath: p.resolvedProjPath,
    resolvedSessionId: p.resolvedSessionId, sdlcConfig: p.sdlcConfig, effTaskDir: p.effTaskDir, instructions,
    extraBytes: Buffer.byteLength(p.skillsContent + projectContextBlock, 'utf8'),
    todoHelpers: { syncTodoAndWalkthrough, formatTodoSyncBlock, markAgentTodoInProgress },
    workflowHelpers: { loadWorkflowStatus, saveWorkflowStatus }
  });
  instructions = turnEnvelope.instructions;
  const { todoSync, quotaCheck } = turnEnvelope;
  let taskBlock = `## TASK INSTRUCTIONS\n\n${instructions}\n`;
  const tailCeiling = PROMPT_CEILING_BYTES - SYSTEM_PROMPT_FLOOR_BYTES;
  const fixedTail = _buildFixedTailBlocks(p.dbAgentName, p.skillsList, p.opts.flowHash);
  if (Buffer.byteLength(fixedTail + taskBlock, 'utf8') > tailCeiling) {
    instructions = truncateAtBoundary(instructions, Math.max(0, tailCeiling - Buffer.byteLength(fixedTail, 'utf8') - 24));
    taskBlock = `## TASK INSTRUCTIONS\n\n${instructions}\n`;
  }
  const tailBlocks = `${fixedTail}${taskBlock}`;
  const isChildWorker = Boolean(p.opts.isChildWorker || process.env.KONOHA_IS_CHILD_WORKER === '1');
  const systemPrompt = _assembleSystemPrompt({
    dbAgentName: p.dbAgentName, title: p.meta.title, purpose: p.meta.purpose, agentConstraints: p.meta.agentConstraints,
    personaInstructions: p.meta.personaInstructions, projectContextBlock, soulBehaviorBlock: p.soulBehaviorBlock,
    tasteSkillBlock: p.tasteSkillBlock, docDesignBlock: p.docDesignBlock, skillsList: p.skillsList, skillsContent: p.skillsContent,
    effFlowHash: p.opts.flowHash, agentName: p.agentName, client: p.spawnClient, resolvedProjPath: p.resolvedProjPath,
    instructions, rawTask: p.opts.task, isChildWorker, piSubagentSupported: p.opts.piSubagentSupported,
    maxBytes: PROMPT_CEILING_BYTES - Buffer.byteLength(tailBlocks, 'utf8') - 2
  });
  const instruction = clampToBytes(`${systemPrompt}\n\n${tailBlocks}`.trim(), PROMPT_CEILING_BYTES);
  // Sibling findings are appended only if they fit under the same ceiling.
  // A fixed-size block would overflow high-baseline agents (jonin runs within
  // ~20 bytes of the ceiling) and clampToBytes would then eat the middle of the
  // system prompt, so the budget is whatever is actually left.
  const sharedRoom = PROMPT_CEILING_BYTES - Buffer.byteLength(instruction, 'utf8') - 2;
  const sharedBlock = formatSharedContextBlock(p.sharedRows, sharedRoom);
  const finalInstruction = sharedBlock ? `${instruction}\n\n${sharedBlock}` : instruction;
  const resolvedWorktreePath = p.opts.worktree ? (typeof p.opts.worktree === 'string' ? p.opts.worktree : p.opts.worktree.worktree_path) : undefined;
  const { spawnDirective, spawnError } = _resolveSpawnDirective({
    isChildWorker, client: p.spawnClient, agent: p.dbAgentName, skills: p.skillsList,
    projectPath: resolvedWorktreePath || p.resolvedProjPath, prompt: p.opts.task,
    worktree: p.opts.worktree, piSubagentSupported: p.opts.piSubagentSupported
  });
  if (spawnError && spawnError.code === 'SKILL_AUTHORIZATION_DENIED') {
    return JSON.stringify({ status: 'blocked', phase: 'skill_authorization', agent: p.dbAgentName, ...spawnError });
  }
  const res = JSON.stringify({
    status: spawnError ? 'unsupported_native_spawn' : 'ready', phase: 'execution', agent: p.dbAgentName, model: p.meta.assignedModel,
    mandatory_next_step: p.dbAgentName === 'kage' ? 'delivery' : 'kage_review', flow_hash: p.opts.flowHash || undefined,
    project_path: p.resolvedProjPath, session_id: p.resolvedSessionId, task_dir: p.effTaskDir, worktree_path: resolvedWorktreePath,
    spawn_directive: spawnDirective, spawn_error: spawnError,
    advisor_steers_delivered: p.steerCtx.pending.length > 0 ? p.steerCtx.pending : undefined,
    todos: todoSync.todos, walkthrough_steps: todoSync.walkthrough_steps,
    client_todo_directive: todoSync.client_todo_directive, quota_compaction: quotaCheck, instructions: finalInstruction
  });
  logToolCall(p.agentName, `project_path=${p.resolvedProjPath} session_id=${p.resolvedSessionId} task_dir=${p.effTaskDir}`, res, p.dbAgentName);
  return res;
}

function runMcpAgent(agentName, task = null, context = null, constraints = null, ...rest) {
  const prep = _prepareAgentRun(agentName, task, context, constraints, rest);
  if (prep.earlyReturn) return prep.earlyReturn;
  return _finalizeAgentRun(prep, _formatProjectContext(prep.dbAgentName, prep.instructions, prep.resolvedProjPath, prep.resolvedSessionId));
}

async function runMcpAgentAsync(agentName, task = null, context = null, constraints = null, ...rest) {
  return require('./memory_subagent_async').runMcpAgentAsync(agentName, task, context, constraints, ...rest);
}

module.exports = {
  getMainModel, applyFileEdits, autoloadSkillsFromPrompt, buildSubagentMcpBlock,
  buildResearchFetchRule, truncateAtBoundary, cleanRedundantPersonaText,
  _loadBaseProjectContext, _prepareAgentRun, _finalizeAgentRun, runMcpAgent, runMcpAgentAsync
};
