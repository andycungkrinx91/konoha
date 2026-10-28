'use strict';

const fs = require('fs');
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

function buildSubagentMcpBlock(client = null, agentName = null) {
  const normAgent = (agentName || '').toLowerCase().replace(/_/g, '-');
  const tools = [
    '- `mcp__konoha__sannin` — Sannin router agent',
    '- `mcp__konoha__kage` — Village Leader & Architect',
    '- `mcp__konoha__jonin` — UI & Frontend Specialist',
    '- `mcp__konoha__anbu` — Backend & DevOps Specialist',
    '- `mcp__konoha__chunin` — Intel Ninja',
    '- `mcp__konoha__tokubetsu_jonin` — Scribe',
    '- `mcp__konoha__genin` — Scout',
    '- `mcp__konoha__find_skill` — Find skills',
    '- `mcp__konoha__use_skills` — Load and activate specific skill(s) by name',
    '- `mcp__konoha__get_skill` — Get skill content',
    '- `mcp__konoha__list_skills` — List all skills',
    '- `mcp__konoha__read_file_head` — Read head of file',
    '- `mcp__konoha__read_file_range` — Read range of lines in file',
    '- `mcp__konoha__file_info` — Get file info',
    '- `mcp__konoha__token_efficient_grep` — Token-efficient grep',
    '- `mcp__konoha__get_file_structure` — Get file tree',
    '- `mcp__konoha__find_files_clean` — Find files cleanly',
    '- `mcp__semble__search` — Search project codebase',
    '- `mcp__semble__find_related` — Find related code symbols'
  ];

  if (['genin', 'kage'].includes(normAgent)) {
    tools.push('- `mcp__aislop__aislop_scan` — Zero-AI-slop and code quality scan');
    tools.push('- `mcp__aislop__aislop_why` — Explain AI slop rule reasoning');
  } else if (['jonin', 'anbu'].includes(normAgent)) {
    tools.push('- `mcp__aislop__aislop_scan` — Zero-AI-slop and code quality scan');
    tools.push('- `mcp__aislop__aislop_why` — Explain AI slop rule reasoning');
    tools.push('- `mcp__aislop__aislop_fix` — Auto-fix AI slop issues');
  }

  if (normAgent === 'anbu') {
    tools.push('- `mcp__konoha__qa_codify` — Deterministically codify flow file to Playwright test');
    tools.push('- `mcp__konoha__qa_e2e_run` — Run Playwright regression test suite with compact summary');
  }

  let boundaries = (
    '### Strict Tool Boundaries\n' +
    'Use konoha MCP for skill lookup and bounded file reads/grep. Use semble MCP for project code search.\n'
  );
  if (['genin', 'kage'].includes(normAgent)) {
    boundaries += (
      'For aislop MCP: You are permitted to use `aislop_scan` and `aislop_why`. ' +
      'You are strictly forbidden from calling `aislop_fix` or `aislop_baseline` (read-only mandate).\n'
    );
  } else if (['jonin', 'anbu'].includes(normAgent)) {
    boundaries += (
      'For aislop MCP: You are permitted to use `aislop_scan`, `aislop_fix`, and `aislop_why` ' +
      'to detect and remediate slop issues before Kage delivery review.\n'
    );
  }
  if (normAgent === 'anbu') {
    boundaries += (
      'For QA automation: Anbu is granted `qa_codify` and `qa_e2e_run`. ' +
      'Other agents (Jonin, Kage, Genin) do not call QA tools.\n'
    );
  }

  return `\n## MCP Tools Available To You\n${tools.join('\n')}\n\n${boundaries}`;
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
    `- Active Taste Dials: DESIGN_VARIANCE=${varDial}/10 | MOTION_INTENSITY=${motDial}/10 | VISUAL_DENSITY=${densDial}/10\n` +
    '- Anti-Slop: Zero generic AI-purple gradients, zero 3-card boilerplate stacks. Bespoke editorial UI.\n' +
    '- Typography: Geist, Cabinet Grotesk, Outfit, Satoshi, Clash Display. Extreme scale contrast.\n' +
    '- Layout & Spacing: py-24/py-32 section pacing, CSS Grid (grid-cols-12), max-w-[1400px], min-h-[100dvh].\n' +
    '- Theme & Aesthetics: 10 Light-Mode gradient themes (data-theme), 3D perspective tilt (1200px), Zero emojis (Lucide SVG).\n' +
    '- Konoha Invariants: Far-left logo, no mobile header hamburger, fixed mobile dock, floating bottom-left 10-theme switcher, 4-slide hero carousel.\n' +
    '- Quality & Delivery: pnpm exclusively, zero errors/warnings, run `rtk aislop scan --changes` (findings: 0, ai_slop_clean: true).\n'
  );
}

function _buildTokubetsuDocBlock() {
  return (
    '### 🖋️ Tokubetsu-Jonin Document Engineering & Design Directives (Compacted):\n' +
    '- Native Tools: Use document_create (DOCX/PDF), spreadsheet_create (XLSX), presentation_create (PPTX), diagram_create (SVG), animation_export (WebP) in src/tools/document_engine.js.\n' +
    '- Skills via FTS5/RAG: Query konoha.find_skill("<keywords>") and konoha.get_skill("<name>"); never read raw markdown files directly.\n' +
    '- Fonts & Themes: Inter (Display/SemiBold/Regular), JetBrains Mono for code. 20 Enterprise 4-Base-Color Themes (T01-T20). Pure light mode (#FFFFFF/#F8FAFC), zero dark fills.\n' +
    '- Quality Gate: Strict AI score < 3.0% (ZeroGPT risk < 3.0%), sentence CV >= 0.85, active voice, zero robotic clichés, metadata scrubbed.\n'
  );
}

function _loadPrimarySkillContent(primarySkill, agentName) {
  if (!primarySkill) return [];
  let skillConn = null;
  const skillsContent = [];
  try {
    skillConn = getDb();
    const resolved = fuzzyResolveSkill(primarySkill, skillConn) || primarySkill;
    const row = skillConn.prepare('SELECT content, type FROM skills WHERE name = ?').get(resolved);
    if (row?.content) {
      const preview = row.content.substring(0, 250) + (row.content.length > 250 ? '\n...(Use konoha.get_skill for full reference)' : '');
      const label = row.type === 'skill' ? 'Skill' : 'Reference';
      skillsContent.push(`### ${label}: ${resolved}\n\n${preview}`);
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
  const MAX_PERSONA_BYTES = 1400;
  const prefix = `${staticHeader}You are @${dbAgentName} (${title}).\nPurpose: ${purpose}\n`;
  const truncatedConstraints = truncateAtBoundary(agentConstraints, 600);
  const constraintsBlock = `Constraints: ${truncatedConstraints}\n\n`;

  const instructionsPrefix = 'Instructions: ';
  const TRUNCATE_SUFFIX_LEN = 16;
  const baseOverhead = prefix.length + constraintsBlock.length + instructionsPrefix.length + 1;
  const remainingBudget = MAX_PERSONA_BYTES - baseOverhead - TRUNCATE_SUFFIX_LEN;

  let instructionsLine = '';
  if (remainingBudget > 0) {
    const truncatedInstructions = truncateAtBoundary(personaInstructions, remainingBudget);
    instructionsLine = `${instructionsPrefix}${truncatedInstructions}\n`;
  }
  let prompt = `${prefix}${instructionsLine}${constraintsBlock}`;
  if (projectContextBlock) prompt += projectContextBlock + '\n';
  if (soulBehaviorBlock) prompt += soulBehaviorBlock + '\n';
  if (tasteSkillBlock) prompt += tasteSkillBlock + '\n';
  if (docDesignBlock) prompt += docDesignBlock + '\n';
  prompt += buildSubagentMcpBlock(getActiveClient(), agentName) + '\n';

  let flowSkillsHeader = '';
  if (effFlowHash && skillsList.length > 0) {
    flowSkillsHeader = `Active Flow Skills (Bound to Flow ${effFlowHash}): ${skillsList.join(', ')}\n\n`;
  }
  if (skillsContent.length > 0) {
    prompt += (flowSkillsHeader || 'Available Skills:\n') + skillsContent.join('\n\n') + '\n\n';
  } else if (skillsList.length > 0) {
    prompt += flowSkillsHeader || `Available Skills:\nOn-Demand Reference Skills: ${skillsList.join(', ')}\n\n`;
  }
  return prompt + 'Conflict Diff Format:\nFILE: path/to/file\n<<<<<<< original\n[orig]\n=======\n[replacement]\n>>>>>>>\n';
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

  if (opts.taskId) {
    try {
      sdlcManager.updateTask(opts.taskId, {
        status: 'in_progress',
        evidence: { active_agent: dbAgentName, phase: 'execution', project_path: resolvedProjPath }
      });
    } catch (_) { /* ignore */ }
  }

  const meta = _resolveAgentDbMetadata(dbAgentName);
  let skillsList = Array.isArray(opts.skills) ? [...opts.skills] : meta.skillsList;
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

  let soulBehaviorBlock = '';
  try {
    const soulInfo = personaMemory.getSoul({ agentName: dbAgentName, projectPath: resolvedProjPath });
    if (soulInfo?.behavior_directive) soulBehaviorBlock = `${soulInfo.behavior_directive}\n`;
  } catch (_) { /* ignore */ }

  const skillsContent = _loadPrimarySkillContent(skillsList[0], agentName);
  const projectContextBlock = _formatProjectContext(dbAgentName, instructions, resolvedProjPath, resolvedSessionId);
  const tasteSkillBlock = dbAgentName === 'jonin' ? _buildTasteSkillBlock(opts.tasteDials) : '';
  const docDesignBlock = dbAgentName.includes('tokubetsu') ? _buildTokubetsuDocBlock() : '';

  const systemPrompt = _assembleSystemPrompt({
    dbAgentName, title: meta.title, purpose: meta.purpose, agentConstraints: meta.agentConstraints,
    personaInstructions: meta.personaInstructions, projectContextBlock, soulBehaviorBlock,
    tasteSkillBlock, docDesignBlock, skillsList, skillsContent, effFlowHash: opts.flowHash, agentName
  });

  const basePersonalityBlock = (
    '## Base Personality: High Effort + Instruct Style\n\n' +
    '- Strictly NO conversational filler or hesitation markers (STRICTLY FORBIDDEN: "Hmmmm", "Let me check", "Wait - but", "let me").\n' +
    '- Lead with direct action and direct evidence. Start immediately with the action taken or factual result.\n' +
    '- ADHD-friendly structured format: number multi-step procedures, bold headings, bullet points, clean code blocks.\n' +
    '- Zero hallucination and strictly NO lies: never pretend a test ran or passed without verified output evidence.\n' +
    '- Minimum 98% confidence gate: mechanically verified against real execution exit codes and 0 slop findings.\n' +
    '- MANDATORY SKILL RETRIEVAL: Always discover skills via konoha.find_skill and load with konoha.use_skills or konoha.get_skill.\n\n'
  );
  const dualBoundaryAnchor = (
    '## 🛡️ Critical Invariants & Non-Negotiables (Dual-Boundary Anchor)\n\n' +
    '- STRICT FACTUAL TRUTH: Never fabricate test results or simulated tool outputs.\n' +
    '- STRICT NO-PUSH / NO-PUBLISH: Never run git push, npm publish, or create remote tags.\n' +
    '- REQUIRED LOCAL COMMIT IDENTITY: If explicitly committing, use author `andycungkrinx91 <andy.silva270114@gmail.com>`.\n' +
    '- PRESERVE PROXY GATEWAY: Under no circumstances modify, touch, or disable the local OpenAI proxy gateway (port 19999).\n' +
    '- BOUNDED FILE ACCESS: Always use konoha MCP bounded file tools. Never use shell cat/head/grep.\n' +
    '- ZERO-AI-SLOP DELIVERY: Before delivery, run `rtk aislop scan --changes` to verify score 100/100 and 0 findings.\n' +
    '- KAGE 98% CONFIDENCE GATE: Delivery is blocked if confidence < 98%.\n\n'
  );
  const executionProtocol = (
    `You must now act as ${dbAgentName} and execute the task below.\n\n` +
    '## Execution Protocol\n\n' +
    '1. Execute the task directly as described in TASK INSTRUCTIONS below.\n' +
    '2. Validate your work: execute framework validation checks and verify 0 errors and 0 warnings.\n' +
    '3. Zero-AI-Slop Pre-Gate: Ensure no AI slop patterns exist (`rtk aislop scan --changes`).\n' +
    '4. When complete, report results and validation evidence via `report_from_agent`.\n\n'
  );

  const taskBlock = `## TASK INSTRUCTIONS\n\n${instructions}\n`;
  const instruction = `${systemPrompt}\n\n${basePersonalityBlock}${dualBoundaryAnchor}${executionProtocol}${taskBlock}`.trim();
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
  truncateAtBoundary,
  cleanRedundantPersonaText,
  runMcpAgent
};
