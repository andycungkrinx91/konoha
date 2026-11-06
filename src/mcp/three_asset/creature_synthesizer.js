'use strict';

/**
 * Parametric Quadruped / Multi-Tailed Creature Synthesizer.
 * Builds anatomically proportioned, grounded creature assemblies (e.g. Kurama nine-tailed fox)
 * with radially fanned, strictly non-overlapping bushy tails sized from the scene spec.
 */

const WORD_NUMBERS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12
};

const NUMBER_WORDS = Object.keys(WORD_NUMBERS).join('|');

function parseRequestedCount(prompt, fallback = 0) {
  const text = String(prompt || '').toLowerCase();
  const digit = text.match(new RegExp(`\\b(\\d{1,2})\\s*(?:[-\\s])?(?:separate\\s+|long\\s+|bushy\\s+)*${'tails?'}\\b`));
  if (digit) return Math.min(24, Math.max(1, Number(digit[1])));
  const word = text.match(new RegExp(`\\b(${NUMBER_WORDS})[\\s-]*(?:separate\\s+)?(?:long\\s+)?(?:bushy\\s+)?tails?\\b`));
  if (word) return WORD_NUMBERS[word[1]];
  const hyphenated = text.match(new RegExp(`\\b(${NUMBER_WORDS})[\\s-]tailed\\b`));
  if (hyphenated) return WORD_NUMBERS[hyphenated[1]];
  return fallback;
}

function parseTailCount(prompt) {
  const explicit = parseRequestedCount(prompt, 0);
  if (explicit > 0) return explicit;
  return /\btail(s|ed)?\b/i.test(String(prompt || '')) ? 1 : 0;
}

const COLOR_HINTS = [
  { pattern: /\b(orange[\s-]?red|red[\s-]?orange|vermilion|scarlet orange)\b/i, hex: '#e8541f' },
  { pattern: /\b(orange|coral|tangerine|amber fur)\b/i, hex: '#ea580c' },
  { pattern: /\b(golden|gold)\b/i, hex: '#d97706' },
  { pattern: /\b(white|snow|pearl)\b/i, hex: '#f8fafc' },
  { pattern: /\b(black|onyx|obsidian|charcoal)\b/i, hex: '#141418' },
  { pattern: /\b(gray|grey|silver)\b/i, hex: '#a1a1aa' },
  { pattern: /\b(brown|auburn|chestnut)\b/i, hex: '#92400e' },
  { pattern: /\b(blue|azure)\b/i, hex: '#2563eb' },
  { pattern: /\b(green|emerald)\b/i, hex: '#15803d' },
  { pattern: /\b(purple|violet)\b/i, hex: '#7c3aed' },
  { pattern: /\b(red|crimson|ruby)\b/i, hex: '#dc2626' }
];

function colorFromPrompt(text, fallback) {
  for (const hint of COLOR_HINTS) {
    if (hint.pattern.test(text)) return hint.hex;
  }
  return fallback;
}

function furPalette(prompt) {
  const text = String(prompt || '');
  const coat = colorFromPrompt(text, '#e8541f');
  const markings = /\b(black|dark|onyx|charcoal)\b/i.test(text) ? '#141418' : '#1f2937';
  const counter = /\b(white|cream|ivory|pearl)\b/i.test(text) ? '#f8fafc' : '#f1f5f9';
  const eye = /\b(red|scarlet|crimson)\b/i.test(text) ? '#dc2626' : (/\b(gold|amber|yellow)\b/i.test(text) ? '#d97706' : '#16a34a');
  return { coat, markings, counter, eye, nose: '#111827', pupil: '#090d16' };
}

function organicMat(color, extra = {}) {
  return Object.assign({
    type: 'physical',
    color,
    roughness: 0.62,
    metalness: 0.0,
    clearcoat: 0.05,
    clearcoatRoughness: 0.6,
    sheen: 0.85,
    sheenRoughness: 0.42,
    sheenColor: color,
    subsurface: 0.12
  }, extra);
}

function tr(position, rotation = [0, 0, 0], scale = [1, 1, 1]) {
  return { position, rotation, scale };
}

function node(name, type, params, material, transform = {}) {
  return {
    name,
    geometry: { type, params },
    material,
    transform: {
      position: transform.position || [0, 0, 0],
      rotation: transform.rotation || [0, 0, 0],
      scale: transform.scale || [1, 1, 1]
    }
  };
}

function buildTorso(pal) {
  return [
    node('ribcage_thorax', 'sphere', { radius: 0.46, widthSegments: 48, heightSegments: 32 }, organicMat(pal.coat), tr([0, 0.92, 0.05], [0, 0, 0], [1.0, 1.0, 1.28])),
    node('shoulder_scruff', 'sphere', { radius: 0.40, widthSegments: 40, heightSegments: 28 }, organicMat(pal.coat), tr([0, 1.06, 0.44], [0, 0, 0], [1.05, 0.95, 1.05])),
    node('lumbar_spine', 'capsule', { radius: 0.33, length: 0.95, capSegments: 16, radialSegments: 32 }, organicMat(pal.coat), tr([0, 0.90, -0.52], [Math.PI / 2, 0, 0])),
    node('pelvis_haunches', 'sphere', { radius: 0.43, widthSegments: 44, heightSegments: 30 }, organicMat(pal.coat), tr([0, 0.90, -1.05], [0, 0, 0], [1.02, 1.0, 1.1])),
    node('chest_white_plastron', 'sphere', { radius: 0.30, widthSegments: 36, heightSegments: 24 }, organicMat(pal.counter, { roughness: 0.7 }), tr([0, 0.74, 0.55], [0, 0, 0], [0.86, 0.78, 1.15])),
    node('belly_undercoat', 'capsule', { radius: 0.26, length: 1.35, capSegments: 14, radialSegments: 28 }, organicMat(pal.counter, { roughness: 0.72 }), tr([0, 0.62, -0.32], [Math.PI / 2, 0, 0], [1, 1, 0.62])),
    node('throat_white_ruff', 'sphere', { radius: 0.27, widthSegments: 32, heightSegments: 22 }, organicMat(pal.counter, { roughness: 0.7 }), tr([0, 1.08, 0.74], [0, 0, 0], [1.0, 0.92, 0.85]))
  ];
}

function buildHead(pal) {
  const headY = 1.44;
  const headZ = 0.92;
  return [
    node('neck_column', 'capsule', { radius: 0.24, length: 0.46, capSegments: 14, radialSegments: 28 }, organicMat(pal.coat), tr([0, 1.24, 0.78], [0.62, 0, 0])),
    node('cranium_skull', 'sphere', { radius: 0.29, widthSegments: 44, heightSegments: 30 }, organicMat(pal.coat), tr([0, headY, headZ], [0, 0, 0], [1.0, 0.94, 1.12])),
    node('cheek_ruff_l', 'sphere', { radius: 0.19, widthSegments: 28, heightSegments: 20 }, organicMat(pal.coat), tr([-0.24, headY - 0.06, headZ + 0.04], [0, 0.3, 0], [0.8, 1.05, 1.0])),
    node('cheek_ruff_r', 'sphere', { radius: 0.19, widthSegments: 28, heightSegments: 20 }, organicMat(pal.coat), tr([0.24, headY - 0.06, headZ + 0.04], [0, -0.3, 0], [0.8, 1.05, 1.0])),
    node('snout_bridge', 'capsule', { radius: 0.13, length: 0.34, capSegments: 12, radialSegments: 24 }, organicMat(pal.coat), tr([0, headY - 0.05, headZ + 0.31], [Math.PI / 2 - 0.12, 0, 0], [1, 1, 0.9])),
    node('muzzle_upper_white', 'capsule', { radius: 0.115, length: 0.32, capSegments: 12, radialSegments: 24 }, organicMat(pal.counter, { roughness: 0.68 }), tr([0, headY - 0.14, headZ + 0.32], [Math.PI / 2 - 0.12, 0, 0])),
    node('jaw_lower_white', 'capsule', { radius: 0.095, length: 0.27, capSegments: 10, radialSegments: 22 }, organicMat(pal.counter, { roughness: 0.7 }), tr([0, headY - 0.22, headZ + 0.29], [Math.PI / 2 - 0.2, 0, 0])),
    node('rhinarium_nose', 'sphere', { radius: 0.055, widthSegments: 20, heightSegments: 16 }, organicMat(pal.nose, { roughness: 0.35, sheen: 0 }), tr([0, headY - 0.09, headZ + 0.47], [0, 0, 0], [1.15, 0.85, 0.85])),
    node('eye_marking_black_l', 'sphere', { radius: 0.085, widthSegments: 24, heightSegments: 18 }, organicMat(pal.markings, { roughness: 0.5, sheen: 0.2 }), tr([-0.145, headY + 0.06, headZ + 0.215], [0, 0, 0], [1.25, 0.7, 0.4])),
    node('eye_marking_black_r', 'sphere', { radius: 0.085, widthSegments: 24, heightSegments: 18 }, organicMat(pal.markings, { roughness: 0.5, sheen: 0.2 }), tr([0.145, headY + 0.06, headZ + 0.215], [0, 0, 0], [1.25, 0.7, 0.4])),
    node('eye_sclera_red_l', 'sphere', { radius: 0.058, widthSegments: 24, heightSegments: 18 }, organicMat(pal.eye, { roughness: 0.12, clearcoat: 1, sheen: 0, emissive: pal.eye, emissiveIntensity: 0.9 }), tr([-0.132, headY + 0.055, headZ + 0.255], [0, 0, 0], [1, 1, 0.8])),
    node('eye_sclera_red_r', 'sphere', { radius: 0.058, widthSegments: 24, heightSegments: 18 }, organicMat(pal.eye, { roughness: 0.12, clearcoat: 1, sheen: 0, emissive: pal.eye, emissiveIntensity: 0.9 }), tr([0.132, headY + 0.055, headZ + 0.255], [0, 0, 0], [1, 1, 0.8])),
    node('pupil_slit_l', 'capsule', { radius: 0.012, length: 0.085, capSegments: 8, radialSegments: 14 }, organicMat(pal.pupil, { roughness: 0.1, sheen: 0 }), tr([-0.132, headY + 0.055, headZ + 0.295], [0, 0, 0], [1, 1, 0.5])),
    node('pupil_slit_r', 'capsule', { radius: 0.012, length: 0.085, capSegments: 8, radialSegments: 14 }, organicMat(pal.pupil, { roughness: 0.1, sheen: 0 }), tr([0.132, headY + 0.055, headZ + 0.295], [0, 0, 0], [1, 1, 0.5])),
    node('ear_outer_l', 'cone', { radius: 0.13, height: 0.36, radialSegments: 22 }, organicMat(pal.coat), tr([-0.17, headY + 0.30, headZ - 0.02], [-0.18, 0, -0.24])),
    node('ear_outer_r', 'cone', { radius: 0.13, height: 0.36, radialSegments: 22 }, organicMat(pal.coat), tr([0.17, headY + 0.30, headZ - 0.02], [-0.18, 0, 0.24])),
    node('ear_inner_l', 'cone', { radius: 0.075, height: 0.26, radialSegments: 18 }, organicMat(pal.counter, { roughness: 0.75 }), tr([-0.17, headY + 0.29, headZ + 0.045], [-0.18, 0, -0.24])),
    node('ear_inner_r', 'cone', { radius: 0.075, height: 0.26, radialSegments: 18 }, organicMat(pal.counter, { roughness: 0.75 }), tr([0.17, headY + 0.29, headZ + 0.045], [-0.18, 0, 0.24]))
  ];
}

function buildLeg(side, isFront, pal) {
  const x = side === 'l' ? -0.27 : 0.27;
  const z = isFront ? 0.52 : -0.92;
  const tag = `${isFront ? 'front' : 'back'}_${side}`;
  const upperMat = organicMat(pal.coat);
  const lowerMat = organicMat(pal.counter, { roughness: 0.7 });
  const pawMat = organicMat(pal.markings, { roughness: 0.55, sheen: 0.3 });
  return [
    node(`${tag}_upper_limb`, 'capsule', { radius: 0.135, length: 0.46, capSegments: 12, radialSegments: 26 }, upperMat, tr([x, 0.72, z], [isFront ? 0.1 : -0.12, 0, side === 'l' ? 0.06 : -0.06])),
    node(`${tag}_middle_limb`, 'capsule', { radius: 0.095, length: 0.44, capSegments: 12, radialSegments: 24 }, lowerMat, tr([x, 0.36, z + (isFront ? 0.03 : -0.03)], [isFront ? -0.06 : 0.08, 0, 0])),
    node(`${tag}_lower_limb`, 'capsule', { radius: 0.072, length: 0.22, capSegments: 10, radialSegments: 20 }, lowerMat, tr([x, 0.14, z + (isFront ? 0.05 : -0.05)], [0, 0, 0])),
    node(`${tag}_paw`, 'sphere', { radius: 0.105, widthSegments: 24, heightSegments: 18 }, pawMat, tr([x, 0.058, z + (isFront ? 0.09 : -0.09)], [0, 0, 0], [1.0, 0.55, 1.3]))
  ];
}

function buildTails(count, pal, origin = [0, 1.02, -1.42]) {
  if (count <= 0) return [];
  const nodes = [];
  const arcStart = -1.32;
  const arcEnd = 1.32;
  const span = arcEnd - arcStart;
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const azimuth = arcStart + span * t;
    const crown = 0.30 + 0.26 * Math.abs(Math.cos(Math.PI * t));
    const lengthScale = 0.94 + 0.10 * Math.sin(Math.PI * t);
    const dirX = Math.sin(azimuth);
    const dirZ = -Math.cos(azimuth);
    const tailIndex = i + 1;
    const basePos = [origin[0] + dirX * 0.18, origin[1] + 0.05 * Math.abs(Math.cos(Math.PI * t)), origin[2] + dirZ * 0.18];
    const baseRot = [
      -0.62 + crown * 0.55,
      0,
      -azimuth * 0.85
    ];
    nodes.push(node(`tail_${tailIndex}_base`, 'capsule', { radius: 0.105, length: 0.62, capSegments: 14, radialSegments: 26 }, organicMat(pal.coat, { sheen: 0.92 }), tr(basePos, baseRot, [1, 1, lengthScale])));
    const midOffset = 0.40;
    nodes.push(node(`tail_${tailIndex}_plume`, 'sphere', { radius: 0.215, widthSegments: 34, heightSegments: 24 }, organicMat(pal.coat, { sheen: 0.95 }), tr([
      basePos[0] + dirX * midOffset * 0.9,
      basePos[1] + 0.30 + crown * 0.20,
      basePos[2] + dirZ * midOffset * 0.9
    ], baseRot, [0.92, 1.18, 1.0])));
    nodes.push(node(`tail_${tailIndex}_tip`, 'cone', { radius: 0.135, height: 0.42, radialSegments: 24 }, organicMat(pal.counter, { roughness: 0.66, sheen: 0.95 }), tr([
      basePos[0] + dirX * midOffset * 1.75,
      basePos[1] + 0.44 + crown * 0.32,
      basePos[2] + dirZ * midOffset * 1.75
    ], [baseRot[0] + 0.35, 0, baseRot[2]])));
  }
  return nodes;
}


function isQuadrupedCreaturePrompt(prompt) {
  const text = String(prompt || '');
  const creatureWords = /\b(creature|fox|kitsune|kurama|wolf|hound|dog|cat|tiger|lion|leopard|panther|horse|stag|deer|bear|quadruped|quadriped|nine[-\s]?tailed|multi[-\s]?tailed|beast|animal)\b/i;
  const quadrupedWords = /\b(quadruped|quadriped|four[-\s]?legged|four[-\s]?legs|standing pose|neutral standing)\b/i;
  return creatureWords.test(text) || (quadrupedWords.test(text) && parseTailCount(text) > 0);
}

const EXACT_FOOTPRINT_GEOMS = new Set(['box', 'roundedBox', 'plane', 'cylinder', 'cone', 'tetrahedron', 'octahedron']);

function halfExtentY(nodeSpec) {
  const params = nodeSpec.geometry.params || {};
  const scaleY = nodeSpec.transform.scale[1] || 1;
  const type = nodeSpec.geometry.type;
  if (EXACT_FOOTPRINT_GEOMS.has(type)) {
    if (typeof params.height === 'number') return (params.height / 2) * scaleY;
    if (typeof params.depth === 'number') return (params.depth / 2) * scaleY;
    return scaleY;
  }
  const radius = typeof params.radius === 'number' ? params.radius : 1;
  return radius * 1.05 * scaleY;
}

function groundNodes(nodes) {
  let minY = Infinity;
  const candidate = nodes.filter((n) => n.geometry.type !== 'plane');
  for (const n of candidate) {
    const bottom = n.transform.position[1] - halfExtentY(n);
    if (bottom < minY) minY = bottom;
  }
  if (!Number.isFinite(minY) || Math.abs(minY) < 1e-4) return nodes;
  for (const n of candidate) {
    n.transform.position[1] = Number((n.transform.position[1] - minY).toFixed(5));
  }
  return nodes;
}

function synthesizeQuadrupedCreatureSpec(safeName, prompt, targetPolycount = 48000) {
  const pal = furPalette(prompt);
  const tailCount = parseTailCount(prompt);
  const turnaroundText = String(prompt || '');
  const turnaround = {
    enabled: /\b(turnaround|orthographic|front view|side view|back view|top view|reference sheet)\b/i.test(turnaroundText),
    views: ['front', 'side', 'back', 'top'],
    aspectRatio: '16:9',
    background: /\blight gray\b/i.test(turnaroundText) ? '#d4d4d8' : '#e5e7eb',
    flatStudioLighting: /\bflat neutral studio lighting\b/i.test(turnaroundText),
    noShadows: /\bno shadows\b/i.test(turnaroundText)
  };

  const nodes = [
    ...buildTorso(pal),
    ...buildHead(pal),
    ...buildLeg('l', true, pal),
    ...buildLeg('r', true, pal),
    ...buildLeg('l', false, pal),
    ...buildLeg('r', false, pal),
    ...buildTails(tailCount, pal)
  ];

  groundNodes(nodes);

  return {
    name: safeName || 'QuadrupedCreature',
    archetype: 'game-creature',
    target_polycount: Math.max(targetPolycount, 24000),
    turnaround,
    camera: { position: [0, 1.7, 5.4], fov: 34, target: [0, 0.95, 0] },
    lights: turnaround.flatStudioLighting
      ? [
          { type: 'ambient', color: '#ffffff', intensity: 1.35 },
          { type: 'directional', color: '#ffffff', intensity: 1.6, position: [0, 6, 2] }
        ]
      : [
          { type: 'ambient', color: '#ffffff', intensity: 0.7 },
          { type: 'directional', color: '#fef3c7', intensity: 2.6, position: [3, 5, 4] },
          { type: 'directional', color: '#93c5fd', intensity: 1.2, position: [-3, 3, -2] }
        ],
    style: { bevel: 0.006, flatShading: false },
    tail_count: tailCount,
    palette: pal,
    nodes
  };
}

module.exports = {
  groundNodes,
  parseTailCount,
  parseRequestedCount,
  furPalette,
  isQuadrupedCreaturePrompt,
  synthesizeQuadrupedCreatureSpec
};
