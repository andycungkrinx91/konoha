'use strict';

const layout = require('./drawio_flow_layout');
const glass = require('./drawio_flow_glass');

/** Helpers the layout module needs from this file (lazy: CANVAS is defined below). */
function layoutHelpers() {
  return {
    baseCanvas: CANVAS,
    isPageHeading,
    isPageSubheading,
    contentBounds: (page) => layout.contentBounds(page, layoutHelpers())
  };
}

function fitScale(page, canvas) { return layout.fitScale(page, canvas, layoutHelpers()); }
function contentBounds(page) { return layout.contentBounds(page, layoutHelpers()); }
const cardType = layout.cardType;

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
const KIT_INK = glass.GLASS.inkTitle;
const KIT_BODY = glass.GLASS.inkDesc;
const KIT_MUTED = glass.GLASS.inkTag;

/** Per-cell wording overrides (drawio stays verbatim; only the WebP is condensed). */
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

/**
 * Page heading = the document title / subtitle annotations pinned to the top band.
 * These are suppressed in the projection: the page label belongs in the bottom
 * caption only, so diagrams carry no top header.
 */
function isPageHeading(vertex, pageHeight) {
  if (!isTextBox(vertex) || !vertex.box || !(pageHeight > 0)) return false;
  return /^p\d+-title$/i.test(vertex.id) && vertex.box.y < pageHeight * 0.12;
}

/**
 * The subtitle line under the title: same top band, the only annotation cell
 * sitting just below the heading row. Titles go to the caption; captions stay short.
 */
function isPageSubheading(vertex, pageHeight, headingBottom) {
  if (!isTextBox(vertex) || !vertex.box || !(pageHeight > 0)) return false;
  if (vertex.box.y >= pageHeight * 0.12) return false;
  return vertex.box.y > headingBottom - 1;
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
function simplifyLabel(vertex) {
  const raw = String(vertex.label || '');
  if (isTextBox(vertex)) {
    return raw;
  }
  // Authored copy is rendered verbatim: no prefix stripping, no line dropping and
  // no ellipsis truncation. Long lines wrap; the fitter only scales type if needed.
  return raw.split('\n').map((line) => line.replace(/\s{2,}/g, ' ').trim()).filter(Boolean).join('\n');
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
  const escaped = esc(text);
  const capacity = Math.max(10, Math.floor(width / (size * 0.5)));
  if (escaped.length <= capacity) return escaped;
  // No truncation: break on word boundaries so the authored wording survives intact.
  const words = escaped.split(' ');
  const out = [];
  let line = '';
  for (const word of words) {
    if (line && (line + ' ' + word).length > capacity) { out.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out.join('<br/>');
}

/** Kit card labels: 700-weight title over one 500-weight detail line, inside the box. */
function labelMarkup(vertex, agent) {
  const { box, style } = vertex;
  const lines = cardLines(vertex);
  if (!lines.length) return '';
  const detailLines = lines.slice(1);
  if (isPanel(vertex)) {
    const head = Math.min(28, box.h * 0.4);
    const title = textDiv({ x: box.x + 8, y: box.y + 2, w: box.w - 16, h: head }, esc(lines[0]),
      { size: 16, weight: 700, color: KIT_INK, align: 'left' });
    if (!detailLines.length || box.h < 52) return title;
    const available = box.h - head - 10;
    return title + textDiv({ x: box.x + 8, y: box.y + head + 2, w: box.w - 16, h: available }, detailLines.map((line) => esc(line)).join('<br/>'),
      { size: 13.5, weight: 500, color: KIT_MUTED, align: 'left', vertical: 'flex-start' });
  }
  if (style.rhombus) {
    const innerW = box.w * 0.56;
    const innerH = box.h * 0.5;
    const size = Math.max(14, Math.min(17, box.h * 0.17, innerW / 9));
    const text = fitOneLine(lines.join(' \u00b7 '), innerW, size);
    return textDiv({ x: box.x + (box.w - innerW) / 2, y: box.y + (box.h - innerH) / 2, w: innerW, h: innerH }, text,
      { size, weight: 700, color: KIT_INK });
  }
  const type = cardType(box, vertex.id);
  const pad = 6;
  const top = style.shape === 'cylinder3'
    ? box.y + Math.min(9, box.h / 5) + 2
    : box.y + (box.h >= 44 ? 3 : 2) + 2;
  const bottom = agent ? 9 : 0;
  const usable = Math.max(12, box.y + box.h - bottom - pad + 2 - top);
  const width = Math.max(8, box.w - pad * 2);
  // Every authored line is emitted. If the copy is taller than the box, the fitter
  // shrinks the type for this card rather than dropping or ellipsising a line.
  const need = type.title + detailLines.length * type.detail * 1.22;
  const scale = Math.min(1, usable / Math.max(1, need));
  const titleSize = Math.max(9, type.title * scale);
  const detailSize = Math.max(8, type.detail * scale);
  const titleH = detailLines.length
    ? Math.max(titleSize * 1.3, usable - detailSize * 1.22 * detailLines.length)
    : usable;
  const title = textDiv({ x: box.x + pad, y: top, w: width, h: titleH }, esc(lines[0]), { size: titleSize, weight: 700, color: KIT_INK });
  if (!detailLines.length) return title;
  const detailMarkup = detailLines
    .map((line) => fitOneLine(line, width, detailSize))
    .join('<br/>');
  return title + textDiv({ x: box.x + pad, y: top + titleH, w: width, h: Math.max(0, usable - titleH) }, detailMarkup,
    { size: detailSize, weight: 500, color: KIT_BODY });
}

function agentTagMarkup(vertex, agent) {
  if (!agent || vertex.box.h < 34 || isTextBox(vertex) || isPanel(vertex)) return '';
  const accent = hueOf(vertex.style.strokeColor, KIT.violet);
  return `<text class="card-agent" data-agent="${esc(agent)}" x="${num(vertex.box.x + 10)}" y="${num(vertex.box.y + vertex.box.h - 6)}"`
    + ` font-family="${FONT_MONO}" font-size="11" font-weight="700" letter-spacing="0.3" fill="${accent}">\u25c8 ${esc(agent)}</text>`;
}

function shapeMarkup(vertex) {
  const { box, style } = vertex;
  const role = glass.roleOf(style.strokeColor);
  // Group containers stay flat; every other node becomes a glass panel.
  if (isPanel(vertex)) return glass.glassPanel(box, role, { group: true, radius: glass.GLASS.groupRadius });
  if (style.rhombus) {
    const pts = [[box.x + box.w / 2, box.y], [box.x + box.w, box.y + box.h / 2], [box.x + box.w / 2, box.y + box.h], [box.x, box.y + box.h / 2]];
    const v = glass.ROLE_HUES[role];
    return `<polygon points="${pts.map((q) => `${glass.num(q[0])},${glass.num(q[1])}`).join(' ')}"`
      + ` fill="${v.hue}" fill-opacity="0.10" stroke="url(#${glass.paintId(role)})" stroke-width="1.8" stroke-linejoin="round"/>`;
  }
  return glass.glassPanel(box, role);
}

function edgeLabelMarkup(edge, mid, accent) {
  const raw = String(edge.label || '').trim();
  if (!raw) return '';
  const label = raw.length > 24 ? `${raw.slice(0, 23).replace(/[\s,;/]+$/, '')}\u2026` : raw;
  const width = label.length * 5.2 + 8;
  return `<rect x="${num(mid.x - width / 2)}" y="${num(mid.y - 7)}" width="${num(width)}" height="14" rx="7"`
    + ` fill="#FFFFFF" stroke="${accent}" stroke-opacity="0.35" filter="url(#panelShadow)"/>`
    + `<text x="${num(mid.x)}" y="${num(mid.y + 3.3)}" text-anchor="middle" font-family="${FONT_SANS}"`
    + ` font-size="13" font-weight="700" fill="${accent}">${esc(label)}</text>`;
}

function textNodeMarkup(vertex) {
  const { box, style } = vertex;
  const raw = Number(style.fontSize || 12);
  const heading = raw >= 16;
  const size = heading ? Math.min(Math.max(raw, 18), 28) : 15;
  const weight = heading ? 800 : 500;
  const color = heading ? KIT_INK : KIT_MUTED;
  const justify = style.align === 'center' ? 'center' : style.align === 'right' ? 'flex-end' : 'flex-start';
  const text = esc(simplifyLabel(vertex)).replace(/\n/g, '<br/>');
  return `<foreignObject x="${num(box.x)}" y="${num(box.y - 1)}" width="${num(Math.max(8, box.w))}" height="${num(Math.max(10, box.h + 3))}">`
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

function svgForPage(page, options) {
  const scale = fitScale(page, options);
  const { steps, total } = stepPlan(page);
  const markerColors = new Map();
  const vertexById = new Map(page.vertices.map((v) => [v.id, v]));
  const parts = [];

  const pageHeight = page.pageHeight || page.height || 0;
  const headingBottom = Math.max(0, ...page.vertices.filter((v) => isPageHeading(v, pageHeight)).map((v) => v.box.y + v.box.h));
  for (const vertex of page.vertices) {
    if (isPageHeading(vertex, pageHeight) || isPageSubheading(vertex, pageHeight, headingBottom)) {
      // Suppressed visually (the label lives in the bottom caption), but still
      // projected as an anchor so the topology audit sees every drawio cell.
      parts.push(`<g class="heading-anchor" data-cell="${esc(vertex.id)}" data-kind="heading" aria-hidden="true"/>`);
      continue;
    }
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
    const role = glass.roleOf(edge.style.strokeColor);
    const phase = num((steps.get(edge.id) || 0) / Math.max(1, total));
    const inner = glass.neonEdge(d, role, phase) + edgeLabelMarkup(edge, route.mid, accent);
    parts.push(revealGroup(steps.get(edge.id) || 0, inner, edge.id, 'edge'));
  }

  // Bottom-centre caption only: the page label itself, with its drawio tab
  // number stripped and no version suffix. No top header is drawn anywhere.
  const footerY = page.pageHeight - 16;
  const caption = String(page.name).replace(/^\s*\d+\s*[.)-]?\s*/, '');
  const footerPlate = `<rect x="${num(page.pageWidth / 2 - 420)}" y="${num(footerY - 28)}" width="840" height="40"`
    + ` rx="20" fill="#0B1020" fill-opacity="0.72"/>`;
  const footer = footerPlate + `<text x="${num(page.pageWidth / 2)}" y="${num(footerY)}" text-anchor="middle" fill="${KIT_INK}"`
    + ` font-family="${FONT_SANS}" font-size="22" font-weight="800" letter-spacing="0.02em">`
    + `${esc(caption)}</text>`;

  // Centre the drawing itself (excluding the caption token) on the viewBox centre.
  // contentBounds() walks page vertices only, so the caption never biases the aim.
  const bounds = contentBounds(page);
  const cx = bounds ? (bounds.minX + bounds.maxX) / 2 : page.pageWidth / 2;
  const cy = bounds ? (bounds.minY + bounds.maxY) / 2 : page.pageHeight / 2;
  const shiftX = page.pageWidth / 2 - cx;
  const shiftY = page.pageHeight / 2 - cy;
  return {
    steps: total,
    svg: `<svg width="${num(page.pageWidth * scale)}" height="${num(page.pageHeight * scale)}"`
      + ` viewBox="0 0 ${page.pageWidth} ${page.pageHeight}" xmlns="http://www.w3.org/2000/svg">`
      + `<defs>${kitDefs(page)}</defs>${kitBackground(page)}`
      + `<g transform="translate(${num(shiftX)} ${num(shiftY)})">${parts.join('')}</g>${footer}</svg>`
  };
}

/** Kit defs: card shadow, dotted paper, brand wash and one arrow per page hue. */
function kitDefs(page) {
  // Roles actually present on this page drive the blurred background blobs.
  const roles = [...new Set(page.vertices
    .filter((v) => !isTextBox(v))
    .map((v) => glass.roleOf(v.style.strokeColor)))];
  return glass.glassDefs()
    + '<filter id="panelShadow" x="-5%" y="-5%" width="110%" height="110%">'
    + '<feDropShadow dx="0" dy="2" stdDeviation="5" flood-color="#000000" flood-opacity="0.10"/></filter>'
    + '<pattern id="dotgrid" width="22" height="22" patternUnits="userSpaceOnUse">'
    + '<circle cx="1.4" cy="1.4" r="1.1" fill="#FFFFFF" opacity="0.05"/></pattern>'
    + '<g data-roles="' + roles.join(',') + '"/>';
}
function kitBackground(page) {
  const w = page.pageWidth;
  const h = page.pageHeight;
  const roles = [...new Set(page.vertices
    .filter((v) => !isTextBox(v))
    .map((v) => glass.roleOf(v.style.strokeColor)))];
  return glass.glassBackground(w, h, roles)
    + `<rect width="${num(w)}" height="${num(h)}" fill="url(#dotgrid)"/>`;
}


const FRAME_SCRIPT = `
  window.fitLabels = function () {
    document.querySelectorAll('foreignObject > div').forEach(function (div) {
      var size = parseFloat(getComputedStyle(div).fontSize);
      var guard = 0;
      while (guard < 26 && size > 12.5 && (div.scrollHeight > div.clientHeight + 1 || div.scrollWidth > div.clientWidth + 1)) {
        size -= 0.5;
        div.style.fontSize = size + 'px';
        guard += 1;
      }
      // Still too wide at the floor: trim the copy so the type keeps its declared
      // size instead of shrinking below it.
      if (div.scrollWidth > div.clientWidth + 1) {
        var raw = div.textContent;
        while (raw.length > 3 && div.scrollWidth > div.clientWidth + 1) {
          raw = raw.slice(0, -2) + '\u2026';
          div.textContent = raw;
        }
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
  // One dash period per loop: 6s at 24fps means the pattern advances by exactly one
  // period, so frame 144 is identical to frame 0 and the loop has no visible seam.
  var DOT_PERIOD = 9.1;
  window.updateFrame = function (frameIdx, total) {
    var progress = frameIdx / total;
    document.querySelectorAll('.edge-core').forEach(function (el) {
      el.style.strokeDashoffset = String(-progress * DOT_PERIOD);
    });
    document.querySelectorAll('.edge-glow').forEach(function (el) {
      el.style.opacity = String(0.30 + 0.16 * Math.sin(progress * Math.PI * 2));
    });
    document.querySelectorAll('.edge-pulse').forEach(function (el) {
      var phase = Number(el.dataset.phase || 0);
      var travel = (progress + phase) % 1;
      el.style.opacity = String(0.10 + 0.55 * Math.sin(Math.PI * travel));
    });
  };
`;

function pageHtml(page, options) {
  const { svg, steps } = svgForPage(page, options);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap');
  html, body { margin: 0; padding: 0; background: ${options.bg || glass.GLASS.bgTop}; }
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
