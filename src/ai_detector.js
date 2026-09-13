/**
 * src/ai_detector.js — Website AI-Fingerprint Detector (anonymiz.com-style).
 *
 * Scans a built or source website (directory or URL) for the fingerprints
 * AI-website detectors score on: generator meta tags, Lucide icon packages,
 * shadcn/ui component API shapes, Vercel/Netlify hosting signals, AI-tool
 * attribution comments, template boilerplate text, and generic scaffold asset
 * names. Returns a 0-100 score (0-20 = Human-Built, matching
 * PLAN_HUMAN_BUILT.md's target band) plus compact, evidence-backed findings.
 *
 * Pure module: no DB, no MCP, no CLI dependencies — reused by the MCP tool
 * wrapper (src/mcp/ai_detector.js), the CLI (`konoha detect-ai`), and the
 * web UI endpoint (GET /api/v1/detect-ai).
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── Scan bounds (token efficiency: bounded walk, bounded reads) ──────────────
const MAX_FILES = 1500;
const MAX_FILE_BYTES = 768 * 1024;
const MAX_FINDINGS = 50;
const URL_TIMEOUT_MS = 20000;
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', '.svelte-kit', 'dist', 'build',
  'output', '.output', '.nuxt', '.turbo', '.vercel', 'coverage'
]);
const SCAN_EXTENSIONS = new Set([
  '.html', '.htm', '.js', '.mjs', '.cjs', '.ts', '.jsx', '.tsx',
  '.svelte', '.vue', '.css', '.scss', '.astro'
]);

// ── Fingerprint rules ─────────────────────────────────────────────────────────
// weight = points added to the AI-likeness score when the rule fires.
const RULES = [
  {
    id: 'GEN-01', severity: 'high', weight: 15,
    title: 'Generator meta tag present',
    applies: () => true,
    test: (ctx) => [...ctx.html, ...ctx.sources].some((h) => /<meta\s+name=["']generator["']/i.test(h.line))
      ? '<meta name="generator"> exposes the site builder toolchain' : null
  },
  {
    id: 'ICON-01', severity: 'high', weight: 12,
    title: 'Lucide icon package dependency (AI-scaffold default)',
    applies: () => true,
    test: (ctx) => {
      const lucideDep = ctx.packageJsons.find((p) => /["']lucide-[a-z-]+["']\s*:/.test(p.line));
      if (lucideDep) return `package.json depends on ${lucideDep.line.trim().slice(0, 60)}`;
      const lucideImport = ctx.sources.find((s) => /from\s+["']lucide-[a-z-]+["']/.test(s.line));
      if (lucideImport) return `Lucide usage in ${lucideImport.file}: ${lucideImport.line.trim().slice(0, 80)}`;
      const lucideAttr = [...ctx.html, ...ctx.sources].find((s) => /data-lucide=/.test(s.line));
      if (lucideAttr) return `data-lucide attribute in ${lucideAttr.file}: ${lucideAttr.line.trim().slice(0, 80)}`;
      return null;
    }
  },
  {
    id: 'ATTR-01', severity: 'high', weight: 12,
    title: 'AI-tool attribution comment or badge',
    applies: () => true,
    test: (ctx) => {
      const re = /(?:built|created|generated|made)\s+with[^a-z]{0,3}(?:v0|lovable|bolt|cursor|chatgpt|claude|ai)|v0\.dev|lovable\.dev|bolt\.new|generated\s+by\s+ai|created\s+by\s+ai|<!--\s*built\s+with|<!--\s*generated\s+by/i;
      const hit = [...ctx.html, ...ctx.sources].find((l) => re.test(l.line));
      return hit ? `attribution signal in ${hit.file}: ${hit.line.trim().slice(0, 80)}` : null;
    }
  },
  {
    id: 'UI-01', severity: 'high', weight: 10,
    title: 'shadcn/ui component API shape',
    applies: () => true,
    test: (ctx) => {
      const dir = ctx.componentUiDirs[0];
      if (dir) return `shadcn-style components/ui directory: ${dir}`;
      const cn = ctx.sources.find((s) => /(?:class|className)[:=]\s*\{?\s*cn\(/.test(s.line));
      if (cn) return `shadcn cn() class-merge pattern in ${cn.file}`;
      const imp = ctx.sources.find((s) => /from\s+["'][^"']*components\/ui\//.test(s.line));
      if (imp) return `components/ui import in ${imp.file}`;
      return null;
    }
  },
  {
    id: 'HOST-01', severity: 'medium', weight: 8,
    title: 'Vercel/Netlify hosting signal',
    applies: () => true,
    test: (ctx) => {
      if (ctx.vercelDir) return '.vercel project directory present (Vercel deployment)';
      const hit = [...ctx.html, ...ctx.sources, ...ctx.packageJsons].find((l) =>
        /vercel\.app|netlify\.app|\/_vercel\/|netlify\/toml|x-vercel-id|x-vercel-cache|x-nf-request-id/i.test(l.line));
      return hit ? `hosting signal: ${hit.line.trim().slice(0, 80)}` : null;
    }
  },
  {
    id: 'TPLT-01', severity: 'medium', weight: 6,
    title: 'Unmodified scaffold boilerplate text',
    applies: () => true,
    test: (ctx) => {
      const re = /lorem ipsum|get\s+started\s+by\s+editing|create\s+next\s+app|edit\s+.*app\/page\.tsx\s+and\s+save/i;
      const hit = ctx.html.find((h) => re.test(h.line));
      return hit ? `boilerplate text: ${hit.line.trim().slice(0, 80)}` : null;
    }
  },
  {
    id: 'ASSET-01', severity: 'low', weight: 4,
    title: 'Generic template asset filenames',
    applies: () => true,
    test: (ctx) => {
      const generic = ctx.assets.find((a) => /^(og-image\.png|hero\.(webp|png|jpg)|icon-\d\.svg|icon-0\.png|placeholder\.(png|svg))$/i.test(a));
      return generic ? `template-named asset: ${generic}` : null;
    }
  },
  {
    id: 'FRAME-01', severity: 'low', weight: 3,
    title: 'Unchanged framework default title',
    applies: () => true,
    test: (ctx) => {
      const hit = ctx.html.find((h) => /<title>\s*(create\s+next\s+app|nuxt|vite\s*\+\s*(vue|react)|sveltekit?|angular\s*app)\s*<\/title>/i.test(h.line));
      return hit ? `default framework <title>: ${hit.line.trim().slice(0, 80)}` : null;
    }
  }
];

function classify(score) {
  if (score <= 20) return 'Human-Built';
  if (score <= 40) return 'Likely Human-Built';
  if (score <= 60) return 'AI-Assisted Build';
  return 'AI-Generated';
}

// ── Directory collection ──────────────────────────────────────────────────────
function collectDirectorySignals(rootDir) {
  const ctx = {
    html: [], sources: [], packageJsons: [],
    assets: [], componentUiDirs: [], vercelDir: null
  };
  let filesScanned = 0;
  let bytesScanned = 0;

  const stack = [rootDir];
  while (stack.length && filesScanned < MAX_FILES) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { continue; }
    for (const entry of entries) {
      if (filesScanned >= MAX_FILES) break;
      const full = path.join(dir, entry.name);
      const rel = path.relative(rootDir, full) || entry.name;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) {
          if (entry.name === '.vercel') ctx.vercelDir = rel;
          continue;
        }
        if (/^(ui|ui-components)$/.test(entry.name) && /components([\\/])?$/.test(path.basename(dir))) {
          ctx.componentUiDirs.push(rel);
        }
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!SCAN_EXTENSIONS.has(ext) && entry.name !== 'package.json') {
        // Assets are tracked by name only (no content read).
        if (/\.(png|jpe?g|webp|svg|gif|ico)$/i.test(entry.name) && ctx.assets.length < 200) {
          ctx.assets.push(entry.name);
        }
        continue;
      }
      let content;
      try {
        const st = fs.statSync(full);
        if (st.size > MAX_FILE_BYTES) continue;
        content = fs.readFileSync(full, 'utf-8');
      } catch (_) { continue; }
      filesScanned++;
      bytesScanned += Buffer.byteLength(content, 'utf-8');
      const isHtml = ext === '.html' || ext === '.htm' || ext === '.astro';
      const bucket = entry.name === 'package.json' ? ctx.packageJsons : (isHtml ? ctx.html : ctx.sources);
      // Bounded per-file line capture: first 400 lines, 300 chars per line.
      const lines = content.split('\n').slice(0, 400);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].slice(0, 300);
        if (line.trim()) bucket.push({ file: rel, line_no: i + 1, line });
      }
      // components/ui detection for source files (imports reveal it even when
      // the built output flattens directories).
      if (/components[\\/]ui[\\/]/.test(rel)) ctx.componentUiDirs.push(rel);
    }
  }
  return { ctx, filesScanned, bytesScanned };
}

// ── URL collection ───────────────────────────────────────────────────────────
async function collectUrlSignals(url) {
  const ctx = {
    html: [], sources: [], packageJsons: [],
    assets: [], componentUiDirs: [], vercelDir: null
  };
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(URL_TIMEOUT_MS),
    headers: { 'user-agent': 'Konoha-AiDetector/2.0 (+https://github.com/andycungkrinx91/konoha)' }
  });
  if (!res.ok) {
    const err = new Error(`Fetch failed: HTTP ${res.status}`);
    err.httpStatus = res.status;
    throw err;
  }
  // Hosting signals from response headers.
  const headerBits = [];
  for (const h of ['server', 'x-vercel-id', 'x-vercel-cache', 'x-nf-request-id', 'x-amz-cf-id']) {
    if (res.headers.get(h)) headerBits.push(`${h}: ${res.headers.get(h)}`);
  }
  if (res.url && /vercel\.app|netlify\.app/i.test(res.url)) headerBits.push(`final URL hosted on ${res.url}`);
  for (const bit of headerBits) ctx.sources.push({ file: '(response headers)', line_no: 0, line: bit });
  const body = await res.text();
  const lines = body.split('\n').slice(0, 800);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].slice(0, 300);
    if (line.trim()) ctx.html.push({ file: '(fetched page)', line_no: i + 1, line });
  }
  return { ctx, filesScanned: 1, bytesScanned: Buffer.byteLength(body, 'utf-8') };
}

// ── Public API ───────────────────────────────────────────────────────────────
function evaluateRules(ctx) {
  const findings = [];
  let score = 0;
  for (const rule of RULES) {
    let evidence = null;
    try { evidence = rule.test(ctx); } catch (_) { evidence = null; }
    if (evidence) {
      score += rule.weight;
      if (findings.length < MAX_FINDINGS) {
        findings.push({
          rule: rule.id, severity: rule.severity, weight: rule.weight,
          title: rule.title, evidence: String(evidence).slice(0, 160)
        });
      }
    }
  }
  return { score: Math.min(100, score), findings };
}

function buildDetectionResult(target, mode, ctxStats, started) {
  const { score, findings } = evaluateRules(ctxStats.ctx);
  return {
    target,
    mode,
    score,
    label: classify(score),
    verdict: score <= 20 ? 'PASS (Human-Built band)' : 'FAIL (AI fingerprints detected)',
    findings,
    stats: {
      files_scanned: ctxStats.filesScanned,
      bytes_scanned: ctxStats.bytesScanned,
      elapsed_ms: Date.now() - started
    },
    scanned_at: new Date().toISOString()
  };
}

function detectWebsiteAi(target) {
  if (!target || typeof target !== 'string' || !target.trim()) {
    return { error: 'Missing required argument: target (site directory path or http(s) URL)' };
  }
  const trimmed = target.trim();
  const started = Date.now();

  if (/^https?:\/\//i.test(trimmed)) {
    // Async path handled by detectWebsiteAiAsync.
    return { error: 'Use detectWebsiteAiAsync for URL targets' };
  }

  const dir = path.resolve(trimmed);
  let st;
  try { st = fs.statSync(dir); } catch (_) {
    return { error: `Target not found: ${trimmed}` };
  }
  if (!st.isDirectory()) {
    return { error: `Target is not a directory: ${trimmed}` };
  }

  const result = buildDetectionResult(trimmed, 'directory', collectDirectorySignals(dir), started);
  if (result.stats.files_scanned === 0) {
    result.hint = 'No scannable files found. If this is a build output parent, point the target directly at the build directory — generated dirs (build/, dist/, .next/, node_modules/) nested inside the target are skipped by design.';
  }
  return result;
}

async function detectWebsiteAiAsync(target) {
  if (!target || typeof target !== 'string' || !target.trim()) {
    return { error: 'Missing required argument: target (site directory path or http(s) URL)' };
  }
  const trimmed = target.trim();
  if (!/^https?:\/\//i.test(trimmed)) return detectWebsiteAi(trimmed);

  const started = Date.now();
  let collected;
  try {
    collected = await collectUrlSignals(trimmed);
  } catch (err) {
    return { error: `URL scan failed: ${err.message || String(err)}` };
  }
  return buildDetectionResult(trimmed, 'url', collected, started);
}

module.exports = {
  detectWebsiteAi,
  detectWebsiteAiAsync,
  evaluateRules,
  classify,
  RULES,
  _internals: { collectDirectorySignals, SKIP_DIRS, SCAN_EXTENSIONS }
};
