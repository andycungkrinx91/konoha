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
    'box', 'sphere', 'cylinder', 'cone', 'torus', 'knot', 'capsule',
    'plane', 'dodecahedron', 'icosahedron', 'octahedron', 'tetrahedron',
    'lathe', 'tube'
  ];
  const rawType = (node.geometry && node.geometry.type) || 'box';
  const geomType = validGeoms.includes(rawType) ? rawType : 'box';
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
    wireframe: Boolean(rawMat.wireframe)
  };

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

  return {
    name: String(node.name || `node_${index}`),
    geometry: { type: geomType, params: cleanParams },
    material: cleanMat,
    transform: cleanTrans
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
    nodes
  };
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

function inferArchetypeFromPrompt(prompt = '') {
  const p = prompt.toLowerCase();
  if (p.includes('character') || p.includes('warrior') || p.includes('robot') || p.includes('hero') || p.includes('avatar') || p.includes('soldier')) return 'game-character';
  if (p.includes('sword') || p.includes('gun') || p.includes('weapon') || p.includes('blade') || p.includes('shield')) return 'game-weapon';
  if (p.includes('car') || p.includes('truck') || p.includes('vehicle') || p.includes('hauler') || p.includes('rover') || p.includes('spaceship')) return 'game-vehicle';
  if (p.includes('building') || p.includes('tower') || p.includes('house') || p.includes('citadel') || p.includes('temple')) return 'game-building';
  if (p.includes('creature') || p.includes('dragon') || p.includes('beast') || p.includes('monster') || p.includes('dinosaur')) return 'game-creature';
  if (p.includes('environment') || p.includes('diorama') || p.includes('landscape') || p.includes('island') || p.includes('forest')) return 'game-environment';
  if (p.includes('tile') || p.includes('terrain') || p.includes('floor') || p.includes('ground') || p.includes('brick')) return 'game-tileset';
  if (p.includes('prop') || p.includes('chest') || p.includes('crate') || p.includes('barrel') || p.includes('box') || p.includes('container')) return 'game-prop';
  if (p.includes('shop') || p.includes('product') || p.includes('pedestal') || p.includes('ecommerce') || p.includes('store')) return 'commerce';
  if (p.includes('dashboard') || p.includes('analytics') || p.includes('screen') || p.includes('monitor') || p.includes('chart')) return 'dashboard';
  if (p.includes('cloud') || p.includes('server') || p.includes('saas') || p.includes('network') || p.includes('infra')) return 'saas';
  if (p.includes('portfolio') || p.includes('art') || p.includes('gallery') || p.includes('sculpture')) return 'portfolio';
  if (p.includes('landing') || p.includes('monolith') || p.includes('beacon') || p.includes('hero')) return 'landing';
  if (p.includes('logistics') || p.includes('cargo') || p.includes('warehouse') || p.includes('shipping')) return 'logistics';
  return 'application';
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

function createDefaultSceneSpec(archetype = 'application', name = 'HeroModel') {
  const norm = (archetype || 'application').toLowerCase();
  const builder = ARCHETYPE_BUILDERS[norm] || createApplicationSpec;
  return builder(name);
}

const ARCHETYPES = Object.freeze(Object.keys(ARCHETYPE_BUILDERS).sort());

module.exports = {
  ARCHETYPES,
  validateSceneSpec,
  validateNode,
  createDefaultSceneSpec,
  inferArchetypeFromPrompt,
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
