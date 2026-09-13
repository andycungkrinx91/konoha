/**
 * Konoha MCP Subsystem - Memory, Context, Reporting & Subagent Execution
 * Extracted from server.js as part of modularization refactor (Phase 6)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../db');
const { getDb } = db;
const personaMemory = require('../persona_memory');
const { getWorkspaceRoot, getActiveClient } = require('./runtime_state');
const { getSessionKey, getAndIncrementSessionTurn } = require('./client_detection');
const { fuzzyResolveSkill, logToolCall } = require('./skills');
const {
  loadWorkflowStatus,
  saveWorkflowStatus,
  getResolvedTaskDir,
  VALIDATION_EVIDENCE_PATTERN
} = require('./workflow');

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

function applyFileEdits(content) {
  const workspace = getWorkspaceRoot() || process.cwd();
  const pattern = /FILE:\s*(.*?)\r?\n<<<<<<<\s*original\r?\n([\s\S]*?)\r?\n=======\r?\n([\s\S]*?)\r?\n>>>>>>>/gi;
  let match;
  while ((match = pattern.exec(content)) !== null) {
    let filePath = match[1].trim();
    const original = match[2];
    const replacement = match[3];

    if (!path.isAbsolute(filePath)) {
      filePath = path.resolve(workspace, filePath);
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    if (!original.trim()) {
      fs.writeFileSync(filePath, replacement, 'utf8');
    } else if (fs.existsSync(filePath)) {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      if (fileContent.includes(original)) {
        // Function replacement: literal insert, immune to $& / $` / $' patterns
        fs.writeFileSync(filePath, fileContent.replace(original, () => replacement), 'utf8');
      } else {
        const origLf = original.replace(/\r\n/g, '\n');
        const fileLf = fileContent.replace(/\r\n/g, '\n');
        if (fileLf.includes(origLf)) {
          fs.writeFileSync(filePath, fileLf.replace(origLf, () => replacement), 'utf8');
        }
      }
    }
  }
}

function autoloadSkillsFromPrompt(prompt, conn, maxMatches = 3) {
  if (!prompt || !prompt.trim()) return [];
  const promptLower = prompt.toLowerCase();
  const tokens = promptLower.replace(/\n/g, ' ').split(/\s+/).filter(t => t.length > 3);
  if (tokens.length === 0) return [];

  const rows = conn.prepare("SELECT skill_name, content FROM skills WHERE type = 'skill'").all();
  const scored = [];
  for (const row of rows) {
    const haystack = (row.skill_name + ' ' + (row.content || '').substring(0, 200)).toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (haystack.includes(t)) score++;
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

function assessValidationEvidence(validation) {
  if (!validation || !Array.isArray(validation)) {
    return { verified: false, reason: 'no validation evidence provided' };
  }
  const evidence = validation.filter(v => typeof v === 'string' && v.trim());
  if (evidence.length === 0) {
    return { verified: false, reason: 'validation evidence is empty' };
  }
  for (const entry of evidence) {
    if (VALIDATION_EVIDENCE_PATTERN.test(entry)) {
      return { verified: true, reason: 'validation evidence contains a passing command/exit-code marker' };
    }
  }
  return {
    verified: false,
    reason: "validation entries contain no command/exit-code evidence (expected entries like 'npm run build exited 0' or 'pytest: 12 passed')"
  };
}

function reportFromAgent(agentName, summary, status = 'completed', filesCreated = null, filesModified = null, learnings = null, projectPath = null, taskDir = null, dispatchId = null, validation = null, taskId = null) {
  const pPath = projectPath || getWorkspaceRoot() || process.cwd();
  let workflowStatus = null;

  const { verified, reason: verificationReason } = assessValidationEvidence(validation);
  let finalStatus = status;
  if (finalStatus === 'completed' && !verified) {
    finalStatus = 'unverified';
  }

  if (taskDir && fs.existsSync(taskDir) && fs.statSync(taskDir).isDirectory()) {
    workflowStatus = loadWorkflowStatus(taskDir);
    const dispatch = workflowStatus.current_dispatch || {};
    if (dispatchId && dispatch.id !== dispatchId) {
      return JSON.stringify({ status: 'error', message: 'dispatch_id does not match the active workflow dispatch' });
    }
    if (dispatch && dispatch.agent && dispatch.agent !== agentName.replace(/_/g, '-')) {
      return JSON.stringify({ status: 'error', message: 'agent_name does not match the active workflow dispatch' });
    }
    if ((finalStatus === 'completed' || finalStatus === 'unverified') && dispatch && dispatch.task_id) {
      const task = (workflowStatus.tasks || []).find(t => t.id === dispatch.task_id);
      if (task) {
        task.status = finalStatus;
        task.result = summary;
        task.validation = validation || [];
        task.verified = verified;
        task.files_created = filesCreated || [];
        task.files_modified = filesModified || [];
      }
      workflowStatus.completed_dispatches = workflowStatus.completed_dispatches || [];
      if (!workflowStatus.completed_dispatches.includes(dispatch.id)) {
        workflowStatus.completed_dispatches.push(dispatch.id);
      }
      workflowStatus.dispatch_results = workflowStatus.dispatch_results || {};
      workflowStatus.dispatch_results[dispatch.id] = summary;
      saveWorkflowStatus(taskDir, workflowStatus);
    }
  }

  let cleanAgent = (agentName || '').toLowerCase().trim();
  if (cleanAgent.startsWith('delegate_to_')) cleanAgent = cleanAgent.substring(12);
  if (cleanAgent.startsWith('mcp_')) cleanAgent = cleanAgent.substring(4);
  cleanAgent = cleanAgent.replace(/_/g, '-');

  const savedIds = [];
  if (learnings && Array.isArray(learnings)) {
    for (const l of learnings) {
      if (l && typeof l === 'string' && l.trim()) {
        const content = l.trim();
        try {
          if (!verified) continue;
          if (personaMemory.memoryContentExists({ content, agentName: cleanAgent, projectPath: pPath, dbPath: db.DB_PATH })) {
            continue;
          }
          const mid = personaMemory.saveMemory({
            agentName: cleanAgent,
            content,
            title: `${cleanAgent} decision`,
            memoryType: 'episodic',
            importance: 2,
            projectPath: pPath,
            dbPath: db.DB_PATH
          });
          savedIds.push(mid);
        } catch (e) {
          process.stderr.write(`[mcp report_from_agent] Error saving learning: ${e.message}\n`);
        }
      }
    }
  }

  const result = {
    status: 'recorded',
    agent: cleanAgent,
    task_status: finalStatus,
    summary,
    verified,
    files_created: filesCreated || [],
    files_modified: filesModified || [],
    learnings_saved_count: savedIds.length,
    project_path: pPath
  };

  const effTaskId = taskId || (workflowStatus && workflowStatus.current_dispatch ? workflowStatus.current_dispatch.task_id : null) || (taskDir ? path.basename(taskDir) : null) || 'task_active';

  try {
    const sdlcManager = require('../sdlc_manager');
    const evidenceData = {
      verified,
      verification_reason: verificationReason,
      validation: validation || [],
      agent: cleanAgent,
      status: finalStatus,
      summary,
      files_created: filesCreated || [],
      files_modified: filesModified || [],
      recorded_at: new Date().toISOString()
    };
    sdlcManager.recordEvidence(effTaskId, evidenceData);
    result.task_id = effTaskId;
    result.evidence = evidenceData;
  } catch (_) {
    // Non-fatal if sdlc recording fails
  }

  if (!verified) {
    result.verification_reason = verificationReason;
    result.remediation = (
      'Task recorded as UNVERIFIED. Re-run the actual validation commands ' +
      '(build/test/lint), confirm real output, then re-report with validation ' +
      "entries that include the command and its exit code or pass result (e.g. 'npm run build exited 0'). Do NOT claim completion without it."
    );
  }
  const res = JSON.stringify(result);
  logToolCall('report_from_agent', `agent=${cleanAgent} status=${finalStatus}`, res, cleanAgent);
  return res;
}

function getProjectContext(projectPath = null) {
  const pPath = projectPath || getWorkspaceRoot() || process.cwd();
  let profile = personaMemory.getProjectProfile(pPath);
  if (!profile) {
    const pHash = personaMemory.saveOrUpdateProject(pPath);
    profile = personaMemory.getProjectProfile(pHash);
  }
  const mems = personaMemory.listMemories({ projectPath: pPath, limit: 5 });
  const boundedMems = (mems || []).map(m => ({
    id: m.id,
    agent_name: m.agent_name,
    memory_type: m.memory_type,
    title: m.title,
    content: m.content && m.content.length > 300 ? m.content.substring(0, 300) + '...' : m.content,
    updated_at: m.updated_at
  }));
  const safeProfile = profile ? {
    ...profile,
    context_summary: profile.context_summary && profile.context_summary.length > 500
      ? profile.context_summary.substring(0, 500) + '...'
      : profile.context_summary
  } : null;
  return JSON.stringify({
    status: 'ok',
    project_path: pPath,
    profile: safeProfile,
    memories: boundedMems
  });
}

function saveProjectContext(projectPath = null, contextSummary = '', techStack = null) {
  const pPath = projectPath || getWorkspaceRoot() || process.cwd();
  const pHash = personaMemory.saveOrUpdateProject(pPath, contextSummary, techStack);
  return JSON.stringify({
    status: 'saved',
    project_hash: pHash,
    project_path: pPath
  });
}

function queryProjectMemory(query = '', projectPath = null, agentName = null, memoryType = null, limit = 5) {
  const pPath = projectPath || getWorkspaceRoot() || process.cwd();
  const effLimit = Math.min(Math.max(parseInt(limit, 10) || 5, 1), 10);
  const mems = personaMemory.queryMemories({
    agentName,
    query,
    memoryType,
    projectPath: pPath,
    limit: effLimit
  });
  const boundedMems = (mems || []).map(m => ({
    id: m.id,
    agent_name: m.agent_name,
    memory_type: m.memory_type,
    title: m.title,
    content: m.content && m.content.length > 300 ? m.content.substring(0, 300) + '...' : m.content,
    updated_at: m.updated_at
  }));
  return JSON.stringify({
    status: 'ok',
    project_path: pPath,
    count: boundedMems.length,
    memories: boundedMems
  });
}

function runMcpAgent(agentName, task = null, context = null, constraints = null, skills = null, tasteDials = null, projectPath = null, taskDir = null) {
  if (typeof task === 'object' && task !== null) {
    const opts = task;
    context = opts.context || null;
    constraints = opts.constraints || null;
    skills = opts.skills || null;
    tasteDials = opts.tasteDials || opts.taste_dials || null;
    projectPath = opts.projectPath || opts.project_path || projectPath;
    taskDir = opts.taskDir || opts.task_dir || taskDir;
    task = opts.task || null;
  }
  const resolvedProjPath = projectPath || getWorkspaceRoot() || process.cwd();
  const sessionKey = getSessionKey(resolvedProjPath);
  const turn = getAndIncrementSessionTurn(sessionKey);
  const isAutoCompact = (turn >= 2);

  const sdlcManager = require('../sdlc_manager');
  const sdlcConfig = sdlcManager.getProjectSdlcConfig(resolvedProjPath);
  let dorResult = null;
  if (task && typeof task === 'string' && task.trim()) {
    dorResult = sdlcManager.checkReadiness(task, resolvedProjPath);
    if (sdlcConfig.dor_mode === 'enforced' && !dorResult.ready) {
      return JSON.stringify({
        status: 'blocked',
        phase: 'dor',
        message: 'Definition-of-Readiness (DoR) check failed in enforced mode. Please address missing items.',
        missing: dorResult.missing,
        dor_result: dorResult
      });
    }
  }

  let instructions = '';
  if (task && typeof task === 'string' && task.trim()) {
    instructions = task.trim();
    if (dorResult && !dorResult.ready && dorResult.missing.length > 0) {
      instructions += `\n\n### ⚠️ Definition-of-Readiness (DoR) Advisory Hints:\n` +
        dorResult.missing.map(m => `- ${m}`).join('\n');
    }
    if (context && typeof context === 'string' && context.trim()) {
      instructions += `\n\n### Context & Relevant Code Paths:\n${context.trim()}`;
    }
    if (constraints && typeof constraints === 'string' && constraints.trim()) {
      instructions += `\n\n### Execution Constraints:\n${constraints.trim()}`;
    }
  } else {
    const resolvedTaskDir = getResolvedTaskDir(taskDir);
    const delegatePath = path.join(resolvedTaskDir, 'delegate.md');
    if (!fs.existsSync(delegatePath)) {
      return JSON.stringify({ status: 'error', message: `Neither direct task instructions nor delegate.md found in task directory: ${resolvedTaskDir}` });
    }
    try {
      let delegateContent = fs.readFileSync(delegatePath, 'utf8');
      if (delegateContent.startsWith('---')) {
        const parts = delegateContent.split('---', 3);
        if (parts.length >= 3) delegateContent = parts[2].trim();
      }
      instructions = delegateContent;
    } catch (e) {
      return JSON.stringify({ status: 'error', message: `Failed to read delegate.md: ${e.message}` });
    }
  }

  if (!dorResult && instructions && typeof instructions === 'string' && instructions.trim()) {
    dorResult = sdlcManager.checkReadiness(instructions, resolvedProjPath);
    if (sdlcConfig.dor_mode === 'enforced' && !dorResult.ready) {
      return JSON.stringify({
        status: 'blocked',
        phase: 'dor',
        message: 'Definition-of-Readiness (DoR) check failed in enforced mode. Please address missing items.',
        missing: dorResult.missing,
        dor_result: dorResult
      });
    }
  }

  let dbAgentName = agentName;
  if (dbAgentName.startsWith('delegate_to_')) dbAgentName = dbAgentName.substring(12);
  if (dbAgentName.startsWith('mcp_')) dbAgentName = dbAgentName.substring(4);
  dbAgentName = dbAgentName.replace(/_/g, '-');

  let title = dbAgentName;
  let purpose = '';
  let agentConstraints = '';
  let personaInstructions = '';
  let skillsList = Array.isArray(skills) ? [...skills] : [];

  try {
    let rowConn = null;
    try {
      rowConn = getDb();
      let row = rowConn.prepare(`
        SELECT name, title, purpose, skills, constraints_text, instructions
        FROM agents WHERE name = ?
      `).get(dbAgentName);
      if (!row) {
        row = rowConn.prepare(`
          SELECT name, title, purpose, skills, constraints_text, instructions
          FROM agents WHERE name = ?
        `).get(`mcp_${dbAgentName}`);
      }
      if (row) {
        title = row.title || title;
        purpose = row.purpose || purpose;
        agentConstraints = row.constraints_text || agentConstraints;
        personaInstructions = row.instructions || personaInstructions;
        if (row.skills && skillsList.length === 0) {
          try { skillsList = JSON.parse(row.skills); } catch (_) { /* ignore */ }
        }
      }
    } finally {
      if (rowConn) {
        try { rowConn.close(); } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
      }
    }
  } catch (e) {
    process.stderr.write(`[mcp konoha] Error reading agent row from DB: ${e.message}\n`);
  }

  if (skillsList.length === 0 && instructions) {
    try {
      const conn = getDb();
      const auto = autoloadSkillsFromPrompt(instructions, conn);
      if (auto.length > 0) {
        skillsList = auto;
        process.stderr.write(`[mcp ${agentName}] auto-loaded skills from prompt: ${auto.join(', ')}\n`);
      }
    } catch (_) { /* ignore */ }
  }

  if (dbAgentName === 'jonin') {
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
    if (skillsList.length === 0) {
      skillsList = [
        'jonin-skill',
        `jonin-skill/${targetFw}-code-expert`,
        `jonin-skill/${targetFw}-ui-expert`,
        'jonin-skill/design-token-manifest',
        'jonin-skill/taste-skill-frontend-expert'
      ];
    }
  }

  const skillsContent = [];
  if (skillsList.length > 0) {
    let skillConn = null;
    try {
      skillConn = getDb();
      const primarySkill = skillsList[0];
      const resolved = fuzzyResolveSkill(primarySkill, skillConn) || primarySkill;
      const row = skillConn.prepare('SELECT content, type FROM skills WHERE name = ?').get(resolved);
      if (row && row.content) {
        const preview = row.content.substring(0, 250) + (row.content.length > 250 ? '\n...(Use konoha.get_skill for full reference)' : '');
        const label = row.type === 'skill' ? 'Skill' : 'Reference';
        skillsContent.push(`### ${label}: ${resolved}\n\n${preview}`);
      }
    } catch (e) {
      process.stderr.write(`[mcp ${agentName}] Error loading skill definitions: ${e.message}\n`);
    } finally {
      if (skillConn) {
        try { skillConn.close(); } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
      }
    }
  }

  let projectContextBlock = '';
  try {
    let projProfile = personaMemory.getProjectProfile(resolvedProjPath);
    if (!projProfile) {
      const pHash = personaMemory.saveOrUpdateProject(resolvedProjPath);
      projProfile = personaMemory.getProjectProfile(pHash);
    }
    const projMems = personaMemory.queryMemories({
      agentName: dbAgentName,
      query: instructions,
      projectPath: resolvedProjPath,
      limit: isAutoCompact ? 2 : 3
    });
    projectContextBlock = personaMemory.formatProjectContextForPrompt(
      projProfile,
      projMems,
      isAutoCompact ? 1 : 2,
      isAutoCompact
    );
  } catch (e) {
    process.stderr.write(`[mcp ${agentName}] Error querying project context: ${e.message}\n`);
  }

  let searchFindings = '';
  if (dbAgentName.includes('chunin') && !isAutoCompact) {
    searchFindings = '### Deep Research Findings (Compact)\n\n';
  }

  let tasteSkillBlock = '';
  if (dbAgentName === 'jonin') {
    const dials = tasteDials || {};
    const varDial = dials.design_variance !== undefined ? dials.design_variance : 8;
    const motDial = dials.motion_intensity !== undefined ? dials.motion_intensity : 7;
    const densDial = dials.visual_density !== undefined ? dials.visual_density : 6;
    if (isAutoCompact) {
      tasteSkillBlock = (
        `### 🎨 Taste-Skill Rules (Compacted Turn ${turn}):\n` +
        `- Dials: ${varDial}/${motDial}/${densDial} | Typography: Geist/Satoshi | Spacing: py-24/py-32 | CSS Grid (12-col) | 100dvh | Zero emojis\n` +
        `- SDLC & Anti-Slop: Run aislop_scan (ai_slop_clean: true, findings: 0), record clean build/lint validation evidence.\n`
      );
    } else {
      tasteSkillBlock = (
        '### 🎨 Taste-Skill Design Engine Directives (tasteskill.dev):\n' +
        `- Active Taste Dials: DESIGN_VARIANCE=${varDial}/10 | MOTION_INTENSITY=${motDial}/10 | VISUAL_DENSITY=${densDial}/10\n` +
        '- Anti-Slop Policy: Zero generic AI-purple gradients, zero 3-card boilerplate stacks. Implement bespoke editorial UI.\n' +
        '- Typography: Geist, Cabinet Grotesk, Outfit, Satoshi, Clash Display (no default Inter). Extreme scale contrast.\n' +
        '- Layout & Spacing: Cinematic py-24/py-32 section pacing, CSS Grid (grid-cols-12), max-w-[1400px].\n' +
        '- Viewport & Mobile: min-h-[100dvh] safety (no h-screen), sticky bottom dock on mobile (`lg:hidden`).\n' +
        '- Theme & Aesthetics: 10 Light-Mode gradient themes (data-theme), 3D perspective tilt (1200px), Zero emojis (use Lucide SVG).\n' +
        "- Quality: pnpm exclusively, SPA/multi-page routes, 50-item dataset, zero errors/warnings, 'Build by Konoha' footer.\n" +
        '- SDLC & Anti-Slop Delivery Gate: Jonin must run `aislop_scan` before delivery to ensure `ai_slop_findings: 0` and `ai_slop_clean: true`. Include real validation commands (e.g. `pnpm run build`, `pnpm run lint`) and anti-slop scan results in report_from_agent validation evidence.\n'
      );
    }
  }

  let systemPrompt = '';
  if (isAutoCompact) {
    const compactHeader = (
      `[Konoha Auto-Compact: Active (Turn ${turn}) - Token Preservation Enabled]\n\n` +
      'IMPORTANT: The TASK INSTRUCTIONS at the bottom of this prompt are the complete, ' +
      'authoritative task. Never reinterpret, narrow, or replace them with a newly ' +
      'discovered error. If you find an additional bug while fixing, fix the ORIGINAL ' +
      'task first, then report the new finding — do not abandon or delete prior work.\n\n'
    );
    systemPrompt = (
      `${compactHeader}You are @${dbAgentName} (${title}).\n` +
      `Purpose: ${purpose}\n` +
      `Instructions: ${truncateAtBoundary(personaInstructions, 1200)}\n` +
      `Constraints: ${truncateAtBoundary(agentConstraints, 600)}\n\n`
    );
    // P4: cap the persona/context portion (never the MCP block, skills, or task instructions)
    const MAX_PERSONA_BYTES = 1400;
    if (systemPrompt.length > MAX_PERSONA_BYTES) {
      systemPrompt = truncateAtBoundary(systemPrompt, MAX_PERSONA_BYTES) + '\n';
    }
    if (projectContextBlock) systemPrompt += projectContextBlock + '\n';
    if (tasteSkillBlock) systemPrompt += tasteSkillBlock + '\n';
    systemPrompt += buildSubagentMcpBlock(getActiveClient(), agentName) + '\n';
    if (skillsContent.length > 0) {
      systemPrompt += 'Available Skills:\n' + skillsContent.join('\n\n') + '\n\n';
    } else if (skillsList.length > 0) {
      systemPrompt += `Available Skills:\nOn-Demand Reference Skills: ${skillsList.join(', ')}\n\n`;
    }
    systemPrompt += (
      'Conflict Diff Format:\n' +
      'FILE: path/to/file\n<<<<<<< original\n[orig]\n=======\n[replacement]\n>>>>>>>\n'
    );
  } else {
    systemPrompt = (
      `You are @${dbAgentName} (${title}).\n` +
      `Purpose: ${purpose}\n\n` +
      `Instructions:\n${personaInstructions}\n\n` +
      `Constraints:\n${agentConstraints}\n\n`
    );
    if (projectContextBlock) systemPrompt += projectContextBlock + '\n';
    if (tasteSkillBlock) systemPrompt += tasteSkillBlock + '\n';
    systemPrompt += buildSubagentMcpBlock(getActiveClient(), agentName);
    if (searchFindings) systemPrompt += searchFindings + '\n';
    if (skillsContent.length > 0) {
      systemPrompt += 'Available Skills:\n' + skillsContent.join('\n\n') + '\n\n';
    }
    if (skillsList.length > 1) {
      systemPrompt += `Available On-Demand Skills (call konoha.get_skill to load): ${skillsList.join(', ')}\n\n`;
    }
    systemPrompt += (
      'You can make file creations/edits directly by outputting conflict diff markers in your response.\n' +
      'To write a new file or edit an existing file, include this exact block in your response:\n' +
      'FILE: path/to/file\n' +
      '<<<<<<< original\n' +
      '[exact original code snippet to replace, leave empty for new files]\n' +
      '=======\n' +
      '[exact replacement code block]\n' +
      '>>>>>>>\n\n' +
      'Make sure to output the complete conflict diff block. You can output multiple diff blocks for multiple edits.'
    );
  }

  // P4: payload ceiling — persona/context capped above (never MCP block,
  // skills, or TASK INSTRUCTIONS). Total stays bounded by construction.
  const taskTail = (
    `## TASK INSTRUCTIONS\n\n${instructions}\n\n` +
    `You must now act as ${dbAgentName} and execute the task above. Use the available tools to explore the codebase or make file edits.\n\n` +
    '## Execution Protocol\n\n' +
    '1. Execute the task directly as described in TASK INSTRUCTIONS above.\n' +
    '2. Validate your work: execute framework validation checks and verify 0 errors and 0 warnings.\n' +
    '3. Zero-AI-Slop Pre-Gate: Ensure no AI slop patterns exist (run `aislop_scan` to verify `ai_slop_clean: true` and `ai_slop_findings: 0`).\n' +
    '4. When complete, write your summary to `result.md` in the task directory (or report your results, validation evidence, and key learnings via the `report_from_agent` tool or structured response).'
  );
  const instruction = `${systemPrompt}\n\n` + taskTail;

  const res = JSON.stringify({
    status: 'ready',
    phase: 'execution',
    agent: dbAgentName,
    project_path: resolvedProjPath,
    task_dir: taskDir,
    instructions: instruction
  });
  logToolCall(agentName, `project_path=${resolvedProjPath} task_dir=${taskDir}`, res, dbAgentName);
  return res;
}

module.exports = {
  getMainModel,
  applyFileEdits,
  autoloadSkillsFromPrompt,
  buildSubagentMcpBlock,
  truncateAtBoundary,
  assessValidationEvidence,
  reportFromAgent,
  getProjectContext,
  saveProjectContext,
  queryProjectMemory,
  runMcpAgent
};
