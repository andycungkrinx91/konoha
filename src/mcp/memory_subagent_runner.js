'use strict';

const fs = require('fs');
const { buildDisciplineContract, COMPACT_REMINDER } = require('./discipline_contract');
const { REMEDIATION_INVARIANT } = require('./remediation_contract');
const path = require('path');
const db = require('../db');
const { getDb } = db;
const personaMemory = require('../persona_memory');
const { getWorkspaceRoot, getActiveClient } = require('./runtime_state');
const { getSessionKey, getAndIncrementSessionTurn } = require('./client_detection');
const { fuzzyResolveSkill, logToolCall } = require('./skills');
const { getResolvedTaskDir } = require('./workflow');

function getMainModel() {
  try {
    const conn = getDb();
    const row1 = conn.prepare('SELECT model_tier FROM agents WHERE name = ?').get('sannin');
    if (row1 && row1.model_tier) return row1.model_tier;
    const row2 = conn.prepare('SELECT model_tier FROM agents WHERE name = ?').get('kage');
    if (row2 && row2.model_tier) return row2.model_tier;
  } catch (_) { /* ignore */ }
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

function _loadManifestToolCatalog() {
  const manifest = require('../mcp_tool_manifest.json');
  const arr = Array.isArray(manifest.tools) ? manifest.tools : [];
  const names = arr.map(t => t && t.name).filter(Boolean);
  if (names.length === 0) {
    throw new Error('buildSubagentMcpBlock: empty tool catalog from mcp_tool_manifest.json — refusing to emit a parity claim without the manifest.');
  }
  return names;
}

// Literal per-tool parity: every manifest tool as its own row (set-equality
// holds exactly) with descriptions omitted to fit the <8KB ceiling.
function buildSubagentMcpBlock(client = null, agentName = null, options = {}) {
  const contract = require('./subagent_tool_contract');
  const policy = contract.resolveSubagentToolPolicy({ client, ...options });
  if (!policy.attached) return contract.buildNotAttachedNote(client);
  const normAgent = (agentName || '').toLowerCase().replace(/_/g, '-');
  // Full main-agent tool parity, generated from the canonical manifest so the
  // list can never drift: every official subagent sees the same MCP catalog
  // as the main agent as literal per-tool entries. Descriptions are omitted
  // to preserve the unified <8KB token-bounded prompt ceiling; role guidance
  // below directs usage. Only hard safety mandates remain enforced.
  const catalog = _loadManifestToolCatalog();
  const tools = catalog.map((name) => `- \`mcp__konoha__${name}\``);
  tools.push('- `mcp__semble__search`');
  tools.push('- `mcp__semble__find_related`');
  tools.push('- `mcp__aislop__aislop_scan`');
  tools.push('- `mcp__aislop__aislop_why`');
  if (['jonin', 'anbu'].includes(normAgent)) {
    tools.push('- `mcp__aislop__aislop_fix`');
  }

  let boundaries = (
    '### Strict Tool Boundaries\n' +
    'Full manifest parity: prefer archetype specialty (genin read-only, chunin research, jonin UI/taste-skill, anbu backend/QA, tokubetsu docs, akatsuki security, kage review, sannin triage).\n'
  );
  if (['genin', 'kage'].includes(normAgent)) {
    boundaries += (
      'For aislop MCP: you may call `aislop_scan` and `aislop_why`. ' +
      'You are strictly forbidden from calling `aislop_fix` or `aislop_baseline` (read-only mandate).\n'
    );
  }
  if (normAgent === 'genin') {
    boundaries += (
      'Genin Read-Only Invariant: You are strictly in read-only mode. You are forbidden from calling file mutation tools or executing file-modifying scripts. Perform non-destructive exploration, symbol search, and dependency analysis only.\n'
    );
  }

  return `\n## MCP Tools Available To You\n${tools.join('\n')}\n\n${boundaries}`;
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
  let out = text || '';
  let over = Buffer.byteLength(out, 'utf8') - maxBytes;
  while (over > 0) {
    out = out.substring(0, Math.max(0, out.length - Math.ceil(over / 2) - 1));
    over = Buffer.byteLength(out, 'utf8') - maxBytes;
  }
  return out;
}

function truncateAtBoundary(text, maxChars) {
  const s = text || '';
  if (s.length <= maxChars) return s;
  const head = s.substring(0, maxChars);
  const cutPoints = [head.lastIndexOf('. '), head.lastIndexOf('.\n'), head.lastIndexOf('\n')];
  let cut = Math.max(...cutPoints);
  if (cut < Math.floor(maxChars / 2)) cut = maxChars;
  else cut += 1;
  return head.substring(0, cut).trimEnd() + ' ...[truncated]';
}

function cleanRedundantPersonaText(text) {
  if (!text) return '';
  return text
    .replace(/Base personality: High Effort \+ Instruct Style —[^.]+\./gi, '')
    .replace(/and adhere strictly to base personality:[^.]+\./gi, '')
    .replace(/Call konoha\.find_skill for skills\.[\s\S]*?(?=Call the semble|\. [A-Z]|$)/gi, '')
    .replace(/Call the semble MCP tools \(search\/find_related\) directly for codebase search\. Do NOT mix them\.?/gi, '')
    .replace(/Do NOT call `?semble`? tools[^.]+\./gi, '')
    .replace(/NEVER use `?semble`? search for skills\.?/gi, '')
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
  try {
    rowConn = getDb();
    const row = queryAgentRow(rowConn, dbAgentName);
    if (row) {
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
    'jonin-skill/design-token-manifest',
    'jonin-skill/taste-skill-frontend-expert'
  ];
}

function _buildTasteSkillBlock(tasteDials) {
  const dials = tasteDials || {};
  const varDial = dials.design_variance !== undefined ? dials.design_variance : 8;
  const motDial = dials.motion_intensity !== undefined ? dials.motion_intensity : 7;
  const densDial = dials.visual_density !== undefined ? dials.visual_density : 6;
  return (
    '### 🎨 Taste-Skill Design Engine Directives (tasteskill.dev):\n' +
    `- Dials: DESIGN_VARIANCE=${varDial}/10 | MOTION_INTENSITY=${motDial}/10 | VISUAL_DENSITY=${densDial}/10\n` +
    '- Anti-Slop: Zero generic AI-purple gradients, zero 3-card boilerplate stacks. Bespoke editorial UI.\n' +
    '- Typography & Layout: Geist, Cabinet Grotesk, Satoshi. py-24 pacing, CSS Grid (grid-cols-12), min-h-[100dvh].\n' +
    '- Theme: 10 Light-Mode gradient themes (data-theme), 3D perspective tilt, zero emojis (Lucide SVG).\n' +
    '- Invariants: Far-left logo, no mobile hamburger, fixed mobile dock, floating bottom-left 10-theme switcher, 4-slide hero carousel.\n' +
    '- Quality: pnpm exclusively, zero errors/warnings, run `rtk aislop scan --changes`.\n'
  );
}

function _buildTokubetsuDocBlock() {
  return (
    '### 🖋️ Tokubetsu-Jonin Document Engineering & Design Directives:\n' +
    '- Native Tools: document_create (DOCX/PDF), spreadsheet_create (XLSX), presentation_create (PPTX), diagram_create (SVG), animation_export (WebP).\n' +
    '- Skills via FTS5/RAG: Query konoha.find_skill and konoha.get_skill; never read raw markdown directly.\n' +
    '- Fonts & Themes: Inter, JetBrains Mono. 20 Enterprise Themes (T01-T20). Pure light mode, zero dark fills.\n' +
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

function _formatProjectContext(dbAgentName, instructions, resolvedProjPath, resolvedSessionId) {
  try {
    let projProfile = personaMemory.getProjectProfile(resolvedProjPath);
    if (!projProfile) {
      const pHash = personaMemory.saveOrUpdateProject(resolvedProjPath);
      projProfile = personaMemory.getProjectProfile(pHash);
    }
    const projMems = personaMemory.queryMemories({
      agentName: dbAgentName, query: instructions, projectPath: resolvedProjPath, sessionId: resolvedSessionId, limit: 2
    });
    return personaMemory.formatProjectContextForPrompt(projProfile, projMems, 1, true);
  } catch (_) {
    return '';
  }
}

function _assembleSystemPrompt(data) {
  const { dbAgentName, title, purpose, agentConstraints, personaInstructions, projectContextBlock, soulBehaviorBlock, tasteSkillBlock, docDesignBlock, skillsList, skillsContent, effFlowHash, agentName } = data;
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

  const mcpBlock = buildSubagentMcpBlock(getActiveClient(), agentName);
  const buildBody = ({ personaChars, taste, doc, compactContext = false }) => {
    let body = prefix;
    if (personaChars > 0) body += `${instructionsPrefix}${truncateAtBoundary(personaInstructions, personaChars)}\n`;
    body += constraintsBlock;
    if (projectContextBlock) {
      body += (compactContext ? truncateAtBoundary(projectContextBlock, 150) : projectContextBlock) + '\n';
    }
    if (soulBehaviorBlock) body += soulBehaviorBlock + '\n';
    if (taste && tasteSkillBlock) body += tasteSkillBlock + '\n';
    if (doc && docDesignBlock) body += docDesignBlock + '\n';
    return body + mcpBlock + '\n';
  };
  // Disciplines and a skill preview are non-negotiable, so the body uses the
  // richest variant that still leaves room for both. Persona prose is trimmed
  // first because the soul block already carries the archetype voice.
  const reserve = Buffer.byteLength(buildDisciplineContract(), 'utf8')
    + Buffer.byteLength(DIFF_FOOTER, 'utf8') + 2
    + Math.min(Buffer.byteLength(skillsSection, 'utf8'), MIN_SKILL_PREVIEW_BYTES);
  const bodyLadder = [
    { personaChars: personaCap, taste: true, doc: true },
    { personaChars: Math.min(personaCap, 600), taste: true, doc: true },
    { personaChars: Math.min(personaCap, 600), taste: true, doc: false },
    { personaChars: Math.min(personaCap, 400), taste: true, doc: false },
    { personaChars: Math.min(personaCap, 200), taste: true, doc: false },
    { personaChars: 0, taste: true, doc: false },
    { personaChars: 0, taste: true, doc: false, compactContext: true },
    { personaChars: 0, taste: dbAgentName === 'jonin', doc: false, compactContext: true }
  ];
  const fitsCeiling = candidate => ceilingBytes - Buffer.byteLength(candidate, 'utf8') >= reserve;
  let prompt = bodyLadder.map(buildBody).find(fitsCeiling);
  if (!prompt) prompt = buildBody(bodyLadder[bodyLadder.length - 1]);

  const disciplineHeadroom = ceilingBytes - Buffer.byteLength(prompt, 'utf8')
    - Buffer.byteLength(DIFF_FOOTER, 'utf8') - 1;
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
  let [skills = null, tasteDials = null, projectPath = null, taskDir = null, sessionId = null, flowHash = null, taskId = null] = rest;
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
      taskId: opts.taskId || opts.task_id || taskId
    };
  }
  return { task, context, constraints, skills, tasteDials, projectPath, taskDir, sessionId, flowHash, taskId };
}

function runMcpAgent(agentName, task = null, context = null, constraints = null, ...rest) {
  const opts = _parseTaskOptions(task, context, constraints, rest);
  const resolvedProjPath = opts.projectPath || getWorkspaceRoot() || process.cwd();
  const cd = require('./client_detection');
  const activeClient = getActiveClient() || cd.detectActiveClient() || 'universal';
  const resolvedSessionId = opts.sessionId || cd.getActiveSessionId(resolvedProjPath, activeClient);
  getAndIncrementSessionTurn(getSessionKey(resolvedProjPath, resolvedSessionId));

  if (!opts.task || typeof opts.task !== 'string' || !opts.task.trim() || /\b(read|check|load|process|open)\s+(prompt\.md|delegate\.md)\b/i.test(opts.task)) {
    return JSON.stringify({
      status: 'error',
      reason: 'retired_file_ipc',
      error: 'File-based IPC (delegate.md / prompt.md) is retired and rejected. Pass task instructions, context, constraints, and skills via direct structured MCP arguments.'
    });
  }

  const sdlcManager = require('../workflow/kage-reviewer/sdlc_manager');
  const sdlcConfig = sdlcManager.getProjectSdlcConfig(resolvedProjPath);
  const dorResult = sdlcManager.checkReadiness(opts.task, resolvedProjPath);
  if (sdlcConfig.dor_mode === 'enforced' && !dorResult.ready) {
    return JSON.stringify({ status: 'blocked', phase: 'dor', message: 'DoR check failed in enforced mode.', missing: dorResult.missing, dor_result: dorResult });
  }

  let instructions = opts.task.trim();
  if (dorResult && !dorResult.ready && dorResult.missing.length > 0) {
    instructions += '\n\n### ⚠️ Definition-of-Readiness (DoR) Advisory Hints:\n' + dorResult.missing.map(m => `- ${m}`).join('\n');
  }
  if (typeof opts.context === 'string' && opts.context.trim()) instructions += `\n\n### Context & Relevant Code Paths:\n${opts.context.trim()}`;
  else if (Array.isArray(opts.context) && opts.context.length > 0) instructions += `\n\n### Context & Relevant Code Paths:\n${opts.context.join('\n')}`;
  if (typeof opts.constraints === 'string' && opts.constraints.trim()) instructions += `\n\n### Execution Constraints:\n${opts.constraints.trim()}`;
  else if (Array.isArray(opts.constraints) && opts.constraints.length > 0) instructions += `\n\n### Execution Constraints:\n${opts.constraints.join('\n')}`;

  let dbAgentName = agentName.startsWith('mcp_') ? agentName.substring(4) : agentName;
  dbAgentName = dbAgentName.replace(/_/g, '-');


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
  if (skillsList.length === 0 && instructions) {
    try {
      const conn = getDb();
      const auto = autoloadSkillsFromPrompt(instructions, conn);
      if (auto.length > 0) skillsList = auto;
    } catch (_) { /* ignore */ }
  }

  if (dbAgentName === 'jonin') {
    skillsList = _resolveJoninSkills(resolvedProjPath, instructions, opts.context, skillsList);
  }

  if (opts.taskId) {
    try {
      const existingTask = sdlcManager.getTask(opts.taskId);
      const existingEvidence = (existingTask && typeof existingTask.evidence === 'object' && existingTask.evidence !== null) ? existingTask.evidence : {};
      sdlcManager.updateTask(opts.taskId, {
        status: 'in_progress',
        evidence: {
          ...existingEvidence,
          active_agent: dbAgentName,
          phase: 'execution',
          project_path: resolvedProjPath,
          skills_bound: skillsList
        }
      });
    } catch (_) { /* ignore */ }
  }

  let soulBehaviorBlock = '';
  try {
    const soulInfo = personaMemory.getSoul({ agentName: dbAgentName, projectPath: resolvedProjPath });
    if (soulInfo?.behavior_directive) soulBehaviorBlock = `${soulInfo.behavior_directive}\n`;
  } catch (_) { /* ignore */ }

  const skillsContent = _loadSkillsContent(skillsList, agentName);
  const projectContextBlock = _formatProjectContext(dbAgentName, instructions, resolvedProjPath, resolvedSessionId);
  const tasteSkillBlock = dbAgentName === 'jonin' ? _buildTasteSkillBlock(opts.tasteDials) : '';
  const docDesignBlock = dbAgentName.includes('tokubetsu') ? _buildTokubetsuDocBlock() : '';


  const basePersonalityBlock = (
    '## Base Personality: High Effort + Instruct Style\n\n' +
    '- Strictly NO conversational filler (FORBIDDEN: "Hmmmm", "Let me check", "Wait - but", "let me").\n' +
    '- Lead with direct action and verified evidence. Start immediately with action or factual result.\n' +
    '- ADHD-friendly structured format: number multi-step procedures, bold headings, bullet points, clean code.\n' +
    '- Zero hallucination, errors, warnings, AI slop: target accuracy 95%-100%, cost efficiency 83%-98%.\n' +
    '- MANDATORY TOOL & SKILL PARITY: Always discover skills via konoha.find_skill and activate with konoha.use_skills or konoha.get_skill.\n\n'
  );
  const dualBoundaryAnchor = (
    '## 🛡️ Critical Invariants & Non-Negotiables (Dual-Boundary Anchor)\n\n' +
    '- STRICT FACTUAL TRUTH: Never fabricate test results or simulated tool outputs.\n' +
    '- STRICT NO-PUSH / NO-PUBLISH: Never run git push, npm publish, or create remote tags.\n' +
    '- REQUIRED LOCAL COMMIT IDENTITY: If explicitly committing, use author `andycungkrinx91 <andy.silva270114@gmail.com>`.\n' +
    '- PRESERVE PROXY GATEWAY: Never modify or disable local OpenAI proxy gateway (port 19999).\n' +
    '- BOUNDED FILE ACCESS: Always use konoha MCP bounded file tools. Never use shell cat/head/grep.\n' +
    '- SEMBLE IS MANDATORY: Use `mcp__semble__search` and `mcp__semble__find_related` with absolute repo path.\n' +
    '- RTK IS MANDATORY: Prefix shell and test runs with `rtk <command>`; fetch web pages with `rtk curl <url>`, never bare curl, wget, or raw fetch.\n' +
    '- SOUL ARCHETYPE MANDATORY: Strictly embody your ninja soul archetype behavior directives, voice, and tenets.\n' +
    (RESEARCH_AGENTS.has(dbAgentName) ? buildResearchFetchRule(dbAgentName) : '') +
    (dbAgentName === 'genin' ? '- GENIN READ-ONLY MANDATE: As @genin, strictly read-only mode. Never write, create, overwrite, modify, or delete files.\n' : '') +
    '- ZERO-AI-SLOP DELIVERY: Before delivery, run `rtk aislop scan --changes` to verify score 100/100 and 0 findings.\n' +
    '- KAGE 98% CONFIDENCE GATE: Delivery blocked if confidence < 98%.\n\n'
  );
  const executionProtocol = (
    `You must now act as ${dbAgentName} and execute the task below.\n\n` +
    '## Execution Protocol\n\n' +
    `0. Mandatory Skills Activation: Before taking actions, invoke \`konoha.use_skills(skills=${JSON.stringify(skillsList)}${opts.flowHash ? `, flow_hash="${opts.flowHash}"` : ''})\` to load and bind references.\n` +
    '1. Search with Semble and prefix shell commands with `rtk` (see anchor).\n' +
    `2. Embody the ${dbAgentName} soul; no filler or ungrounded claims.\n` +
    (dbAgentName === 'genin' ? '3. Genin Strict Read-Only Mode: Strictly explore and inspect. Never create, edit, overwrite, or delete files.\n' : '3. Context Preservation: Preserve all intermediate context, architectural boundaries, and constraints. Never omit context in execution.\n') +
    '4. Execute the task directly as described in TASK INSTRUCTIONS below.\n' +
    '5. Validate your work: execute framework validation checks and verify 0 errors and 0 warnings.\n' +
    '6. Run `rtk aislop scan --changes`; zero findings required.\n' +
    '7. When complete, report results and validation evidence via `report_from_agent`.\n\n'
  );

  let taskBlock = `## TASK INSTRUCTIONS\n\n${instructions}\n`;
  const tailCeiling = PROMPT_CEILING_BYTES - SYSTEM_PROMPT_FLOOR_BYTES;
  const fixedTail = `${basePersonalityBlock}${dualBoundaryAnchor}${executionProtocol}`;
  if (Buffer.byteLength(fixedTail + taskBlock, 'utf8') > tailCeiling) {
    const room = tailCeiling - Buffer.byteLength(fixedTail, 'utf8') - 24;
    instructions = truncateAtBoundary(instructions, Math.max(0, room));
    taskBlock = `## TASK INSTRUCTIONS\n\n${instructions}\n`;
  }
  const tailBlocks = `${fixedTail}${taskBlock}`;
  const systemPrompt = _assembleSystemPrompt({
    dbAgentName, title: meta.title, purpose: meta.purpose, agentConstraints: meta.agentConstraints,
    personaInstructions: meta.personaInstructions, projectContextBlock, soulBehaviorBlock,
    tasteSkillBlock, docDesignBlock, skillsList, skillsContent, effFlowHash: opts.flowHash, agentName,
    maxBytes: PROMPT_CEILING_BYTES - Buffer.byteLength(tailBlocks, 'utf8') - 2
  });
  const instruction = clampToBytes(`${systemPrompt}\n\n${tailBlocks}`.trim(), PROMPT_CEILING_BYTES);
  const effTaskDir = opts.taskDir || getResolvedTaskDir(opts.taskDir, resolvedProjPath, resolvedSessionId);
  const res = JSON.stringify({
    status: 'ready', phase: 'execution', agent: dbAgentName, model: meta.assignedModel,
    flow_hash: opts.flowHash || undefined, project_path: resolvedProjPath, session_id: resolvedSessionId,
    task_dir: effTaskDir, instructions: instruction
  });
  logToolCall(agentName, `project_path=${resolvedProjPath} session_id=${resolvedSessionId} task_dir=${effTaskDir}`, res, dbAgentName);
  return res;
}

module.exports = {
  getMainModel,
  applyFileEdits,
  autoloadSkillsFromPrompt,
  buildSubagentMcpBlock,
  buildResearchFetchRule,
  truncateAtBoundary,
  cleanRedundantPersonaText,
  runMcpAgent
};
