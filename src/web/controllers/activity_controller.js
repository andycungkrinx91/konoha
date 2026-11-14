'use strict';

/**
 * Live Agent Activity Controller (`GET /api/v1/activity/live`)
 * Aggregates real-time agent, client, SDLC task, and MCP tool execution telemetry
 * from SQLite (`active_sessions`, `sdlc_tasks`, `tool_calls`, `agents`) into an
 * execution graph for the interactive Agent Activity spider visualization.
 */

const db = require('../../db');
const agentManager = require('../../agent_manager');
const { sendJson, isClientConfigured } = require('./common');

let _activitySeq = 0;

const CLIENT_DEFINITIONS = [
  { id: 'antigravity', name: 'Antigravity', category: 'IDE / CLI' },
  { id: 'cursor', name: 'Cursor', category: 'IDE' },
  { id: 'claude', name: 'Claude Code', category: 'CLI' },
  { id: 'opencode', name: 'OpenCode', category: 'CLI' },
  { id: 'commandcode', name: 'CommandCode', category: 'CLI' },
  { id: 'codex', name: 'Codex', category: 'CLI / App' },
  { id: 'pi', name: 'Pi', category: 'CLI' },
  { id: 'omp', name: 'OMP', category: 'CLI' }
];

const AGENT_ROLE_LABELS = {
  sannin: 'MCP Router & Orchestrator',
  kage: 'Village Leader & Architect',
  jonin: 'UI & Frontend Specialist',
  anbu: 'Backend, DevOps & Security',
  chunin: 'Research & Intel Specialist',
  genin: 'Read-Only Codebase Scout',
  'tokubetsu-jonin': 'Technical Writing & Scribe',
  akatsuki: 'Red-Team & Blue-Team Security',
  yamanaka: 'Generative 3D Subsystem'
};

function normalizeAgentId(raw) {
  const s = String(raw || '').trim().toLowerCase().replace(/^@/, '').replace(/_/g, '-');
  if (!s) return 'sannin';
  if (s.includes('tokubetsu')) return 'tokubetsu-jonin';
  if (s.includes('sannin') || s === 'router' || s === 'orchestrator') return 'sannin';
  if (s.includes('kage')) return 'kage';
  if (s.includes('jonin')) return 'jonin';
  if (s.includes('anbu')) return 'anbu';
  if (s.includes('chunin')) return 'chunin';
  if (s.includes('genin')) return 'genin';
  if (s.includes('akatsuki')) return 'akatsuki';
  if (s.includes('yamanaka')) return 'yamanaka';
  return s;
}

function normalizeClientId(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s || s === 'unknown' || s === 'default') return 'antigravity';
  if (s.includes('antigravity') || s.includes('gemini')) return 'antigravity';
  if (s.includes('cursor')) return 'cursor';
  if (s.includes('claude')) return 'claude';
  if (s.includes('opencode')) return 'opencode';
  if (s.includes('command')) return 'commandcode';
  if (s.includes('codex')) return 'codex';
  if (s === 'pi' || s.startsWith('pi-')) return 'pi';
  if (s.includes('omp')) return 'omp';
  return s;
}

function parseTimestampMs(ts) {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts > 1e12 ? ts : ts * 1000;
  const raw = String(ts).trim();
  const iso = raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : 0;
}

function loadCanonicalAgents() {
  try {
    const loaded = agentManager.loadAgents();
    const list = Array.isArray(loaded) ? loaded : Object.values(loaded || {});
    const filtered = list
      .map((a) => ({
        id: normalizeAgentId(a.name || a.id),
        name: a.name || a.id || 'sannin',
        icon: a.icon || '*',
        role: AGENT_ROLE_LABELS[normalizeAgentId(a.name || a.id)] || a.description || 'Specialist Agent',
        model: a.model || 'inherit',
        skills_count: Array.isArray(a.skills) ? a.skills.length : 0
      }))
      .filter((a) => a.id !== 'yamanaka');
    if (filtered.length > 0) return filtered;
  } catch (_) {
    // Fallback to default list
  }
  return Object.entries(AGENT_ROLE_LABELS)
    .filter(([id]) => id !== 'yamanaka')
    .map(([id, role]) => ({ id, name: id, icon: '*', role, model: 'inherit', skills_count: 1 }));
}

function normalizeExecutionStatus(rawStatus) {
  const s = String(rawStatus || '').trim().toLowerCase();
  if (s === 'queued' || s === 'pending') return 'queued';
  if (s === 'in_progress' || s === 'executing' || s === 'running' || s === 'remediating' || s === 'orchestrating' || s === 'active') return 'running';
  if (s === 'completed' || s === 'verified' || s === 'done') return 'completed';
  if (s === 'failed' || s === 'error' || s === 'rejected' || s === 'circuit_broken') return 'failed';
  if (s === 'paused' || s === 'blocked' || s === 'standby' || s === 'idle') return 'paused';
  if (s === 'pending_plan_approval' || s === 'pending_human_signoff' || s === 'awaiting-approval' || s === 'awaiting_approval') return 'awaiting-approval';
  return 'queued';
}

function parseTaskRow(row) {
  let evidenceObj = {};
  if (row && row.evidence) {
    try {
      evidenceObj = typeof row.evidence === 'string' ? JSON.parse(row.evidence) : row.evidence;
    } catch (_) {
      evidenceObj = {};
    }
  }
  const rawDesc = String(row?.description || '').trim();
  const derivedTitle = evidenceObj?.title
    || (rawDesc ? rawDesc.split('\n')[0].slice(0, 96) : '')
    || `Task #${row?.id || 'unknown'}`;
  const rawConf = evidenceObj?.confidence_score ?? evidenceObj?.confidence ?? null;
  const createdMs = parseTimestampMs(row?.created_at);
  const updatedMs = parseTimestampMs(row?.updated_at || row?.created_at);
  const durationMs = createdMs > 0 && updatedMs >= createdMs ? (updatedMs - createdMs) : 0;
  const normalizedStatus = normalizeExecutionStatus(evidenceObj?.hitl_gate || row?.status);
  return {
    ...row,
    title: derivedTitle,
    agent: evidenceObj?.agent || evidenceObj?.assigned_agent || evidenceObj?.subagent || 'sannin',
    client: normalizeClientId(row?.client || evidenceObj?.client || 'antigravity'),
    tool: evidenceObj?.tool || evidenceObj?.last_tool || 'sannin',
    workflow: evidenceObj?.workflow || evidenceObj?.phase || evidenceObj?.stage || row?.review_mode || 'sdlc-langgraph',
    phase: evidenceObj?.phase || evidenceObj?.stage || row?.review_mode || row?.status || 'implementation',
    execution_status: normalizedStatus,
    duration_ms: durationMs,
    evidence_summary: evidenceObj?.summary || evidenceObj?.exploration_evidence || (row?.dor_result ? String(row.dor_result).slice(0, 120) : 'Verified runtime telemetry'),
    verified: Boolean(evidenceObj?.verified || evidenceObj?.qa_verified || row?.status === 'completed'),
    confidence_score: rawConf !== null && rawConf !== undefined && Number.isFinite(Number(rawConf)) ? Number(rawConf) : null
  };
}

function queryDatabaseActivity(windowMinutes = 60, limit = 60) {
  const nowMs = Date.now();
  const activeCutoffMs = nowMs - (Math.max(5, windowMinutes) * 60 * 1000);
  const liveBurstCutoffMs = nowMs - (5 * 60 * 1000);

  let activeSessions = [];
  let recentToolCalls = [];
  let sdlcTasks = [];
  let toolSummary = [];

  let conn = null;
  try {
    conn = db.getConnection(null, true);
    try {
      activeSessions = conn.prepare(`
        SELECT session_id, client, workspace_root, project_hash, transcript_path, last_active_at AS last_active_ts
        FROM active_sessions ORDER BY last_active_at DESC LIMIT 32
      `).all();
    } catch (_) { activeSessions = []; }

    try {
      recentToolCalls = conn.prepare(`
        SELECT id, timestamp, tool, query, returned_bytes, total_library_bytes, bytes_saved, tokens_saved, agent, client
        FROM tool_calls ORDER BY id DESC LIMIT ?
      `).all(Math.min(150, Math.max(20, limit)));
    } catch (_) { recentToolCalls = []; }

    try {
      const rawTasks = conn.prepare(`
        SELECT id, description, status, dor_result, review_mode, evidence, slop_result, slop_cycles, project_path, session_id, client, created_at, updated_at
        FROM sdlc_tasks ORDER BY updated_at DESC, id DESC LIMIT 40
      `).all();
      sdlcTasks = rawTasks.map(parseTaskRow);
    } catch (_) { sdlcTasks = []; }

    try {
      toolSummary = conn.prepare(`
        SELECT tool, COUNT(*) as call_count, COALESCE(SUM(tokens_saved), 0) as total_tokens_saved,
               COALESCE(SUM(returned_bytes), 0) as total_returned_bytes, MAX(timestamp) as last_called_at
        FROM tool_calls WHERE tool IS NOT NULL AND tool != ''
        GROUP BY tool ORDER BY MAX(id) DESC LIMIT 18
      `).all();
    } catch (_) { toolSummary = []; }
  } catch (_) {
    // Graceful degradation
  } finally {
    if (conn) {
      try { conn.close(); } catch (_) { /* ignore */ }
    }
  }

  return { nowMs, activeCutoffMs, liveBurstCutoffMs, activeSessions, recentToolCalls, sdlcTasks, toolSummary };
}

function createGraphHelpers() {
  const nodes = [];
  const edges = [];
  const nodeMap = new Map();
  const edgeMap = new Map();

  function upsertNode(node) {
    const existing = nodeMap.get(node.id);
    if (!existing) {
      nodeMap.set(node.id, node);
      nodes.push(node);
      return node;
    }
    Object.assign(existing, node, {
      active: Boolean(existing.active || node.active),
      call_count: (existing.call_count || 0) + (node.call_count || 0),
      tokens_saved: (existing.tokens_saved || 0) + (node.tokens_saved || 0)
    });
    return existing;
  }

  function upsertEdge(source, target, meta = {}) {
    if (!source || !target || source === target) return null;
    const id = `${source}->${target}`;
    const existing = edgeMap.get(id);
    if (!existing) {
      const edge = {
        id, source, target,
        kind: meta.kind || 'execution',
        status: meta.status || 'idle',
        active: Boolean(meta.active),
        weight: meta.weight || 1,
        tokens_saved: meta.tokens_saved || 0,
        last_timestamp: meta.last_timestamp || null,
        label: meta.label || ''
      };
      edgeMap.set(id, edge);
      edges.push(edge);
      return edge;
    }
    existing.weight += (meta.weight || 1);
    existing.tokens_saved += (meta.tokens_saved || 0);
    if (meta.active) existing.active = true;
    if (meta.status && (existing.status === 'idle' || meta.active)) existing.status = meta.status;
    if (meta.last_timestamp && (!existing.last_timestamp || meta.last_timestamp > existing.last_timestamp)) {
      existing.last_timestamp = meta.last_timestamp;
    }
    return existing;
  }

  return { nodes, edges, nodeMap, upsertNode, upsertEdge };
}

function populateClientAndAgentNodes(graph, rawData, canonicalAgents) {
  const { activeSessions, activeCutoffMs, liveBurstCutoffMs } = rawData;
  const sessionByClient = new Map();
  for (const sess of activeSessions) {
    const cid = normalizeClientId(sess.client);
    const tsMs = parseTimestampMs(sess.last_active_ts);
    const prev = sessionByClient.get(cid);
    if (!prev || tsMs > prev.tsMs) sessionByClient.set(cid, { ...sess, tsMs });
  }

  const clientsPayload = CLIENT_DEFINITIONS.map((clientDef) => {
    const configured = isClientConfigured(clientDef.id);
    const sess = sessionByClient.get(clientDef.id);
    const isRecent = Boolean(sess && sess.tsMs >= activeCutoffMs);
    const isLive = Boolean(sess && sess.tsMs >= liveBurstCutoffMs);
    const status = isLive ? 'executing' : (isRecent ? 'connected' : (configured ? 'ready' : 'unconfigured'));

    graph.upsertNode({
      id: `client:${clientDef.id}`,
      key: clientDef.id,
      type: 'client',
      label: clientDef.name,
      category: clientDef.category,
      status,
      active: isLive || isRecent,
      configured,
      turn_count: sess ? Number(sess.turn_count || 0) : 0,
      session_id: sess ? sess.session_id : null,
      last_active_at: sess && sess.tsMs ? new Date(sess.tsMs).toISOString() : null,
      call_count: 0,
      tokens_saved: 0
    });

    return {
      id: clientDef.id, name: clientDef.name, category: clientDef.category,
      configured, status, active: isLive || isRecent,
      turn_count: sess ? Number(sess.turn_count || 0) : 0,
      last_active_at: sess && sess.tsMs ? new Date(sess.tsMs).toISOString() : null
    };
  });

  for (const agent of canonicalAgents) {
    const agentNodeId = `agent:${agent.id}`;
    graph.upsertNode({
      id: agentNodeId, key: agent.id, type: 'agent', label: `@${agent.id}`,
      role: agent.role, model: agent.model || 'inherit', skills_count: agent.skills_count || 0,
      status: 'standby', active: false, task_id: null, task_title: null,
      phase: null, confidence_score: null, call_count: 0, tokens_saved: 0, last_active_at: null
    });
    if (agent.id !== 'sannin') {
      graph.upsertEdge('agent:sannin', agentNodeId, { kind: 'orchestration', status: 'standby', active: false, weight: 1, label: 'delegates' });
    }
  }

  return clientsPayload;
}

function populateTasksAndTools(graph, rawData) {
  const { sdlcTasks, toolSummary, recentToolCalls, activeCutoffMs, liveBurstCutoffMs } = rawData;
  const activeTaskStatuses = new Set(['in_progress', 'queued', 'pending_plan_approval', 'pending_human_signoff', 'remediating']);

  const formattedTasks = sdlcTasks.map((t) => {
    const agentId = normalizeAgentId(t.agent || 'sannin');
    const updatedMs = parseTimestampMs(t.updated_at || t.created_at);
    const isTaskActive = activeTaskStatuses.has(String(t.status || '').toLowerCase()) || (updatedMs >= liveBurstCutoffMs);
    const agentNode = graph.nodeMap.get(`agent:${agentId}`);
    if (agentNode && (isTaskActive || !agentNode.task_id)) {
      agentNode.task_id = t.id;
      agentNode.task_title = t.title;
      agentNode.phase = t.phase || 'implementation';
      agentNode.workflow = t.workflow || t.phase || 'sdlc-langgraph';
      agentNode.client = t.client || 'antigravity';
      agentNode.tool = t.tool || 'sannin';
      agentNode.duration_ms = t.duration_ms || 0;
      agentNode.evidence = t.evidence_summary || 'Verified runtime telemetry';
      agentNode.execution_status = t.execution_status || normalizeExecutionStatus(t.status);
      agentNode.confidence_score = t.confidence_score;
    }
    if (agentNode && isTaskActive) {
      agentNode.active = true;
      agentNode.status = t.execution_status || t.status || 'running';
      agentNode.last_active_at = t.updated_at || t.created_at;
      graph.upsertEdge('agent:sannin', `agent:${agentId}`, {
        kind: 'sdlc_task', status: t.execution_status || t.status || 'running', active: true, weight: 2,
        last_timestamp: t.updated_at || t.created_at, label: t.phase || t.status || 'active'
      });
    }
    return {
      id: t.id, task_id: t.id, title: t.title || `Task #${t.id}`, description: t.description || '',
      agent: agentId, client: t.client || 'antigravity', tool: t.tool || 'sannin',
      workflow: t.workflow || t.phase || 'sdlc-langgraph',
      status: t.status || 'queued', execution_status: t.execution_status || normalizeExecutionStatus(t.status),
      phase: t.phase || 'planning', duration_ms: t.duration_ms || 0,
      evidence: t.evidence_summary || 'Verified runtime telemetry',
      verified: Boolean(t.verified), confidence_score: t.confidence_score !== undefined ? t.confidence_score : null,
      created_at: t.created_at, updated_at: t.updated_at, active: isTaskActive
    };
  });

  for (const item of toolSummary.slice(0, 12)) {
    const toolName = String(item.tool || '').trim();
    if (!toolName) continue;
    const lastMs = parseTimestampMs(item.last_called_at);
    const isToolActive = lastMs >= activeCutoffMs;
    graph.upsertNode({
      id: `tool:${toolName}`, key: toolName, type: 'tool', label: toolName,
      category: 'Konoha MCP Tool',
      status: lastMs >= liveBurstCutoffMs ? 'executing' : (isToolActive ? 'warm' : 'idle'),
      active: isToolActive, call_count: Number(item.call_count || 0),
      tokens_saved: Number(item.total_tokens_saved || 0),
      returned_bytes: Number(item.total_returned_bytes || 0),
      last_active_at: item.last_called_at || null
    });
  }

  const formattedToolCalls = recentToolCalls.slice(0, 40).map((call, idx) => {
    const toolName = String(call.tool || 'mcp_tool').trim();
    const agentId = normalizeAgentId(call.agent || (toolName.includes('skill') ? 'sannin' : 'genin'));
    const clientId = normalizeClientId(call.client || 'antigravity');
    const callMs = parseTimestampMs(call.timestamp);
    const isRecent = callMs >= activeCutoffMs || idx < 6;
    const isLive = callMs >= liveBurstCutoffMs || idx < 3;
    const tokensSaved = Number(call.tokens_saved || 0);
    const edgeStatus = isLive ? 'executing' : (isRecent ? 'active' : 'idle');

    const toolNodeId = `tool:${toolName}`;
    if (!graph.nodeMap.has(toolNodeId)) {
      graph.upsertNode({
        id: toolNodeId, key: toolName, type: 'tool', label: toolName, category: 'Konoha MCP Tool',
        status: isLive ? 'executing' : (isRecent ? 'warm' : 'idle'), active: isRecent,
        call_count: 1, tokens_saved: tokensSaved, returned_bytes: Number(call.returned_bytes || 0),
        last_active_at: call.timestamp || null
      });
    }

    const agentNode = graph.nodeMap.get(`agent:${agentId}`);
    if (agentNode) {
      agentNode.call_count = (agentNode.call_count || 0) + 1;
      agentNode.tokens_saved = (agentNode.tokens_saved || 0) + tokensSaved;
      if (!agentNode.last_active_at || (call.timestamp && call.timestamp > agentNode.last_active_at)) {
        agentNode.last_active_at = call.timestamp;
      }
      if (isRecent) {
        agentNode.active = true;
        if (agentNode.status === 'standby') agentNode.status = edgeStatus;
      }
    }

    const clientNode = graph.nodeMap.get(`client:${clientId}`);
    if (clientNode) {
      clientNode.call_count = (clientNode.call_count || 0) + 1;
      clientNode.tokens_saved = (clientNode.tokens_saved || 0) + tokensSaved;
      if (isRecent) {
        clientNode.active = true;
        if (clientNode.status === 'ready' || clientNode.status === 'unconfigured') clientNode.status = isLive ? 'executing' : 'connected';
      }
    }

    graph.upsertEdge(`client:${clientId}`, 'agent:sannin', { kind: 'client_dispatch', status: edgeStatus, active: isRecent, weight: 1, tokens_saved: tokensSaved, last_timestamp: call.timestamp, label: clientId });
    if (agentId !== 'sannin') {
      graph.upsertEdge('agent:sannin', `agent:${agentId}`, { kind: 'orchestration', status: edgeStatus, active: isRecent, weight: 1, tokens_saved: tokensSaved, last_timestamp: call.timestamp, label: `@${agentId}` });
    }
    graph.upsertEdge(`agent:${agentId}`, toolNodeId, { kind: 'tool_invocation', status: edgeStatus, active: isRecent, weight: 1, tokens_saved: tokensSaved, last_timestamp: call.timestamp, label: toolName });

    return {
      id: call.id, timestamp: call.timestamp, tool: toolName, query: String(call.query || '').slice(0, 140),
      agent: agentId, client: clientId, returned_bytes: Number(call.returned_bytes || 0),
      baseline_bytes: Number(call.total_library_bytes || call.bytes_saved || 0),
      tokens_saved: tokensSaved, skill_id: null, active: isRecent, live: isLive
    };
  });

  return { formattedTasks, formattedToolCalls };
}

function buildExecutionGraph(rawData, canonicalAgents) {
  const graph = createGraphHelpers();
  const clientsPayload = populateClientAndAgentNodes(graph, rawData, canonicalAgents);
  const { formattedTasks, formattedToolCalls } = populateTasksAndTools(graph, rawData);

  const sanninNode = graph.nodeMap.get('agent:sannin');
  const activeEdgesCount = graph.edges.filter((e) => e.active).length;
  if (sanninNode && activeEdgesCount > 0) {
    sanninNode.active = true;
    if (sanninNode.status === 'standby') sanninNode.status = 'orchestrating';
  }

  const stateCounts = {
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
    paused: 0,
    'awaiting-approval': 0
  };
  for (const t of formattedTasks) {
    const st = t.execution_status || normalizeExecutionStatus(t.status);
    if (stateCounts[st] !== undefined) stateCounts[st] += 1;
  }
  for (const n of graph.nodes) {
    if (!n.execution_status) {
      n.execution_status = n.active ? 'running' : normalizeExecutionStatus(n.status);
    }
  }

  _activitySeq += 1;

  return {
    ok: true,
    seq: _activitySeq,
    timestamp: new Date(rawData.nowMs).toISOString(),
    summary: {
      active_agents: graph.nodes.filter((n) => n.type === 'agent' && n.active).length,
      total_agents: canonicalAgents.length,
      active_tools: graph.nodes.filter((n) => n.type === 'tool' && n.active).length,
      total_tools: graph.nodes.filter((n) => n.type === 'tool').length,
      connected_clients: graph.nodes.filter((n) => n.type === 'client' && (n.active || n.configured)).length,
      total_clients: CLIENT_DEFINITIONS.length,
      active_tasks: formattedTasks.filter((t) => t.active).length,
      total_tasks: formattedTasks.length,
      active_edges: activeEdgesCount,
      total_edges: graph.edges.length,
      spider_leg_count: Math.max(6, Math.min(14, activeEdgesCount > 0 ? activeEdgesCount + 2 : 8)),
      recent_tokens_saved: formattedToolCalls.reduce((sum, c) => sum + (c.tokens_saved || 0), 0),
      recent_calls_count: formattedToolCalls.length,
      runtime_state: activeEdgesCount > 0 ? 'executing' : 'standby',
      state_counts: stateCounts
    },
    graph: {
      hub_id: 'agent:sannin',
      nodes: graph.nodes,
      edges: graph.edges
    },
    clients: clientsPayload,
    tasks: formattedTasks.slice(0, 20),
    recent_calls: formattedToolCalls.slice(0, 25)
  };
}

function getLiveActivitySnapshot(options = {}) {
  const windowMinutes = Number(options.windowMinutes) || 60;
  const limit = Number(options.limit) || 60;
  const canonicalAgents = loadCanonicalAgents();
  const rawData = queryDatabaseActivity(windowMinutes, limit);
  return buildExecutionGraph(rawData, canonicalAgents);
}

async function handleActivityRoutes(req, res, ctx, parsedUrl, ...rest) {
  const [pathname, method] = rest;
  if (method === 'GET' && pathname === '/api/v1/activity/live') {
    try {
      const searchParams = parsedUrl?.searchParams;
      const windowMinutes = Number(searchParams ? searchParams.get('window') : (parsedUrl?.query?.window || 60)) || 60;
      const limit = Number(searchParams ? searchParams.get('limit') : (parsedUrl?.query?.limit || 60)) || 60;
      const payload = getLiveActivitySnapshot({ windowMinutes, limit });
      return sendJson(res, 200, payload);
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: err.message });
    }
  }

  if (method === 'POST' && pathname === '/api/v1/activity/ping') {
    try {
      const payload = getLiveActivitySnapshot({ windowMinutes: 60, limit: 40 });
      if (ctx && typeof ctx.broadcastEvent === 'function') {
        ctx.broadcastEvent('agent_activity_updated', {
          seq: payload.seq,
          timestamp: payload.timestamp,
          summary: payload.summary
        });
      }
      return sendJson(res, 200, payload);
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: err.message });
    }
  }

  return false;
}

module.exports = {
  getLiveActivitySnapshot,
  handleActivityRoutes,
  normalizeExecutionStatus
};
