'use strict';

/**
 * Konoha 3D mini-DSL Parser & Serializer.
 * Provides human-readable, token-efficient 3D scene authoring for any coding agent.
 */

const VALID_ARCHETYPES = new Set([
  'game-character', 'game-prop', 'game-weapon', 'game-vehicle',
  'game-environment', 'game-tileset', 'game-creature', 'game-building',
  'logistics', 'vehicle', 'commerce', 'dashboard', 'portfolio', 'saas', 'landing', 'application'
]);

function clamp(val, min, max, fallback) {
  const n = Number(val);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function parseHexColor(token) {
  if (typeof token !== 'string') return null;
  const match = token.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  return match ? match[0].toLowerCase() : null;
}

function normalizePolycount(val) {
  if (typeof val === 'string') {
    const s = val.toLowerCase().trim();
    if (s === 'low') return 1500;
    if (s === 'medium' || s === 'med') return 8000;
    if (s === 'high') return 30000;
  }
  return clamp(val, 1000, 200000, 50000);
}

function extractDslPayload(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;
  let text = rawText.trim();
  if (text.startsWith('{') && text.endsWith('}')) {
    try { JSON.parse(text); return null; } catch (_) { /* best-effort fallback: ignored by design */ }
  }
  const fenceRegex = /```(?:konoha3d|dsl|3d-dsl|three-dsl|3d)?\s*([\s\S]*?)```/i;
  const match = text.match(fenceRegex);
  if (match && match[1]) {
    const candidate = match[1].trim();
    if (candidate.startsWith('{') && candidate.endsWith('}')) {
      try { JSON.parse(candidate); return null; } catch (_) { /* best-effort fallback: ignored by design */ }
    }
    text = candidate;
  }
  const hasDslKeywords = /\b(box|sphere|cylinder|cone|torus|knot|capsule|plane|ico|dodeca|lathe|tube|group|union|subtract|intersect|archetype|camera|light)\b/i.test(text);
  return hasDslKeywords ? text : null;
}

function normalizeDslLine(rawLine) {
  let line = rawLine.trim();
  if (!line || line.startsWith('//') || line.startsWith('#')) return line;
  line = line.replace(/\[([^\]]+)\]/g, (_, inner) => inner.replace(/,/g, ' ').trim());
  line = line.replace(/\b(pos|position)\b/gi, 'at');
  line = line.replace(/\bsize\s+/gi, '');
  line = line.replace(/\b(color|colour)\s+/gi, '');
  line = line.replace(/\bmetalness\b/gi, 'metal');
  line = line.replace(/\broughness\b/gi, 'rough');
  line = line.replace(/\bcsg\s+difference\b/gi, 'subtract');
  line = line.replace(/\bcsg\s+(union|subtract|intersect|group)\b/gi, '$1');
  const m = line.match(/^([a-zA-Z]+)\s+([a-zA-Z][a-zA-Z0-9_-]*)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)(.*)$/);
  if (m && !['name', 'archetype', 'polycount', 'camera', 'light', 'background', 'union', 'subtract', 'intersect', 'group', 'csg'].includes(m[1].toLowerCase())) {
    line = `${m[1]} ${m[3]} ${m[4]} ${m[5]} as ${m[2]}${m[6]}`;
  }
  return line;
}
function parseMaterialTokens(tokens) {
  const mat = { type: 'physical', color: '#6366f1', roughness: 0.3, metalness: 0.2 };
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    const hex = parseHexColor(t);
    if (hex) { mat.color = hex; i++; continue; }
    const lower = t.toLowerCase();
    if (lower === 'metal') {
      mat.metalness = clamp(tokens[i + 1], 0, 1, 0.8);
      i += 2;
    } else if (lower === 'rough') {
      mat.roughness = clamp(tokens[i + 1], 0, 1, 0.4);
      i += 2;
    } else if (lower === 'clearcoat') {
      mat.clearcoat = clamp(tokens[i + 1], 0, 1, 0.5);
      if (tokens[i + 2] && !Number.isNaN(Number(tokens[i + 2]))) {
        mat.clearcoatRoughness = clamp(tokens[i + 2], 0, 1, 0.1);
        i += 3;
      } else { i += 2; }
    } else if (lower === 'glass') {
      mat.transmission = 0.7; mat.opacity = 0.85; mat.transparent = true;
      mat.metalness = 0.1; mat.roughness = 0.05;
      if (tokens[i + 1] && !Number.isNaN(Number(tokens[i + 1]))) {
        mat.opacity = clamp(tokens[i + 1], 0, 1, 0.85);
        i += 2;
      } else { i += 1; }
    } else if (lower === 'emissive') {
      mat.emissive = parseHexColor(tokens[i + 1]) || mat.color;
      if (tokens[i + 2] && !Number.isNaN(Number(tokens[i + 2]))) {
        mat.emissiveIntensity = clamp(tokens[i + 2], 0, 10, 2.0);
        i += 3;
      } else { mat.emissiveIntensity = 2.0; i += 2; }
    } else if (lower === 'wire') {
      mat.wireframe = true; i++;
    } else { i++; }
  }
  return mat;
}

function extractModifiers(tokens) {
  const transform = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
  let name = null;
  const remainingTokens = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i].toLowerCase();
    if (t === 'at' && i + 3 < tokens.length && !Number.isNaN(Number(tokens[i + 1]))) {
      transform.position = [Number(tokens[i + 1]), Number(tokens[i + 2]), Number(tokens[i + 3])];
      i += 4;
    } else if (t === 'rot' && i + 3 < tokens.length && !Number.isNaN(Number(tokens[i + 1]))) {
      transform.rotation = [Number(tokens[i + 1]), Number(tokens[i + 2]), Number(tokens[i + 3])];
      i += 4;
    } else if (t === 'scale' && i + 3 < tokens.length && !Number.isNaN(Number(tokens[i + 1]))) {
      transform.scale = [Number(tokens[i + 1]), Number(tokens[i + 2]), Number(tokens[i + 3])];
      i += 4;
    } else if (t === 'as' && i + 1 < tokens.length) {
      name = tokens[i + 1];
      i += 2;
    } else {
      remainingTokens.push(tokens[i]);
      i++;
    }
  }
  return { transform, name, remainingTokens };
}

function parsePrimitiveLine(line, index, warnings) {
  const rawTokens = line.split(/\s+/).filter(Boolean);
  if (rawTokens.length === 0) return null;
  const primType = rawTokens[0].toLowerCase();
  const { transform, name, remainingTokens } = extractModifiers(rawTokens.slice(1));
  let geometry = null;
  let matTokens = [];

  switch (primType) {
    case 'box':
      geometry = { type: 'box', params: { width: Number(remainingTokens[0]) || 1, height: Number(remainingTokens[1]) || 1, depth: Number(remainingTokens[2]) || 1 } };
      matTokens = remainingTokens.slice(3);
      break;
    case 'sphere':
      geometry = { type: 'sphere', params: { radius: Number(remainingTokens[0]) || 1, widthSegments: 32, heightSegments: 32 } };
      matTokens = remainingTokens.slice(1);
      break;
    case 'cylinder': {
      const rt = Number(remainingTokens[0]) || 1;
      geometry = { type: 'cylinder', params: { radiusTop: rt, radiusBottom: Number(remainingTokens[1]) || rt, height: Number(remainingTokens[2]) || 1, radialSegments: 32 } };
      matTokens = remainingTokens.slice(3);
      break;
    }
    case 'cone':
      geometry = { type: 'cone', params: { radius: Number(remainingTokens[0]) || 1, height: Number(remainingTokens[1]) || 1, radialSegments: 32 } };
      matTokens = remainingTokens.slice(2);
      break;
    case 'torus':
      geometry = { type: 'torus', params: { radius: Number(remainingTokens[0]) || 1, tube: Number(remainingTokens[1]) || 0.3, radialSegments: 16, tubularSegments: 64 } };
      matTokens = remainingTokens.slice(2);
      break;
    case 'knot':
    case 'torusknot':
      geometry = { type: 'torusKnot', params: { radius: Number(remainingTokens[0]) || 1, tube: Number(remainingTokens[1]) || 0.3, p: Number(remainingTokens[2]) || 2, q: Number(remainingTokens[3]) || 3, radialSegments: 16, tubularSegments: 64 } };
      matTokens = remainingTokens.slice(4);
      break;
    case 'capsule':
      geometry = { type: 'capsule', params: { radius: Number(remainingTokens[0]) || 0.5, length: Number(remainingTokens[1]) || 1, capSegments: 8, radialSegments: 16 } };
      matTokens = remainingTokens.slice(2);
      break;
    case 'plane':
      geometry = { type: 'plane', params: { width: Number(remainingTokens[0]) || 1, height: Number(remainingTokens[1]) || 1 } };
      matTokens = remainingTokens.slice(2);
      break;
    case 'ico':
    case 'icosahedron':
      geometry = { type: 'icosahedron', params: { radius: Number(remainingTokens[0]) || 1, detail: Number(remainingTokens[1]) || 0 } };
      matTokens = remainingTokens.slice(2);
      break;
    case 'dodeca':
    case 'dodecahedron':
      geometry = { type: 'dodecahedron', params: { radius: Number(remainingTokens[0]) || 1, detail: 0 } };
      matTokens = remainingTokens.slice(1);
      break;
    case 'lathe': {
      const pairs = [];
      let tokenIdx = 0;
      while (tokenIdx < remainingTokens.length) {
        const item = remainingTokens[tokenIdx];
        if (item.includes(',')) {
          const [rStr, yStr] = item.split(',');
          pairs.push([Math.max(0, Number(rStr) || 0), Number(yStr) || 0]);
          tokenIdx++;
        } else if (tokenIdx + 1 < remainingTokens.length && !Number.isNaN(Number(item)) && !Number.isNaN(Number(remainingTokens[tokenIdx + 1]))) {
          pairs.push([Math.max(0, Number(item)), Number(remainingTokens[tokenIdx + 1])]);
          tokenIdx += 2;
        } else break;
      }
      if (pairs.length < 2) {
        warnings.push(`Lathe at line ${index + 1} requires >=2 profile pairs; defaulting`);
        pairs.push([0, 0], [0.5, 0.5], [0, 1.0]);
      }
      geometry = { type: 'lathe', params: { profile: pairs, radialSegments: 24 } };
      matTokens = remainingTokens.slice(tokenIdx);
      break;
    }
    case 'tube': {
      const r = Number(remainingTokens[0]) || 0.1;
      const pts = [];
      let tokenIdx = 1;
      while (tokenIdx < remainingTokens.length) {
        const parts = remainingTokens[tokenIdx].split(',').map(Number);
        if (parts.length === 3 && parts.every(Number.isFinite)) {
          pts.push(parts);
          tokenIdx++;
        } else break;
      }
      if (pts.length < 2) {
        warnings.push(`Tube at line ${index + 1} requires >=2 points; defaulting`);
        pts.push([0, 0, 0], [0, 1, 0]);
      }
      geometry = { type: 'tube', params: { radius: r, points: pts, tubularSegments: 32, radialSegments: 12 } };
      matTokens = remainingTokens.slice(tokenIdx);
      break;
    }
    default:
      warnings.push(`Unknown primitive type "${primType}" at line ${index + 1}`);
      return null;
  }

  return { name: name || `${primType}_${index}`, geometry, material: parseMaterialTokens(matTokens), transform };
}

function parseCameraDirective(tokens) {
  const nums = [];
  let fov = 45;
  const target = [0, 0, 0];
  let tIdx = 1;
  while (tIdx < tokens.length) {
    const t = tokens[tIdx].toLowerCase();
    if (t === 'fov' && tokens[tIdx + 1]) {
      fov = clamp(tokens[tIdx + 1], 15, 90, 45);
      tIdx += 2;
    } else if (t === 'at' && tIdx + 3 < tokens.length) {
      target[0] = Number(tokens[tIdx + 1]) || 0;
      target[1] = Number(tokens[tIdx + 2]) || 0;
      target[2] = Number(tokens[tIdx + 3]) || 0;
      tIdx += 4;
    } else {
      const num = Number(tokens[tIdx]);
      if (!Number.isNaN(num)) nums.push(num);
      tIdx++;
    }
  }
  return { position: nums.length >= 3 ? [nums[0], nums[1], nums[2]] : [0, 1.5, 3.5], fov, target };
}

function parseLightDirective(tokens) {
  const rawType = tokens[1] ? tokens[1].toLowerCase() : 'directional';
  const lType = ['ambient', 'directional', 'point'].includes(rawType) ? rawType : 'directional';
  const col = parseHexColor(tokens[2]) || '#ffffff';
  const intensity = clamp(tokens[3], 0, 10, 1.5);
  const pos = [2, 4, 3];
  const atIdx = tokens.indexOf('at');
  if (atIdx !== -1 && atIdx + 3 < tokens.length) {
    pos[0] = Number(tokens[atIdx + 1]) || 0;
    pos[1] = Number(tokens[atIdx + 2]) || 0;
    pos[2] = Number(tokens[atIdx + 3]) || 0;
  }
  return { type: lType, color: col, intensity, position: pos };
}

function buildCompletedCsgNode(completed, warnings) {
  const operands = completed.operands.filter(op => op.length > 0);
  if (completed.type === 'intersect' && operands.length > 2) {
    warnings.push('Intersect "' + completed.name + '" truncated to 2 operands');
    operands.length = 2;
  }
  return {
    name: completed.name,
    csg: {
      op: completed.type,
      operands: operands.map(opGroup => (opGroup.length === 1 ? opGroup[0] : {
        name: completed.name + '_subgroup',
        csg: { op: 'group', operands: opGroup }
      }))
    }
  };
}

function handleBlockOpen(cmd, tokens, blockStack, nodes, ctx) {
  const { idx, warnings } = ctx;
  if (blockStack.length >= 3) {
    warnings.push(`CSG nesting exceeded limit 3 at line ${idx + 1}`);
    return blockStack[blockStack.length - 1] || null;
  }
  const blockName = (tokens[1] && tokens[1] !== '{') ? tokens[1].replace(/[^a-zA-Z0-9_-]/g, '_') : `${cmd}_${nodes.length}`;
  const newBlock = { type: cmd, name: blockName, operands: [[]], currentOperand: 0, depth: blockStack.length + 1 };
  blockStack.push(newBlock);
  return newBlock;
}

function handleOperandSeparator(inBlock, idx, warnings) {
  if (!inBlock) {
    warnings.push(`Dangling '--' at line ${idx + 1}`);
    return;
  }
  inBlock.currentOperand++;
  inBlock.operands.push([]);
}

function appendParsedNode(node, inBlock, nodes) {
  if (!node) return;
  if (inBlock) {
    inBlock.operands[inBlock.currentOperand].push(node);
  } else {
    nodes.push(node);
  }
}

function handleBlockEnd(blockStack, nodes, warnings, idx, cmd) {
  if (blockStack.length === 0) {
    warnings.push(`Unexpected closer '${cmd}' at line ${idx + 1}`);
    return null;
  }
  const completed = blockStack.pop();
  const parentBlock = blockStack.length > 0 ? blockStack[blockStack.length - 1] : null;
  const csgNode = buildCompletedCsgNode(completed, warnings);
  if (parentBlock) {
    parentBlock.operands[parentBlock.currentOperand].push(csgNode);
  } else {
    nodes.push(csgNode);
  }
  return parentBlock;
}

function flushUnclosedBlocks(blockStack, nodes) {
  while (blockStack.length > 0) {
    const unclosed = blockStack.pop();
    const operands = unclosed.operands.filter(op => op.length > 0);
    const csgNode = {
      name: unclosed.name,
      csg: {
        op: unclosed.type,
        operands: operands.map(opGroup => (opGroup.length === 1 ? opGroup[0] : {
          name: `${unclosed.name}_subgroup`,
          csg: { op: 'group', operands: opGroup }
        }))
      }
    };
    if (blockStack.length > 0) {
      const top = blockStack[blockStack.length - 1];
      top.operands[top.currentOperand].push(csgNode);
    } else {
      nodes.push(csgNode);
    }
  }
}

function parseKonohaDSL(rawScript, _opts = {}) {
  const warnings = [];
  if (!rawScript || typeof rawScript !== 'string') {
    throw new Error('DslParseError: script must be a non-empty string');
  }

  const cleanScript = extractDslPayload(rawScript) || rawScript;
  const lines = cleanScript.split('\n').map(normalizeDslLine);

  let sceneName = 'Hero3DAsset';
  let archetype = 'application';
  let targetPolycount = 50000;
  let background = null;
  let camera = { position: [0, 1.5, 3.5], fov: 45, target: [0, 0, 0] };
  const lights = [];
  const nodes = [];

  let inBlock = null;
  const blockStack = [];

  for (let idx = 0; idx < lines.length; idx++) {
    const stripped = lines[idx].replace(/\/\/.*$/, '').replace(/#(?![0-9a-fA-F]{3,6}\b).*$/, '').trim();
    if (!stripped) continue;

    const tokens = stripped.split(/\s+/);
    const cmd = tokens[0].toLowerCase();

    if (cmd === 'name' && tokens[1]) {
      sceneName = tokens.slice(1).join(' ').replace(/[^a-zA-Z0-9_-]/g, '_');
      continue;
    }
    if (cmd === 'archetype' && tokens[1]) {
      const arch = tokens[1].toLowerCase();
      archetype = VALID_ARCHETYPES.has(arch) ? arch : 'application';
      continue;
    }
    if (cmd === 'polycount' && tokens[1]) {
      targetPolycount = normalizePolycount(tokens[1]);
      continue;
    }
    if (cmd === 'background' && tokens[1]) {
      const hex = parseHexColor(tokens[1]);
      if (hex) background = hex;
      continue;
    }
    if (cmd === 'camera') {
      camera = parseCameraDirective(tokens);
      continue;
    }
    if (cmd === 'light' && tokens.length >= 3) {
      lights.push(parseLightDirective(tokens));
      continue;
    }

    if (['union', 'subtract', 'intersect', 'group'].includes(cmd)) {
      inBlock = handleBlockOpen(cmd, tokens, blockStack, nodes, { idx, warnings });
      continue;
    }

    if (stripped === '--') {
      handleOperandSeparator(inBlock, idx, warnings);
      continue;
    }

    if (cmd === 'end' || cmd === '}') {
      inBlock = handleBlockEnd(blockStack, nodes, warnings, idx, cmd);
      continue;
    }

    const node = parsePrimitiveLine(stripped, idx, warnings);
    appendParsedNode(node, inBlock, nodes);
  }

  flushUnclosedBlocks(blockStack, nodes);

  function countLeafPrimitives(nodeList) {
    let count = 0;
    for (const n of nodeList) {
      if (n.geometry) count++;
      if (n.csg && Array.isArray(n.csg.operands)) count += countLeafPrimitives(n.csg.operands);
    }
    return count;
  }

  if (countLeafPrimitives(nodes) === 0) {
    throw new Error('DslParseError: no valid primitive statements found in DSL script');
  }

  return {
    spec: {
      name: sceneName,
      archetype,
      target_polycount: targetPolycount,
      background,
      camera,
      lights: lights.length > 0 ? lights : [
        { type: 'ambient', color: '#ffffff', intensity: 0.8 },
        { type: 'directional', color: '#ffffff', intensity: 2.0, position: [3, 5, 4] },
        { type: 'point', color: '#818cf8', intensity: 1.5, position: [-3, -2, -2] }
      ],
      nodes
    },
    warnings
  };
}

function specToDSL(spec) {
  if (!spec || typeof spec !== 'object') return '// Empty scene specification\n';
  const lines = ['// Konoha 3D Scene Specification', `name ${spec.name || 'Hero3DAsset'}`, `archetype ${spec.archetype || 'application'}`];
  if (spec.target_polycount) lines.push(`polycount ${spec.target_polycount}`);
  if (spec.background) lines.push(`background ${spec.background}`);
  if (spec.camera) {
    const c = spec.camera, cp = c.position || [0, 1.5, 3.5], ct = c.target || [0, 0, 0];
    lines.push(`camera ${cp[0]} ${cp[1]} ${cp[2]} fov ${c.fov || 45} at ${ct[0]} ${ct[1]} ${ct[2]}`);
  }
  if (Array.isArray(spec.lights)) {
    for (const l of spec.lights) {
      const pos = l.position ? ` at ${l.position[0]} ${l.position[1]} ${l.position[2]}` : '';
      lines.push(`light ${l.type || 'directional'} ${l.color || '#ffffff'} ${l.intensity || 1.5}${pos}`);
    }
  }
  lines.push('');

  function serializeMaterial(m) {
    if (!m) return '';
    const parts = [];
    if (m.color) parts.push(m.color);
    if (typeof m.metalness === 'number') parts.push(`metal ${m.metalness}`);
    if (typeof m.roughness === 'number') parts.push(`rough ${m.roughness}`);
    if (typeof m.clearcoat === 'number') {
      parts.push(`clearcoat ${m.clearcoat}`);
      if (typeof m.clearcoatRoughness === 'number') parts.push(`${m.clearcoatRoughness}`);
    }
    if (m.transmission && m.transmission > 0.5) parts.push(`glass ${m.opacity || 0.85}`);
    if (m.emissive && m.emissive !== '#000000') parts.push(`emissive ${m.emissive} ${m.emissiveIntensity || 2.0}`);
    if (m.wireframe) parts.push('wire');
    return parts.join(' ');
  }

  function serializeModifiers(node) {
    const parts = [];
    if (node.transform) {
      const p = node.transform.position;
      if (p && (p[0] !== 0 || p[1] !== 0 || p[2] !== 0)) parts.push(`at ${p[0]} ${p[1]} ${p[2]}`);
      const r = node.transform.rotation;
      if (r && (r[0] !== 0 || r[1] !== 0 || r[2] !== 0)) parts.push(`rot ${r[0]} ${r[1]} ${r[2]}`);
      const s = node.transform.scale;
      if (s && (s[0] !== 1 || s[1] !== 1 || s[2] !== 1)) parts.push(`scale ${s[0]} ${s[1]} ${s[2]}`);
    }
    if (node.name) parts.push(`as ${node.name}`);
    return parts.join(' ');
  }

  function serializeNode(node, indent = '') {
    if (node.csg) {
      lines.push(`${indent}${node.csg.op || 'union'} ${node.name || ''} {`);
      const operands = node.csg.operands || [];
      for (let i = 0; i < operands.length; i++) {
        if (i > 0) lines.push(`${indent}  --`);
        serializeNode(operands[i], indent + '  ');
      }
      lines.push(`${indent}} end`);
      return;
    }
    const g = node.geometry || {}, p = g.params || {};
    let primStr = '';
    switch (g.type) {
      case 'box': primStr = `box ${p.width || 1} ${p.height || 1} ${p.depth || 1}`; break;
      case 'sphere': primStr = `sphere ${p.radius || 1}`; break;
      case 'cylinder': primStr = `cylinder ${p.radiusTop !== undefined ? p.radiusTop : 1} ${p.radiusBottom !== undefined ? p.radiusBottom : 1} ${p.height || 1}`; break;
      case 'cone': primStr = `cone ${p.radius || 1} ${p.height || 1}`; break;
      case 'torus': primStr = `torus ${p.radius || 1} ${p.tube || 0.3}`; break;
      case 'torusKnot': primStr = `knot ${p.radius || 1} ${p.tube || 0.3} ${p.p || 2} ${p.q || 3}`; break;
      case 'capsule': primStr = `capsule ${p.radius || 0.5} ${p.length || 1}`; break;
      case 'plane': primStr = `plane ${p.width || 1} ${p.height || 1}`; break;
      case 'dodecahedron': primStr = `dodeca ${p.radius || 1}`; break;
      case 'icosahedron': primStr = `ico ${p.radius || 1} ${p.detail || 0}`; break;
      case 'lathe': {
        const pairs = (p.profile || [[0, 0], [0.5, 0.5]]).map(pt => `${pt[0]},${pt[1]}`).join(' ');
        primStr = `lathe ${pairs}`; break;
      }
      case 'tube': {
        const pts = (p.points || [[0, 0, 0], [0, 1, 0]]).map(pt => `${pt[0]},${pt[1]},${pt[2]}`).join(' ');
        primStr = `tube ${p.radius || 0.1} ${pts}`; break;
      }
      default: primStr = `box ${p.width || 1} ${p.height || 1} ${p.depth || 1}`; break;
    }
    lines.push([indent + primStr, serializeModifiers(node), serializeMaterial(node.material)].filter(Boolean).join(' '));
  }

  if (Array.isArray(spec.nodes)) {
    for (const n of spec.nodes) serializeNode(n);
  }
  return lines.join('\n') + '\n';
}

module.exports = {
  VALID_ARCHETYPES,
  extractDslPayload,
  parseKonohaDSL,
  specToDSL,
  normalizePolycount
};
