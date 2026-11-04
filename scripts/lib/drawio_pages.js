'use strict';

/**
 * Minimal, dependency-free reader for the two canonical drawio architecture files.
 *
 * The animated WebP diagrams are ports of the drawio pages (the drawio layout is the
 * source of truth for topology), so this module exposes each page as plain geometry:
 * vertices in page coordinates (lane children resolved through their parent origin) with
 * labels + styles, and edges with anchors + waypoints.
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const DRAWIO_FILES = {
  architecture: path.join(ROOT_DIR, 'docs', 'diagrams', 'konoha-architecture.drawio'),
  enterprise: path.join(ROOT_DIR, 'docs', 'diagrams', 'konoha-enterprise-architecture.drawio')
};

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text) {
  return String(text)
    .replace(/&#(\d+);/g, (_m, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => (ENTITIES[name] !== undefined ? ENTITIES[name] : m));
}

/** Read the tag that starts at `from`, honouring quoted attribute values. */
function readTag(source, from) {
  let quote = false;
  for (let i = from; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '"') quote = !quote;
    else if (ch === '>' && !quote) return { text: source.slice(from, i + 1), end: i + 1 };
  }
  return null;
}

function parseAttrs(tag) {
  const attrs = {};
  const re = /([A-Za-z_][\w:.-]*)\s*=\s*"([^"]*)"/g;
  let m = re.exec(tag);
  while (m) {
    attrs[m[1]] = decodeEntities(m[2]);
    m = re.exec(tag);
  }
  return attrs;
}

function parseStyle(style) {
  const props = {};
  String(style || '').split(';').forEach((chunk) => {
    if (!chunk) return;
    const eq = chunk.indexOf('=');
    if (eq === -1) props[chunk.trim()] = '1';
    else props[chunk.slice(0, eq).trim()] = chunk.slice(eq + 1).trim();
  });
  return props;
}

function plainLabel(value) {
  return decodeEntities(String(value || ''))
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\u00a0/g, ' ')
    .trim();
}

/** Collect `{...}` geometry for a cell body (box + optional waypoint points). */
function parseGeometry(body) {
  const geo = { x: 0, y: 0, width: 0, height: 0, points: [] };
  const start = body.indexOf('<mxGeometry');
  if (start !== -1) {
    const tag = readTag(body, start);
    if (tag) Object.assign(geo, parseAttrs(tag.text), {});
    const pts = [];
    const pointRe = /<mxPoint([^>]*)\/?>/g;
    let pm = pointRe.exec(body);
    while (pm) {
      const p = parseAttrs(pm[1]);
      if (p.x !== undefined && p.y !== undefined) pts.push({ x: Number(p.x), y: Number(p.y), as: p.as });
      pm = pointRe.exec(body);
    }
    geo.points = pts.filter((p) => p.as !== 'sourcePoint' && p.as !== 'targetPoint');
    const sp = pts.find((p) => p.as === 'sourcePoint');
    const tp = pts.find((p) => p.as === 'targetPoint');
    if (sp) geo.sourcePoint = { x: sp.x, y: sp.y };
    if (tp) geo.targetPoint = { x: tp.x, y: tp.y };
  }
  geo.x = Number(geo.x || 0);
  geo.y = Number(geo.y || 0);
  geo.width = Number(geo.width || 0);
  geo.height = Number(geo.height || 0);
  return geo;
}

function parseGraph(root) {
  const vertices = [];
  const edges = [];
  let i = root.indexOf('<mxCell');
  while (i !== -1) {
    const tag = readTag(root, i);
    if (!tag) break;
    const selfClosing = tag.text.endsWith('/>');
    const bodyEnd = selfClosing ? tag.end : root.indexOf('</mxCell>', tag.end) + '</mxCell>'.length;
    const body = root.slice(tag.end, bodyEnd > 0 ? bodyEnd : root.length);
    const attrs = parseAttrs(tag.text);
    const geo = parseGeometry(body);
    const style = parseStyle(attrs.style);
    if (attrs.vertex === '1') {
      vertices.push({
        id: attrs.id,
        parent: attrs.parent,
        label: plainLabel(attrs.value),
        style,
        box: { x: geo.x, y: geo.y, w: geo.width, h: geo.height }
      });
    } else if (attrs.edge === '1') {
      edges.push({
        id: attrs.id,
        parent: attrs.parent,
        label: plainLabel(attrs.value),
        style,
        source: attrs.source,
        target: attrs.target,
        points: geo.points,
        sourcePoint: geo.sourcePoint || null,
        targetPoint: geo.targetPoint || null
      });
    }
    i = root.indexOf('<mxCell', bodyEnd > 0 ? bodyEnd : tag.end);
  }
  return { vertices, edges };
}

/**
 * mxGraph stores the geometry of a child cell relative to its parent container, so a card
 * inside a swimlane lane is positioned from the lane origin, not the page origin. Resolve
 * every cell to page coordinates once, otherwise lane children pile up in the top-left
 * corner (the page reads as overlapping cards).
 */
function resolveOrigins(vertices, edges) {
  const byId = new Map(vertices.map((v) => [v.id, v]));
  const cache = new Map();
  const originOf = (id, depth) => {
    if (!id || depth > 8) return { dx: 0, dy: 0 };
    if (cache.has(id)) return cache.get(id);
    const cell = byId.get(id);
    let origin = { dx: 0, dy: 0 };
    if (cell) {
      const up = originOf(cell.parent, depth + 1);
      origin = { dx: up.dx + cell.box.x, dy: up.dy + cell.box.y };
    }
    cache.set(id, origin);
    return origin;
  };
  return {
    vertices: vertices.map((v) => {
      const { dx, dy } = originOf(v.parent, 0);
      if (!dx && !dy) return v;
      return { ...v, box: { ...v.box, x: v.box.x + dx, y: v.box.y + dy } };
    }),
    edges: edges.map((e) => {
      const { dx, dy } = originOf(e.parent, 0);
      if (!dx && !dy) return e;
      return {
        ...e,
        points: e.points.map((pt) => ({ ...pt, x: pt.x + dx, y: pt.y + dy })),
        sourcePoint: e.sourcePoint ? { x: e.sourcePoint.x + dx, y: e.sourcePoint.y + dy } : null,
        targetPoint: e.targetPoint ? { x: e.targetPoint.x + dx, y: e.targetPoint.y + dy } : null
      };
    })
  };
}

function parseDiagramBody(body) {
  const modelStart = body.indexOf('<mxGraphModel');
  const modelTag = modelStart === -1 ? null : readTag(body, modelStart);
  const model = modelTag ? parseAttrs(modelTag.text) : {};
  const graph = parseGraph(body);
  const { vertices, edges } = resolveOrigins(graph.vertices, graph.edges);
  return {
    pageWidth: Number(model.pageWidth || 1250),
    pageHeight: Number(model.pageHeight || 850),
    vertices,
    edges
  };
}

function readDrawioPages(filePath) {
  const xml = fs.readFileSync(filePath, 'utf-8');
  const pages = [];
  let i = xml.indexOf('<diagram');
  while (i !== -1) {
    const tag = readTag(xml, i);
    if (!tag) break;
    const attrs = parseAttrs(tag.text);
    const close = xml.indexOf('</diagram>', tag.end);
    if (close === -1) break;
    const body = xml.slice(tag.end, close);
    pages.push({ name: attrs.name, ...parseDiagramBody(body) });
    i = xml.indexOf('<diagram', close);
  }
  return pages;
}

function loadDrawioCorpus() {
  const architecture = readDrawioPages(DRAWIO_FILES.architecture);
  const enterprise = readDrawioPages(DRAWIO_FILES.enterprise);
  return { architecture, enterprise };
}

module.exports = { readDrawioPages, loadDrawioCorpus, parseStyle, decodeEntities, plainLabel, DRAWIO_FILES };
