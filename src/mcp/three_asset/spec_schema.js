'use strict';

/**
 * 3D Scene Specification Schema & Validation Engine.
 * Supports PBR materials, procedural geometry, CSG hierarchies, and 16 domain archetypes.
 * Backed by enterprise realistic templates from part_library.js.
 */

const { ENTERPRISE_TEMPLATES } = require('./part_library');

function clamp(val, min, max, fallback) {
  const num = Number(val);
  if (Number.isNaN(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

function normalizeVector3(arr, fallback = [0, 0, 0]) {
  if (!Array.isArray(arr) || arr.length < 3) return fallback;
  return [Number(arr[0]) || 0, Number(arr[1]) || 0, Number(arr[2]) || 0];
}

function normalizeColor(val, fallback = '#ffffff') {
  if (typeof val === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(val)) {
    return val;
  }
  if (typeof val === 'number' && val >= 0 && val <= 0xffffff) {
    return '#' + val.toString(16).padStart(6, '0');
  }
  return fallback;
}

function validateNode(node, index, depth = 0) {
  if (!node || typeof node !== 'object') {
    throw new Error(`Node at index ${index} must be an object`);
  }

  if (node.csg && typeof node.csg === 'object') {
    if (depth >= 3) {
      throw new Error(`CSG nesting depth exceeded limit 3 at node ${index}`);
    }
    const rawOp = String(node.csg.op || 'union').toLowerCase();
    const op = ['union', 'subtract', 'intersect', 'group'].includes(rawOp) ? rawOp : 'union';
    const rawOperands = Array.isArray(node.csg.operands) ? node.csg.operands : [];
    const operands = rawOperands.map((opNode, opIdx) => validateNode(opNode, opIdx, depth + 1));
    if (op === 'intersect' && operands.length > 2) {
      operands.length = 2;
    }
    return {
      name: String(node.name || `csg_${op}_${index}`),
      csg: { op, operands }
    };
  }

  const validGeoms = [
    'box', 'roundedBox', 'sphere', 'cylinder', 'cone', 'torus', 'knot', 'capsule',
    'plane', 'dodecahedron', 'icosahedron', 'octahedron', 'tetrahedron',
    'lathe', 'tube', 'extrude'
  ];
  const rawType = String((node.geometry && node.geometry.type) || 'box');
  const normalizedType = rawType === 'rounded_box' || rawType === 'roundedbox' ? 'roundedBox' : rawType;
  const geomType = validGeoms.includes(normalizedType) ? normalizedType : 'box';
  const rawParams = (node.geometry && node.geometry.params) || {};

  const cleanParams = {};
  for (const [k, v] of Object.entries(rawParams)) {
    if (typeof v === 'number' && !Number.isNaN(v)) {
      cleanParams[k] = v;
    } else if (Array.isArray(v)) {
      cleanParams[k] = v;
    }
  }

  const rawMat = node.material || {};
  const validMatTypes = ['standard', 'physical', 'phong', 'basic', 'lambert'];
  const matType = validMatTypes.includes(rawMat.type) ? rawMat.type : 'physical';

  const cleanMat = {
    type: matType,
    color: normalizeColor(rawMat.color, '#cbd5e1'),
    roughness: clamp(rawMat.roughness, 0, 1, 0.35),
    metalness: clamp(rawMat.metalness, 0, 1, 0.5),
    clearcoat: clamp(rawMat.clearcoat, 0, 1, 0.2),
    clearcoatRoughness: clamp(rawMat.clearcoatRoughness, 0, 1, 0.1),
    transmission: clamp(rawMat.transmission, 0, 1, 0),
    ior: clamp(rawMat.ior, 1, 2.4, 1.5),
    sheen: clamp(rawMat.sheen, 0, 1, 0),
    sheenRoughness: clamp(rawMat.sheenRoughness, 0, 1, 0.5),
    subsurface: clamp(rawMat.subsurface, 0, 1, 0),
    wireframe: Boolean(rawMat.wireframe)
  };

  if (rawMat.sheenColor) {
    cleanMat.sheenColor = normalizeColor(rawMat.sheenColor, '#ffffff');
  }

  if (rawMat.emissive) {
    cleanMat.emissive = normalizeColor(rawMat.emissive, '#000000');
    cleanMat.emissiveIntensity = clamp(rawMat.emissiveIntensity, 0, 10, 1.0);
  }

  const rawTrans = node.transform || {};
  const cleanTrans = {
    position: normalizeVector3(rawTrans.position, [0, 0, 0]),
    rotation: normalizeVector3(rawTrans.rotation, [0, 0, 0]),
    scale: normalizeVector3(rawTrans.scale, [1, 1, 1])
  };

  const cleanNode = {
    name: String(node.name || `node_${index}`),
    geometry: { type: geomType, params: cleanParams },
    material: cleanMat,
    transform: cleanTrans
  };

  const part = normalizePart(node.part, geomType, cleanTrans, cleanParams);
  if (part) {
    cleanNode.part = part;
    cleanNode.geometry.type = part.primitive;
    cleanNode.geometry.params = { size: part.size.slice(), ...cleanParams };
    cleanNode.transform.position = part.position.slice();
    if (part.modifiers.bevel !== null && part.modifiers.bevel !== undefined) {
      cleanNode.geometry.params.bevel = part.modifiers.bevel;
    }
  }
  return cleanNode;
}

const PART_PRIMITIVES = ['box', 'roundedBox', 'sphere', 'capsule', 'cylinder', 'cone', 'torus', 'metaball'];
const PART_MODIFIER_OPS = ['union', 'subtract', 'intersect'];

function normalizePart(rawPart, fallbackPrimitive, transform, params) {
  if (!rawPart || typeof rawPart !== 'object') return null;
  const primitive = PART_PRIMITIVES.includes(String(rawPart.primitive || ''))
    ? String(rawPart.primitive)
    : 'box';
  const rawSize = Array.isArray(rawPart.size) ? rawPart.size : params.size || [1, 1, 1];
  const size = [
    Math.max(0.001, Number(rawSize[0]) || 1),
    Math.max(0.001, Number(rawSize[1]) || 1),
    Math.max(0.001, Number(rawSize[2]) || 1)
  ];
  const position = Array.isArray(rawPart.position)
    ? normalizeVector3(rawPart.position, transform.position)
    : transform.position.slice();
  const rawMods = rawPart.modifiers && typeof rawPart.modifiers === 'object' ? rawPart.modifiers : {};
  const modifiers = {
    subsurf: clamp(rawMods.subsurf, 0, 3, null),
    bevel: clamp(rawMods.bevel, 0, 1, null),
    mirror_x: Boolean(rawMods.mirror_x ?? rawPart.mirror),
    boolean_op: PART_MODIFIER_OPS.includes(rawMods.boolean_op) ? rawMods.boolean_op : null,
    boolean_target: rawMods.boolean_target ? String(rawMods.boolean_target) : null
  };
  return {
    primitive: primitive || fallbackPrimitive,
    size,
    position,
    parent: rawPart.parent ? String(rawPart.parent) : null,
    mirror: Boolean(rawPart.mirror || modifiers.mirror_x),
    modifiers
  };
}

function validateSceneSpec(rawSpec) {
  if (!rawSpec || typeof rawSpec !== 'object') {
    throw new Error('Scene specification must be a non-null object');
  }

  const name = String(rawSpec.name || 'HeroModel').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 64);
  const archetype = String(rawSpec.archetype || 'application').toLowerCase();
  const targetPolycount = clamp(rawSpec.target_polycount, 500, 200000, 12000);

  if (!Array.isArray(rawSpec.nodes) || rawSpec.nodes.length === 0) {
    throw new Error('Scene specification must contain a non-empty nodes array');
  }

  const nodes = rawSpec.nodes.map((n, i) => validateNode(n, i, 0));
  const parts = flattenParts(nodes);
  const nodeNames = new Set(nodes.map((n) => n.name));
  for (const part of parts) {
    if (part.parent && !nodeNames.has(part.parent)) part.parent = null;
  }

  const rawCam = rawSpec.camera || {};
  const camera = {
    position: normalizeVector3(rawCam.position, [0, 1.5, 3.5]),
    fov: clamp(rawCam.fov, 10, 120, 45),
    target: normalizeVector3(rawCam.target, [0, 0.8, 0])
  };

  const rawLights = Array.isArray(rawSpec.lights) && rawSpec.lights.length > 0
    ? rawSpec.lights.map(l => ({
        type: ['ambient', 'directional', 'point'].includes(l.type) ? l.type : 'directional',
        color: normalizeColor(l.color, '#ffffff'),
        intensity: clamp(l.intensity, 0, 10, 1.5),
        position: normalizeVector3(l.position, [2, 4, 3])
      }))
    : createStudioLights();

  const rawStyle = rawSpec.style && typeof rawSpec.style === 'object' ? rawSpec.style : {};
  const style = {
    bevel: typeof rawStyle.bevel === 'number' ? rawStyle.bevel : 0.025,
    flatShading: Boolean(rawStyle.flatShading)
  };

  return {
    name,
    archetype,
    target_polycount: targetPolycount,
    camera,
    lights: rawLights,
    style,
    turnaround: parseTurnaroundIntent(rawSpec.__prompt || '', rawSpec.turnaround),
    nodes,
    parts: parts.map((p) => ({ ...p, parent: p.parent || null })),
    labels: Array.isArray(rawSpec.labels) ? rawSpec.labels.map(String).slice(0, 12) : extractLabelText(rawSpec.__prompt || ''),
    output_size: rawSpec.output_size && typeof rawSpec.output_size === 'object' ? rawSpec.output_size : undefined
  };
}

function flattenParts(nodes, out = []) {
  for (const node of nodes) {
    if (node.csg && Array.isArray(node.csg.operands)) {
      flattenParts(node.csg.operands, out);
      continue;
    }
    if (node.part) out.push({ ...node.part, name: node.name, modifiers: { ...node.part.modifiers } });
  }
  return out;
}

function createStudioLights(ambient = 0.85, dir = 2.2, point = 1.4, pointColor = '#38bdf8') {
  return [
    { type: 'ambient', color: '#ffffff', intensity: ambient },
    { type: 'directional', color: '#fef08a', intensity: dir, position: [3, 5, 4] },
    { type: 'point', color: pointColor, intensity: point, position: [-2, 2, -2] }
  ];
}

function createCamera(pos = [0, 1.4, 4.0], fov = 40, target = [0, 1.0, 0]) {
  return { position: pos, fov, target };
}

function templateSpec(archetypeKey, name, defaultPoly = 12000) {
  const nodes = ENTERPRISE_TEMPLATES[archetypeKey] || ENTERPRISE_TEMPLATES['application'];
  return {
    name: name || `Enterprise${archetypeKey.replace(/[^a-zA-Z0-9]/g, '')}`,
    archetype: archetypeKey,
    target_polycount: defaultPoly,
    camera: createCamera([0, 1.5, 4.0], 40, [0, 0.8, 0]),
    lights: createStudioLights(),
    style: { bevel: 0.025, flatShading: false },
    nodes: JSON.parse(JSON.stringify(nodes))
  };
}

function createGameCharacterSpec(name) { return templateSpec('game-character', name || 'HeroCharacter', 16000); }
function createGamePropSpec(name) { return templateSpec('game-prop', name || 'TacticalCase', 8000); }
function createGameWeaponSpec(name) { return templateSpec('game-weapon', name || 'EnergySword', 9000); }
function createGameVehicleSpec(name) { return templateSpec('game-vehicle', name || 'HyperionRacer', 18000); }
function createGameEnvironmentSpec(name) { return templateSpec('game-environment', name || 'ZenithDiorama', 20000); }
function createGameTilesetSpec(name) { return templateSpec('game-tileset', name || 'ModularCityTile', 10000); }
function createGameCreatureSpec(name) { return templateSpec('game-creature', name || 'CyberMechBeast', 14000); }
function createGameBuildingSpec(name) { return templateSpec('game-building', name || 'CitadelTower', 18000); }
function createCommerceSpec(name) { return templateSpec('commerce', name || 'CommerceHeroPedestal', 9000); }
function createDashboardSpec(name) { return templateSpec('dashboard', name || 'TelemetryMonitor', 8000); }
function createPortfolioSpec(name) { return templateSpec('portfolio', name || 'SculptureStudio', 8500); }
function createSaasSpec(name) { return templateSpec('saas', name || 'CloudChassis', 9500); }
function createLandingSpec(name) { return templateSpec('landing', name || 'LandingHeroMonolith', 10000); }
function createApplicationSpec(name) { return templateSpec('application', name || 'AppFeatureModel', 9000); }
function createLogisticsSpec(name) { return templateSpec('logistics', name || 'LogisticsPalletCluster', 8500); }
function createVehicleSpec(name) { return templateSpec('vehicle', name || 'TitanCruiser', 16000); }

const ARCHETYPE_BUILDERS = {
  'game-character': createGameCharacterSpec,
  'game-prop': createGamePropSpec,
  'game-weapon': createGameWeaponSpec,
  'game-vehicle': createGameVehicleSpec,
  'game-environment': createGameEnvironmentSpec,
  'game-tileset': createGameTilesetSpec,
  'game-creature': createGameCreatureSpec,
  'game-building': createGameBuildingSpec,
  'logistics': createLogisticsSpec,
  'vehicle': createVehicleSpec,
  'commerce': createCommerceSpec,
  'dashboard': createDashboardSpec,
  'portfolio': createPortfolioSpec,
  'saas': createSaasSpec,
  'landing': createLandingSpec,
  'application': createApplicationSpec
};

const CREATURE_PATTERN = /\b(creature|dragon|beast|monster|dinosaur|fox|kitsune|kurama|wolf|hound|dog|cat|tiger|lion|leopard|panther|horse|stag|deer|bear|quadruped|quadriped|nine[\s-]?tailed|multi[\s-]?tailed|tailed|animal|fauna|wildlife|mount|serpent|griffin|phoenix|unicorn|rabbit|hare|panther|jaguar|lynx|otter|badger|boar)\b/i;
const CREATURE_STRONG_PATTERN = /\b(creature|dragon|beast|monster|dinosaur|fox|kitsune|kurama|quadruped|quadriped|nine[\s-]?tailed|multi[\s-]?tailed|griffin|phoenix|unicorn|serpent|wolf|tiger|lion|bear|horse|deer|stag)\b/i;
const HUMANOID_PATTERN = /\b(character|warrior|robot|hero(?!\s*(section|banner))|avatar|soldier|humanoid|knight|ninja|shinobi|mech pilot|samurai|android|cyborg)\b/i;
const TURNAROUND_PATTERN = /\b(turnaround|orthographic|front view|side view|back view|top view|blueprint|reference sheet|model sheet)\b/i;

const LABEL_KEYWORDS_SRC = 'brand|merk|merek|marque|marca|maker|label|logo|wordmark|nameplate|imprint|decal|text';
const LABEL_KEYWORD_PATTERN = new RegExp(`\\b(${LABEL_KEYWORDS_SRC})\\b`, 'i');
const QUOTED_TEXT_PATTERN = /"[^"\n]{1,48}"|\u201c[^\u201d\n]{1,48}\u201d|\u00ab[^\u00bb\n]{1,48}\u00bb|(?<=(?:^|[\s(,]))'[^'\n]{1,48}'(?=$|[\s,.;:)!])/g;
const LABEL_CLAUSE_PATTERN = new RegExp(
  '(?:\\b(?:with|by|from|under|bermerek|dengan)\\s+)?\\b(?:' + LABEL_KEYWORDS_SRC + ')\\b\\s*(?:is|:|=|called|says|reads|named|of|with|saying|that\\s+says|on)?\\s*'
  + '(?:"([^"\\n]{1,48})"|\u201c([^\u201d\\n]{1,48})\u201d|\u00ab([^\u00bb\\n]{1,48})\u00bb|'
  + '((?:[A-Z][\\w\'\\-]*)(?:\\s+(?:[A-Z][\\w\'\\-]*|[a-z][\\w\'\\-]{1,12}))*))',
  'g'
);

/**
 * Extract surface-text label strings (e.g. a brand like "Yong Ma"). These are
 * texture/decal content only and must never influence shape or archetype routing.
 */
function extractLabelText(text = '') {
  const src = String(text || '');
  const found = new Set();
  for (const match of src.matchAll(QUOTED_TEXT_PATTERN)) {
    const value = String(match[0] || '').trim().replace(/^["'\u201c\u201d\u00ab\u00bb]|["'\u201c\u201d\u00ab\u00bb]$/g, '');
    if (value && value.length <= 48) found.add(value);
  }
  for (const match of src.matchAll(LABEL_CLAUSE_PATTERN)) {
    const value = String((match.slice(1).find((g) => g && g.trim())) || '').trim();
    if (value && value.length <= 48) found.add(value);
  }
  return Array.from(found);
}

/** Remove label/brand text so it cannot affect archetype inference. */
function stripLabelText(text = '') {
  return String(text || '')
    .replace(QUOTED_TEXT_PATTERN, ' ')
    .replace(LABEL_CLAUSE_PATTERN, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const ARCHETYPE_HINTS = [
  ['game-weapon', /\b(sword|gun|weapon|blade|shield|axe|spear|bow|rifle|pistol|katana|dagger)\b/i],
  ['game-vehicle', /\b(car|truck|vehicle|hauler|rover|spaceship|spacecraft|satellite|orbiter|lander|probe|drone|shuttle|hoverbike|hovercraft|aircraft|fighter|ship|plane|jet|tank|motorcycle)\b/i],
  ['game-building', /\b(building|tower|house|citadel|temple|castle|church|skyscraper|bunker|fortress|outpost|gatehouse|pagoda)\b/i],
  ['game-creature', CREATURE_PATTERN],
  ['game-environment', /\b(environment|diorama|landscape|island|forest|valley|terrain scene|canyon)\b/i],
  ['game-tileset', /\b(tileset|tiles|brick)\b/i],
  ['game-prop', /\b(prop|chest|crate|barrel|box|container|potion|keyboard|pen|cup|mug|bottle|vase|lantern|mainframe|terminal|console|kiosk|workstation|generator|reactor|turbine|antenna|dish|helmet|visor|armou?r|gauntlet|appliance|machine|gadget|relay|beacon|rice\s*cooker|ricecooker|cooker|kettle|toaster|blender|mixer|microwave|oven|stove|fridge|refrigerator|washer|dryer|vacuum|iron|coffee\s*maker|espresso|air\s*fryer|fryer|pot|pan|skillet|teapot|thermos|chair|stool|table|desk|sofa|couch|lamp|fan|heater|cooler|speaker|radio|camera|phone|laptop|monitor|watch|clock|backpack|suitcase)\b/i],
  ['commerce', /\b(shop|product|pedestal|ecommerce|store|checkout)\b/i],
  ['dashboard', /\b(dashboard|analytics|screen|monitor|chart|telemetry)\b/i],
  ['saas', /\b(cloud|server|saas|network|infra|kubernetes|cluster)\b/i],
  ['portfolio', /\b(portfolio|gallery|sculpture|showcase)\b/i],
  ['landing', /\b(landing|monolith|beacon|hero section)\b/i],
  ['logistics', /\b(logistics|cargo|warehouse|shipping|pallet)\b/i]
];

function inferArchetypeFromPrompt(prompt = '') {
  const p = stripLabelText(prompt);
  if (CREATURE_STRONG_PATTERN.test(p)) return 'game-creature';
  if (HUMANOID_PATTERN.test(p) && !CREATURE_PATTERN.test(p)) return 'game-character';
  for (const [archetype, pattern] of ARCHETYPE_HINTS) {
    if (pattern.test(p)) return archetype;
  }
  return 'application';
}

function resolveEffectiveArchetype(prompt = '', requestedArchetype = '') {
  const requested = String(requestedArchetype || '').trim().toLowerCase();
  const shapePrompt = stripLabelText(prompt);
  const inferred = inferArchetypeFromPrompt(shapePrompt);
  if (!requested || requested === 'auto' || requested === 'application' || requested === 'detect') {
    return inferred;
  }
  const hasExplicitSubject = CREATURE_STRONG_PATTERN.test(shapePrompt) || ARCHETYPE_HINTS.some(([, pattern]) => pattern.test(shapePrompt));
  if (hasExplicitSubject && inferred !== 'application' && inferred !== requested) {
    return inferred;
  }
  return requested;
}

function parseTurnaroundIntent(prompt = '', rawTurnaround = null) {
  const raw = rawTurnaround && typeof rawTurnaround === 'object' ? rawTurnaround : {};
  const text = String(prompt || '');
  const requestedViews = Array.isArray(raw.views) ? raw.views.map(v => String(v).toLowerCase()) : [];
  const promptViews = [];
  if (/front\s*view/i.test(text)) promptViews.push('front');
  if (/side\s*view|right\s*view|left\s*view|profile/i.test(text)) promptViews.push('side');
  if (/back\s*view|rear\s*view/i.test(text)) promptViews.push('back');
  if (/top\s*view|plan\s*view|above/i.test(text)) promptViews.push('top');
  const views = requestedViews.length > 0 ? requestedViews : (promptViews.length > 0 ? promptViews : []);
  const enabled = raw.enabled === true || views.length >= 2 || TURNAROUND_PATTERN.test(stripLabelText(text));
  const finalViews = views.length > 0 ? views : ['front', 'side', 'back', 'top'];
  return {
    enabled,
    views: finalViews,
    aspectRatio: String(raw.aspectRatio || '16:9'),
    background: normalizeColor(raw.background, '#d4d4d8'),
    flatStudioLighting: raw.flatStudioLighting !== undefined ? Boolean(raw.flatStudioLighting) : /flat neutral studio lighting|no shadows|flat lighting/i.test(text),
    noShadows: raw.noShadows !== undefined ? Boolean(raw.noShadows) : /no shadows|shadowless/i.test(text)
  };
}

function customizeSpecFromPrompt(baseSpec, prompt = '') {
  if (!baseSpec) return baseSpec;
  const spec = JSON.parse(JSON.stringify(baseSpec));
  const p = prompt.toLowerCase();

  let primaryColor = null;
  let neonColor = null;

  if (p.includes('crimson') || p.includes('red') || p.includes('ruby')) primaryColor = '#dc2626';
  else if (p.includes('azure') || p.includes('blue') || p.includes('sapphire')) primaryColor = '#2563eb';
  else if (p.includes('emerald') || p.includes('green') || p.includes('jade')) primaryColor = '#059669';
  else if (p.includes('gold') || p.includes('yellow') || p.includes('amber')) primaryColor = '#d97706';
  else if (p.includes('purple') || p.includes('violet') || p.includes('amethyst')) primaryColor = '#7c3aed';
  else if (p.includes('obsidian') || p.includes('black') || p.includes('charcoal')) primaryColor = '#0f172a';
  else if (p.includes('platinum') || p.includes('white') || p.includes('silver')) primaryColor = '#f8fafc';

  if (p.includes('cyan') || p.includes('neon') || p.includes('electric') || p.includes('glow')) neonColor = '#06b6d4';
  else if (p.includes('laser') || p.includes('plasma')) neonColor = '#ec4899';

  if (primaryColor) {
    for (const node of spec.nodes) {
      if (node.material && (node.name.includes('body') || node.name.includes('torso') || node.name.includes('blade') || node.name.includes('hero') || node.name.includes('core'))) {
        node.material.color = primaryColor;
      }
    }
  }

  if (neonColor) {
    for (const node of spec.nodes) {
      if (node.material && (node.name.includes('visor') || node.name.includes('gem') || node.name.includes('beacon') || node.name.includes('ring') || node.name.includes('headlight'))) {
        node.material.emissive = neonColor;
        node.material.emissiveIntensity = 2.5;
      }
    }
  }

  return spec;
}

function createDefaultSceneSpec(archetype = 'application', name = 'HeroModel', targetPolycount = null) {
  const norm = (archetype || 'application').toLowerCase();
  const builder = ARCHETYPE_BUILDERS[norm] || createApplicationSpec;
  const spec = builder(name);
  const budget = Number(targetPolycount);
  if (Number.isFinite(budget) && budget > 0) spec.target_polycount = budget;
  return spec;
}

const ARCHETYPES = Object.freeze(['auto', ...Object.keys(ARCHETYPE_BUILDERS).sort()]);

module.exports = {
  ARCHETYPES,
  LABEL_KEYWORD_PATTERN,
  validateSceneSpec,
  validateNode,
  createDefaultSceneSpec,
  inferArchetypeFromPrompt,
  resolveEffectiveArchetype,
  extractLabelText,
  stripLabelText,
  normalizePart,
  flattenParts,
  PART_PRIMITIVES,
  parseTurnaroundIntent,
  customizeSpecFromPrompt,
  clamp,
  normalizeVector3,
  normalizeColor,
  createGameCharacterSpec,
  createGamePropSpec,
  createGameWeaponSpec,
  createGameVehicleSpec,
  createGameEnvironmentSpec,
  createGameTilesetSpec,
  createGameCreatureSpec,
  createGameBuildingSpec,
  createCommerceSpec,
  createDashboardSpec,
  createPortfolioSpec,
  createSaasSpec,
  createLandingSpec,
  createApplicationSpec,
  createLogisticsSpec,
  createVehicleSpec
};
