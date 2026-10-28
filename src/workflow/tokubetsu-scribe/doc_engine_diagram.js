'use strict';

const fs = require('fs');
const { resolveDynamicOutputPath } = require('./document_engine_common');
const { selectGradientTheme } = require('./document_cover');

function _buildDefsSvg(colorPalette) {
  let defsSvg = `
    <filter id="dropShadow" x="-10%" y="-10%" width="130%" height="130%">
      <feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#0F172A" flood-opacity="0.06" />
    </filter>`;

  colorPalette.forEach((hex) => {
    const clean = hex.replace('#', '');
    defsSvg += `
    <marker id="arrowhead-${clean}" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
      <path d="M 1 1.5 L 7 4.5 L 1 7.5 L 2.8 4.5 Z" fill="${hex}" />
    </marker>
    <filter id="glow-${clean}" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="2.5" result="blur" />
      <feMerge>
        <feMergeNode in="blur" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>`;
  });
  return defsSvg;
}

function _renderNodesSvg(nodes, width, isVertical, theme) {
  let nodesSvg = '';
  nodes.forEach((n, idx) => {
    const nw = n.width || (isVertical ? 260 : 220);
    const nh = n.height || 90;
    const nx = n.x !== undefined ? n.x : (isVertical ? Math.round((width - nw) / 2) : 80 + idx * 300);
    const ny = n.y !== undefined ? n.y : (isVertical ? 130 + idx * 230 : 380);
    const col = n.color || theme.colors[idx % theme.colors.length];

    nodesSvg += `
    <g class="diagram-node" transform="translate(${nx}, ${ny})">
      <rect width="${nw}" height="${nh}" rx="12" fill="#FFFFFF" stroke="${col}" stroke-width="2.5" filter="url(#dropShadow)" />
      <rect width="${nw}" height="6" rx="3" fill="${col}" />
      <text x="${nw / 2}" y="38" text-anchor="middle" font-family="'Inter', sans-serif" font-size="14" font-weight="700" fill="#0F172A">${n.label || 'Node'}</text>
      <text x="${nw / 2}" y="60" text-anchor="middle" font-family="'Inter', sans-serif" font-size="11" fill="#64748B">${n.sublabel || ''}</text>
    </g>`;
  });
  return nodesSvg;
}

function _getNodeGeom(node, idx, width, isVertical) {
  const nw = node.width || (isVertical ? 260 : 220);
  const nh = node.height || 90;
  const nx = node.x !== undefined ? node.x : (isVertical ? Math.round((width - nw) / 2) : 80 + idx * 300);
  const ny = node.y !== undefined ? node.y : (isVertical ? 130 + idx * 230 : 380);
  return { nw, nh, nx, ny };
}

function _computeEdgeGeometry(fromG, toG, isVertical) {
  if (isVertical) {
    const fx = fromG.nx + fromG.nw / 2;
    const fy = fromG.ny + fromG.nh;
    const tx = toG.nx + toG.nw / 2;
    const ty = toG.ny;
    const midY = (fy + ty) / 2;
    return {
      pathD: `M ${fx} ${fy} C ${fx} ${midY}, ${tx} ${midY}, ${tx} ${ty}`,
      labelTransform: `transform="translate(${Math.max(fx, tx) + 64}, ${midY})"`
    };
  }
  const fx = fromG.nx + fromG.nw;
  const fy = fromG.ny + fromG.nh / 2;
  const tx = toG.nx;
  const ty = toG.ny + toG.nh / 2;
  const midX = (fx + tx) / 2;
  return {
    pathD: `M ${fx} ${fy} C ${midX} ${fy}, ${midX} ${ty}, ${tx} ${ty}`,
    labelTransform: `transform="translate(${midX}, ${Math.min(fy, ty) - 24})"`
  };
}

function _renderSingleEdge(e, eIdx, nodeMap, edgeOpts) {
  const { width, isVertical, theme } = edgeOpts;
  const fromEntry = nodeMap.get(e.from);
  const toEntry = nodeMap.get(e.to);
  if (!fromEntry || !toEntry) return '';

  const fromG = _getNodeGeom(fromEntry.node, fromEntry.idx, width, isVertical);
  const toG = _getNodeGeom(toEntry.node, toEntry.idx, width, isVertical);
  const { pathD, labelTransform } = _computeEdgeGeometry(fromG, toG, isVertical);

  const edgeCol = e.color || fromEntry.node.color || theme.colors[eIdx % theme.colors.length];
  const cleanCol = edgeCol.replace('#', '');

  return `
    <g class="diagram-edge" data-from="${e.from}" data-to="${e.to}">
      <path d="${pathD}" fill="none" stroke="${edgeCol}" stroke-opacity="0.15" stroke-width="6" stroke-linecap="round" />
      <path class="flow-path" d="${pathD}" fill="none" stroke="${edgeCol}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" marker-end="url(#arrowhead-${cleanCol})" />
      <circle r="4" fill="${edgeCol}" filter="url(#glow-${cleanCol})">
        <animateMotion path="${pathD}" dur="2.4s" repeatCount="indefinite" />
      </circle>
      ${e.label ? `
      <g ${labelTransform}>
        <rect x="-48" y="-12" width="96" height="22" rx="5" fill="#FFFFFF" fill-opacity="0.95" stroke="#CBD5E1" stroke-width="1" />
        <text x="0" y="3" text-anchor="middle" font-family="'Inter', sans-serif" font-size="10" font-weight="700" fill="#334155">${e.label}</text>
      </g>` : ''}
    </g>`;
}

async function diagramCreate(options = {}) {
  const outputPath = resolveDynamicOutputPath(options.output_path, 'diagram.svg');
  const title = options.title || 'Architecture & Operational Workflow';
  const nodes = options.nodes || [];
  const edges = options.edges || [];
  const theme = selectGradientTheme(options.theme);

  const orientation = (options.orientation || options.layout || 'horizontal').toLowerCase();
  const isVertical = orientation === 'vertical';
  const width = options.width || (isVertical ? 900 : 1600);
  const height = options.height || (isVertical ? 1400 : 900);

  const colorPalette = new Set(['#3B82F6', '#10B981', '#8B5CF6', '#F59E0B', '#64748B']);
  theme.colors.forEach((c) => colorPalette.add(c));
  nodes.forEach((n) => { if (n.color) colorPalette.add(n.color); });
  edges.forEach((e) => { if (e.color) colorPalette.add(e.color); });

  const defsSvg = _buildDefsSvg(colorPalette);
  const nodesSvg = _renderNodesSvg(nodes, width, isVertical, theme);

  const nodeMap = new Map();
  nodes.forEach((node, idx) => nodeMap.set(node.id, { node, idx }));

  const edgeOpts = { width, isVertical, theme };
  let edgesSvg = '';
  edges.forEach((e, eIdx) => {
    edgesSvg += _renderSingleEdge(e, eIdx, nodeMap, edgeOpts);
  });

  const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    ${defsSvg}
  </defs>

  <style>
    @keyframes flowDash {
      from { stroke-dashoffset: 28; }
      to { stroke-dashoffset: 0; }
    }
    .flow-path {
      animation: flowDash 1.2s linear infinite;
    }
  </style>

  <rect width="100%" height="100%" fill="#FAFBFD" />

  <g transform="translate(60, 40)">
    <text x="0" y="32" font-family="'Inter', sans-serif" font-size="24" font-weight="800" fill="#0F172A">${title}</text>
    <text x="0" y="56" font-family="'Inter', sans-serif" font-size="13" fill="#64748B">Enterprise Architectural Topology &amp; Automated Pipeline Flow</text>
  </g>

  ${edgesSvg}
  ${nodesSvg}

  <g transform="translate(0, ${height - 8})">
    <rect x="0" y="0" width="${width * 0.25}" height="8" fill="${theme.colors[0]}" />
    <rect x="${width * 0.25}" y="0" width="${width * 0.25}" height="8" fill="${theme.colors[1]}" />
    <rect x="${width * 0.50}" y="0" width="${width * 0.25}" height="8" fill="${theme.colors[2]}" />
    <rect x="${width * 0.75}" y="0" width="${width * 0.25}" height="8" fill="${theme.colors[3]}" />
  </g>
</svg>`;

  fs.writeFileSync(outputPath, svgContent, 'utf8');
  return {
    success: true,
    file_path: outputPath,
    node_count: nodes.length,
    edge_count: edges.length
  };
}

module.exports = {
  diagramCreate
};
