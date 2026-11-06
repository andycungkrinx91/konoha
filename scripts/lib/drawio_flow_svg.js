'use strict';

/**
 * Renders a drawio page as a self-contained animated HTML/SVG scene.
 *
 * The drawio architecture files are the source of truth for topology, so the animated
 * WebP diagrams are literal ports of the pages: same boxes, same colours, same labels,
 * same orthogonal routing. Links are pushed through `roundCorners` so no connector is
 * ever a hard elbow, and every process box carries an explicit `◈ <agent>` tag that is
 * a separate DOM element from the box label (`data-agent`), never inferred by a test
 * from the title text.
 */

const { roundCorners } = require('./flow_path_geometry');

const ROSTER = ['sannin', 'genin', 'kage', 'chunin', 'jonin', 'anbu', 'tokubetsu-jonin', 'akatsuki', 'yamanaka'];
const HOST_AGENTS = ROSTER.concat(['host']);
const AGENT_RX = ROSTER.map((name) => ({ name, rx: new RegExp(`\\b${name.replace('-', '[- _]?')}s?\\b`, 'i') }));

// ── Konoha kit visual grammar ───────────────────────────────────────────────
// Topology comes from drawio; the LOOK is the frozen konoha-qa-flow.webp idiom:
// white rounded cards with a hued top bar and a soft drop shadow, 700-weight
// titles over 500-weight detail, dashed connectors riding a soft tinted track,
// mono ◈ agent tags, and a dotted brand wash behind the page. Drawio colours
// snap onto the six-hue kit palette so all nineteen tabs read as one family.
// Boxes never animate: only the connectors carry motion.
const KIT = {
  azure: '#3B82F6',
  teal: '#14B8A6',
  violet: '#8B5CF6',
  amber: '#F97316',
  emerald: '#10B981',
  crimson: '#EF4444',
  slate: '#64748B'
};
const KIT_SURFACE = '#FAFBFD';
const KIT_PANEL = '#F8FAFC';
const KIT_INK = '#0F172A';
const KIT_BODY = '#475569';
const KIT_MUTED = '#64748B';

/** Per-cell wording overrides (drawio stays verbatim; only the WebP is condensed). */
const LABEL_OVERRIDES = {
  'p13-qfb': 'fix backend code\nAPIs · routes · ops',
  'p15-akatsuki': 'Zero-Trust Attack Audit\ntoken validation · container\nboundaries'
};

const FONT_SANS = "'Inter', 'Noto Sans', 'DejaVu Sans', sans-serif";
const FONT_MONO = "'JetBrains Mono', 'DejaVu Sans Mono', monospace";

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function num(value) {
  return String(Math.round(value * 100) / 100);
}

/**
 * Owning ninja for a cell: explicit `agent=` style wins, else id/label mentions.
 * Annotation cells (titles, legends, notes) never own an agent — a page title that
 * happens to name a ninja must not render an agent tag or steal label height.
 */
function agentOf(vertex) {
  if (isTextBox(vertex)) return '';
  const explicit = vertex.style.agent;
  if (explicit && String(explicit).toLowerCase() === 'none') return '';
  if (explicit && HOST_AGENTS.includes(String(explicit).toLowerCase())) return String(explicit).toLowerCase();
  const haystack = `${vertex.id} ${vertex.label}`;
  for (const { name, rx } of AGENT_RX) if (rx.test(haystack)) return name;
  return '';
}

/** Drawio writes `fillColor=none` for transparent annotation cells, not an absent key. */
function isTextBox(vertex) {
  const fill = vertex.style.fillColor;
  return vertex.style.text !== undefined && (!fill || fill === 'none');
}

function isNumberedStep(vertex) {
  return /^\d+\.\s/.test(vertex.label);
}

function pointOnBorder(box, toward, hint) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  if (hint && hint.x !== undefined) return { x: box.x + (box.w * Number(hint.x)) / 100, y: box.y + (box.h * Number(hint.y)) / 100 };
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const sx = dx ? (box.w / 2) / Math.abs(dx) : Infinity;
  const sy = dy ? (box.h / 2) / Math.abs(dy) : Infinity;
  const t = Math.min(sx, sy);
  return { x: cx + dx * t, y: cy + dy * t };
}

function polylineD(points) {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${num(p.x)} ${num(p.y)}`).join(' ');
}

function elbowChain(start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) < 1 || Math.abs(dy) < 1) return [start, end];
  if (Math.abs(dx) >= Math.abs(dy)) {
    const midX = start.x + dx / 2;
    return [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end];
  }
  const midY = start.y + dy / 2;
  return [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end];
}

/** Build the rounded `d` string for an edge, honouring explicit drawio waypoints. */
function routeEdge(edge, vertexById) {  // -> { d, mid } | null
  const src = vertexById.get(edge.source);
  const tgt = vertexById.get(edge.target);
  const sp = edge.sourcePoint || null;
  const tp = edge.targetPoint || null;
  const waypoints = edge.points.slice();

  // If neither vertex nor explicit point exists at an end, we can fall back to the other end.
  const hasStart = Boolean(src || sp || waypoints.length);
  const hasEnd = Boolean(tgt || tp || waypoints.length);
  if (!hasStart || !hasEnd) return null;

  const firstPt = waypoints[0] || tp || (tgt ? { x: tgt.box.x + tgt.box.w / 2, y: tgt.box.y + tgt.box.h / 2 } : null);
  const lastPt = waypoints[waypoints.length - 1] || sp || (src ? { x: src.box.x + src.box.w / 2, y: src.box.y + src.box.h / 2 } : null);

  let start;
  if (src) {
    const hint = src.style.exitX !== undefined ? { x: src.style.exitX, y: src.style.exitY } : null;
    start = pointOnBorder(src.box, firstPt || { x: src.box.x + src.box.w / 2, y: src.box.y + src.box.h / 2 }, hint);
  } else if (sp) {
    start = sp;
  } else {
    start = waypoints[0];
  }

  let end;
  if (tgt) {
    const hint = tgt.style.entryX !== undefined ? { x: tgt.style.entryX, y: tgt.style.entryY } : null;
    end = pointOnBorder(tgt.box, lastPt || { x: tgt.box.x + tgt.box.w / 2, y: tgt.box.y + tgt.box.h / 2 }, hint);
  } else if (tp) {
    end = tp;
  } else {
    end = waypoints[waypoints.length - 1];
  }

  if (!start || !end) return null;

  let chain;
  if (waypoints.length) {
    chain = [start, ...waypoints, end];
  } else if (edge.style.edgeStyle) {
    chain = elbowChain(start, end);
  } else {
    chain = [start, end];
  }

  const mid = chain[Math.floor((chain.length - 1) / 2)];
  return { d: roundCorners(polylineD(chain), 9), mid };
}

/** Characters that fit on one line inside a box at a given font size. */
function charsPerLine(width, size) {
  return Math.max(8, Math.floor((width - 12) / (size * 0.53)));
}

/** Greedy word wrap used when a drawio line is wider than its box. */
function reflowLine(line, capacity) {
  const words = line.split(/\s+/);
  const out = [];
  let current = '';
  for (const word of words) {
    if (!current) current = word;
    else if (`${current} ${word}`.length <= capacity) current += ` ${word}`;
    else { out.push(current); current = word; }
  }
  if (current) out.push(current);
  return out;
}

/**
 * The WebP is a *simplified* rendering of the drawio tab: identical topology, condensed
 * wording. Simplification is deterministic (long parentheticals dropped, over-wide lines
 * re-wrapped, line count capped to the box height) so every diagram can be regenerated and
 * reviewed from the drawio source alone.
 */
function simplifyLabel(vertex) {
  if (LABEL_OVERRIDES[vertex.id]) return LABEL_OVERRIDES[vertex.id];
  const raw = String(vertex.label || '');
  if (isTextBox(vertex)) {
    const sentence = raw.replace(/\s+/g, ' ').trim();
    return sentence.length > 118 ? `${sentence.slice(0, 117).replace(/[\s,;:]\S*$/, '')}\u2026` : raw;
  }
  const agent = agentOf(vertex);
  const capacity = charsPerLine(vertex.box.w, Number(vertex.style.fontSize || 12));
  const reserve = agent ? 12 : 0;
  const maxLines = Math.max(2, Math.floor((vertex.box.h - 8 - reserve) / 10.5));
  let lines = raw.split('\n')
    .map((line) => line.replace(/\s*\(([^)]{25,})\)/g, '').replace(/\s{2,}/g, ' ').trim())
    .filter(Boolean);
  if (agent) {
    // The `◈ agent` tag already names the owner, so drop a duplicated label prefix.
    const prefix = new RegExp(`^${agent.replace('-', '[- _]?')}\\s*:\\s*`, 'i');
    lines = lines.map((line, index) => (index === 0 ? line.replace(prefix, '') : line));
  }
  lines = lines.flatMap((line) => (line.length > capacity ? reflowLine(line, capacity) : [line]));
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1].slice(0, Math.max(4, capacity - 1))}\u2026`;
    lines = kept;
  }
  return lines.join('\n');
}

function rgbOf(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!match) return null;
  const value = parseInt(match[1], 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

/** Snap a drawio colour onto the kit palette so every page shares one family. */
function hueOf(color, fallback) {
  const rgb = rgbOf(color);
  if (!rgb) return fallback || KIT.violet;
  let best = fallback || KIT.violet;
  let bestDistance = Infinity;
  for (const hex of Object.values(KIT)) {
    const candidate = rgbOf(hex);
    const distance = (candidate.r - rgb.r) ** 2 + (candidate.g - rgb.g) ** 2 + (candidate.b - rgb.b) ** 2;
    if (distance < bestDistance) { bestDistance = distance; best = hex; }
  }
  return best;
}

function hueKey(hex) {
  const found = Object.keys(KIT).find((key) => KIT[key] === hex);
  return found || 'violet';
}

/** Container cells (swimlanes, groups, big enclosures) draw as kit panels, not cards. */
function isPanel(vertex) {
  if (vertex.style.swimlane || vertex.style.group) return true;
  return vertex.box.w >= 360 && vertex.box.h >= 150;
}

function cardLines(vertex) {
  return simplifyLabel(vertex).split('\n').map((line) => line.trim()).filter(Boolean);
}

/** Kit type scale, kept small so dense pages never collide with their canvas. */
function cardType(box) {
  const roomy = box.h >= 76 && box.w >= 190;
  const medium = box.h >= 48;
  const base = roomy ? 12.5 : medium ? 11.5 : 10;
  const detail = roomy ? 10.5 : medium ? 9.5 : 8.5;
  const cap = Math.max(7.5, Math.min(box.h * 0.3, box.w * 0.11));
  return { title: Math.min(base, cap), detail: Math.min(detail, Math.max(7.5, cap - 1.5)) };
}

function textDiv(rect, text, opt) {
  const { x, y, w, h } = rect;
  const justify = opt.align === 'left' ? 'flex-start' : opt.align === 'right' ? 'flex-end' : 'center';
  const textAlign = opt.align === 'left' ? 'left' : opt.align === 'right' ? 'right' : 'center';
  return `<foreignObject x="${num(x)}" y="${num(y)}" width="${num(Math.max(8, w))}" height="${num(Math.max(8, h))}">`
    + `<div xmlns="http://www.w3.org/1999/xhtml" style="display:flex;align-items:${opt.vertical || 'center'};justify-content:${justify};`
    + `height:100%;font-family:${FONT_SANS};font-size:${num(opt.size)}px;font-weight:${opt.weight};color:${opt.color};`
    + `line-height:1.16;text-align:${textAlign};white-space:pre-wrap;overflow:hidden;">${text}</div></foreignObject>`;
}

/** Kit card labels: 700-weight title over 500-weight detail, all inside the box. */
/** Truncate a condensed line so it never wraps past the box it belongs to. */
function fitOneLine(text, width, size) {
  const capacity = Math.max(10, Math.floor(width / (size * 0.5)));
  if (text.length <= capacity) return text;
  return `${text.slice(0, capacity - 1).replace(/[\s,;:\u00b7]\S*$/, '')}\u2026`;
}

/** Kit card labels: 700-weight title over one 500-weight detail line, inside the box. */
function labelMarkup(vertex, agent) {
  const { box, style } = vertex;
  const lines = cardLines(vertex);
  if (!lines.length) return '';
  const detailLines = lines.slice(1);
  if (isPanel(vertex)) {
    const head = Math.min(20, box.h * 0.4);
    const title = textDiv({ x: box.x + 8, y: box.y + 2, w: box.w - 16, h: head }, esc(lines[0]),
      { size: 11, weight: 700, color: KIT_INK, align: 'left' });
    if (!detailLines.length || box.h < 52) return title;
    const available = box.h - head - 10;
    const maxLines = Math.max(1, Math.floor(available / 11));
    const kept = detailLines.slice(0, maxLines);
    if (detailLines.length > maxLines) kept[kept.length - 1] = `${kept[kept.length - 1].slice(0, 60)}\u2026`;
    return title + textDiv({ x: box.x + 8, y: box.y + head + 2, w: box.w - 16, h: available }, kept.map((line) => esc(line)).join('<br/>'),
      { size: 9.5, weight: 500, color: KIT_MUTED, align: 'left', vertical: 'flex-start' });
  }
  if (style.rhombus) {
    const innerW = box.w * 0.56;
    const innerH = box.h * 0.5;
    const size = Math.max(7.5, Math.min(10.5, box.h * 0.12));
    const text = fitOneLine(lines.join(' \u00b7 '), innerW, size);
    return textDiv({ x: box.x + (box.w - innerW) / 2, y: box.y + (box.h - innerH) / 2, w: innerW, h: innerH }, esc(text),
      { size, weight: 700, color: KIT_INK });
  }
  const type = cardType(box);
  const pad = 6;
  const top = style.shape === 'cylinder3'
    ? box.y + Math.min(9, box.h / 5) + 2
    : box.y + (box.h >= 44 ? 4 : 3) + 3;
  const bottom = agent ? 10 : 0;
  const usable = Math.max(12, box.y + box.h - bottom - pad - top);
  const width = Math.max(8, box.w - pad * 2);
  const hasDetail = detailLines.length > 0 && usable >= type.title + type.detail * 1.5;
  const multiDetail = detailLines.length > 1 && usable >= type.title * 1.3 + type.detail * 2.5;
  const titleH = hasDetail
    ? (multiDetail ? Math.max(type.title * 1.3, usable - type.detail * 2.4) : Math.max(type.title * 1.3, usable - type.detail * 1.4))
    : usable;
  const title = textDiv({ x: box.x + pad, y: top, w: width, h: titleH }, esc(lines[0]), { size: type.title, weight: 700, color: KIT_INK });
  if (!hasDetail) return title;
  let detailMarkup;
  if (multiDetail) {
    const d1 = fitOneLine(detailLines[0], width, type.detail);
    const d2 = fitOneLine(detailLines.slice(1).join(' · '), width, type.detail);
    detailMarkup = `${esc(d1)}<br/>${esc(d2)}`;
  } else {
    detailMarkup = esc(fitOneLine(detailLines.join(' · '), width, type.detail));
  }
  return title + textDiv({ x: box.x + pad, y: top + titleH, w: width, h: Math.max(0, usable - titleH) }, detailMarkup,
    { size: type.detail, weight: 500, color: KIT_BODY });
}

function agentTagMarkup(vertex, agent) {
  if (!agent || vertex.box.h < 34 || isTextBox(vertex) || isPanel(vertex)) return '';
  const accent = hueOf(vertex.style.strokeColor, KIT.violet);
  return `<text class="card-agent" data-agent="${esc(agent)}" x="${num(vertex.box.x + 10)}" y="${num(vertex.box.y + vertex.box.h - 6)}"`
    + ` font-family="${FONT_MONO}" font-size="8.2" font-weight="700" letter-spacing="0.5" fill="${accent}">\u25c8 ${esc(agent)}</text>`;
}

function cylinderMarkup(vertex, accent) {
  const { box } = vertex;
  const rx = box.w / 2;
  const ry = Math.min(9, box.h / 5);
  const body = `M ${num(box.x)} ${num(box.y + ry)} L ${num(box.x)} ${num(box.y + box.h - ry)}`
    + ` A ${num(rx)} ${num(ry)} 0 0 0 ${num(box.x + box.w)} ${num(box.y + box.h - ry)}`
    + ` L ${num(box.x + box.w)} ${num(box.y + ry)} Z`;
  const cap = `<ellipse cx="${num(box.x + rx)}" cy="${num(box.y + ry)}" rx="${num(rx)}" ry="${num(ry)}"`
    + ` fill="#FFFFFF" stroke="${accent}" stroke-width="1.8"/>`;
  return `<path d="${body}" fill="#FFFFFF" stroke="${accent}" stroke-width="1.8" stroke-linejoin="round"/>${cap}`;
}

function shapeMarkup(vertex) {
  const { box, style } = vertex;
  const accent = hueOf(style.strokeColor, KIT.violet);
  const dash = style.dashed ? ' stroke-dasharray="5 4"' : '';
  if (isPanel(vertex)) {
    return `<rect x="${num(box.x)}" y="${num(box.y)}" width="${num(box.w)}" height="${num(box.h)}" rx="12"`
      + ` fill="${KIT_PANEL}" stroke="${accent}" stroke-width="1.4"${dash} filter="url(#panelShadow)"/>`;
  }
  if (style.shape === 'cylinder3') return cylinderMarkup(vertex, accent);
  if (style.rhombus) {
    const pts = [[box.x + box.w / 2, box.y], [box.x + box.w, box.y + box.h / 2], [box.x + box.w / 2, box.y + box.h], [box.x, box.y + box.h / 2]];
    return `<polygon points="${pts.map((p) => `${num(p[0])},${num(p[1])}`).join(' ')}" fill="url(#cardSurface)"`
      + ` stroke="${accent}" stroke-width="1.8"${dash} stroke-linejoin="round" filter="url(#cardShadow)"/>`;
  }
  const radius = Math.min(11, Math.max(4, box.h / 4));
  const barH = box.h >= 44 ? 4 : 3;
  return `<rect x="${num(box.x)}" y="${num(box.y)}" width="${num(box.w)}" height="${num(box.h)}" rx="${num(radius)}"`
    + ` fill="url(#cardSurface)" stroke="${accent}" stroke-width="1.8" filter="url(#cardShadow)"${dash}/>`
    + `<rect x="${num(box.x + 2)}" y="${num(box.y + 2)}" width="${num(Math.max(4, box.w - 4))}" height="${num(barH)}"`
    + ` rx="${num(barH / 2)}" fill="${accent}"/>`;
}

/** Edge label pill: short drawio verbiage only, in the connector's kit hue. */
function edgeLabelMarkup(edge, mid, accent) {
  const raw = String(edge.label || '').trim();
  if (!raw) return '';
  const label = raw.length > 24 ? `${raw.slice(0, 23).replace(/[\s,;/]+$/, '')}\u2026` : raw;
  const width = label.length * 5.2 + 8;
  return `<rect x="${num(mid.x - width / 2)}" y="${num(mid.y - 7)}" width="${num(width)}" height="14" rx="7"`
    + ` fill="#FFFFFF" stroke="${accent}" stroke-opacity="0.35" filter="url(#panelShadow)"/>`
    + `<text x="${num(mid.x)}" y="${num(mid.y + 3.3)}" text-anchor="middle" font-family="${FONT_SANS}"`
    + ` font-size="9.5" font-weight="600" fill="${accent}">${esc(label)}</text>`;
}

function textNodeMarkup(vertex) {
  const { box, style } = vertex;
  const raw = Number(style.fontSize || 12);
  const heading = raw >= 16;
  const size = heading ? Math.min(raw, 22) : Math.max(9, Math.min(raw, 11.5));
  const weight = heading ? 800 : 500;
  const color = heading ? KIT_INK : KIT_MUTED;
  const justify = style.align === 'center' ? 'center' : style.align === 'right' ? 'flex-end' : 'flex-start';
  const text = esc(simplifyLabel(vertex)).replace(/\n/g, '<br/>');
  return `<foreignObject x="${num(box.x)}" y="${num(box.y)}" width="${num(Math.max(8, box.w))}" height="${num(Math.max(10, box.h))}">`
    + `<div xmlns="http://www.w3.org/1999/xhtml" style="display:flex;align-items:center;justify-content:${justify};height:100%;`
    + `font-family:${FONT_SANS};font-size:${num(size)}px;font-weight:${weight};color:${color};line-height:1.2;`
    + `text-align:${style.align || 'left'};white-space:pre-wrap;overflow:hidden;">${text}</div></foreignObject>`;
}

/**
 * One group per drawio cell. Boxes stay static for the whole loop (the user asked for
 * motion on the arrows only), so `data-step` here is a flow ordinal used to phase the
 * connector pulses, not an opacity reveal.
 */
function revealGroup(step, inner, cell, kind) {
  return `<g class="reveal" data-step="${step}" data-cell="${esc(cell)}" data-kind="${esc(kind)}">${inner}</g>`;
}

function stepPlan(page) {
  const drawable = page.vertices.filter((v) => !isTextBox(v));
  const ordered = drawable.slice().sort((a, b) => (a.box.y - b.box.y) || (a.box.x - b.box.x));
  const steps = new Map();
  const buckets = 6;
  ordered.forEach((v, i) => steps.set(v.id, Math.floor((i / Math.max(1, ordered.length)) * buckets)));
  for (const edge of page.edges) {
    const s = steps.get(edge.source);
    const t = steps.get(edge.target);
    if (s === undefined && t === undefined) continue;
    steps.set(edge.id, Math.max(s === undefined ? 0 : s, t === undefined ? 0 : t));
  }
  const max = Math.max(0, ...steps.values());
  return { steps, total: max + 1 };
}

/** Uniform scale that fits a drawio page inside the output canvas (no clipping, no stretch). */
function fitScale(page, canvas) {
  const cw = canvas.width || CANVAS.width;
  const ch = canvas.height || CANVAS.height;
  const pw = page.pageWidth || page.width;
  const ph = page.pageHeight || page.height;
  // A 4% safety margin keeps page edges (and the footer) off the canvas border.
  const inset = canvas.margin === undefined ? 0.04 : canvas.margin;
  return Math.min((cw * (1 - inset)) / pw, (ch * (1 - inset)) / ph);
}

function svgForPage(page, options) {
  const scale = fitScale(page, options);
  const { steps, total } = stepPlan(page);
  const markerColors = new Map();
  const vertexById = new Map(page.vertices.map((v) => [v.id, v]));
  const parts = [];

  for (const vertex of page.vertices) {
    if (isTextBox(vertex)) {
      parts.push(revealGroup(-1, textNodeMarkup(vertex), vertex.id, 'text'));
      continue;
    }
    const agent = agentOf(vertex);
    const inner = shapeMarkup(vertex) + labelMarkup(vertex, agent) + agentTagMarkup(vertex, agent);
    parts.push(revealGroup(-1, inner, vertex.id, 'vertex'));
  }

  for (const edge of page.edges) {
    const route = routeEdge(edge, vertexById);
    if (!route) continue;
    const accent = hueOf(edge.style.strokeColor, KIT.slate);
    const key = hueKey(accent);
    markerColors.set(key, accent);
    const d = route.d;
    const phase = num((steps.get(edge.id) || 0) / Math.max(1, total));
    const inner = `<path class="bg-track" d="${d}" fill="none" stroke="${accent}" stroke-width="6" stroke-opacity="0.14"`
      + ` stroke-linecap="round" stroke-linejoin="round"/>`
      + `<path class="flow-path" d="${d}" fill="none" stroke="${accent}" stroke-width="2.2" stroke-linecap="round"`
      + ` stroke-linejoin="round" stroke-dasharray="8 6" marker-end="url(#arrow-${key})"/>`
      + `<path class="pulse" data-phase="${phase}" d="${d}" fill="none" stroke="${accent}" stroke-width="3"`
      + ` stroke-linecap="round" opacity="0.4"/>`
      + edgeLabelMarkup(edge, route.mid, accent);
    parts.push(revealGroup(steps.get(edge.id) || 0, inner, edge.id, 'edge'));
  }

  const footerY = page.pageHeight - 10;
  const footer = `<text x="${num(page.pageWidth / 2)}" y="${num(footerY)}" text-anchor="middle" fill="${KIT_MUTED}"`
    + ` font-family="${FONT_MONO}" font-size="9" font-weight="500">`
    + `${esc(page.name)} \u00b7 Konoha v${esc(options.version)}</text>`;

  return {
    steps: total,
    svg: `<svg width="${num(page.pageWidth * scale)}" height="${num(page.pageHeight * scale)}"`
      + ` viewBox="0 0 ${page.pageWidth} ${page.pageHeight}" xmlns="http://www.w3.org/2000/svg">`
      + `<defs>${kitDefs(markerColors)}</defs>${kitBackground(page)}${parts.join('')}${footer}</svg>`
  };
}

/** Kit defs: card shadow, dotted paper, brand wash and one arrow per page hue. */
function kitDefs(markerColors) {
  const markers = [...markerColors.entries()].map(([key, color]) => `<marker id="arrow-${key}" viewBox="0 0 10 8"`
    + ` refX="8" refY="4" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="7.2" orient="auto">`
    + `<path d="M 0 1 L 8 4 L 0 7 L 1.5 4 Z" fill="${color}"/></marker>`).join('');
  return '<filter id="cardShadow" x="-15%" y="-15%" width="135%" height="135%">'
    + '<feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#0F172A" flood-opacity="0.05"/>'
    + '<feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#0F172A" flood-opacity="0.08"/></filter>'
    + '<filter id="panelShadow" x="-5%" y="-5%" width="110%" height="110%">'
    + '<feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#0F172A" flood-opacity="0.04"/></filter>'
    + '<linearGradient id="cardSurface" x1="0%" y1="0%" x2="0%" y2="100%">'
    + '<stop offset="0%" stop-color="#FFFFFF"/>'
    + '<stop offset="100%" stop-color="#F8FAFC"/></linearGradient>'
    + '<pattern id="dotgrid" width="22" height="22" patternUnits="userSpaceOnUse">'
    + '<circle cx="1.4" cy="1.4" r="1.1" fill="#94A3B8" opacity="0.18"/></pattern>'
    + '<radialGradient id="brandWash" cx="50%" cy="28%" r="72%">'
    + '<stop offset="0%" stop-color="#3B82F6" stop-opacity="0.05"/>'
    + '<stop offset="100%" stop-color="#3B82F6" stop-opacity="0"/></radialGradient>'
    + markers;
}

function kitBackground(page) {
  const w = num(page.pageWidth);
  const h = num(page.pageHeight);
  return `<rect width="${w}" height="${h}" fill="${KIT_SURFACE}"/>`
    + `<rect width="${w}" height="${h}" fill="url(#dotgrid)"/>`
    + `<rect width="${w}" height="${h}" fill="url(#brandWash)"/>`;
}

const FRAME_SCRIPT = `
  window.fitLabels = function () {
    document.querySelectorAll('foreignObject > div').forEach(function (div) {
      var size = parseFloat(getComputedStyle(div).fontSize);
      var guard = 0;
      while (guard < 26 && size > 8 && (div.scrollHeight > div.clientHeight + 1 || div.scrollWidth > div.clientWidth + 1)) {
        size -= 0.5;
        div.style.fontSize = size + 'px';
        guard += 1;
      }
    });
  };
  document.addEventListener('DOMContentLoaded', function () {
    window.fitLabels();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { window.fitLabels(); });
  });
  function pulseLength(el) {
    if (el.dataset.len) return Number(el.dataset.len);
    var len = 600;
    try { len = Math.max(60, el.getTotalLength()); } catch (err) { len = 600; }
    el.dataset.len = String(len);
    el.style.strokeDasharray = '14 ' + (len + 24);
    return len;
  }
  window.updateFrame = function (frameIdx, total) {
    const progress = frameIdx / total;
    document.querySelectorAll('.flow-path').forEach(function (el) {
      el.style.strokeDashoffset = String(-progress * 14);
    });
    document.querySelectorAll('.pulse').forEach(function (el) {
      const len = pulseLength(el);
      const travel = (progress + Number(el.dataset.phase || 0)) % 1;
      el.style.strokeDashoffset = String(-travel * (len + 14));
      el.style.opacity = String(0.12 + 0.5 * Math.sin(Math.PI * travel));
    });
  };
`;

function pageHtml(page, options) {
  const { svg, steps } = svgForPage(page, options);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap');
  html, body { margin: 0; padding: 0; background: ${options.bg || KIT_SURFACE}; }
  body { width: ${options.width}px; height: ${options.height}px; overflow: hidden; }
  .stage { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
  svg { display: block; }
  .reveal { opacity: 1; }
</style>
<script>${FRAME_SCRIPT}</script></head>
<body data-steps="${steps}"><div class="stage">${svg}</div></body></html>`;
}

const CANVAS = { width: 1200, height: 816 };

/**
 * Uniform scale for the 1250x850 pages *after* the 4% canvas safety margin:
 * 0.96 x (1200/1250) = 0.9216 on both axes. Kept for documentation and tests.
 */
const CANVAS_SCALE_1250 = 0.9216;

/** Canonical animated asset name per drawio page (kept stable for docs + tests). */
const CANONICAL_NAMES = {
  '08 Orchestrator Task Artifact Flow': 'konoha-orchestration-flow.webp',
  '09 Jonin Taste-Skill Frontend Engine': 'konoha-jonin-flow.webp',
  '11 Kage Pre-Delivery Reviewer Workflow Gate': 'konoha-kage-gate.webp',
  '13 QA Automation Workflow': 'konoha-qa-flow.webp',
  '14 Remote Access & Telegram Inbound/Outbound': 'konoha-telegram-flow.webp',
  '16 Akatsuki Security Controls & Dual-Mode Lab Lifecycle': 'konoha-akatsuki-flow.webp',
  '17 Yamanaka Image-to-3D Asset Pipeline': 'konoha-yamanaka-3d-flow.webp',
  '19 Authenticated Local Web UI & Ingress Queue': 'konoha-web-ingress-flow.webp',
  '18 LangGraph.js Orchestration Runtime': 'konoha-langgraph-flow.webp'
};

function slugForPage(name) {
  return String(name)
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function assetNameFor(page) {
  if (CANONICAL_NAMES[page.name]) return CANONICAL_NAMES[page.name];
  const prefix = page.name.match(/^(\d+)/);
  const nn = prefix ? prefix[1] : 'x';
  return `konoha-flow-${nn}-${slugForPage(page.name.replace(/^\d+\s*/, ''))}.webp`;
}

module.exports = {
  pageHtml,
  svgForPage,
  fitScale,
  CANVAS_SCALE_1250,
  routeEdge,
  agentOf,
  isNumberedStep,
  assetNameFor,
  slugForPage,
  CANVAS,
  ROSTER,
  HOST_AGENTS,
  CANONICAL_NAMES
};
