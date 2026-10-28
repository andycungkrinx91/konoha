'use strict';

const fs = require('fs');
const path = require('path');

const DOMAIN_KEYWORDS = [
  'ui', 'frontend', 'svelte', 'react', 'vue', 'tailwind', 'css', 'html', 'component', 'page', 'web',
  'api', 'backend', 'database', 'sqlite', 'sql', 'migration', 'docker', 'ci/cd', 'k8s', 'kubernetes',
  'refactor', 'test', 'bug', 'fix', 'error', 'debug', 'server', 'endpoint', 'auth', 'security',
  'audit', 'pentest', 'vulnerability', 'cve', 'recon', 'scan', 'red-team', 'blue-team', 'exploit',
  'doc', 'docs', 'documentation', 'guide', 'readme', 'architecture', 'rfc', 'design', 'review',
  'research', 'intel', 'citation', 'evidence', 'explore', 'investigate', 'analyze', 'trace',
  'orchestrate', 'plan', 'workflow', 'dispatch', 'routing', 'sannin', 'kage', 'jonin', 'anbu',
  'chunin', 'genin', 'tokubetsu-jonin', 'akatsuki'
];

const PLACEHOLDER_REGEX = /\b(TODO|FIXME|TBD)\b|\?{3,}|<placeholder>|\[placeholder\]|\[insert\b|<insert\b/i;

const FILE_PATH_REGEX = /(?:^|\s)([\w.-]+[/\\][\w./\\-]+|\b[\w.-]+\.(?:js|ts|json|md|html|css|py|yaml|yml|sh|svelte|vue))\b/g;

const CREATION_WORDS = /\b(create|new|scaffold|add|write|generate|touch|init|implement|build|setup|develop|make|construct)\b/i;

function _validateFilePathCandidate(candidate, isCreating, projectPath, missing) {
  if (
    candidate.startsWith('http:') || candidate.startsWith('https:') ||
    candidate.startsWith('@') || candidate.startsWith('node:') ||
    candidate.includes('..')
  ) {
    return;
  }
  const hasExt = /\.(?:js|ts|json|md|html|css|py|yaml|yml|sh|svelte|vue)$/i.test(candidate);
  const isPathLike = candidate.startsWith('./') || candidate.startsWith('.\\') || candidate.startsWith('../') || candidate.startsWith('..\\') || candidate.startsWith('/') || candidate.startsWith('\\') || /^(?:src|app|components|lib|tests?|docs?|bin|config|public)[/\\]/i.test(candidate);
  if (!hasExt && !isPathLike) return;

  if (!isCreating && projectPath && fs.existsSync(projectPath)) {
    const resolvedCandidate = path.isAbsolute(candidate) ? candidate : path.resolve(projectPath, candidate);
    if (!fs.existsSync(resolvedCandidate)) {
      missing.push(`Referenced file or path '${candidate}' does not exist on disk.`);
    }
  }
}

// Definition of Readiness (DoR) Engine

function checkReadiness(taskInput, projectPath = null) {
  let taskText = '';
  if (typeof taskInput === 'string') {
    taskText = taskInput.trim();
  } else if (taskInput && typeof taskInput === 'object') {
    taskText = (taskInput.task || taskInput.description || taskInput.prompt || '').trim();
  }

  const missing = [];

  const words = taskText.split(/\s+/).filter(Boolean);
  if (!taskText || words.length < 5) {
    missing.push('Task description is too brief (< 5 words). Provide more context or specific instructions.');
  }

  const placeholderMatch = taskText.match(PLACEHOLDER_REGEX);
  if (placeholderMatch) {
    missing.push(`Task contains unresolved placeholder or template marker (${placeholderMatch[0]}).`);
  }

  if (taskText) {
    const isCreating = CREATION_WORDS.test(taskText);
    const matches = taskText.matchAll(FILE_PATH_REGEX);
    for (const match of matches) {
      _validateFilePathCandidate(match[1], isCreating, projectPath, missing);
    }
  }

  if (taskText && words.length >= 3) {
    const lower = taskText.toLowerCase();
    const taskTokens = new Set(lower.split(/\W+/).filter(Boolean));
    const matchedDomain = DOMAIN_KEYWORDS.some(kw => {
      if (kw.includes('-')) return lower.includes(kw);
      return taskTokens.has(kw);
    });
    if (!matchedDomain) {
      missing.push('No matching skill domain identified from task keywords. Confirm domain (UI, Backend, Docs, Security, etc.).');
    }
  }

  const ready = missing.length === 0;
  let confidence = 'high';
  if (!ready) {
    confidence = (missing.length === 1 && words.length >= 5) ? 'medium' : 'low';
  }

  return {
    ready,
    missing,
    confidence
  };
}

// Cross-Provider Independence Detection

function detectReviewIndependence(implementingAgent, reviewerAgent = 'kage', dbPath = null, getDbConnFn = null) {
  const cleanImpl = (implementingAgent || '').toLowerCase().replace(/^mcp_/, '').replace(/_/g, '-');
  const cleanRev = (reviewerAgent || 'kage').toLowerCase().replace(/^mcp_/, '').replace(/_/g, '-');

  const db = require('../../db');
  const conn = getDbConnFn ? getDbConnFn(dbPath) : db.getConnection(dbPath, false);
  let reviewerModel = null;
  let implementingModel = null;

  try {
    const rows = conn.prepare(`
      SELECT name, model FROM agents WHERE name IN (?, ?, ?, ?)
    `).all(cleanImpl, cleanImpl.replace(/-/g, '_'), cleanRev, cleanRev.replace(/-/g, '_'));

    for (const row of rows) {
      const rName = row.name.replace(/_/g, '-');
      if (rName === cleanRev) reviewerModel = row.model;
      if (rName === cleanImpl) implementingModel = row.model;
    }
  } catch (_) {
    /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */
  } finally {
    try { conn.close(); } catch (_) { /* intentional best-effort fallback */ }
  }

  const isCrossProvider = Boolean(
    reviewerModel &&
    implementingModel &&
    reviewerModel.trim() !== '' &&
    implementingModel.trim() !== '' &&
    reviewerModel.trim() !== implementingModel.trim()
  );

  return {
    isCrossProvider,
    reviewMode: isCrossProvider ? 'cross-provider' : 'self',
    reviewerModel: reviewerModel || 'default',
    implementingModel: implementingModel || 'default'
  };
}

// Anti-Slop Delivery Gate & Remediation Loop Helpers

function evaluateAntiSlopDeliveryGate(reviewArtifact) {
  if (!reviewArtifact || typeof reviewArtifact !== 'object') {
    return {
      pass: false,
      findings: [{ rule: 'R-00', description: 'No anti-slop review artifact provided' }],
      scanned_at: new Date().toISOString()
    };
  }

  const clean = reviewArtifact.ai_slop_clean === true;
  const findingsCount = typeof reviewArtifact.ai_slop_findings === 'number' ? reviewArtifact.ai_slop_findings : (reviewArtifact.findings ? reviewArtifact.findings.length : 0);
  const pass = clean && findingsCount === 0;

  const rawFindings = Array.isArray(reviewArtifact.findings) ? reviewArtifact.findings : [];
  const findings = rawFindings.map((f, idx) => {
    if (typeof f === 'string') {
      return { rule: `R-SLOP-${idx + 1}`, description: f };
    }
    return {
      rule: f.rule || `R-SLOP-${idx + 1}`,
      description: f.description || f.message || 'AI slop violation'
    };
  });

  return {
    pass,
    findings,
    scanned_at: new Date().toISOString()
  };
}

function generateSlopFixTask(deliveryGateReport) {
  const findings = deliveryGateReport && deliveryGateReport.findings ? deliveryGateReport.findings : [];
  if (findings.length === 0) {
    return 'Remediate detected AI slop violations and verify clean output.';
  }

  const items = findings.map(f => `[${f.rule}] ${f.description}`).join('\n- ');
  return `Remediate the following anti-slop Delivery Gate findings:\n- ${items}\n\nEnsure 0 AI slop findings and re-verify compliance with anti-slop Hard Gate rules.`;
}

module.exports = {
  DOMAIN_KEYWORDS,
  PLACEHOLDER_REGEX,
  FILE_PATH_REGEX,
  CREATION_WORDS,
  checkReadiness,
  detectReviewIndependence,
  evaluateAntiSlopDeliveryGate,
  generateSlopFixTask
};
