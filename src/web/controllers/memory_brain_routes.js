'use strict';

/**
 * src/web/controllers/memory_brain_routes.js — Authenticated Web UI REST routes
 * for Konoha's provenance-aware Knowledge Brain lifecycle, graph, maintenance, and export.
 */

const personaMemory = require('../../persona_memory');
const { sendJson, parseBody } = require('./common');

async function handleMemoryBrainRoutes(req, res, route, broadcastEvent) {
  const { pathname, method, parsedUrl } = route;

  if (method === 'GET' && pathname === '/api/v1/persona/export') {
    try {
      const format = parsedUrl.searchParams.get('format') === 'json' ? 'json' : 'markdown';
      const projectPath = parsedUrl.searchParams.get('projectPath') || parsedUrl.searchParams.get('project_path') || null;
      const includeInactive = parsedUrl.searchParams.get('includeInactive') === 'true';
      const exported = personaMemory.exportMemoryBrain({ format, projectPath, includeInactive });
      if (format === 'json') return sendJson(res, 200, exported);
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
      return res.end(exported);
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (method === 'POST' && pathname === '/api/v1/persona/relations') {
    try {
      const body = await parseBody(req);
      const rel = personaMemory.linkMemories({
        sourceId: body.sourceId || body.source_id,
        targetId: body.targetId || body.target_id,
        relationType: body.relationType || body.relation_type,
        evidenceRef: body.evidenceRef || body.evidence_ref || '',
        evidenceType: body.evidenceType || body.evidence_type || 'explicit',
        confidence: body.confidence,
        verified: body.verified !== false,
        actor: body.actor || 'web_ui'
      });
      broadcastEvent('persona_updated', { action: 'link', relation_id: rel.id });
      return sendJson(res, 201, { ok: true, relation: rel });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (method === 'POST' && pathname === '/api/v1/persona/maintenance') {
    try {
      const body = await parseBody(req).catch(() => ({}));
      const result = personaMemory.runMemoryMaintenance({
        projectPath: body.projectPath || null,
        projectHash: body.projectHash || null,
        dryRun: body.dryRun !== false,
        actions: body.actions,
        staleDays: body.staleDays,
        actor: body.actor || 'web_ui_maintenance'
      });
      if (!result.dry_run) broadcastEvent('persona_updated', { action: 'maintenance', run_id: result.run_id });
      return sendJson(res, 200, { ok: true, ...result });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (method === 'POST' && pathname === '/api/v1/persona/maintenance/revert') {
    try {
      const body = await parseBody(req);
      const result = personaMemory.revertMaintenanceRun({
        runId: body.runId || body.run_id || null,
        auditEventIds: body.auditEventIds || body.audit_event_ids || null,
        actor: body.actor || 'web_ui_revert'
      });
      broadcastEvent('persona_updated', { action: 'maintenance_revert' });
      return sendJson(res, 200, result);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  const memActionMatch = pathname.match(/^\/api\/v1\/persona\/([^/]+)\/(correct|withdraw|verify|history|graph)$/);
  if (!memActionMatch) return false;
  const memId = decodeURIComponent(memActionMatch[1]);
  const action = memActionMatch[2];

  if (method === 'GET' && action === 'history') {
    try {
      return sendJson(res, 200, personaMemory.getMemoryHistory(memId));
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (method === 'GET' && action === 'graph') {
    try {
      const depth = parseInt(parsedUrl.searchParams.get('depth') || '2', 10);
      const includeUnverified = parsedUrl.searchParams.get('includeUnverified') !== 'false';
      const projectPath = parsedUrl.searchParams.get('projectPath') || null;
      return sendJson(res, 200, personaMemory.traverseKnowledgeGraph({
        memoryId: memId,
        depth,
        includeUnverified,
        projectPath
      }));
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (method === 'POST' && action === 'correct') {
    try {
      const body = await parseBody(req);
      const resCorrect = personaMemory.correctMemory({
        id: memId,
        newContent: body.newContent || body.content,
        title: body.title,
        reason: body.reason || '',
        actor: body.actor || 'web_ui',
        evidenceRef: body.evidenceRef || '',
        sourceType: body.sourceType,
        confidence: body.confidence
      });
      broadcastEvent('persona_updated', { action: 'correct', old_id: memId, new_id: resCorrect.new_id });
      return sendJson(res, 200, resCorrect);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (method === 'POST' && action === 'withdraw') {
    try {
      const body = await parseBody(req).catch(() => ({}));
      const resWithdraw = personaMemory.withdrawMemory({
        id: memId,
        status: body.status || 'withdrawn',
        reason: body.reason || '',
        actor: body.actor || 'web_ui',
        evidenceRef: body.evidenceRef || ''
      });
      broadcastEvent('persona_updated', { action: 'withdraw', id: memId });
      return sendJson(res, 200, resWithdraw);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (method === 'POST' && action === 'verify') {
    try {
      const body = await parseBody(req).catch(() => ({}));
      const resVerify = personaMemory.verifyMemory({
        id: memId,
        verificationStatus: body.verificationStatus || 'confirmed',
        actor: body.actor || 'web_ui',
        evidenceRef: body.evidenceRef || '',
        confidence: body.confidence
      });
      broadcastEvent('persona_updated', { action: 'verify', id: memId });
      return sendJson(res, 200, resVerify);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  return false;
}

module.exports = { handleMemoryBrainRoutes };
