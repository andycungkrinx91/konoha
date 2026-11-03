'use strict';

/**
 * Autonomous Prompt-to-3D Scene Specification Synthesizer.
 * Analyzes natural language concepts to extract color, material finish,
 * and semantic components to build high-fidelity production 3D scenes.
 */

const COLOR_MAP = [
  { match: /\b(red|crimson|ruby|scarlet)\b/i, hex: '#dc2626', accent: '#fca5a5', emissive: '#ef4444' },
  { match: /\b(blue|azure|sapphire|cobalt|navy)\b/i, hex: '#2563eb', accent: '#93c5fd', emissive: '#3b82f6' },
  { match: /\b(green|emerald|jade|forest|olive)\b/i, hex: '#16a34a', accent: '#86efac', emissive: '#22c55e' },
  { match: /\b(yellow|amber)\b/i, hex: '#eab308', accent: '#fef08a', emissive: '#facc15' },
  { match: /\b(gold|golden)\b/i, hex: '#fbbf24', accent: '#fef08a', emissive: '#f59e0b', metalness: 0.95, roughness: 0.18 },
  { match: /\b(silver|chrome)\b/i, hex: '#e2e8f0', accent: '#ffffff', emissive: null, metalness: 0.95, roughness: 0.12 },
  { match: /\b(purple|violet|amethyst)\b/i, hex: '#9333ea', accent: '#d8b4fe', emissive: '#a855f7' },
  { match: /\b(cyan|neon|neon-blue|aqua|turquoise)\b/i, hex: '#06b6d4', accent: '#a5f3fc', emissive: '#00f0ff' },
  { match: /\b(orange|coral|tangerine)\b/i, hex: '#ea580c', accent: '#fdba74', emissive: '#f97316' },
  { match: /\b(pink|magenta|rose)\b/i, hex: '#db2777', accent: '#f9a8d4', emissive: '#ec4899' },
  { match: /\b(black|dark|stealth|obsidian|shadow)\b/i, hex: '#18181b', accent: '#3f3f46', emissive: null, metalness: 0.7, roughness: 0.3 },
  { match: /\b(white|pearl|ivory|snow)\b/i, hex: '#f8fafc', accent: '#e2e8f0', emissive: null, metalness: 0.1, roughness: 0.2 }
];

function extractPalette(prompt, defaultHex = '#6366f1') {
  if (!prompt || typeof prompt !== 'string') {
    return { primary: defaultHex, accent: '#94a3b8', emissive: '#38bdf8', metalness: 0.5, roughness: 0.3 };
  }
  for (const entry of COLOR_MAP) {
    if (entry.match.test(prompt)) {
      return {
        primary: entry.hex,
        accent: entry.accent,
        emissive: entry.emissive || '#38bdf8',
        metalness: entry.metalness !== undefined ? entry.metalness : 0.6,
        roughness: entry.roughness !== undefined ? entry.roughness : 0.25
      };
    }
  }
  return { primary: defaultHex, accent: '#94a3b8', emissive: '#38bdf8', metalness: 0.5, roughness: 0.3 };
}

function synthesizePenSpec(name, palette, polycount) {
  return {
    name: name || 'PrecisionBallpointPen',
    archetype: 'application',
    target_polycount: polycount || 9000,
    camera: { position: [0, 1.2, 2.5], fov: 38, target: [0, 0, 0] },
    lights: [
      { type: 'ambient', color: '#ffffff', intensity: 0.8 },
      { type: 'directional', color: '#fef08a', intensity: 2.4, position: [3, 4, 3] },
      { type: 'point', color: palette.accent, intensity: 1.2, position: [-2, 2, -2] }
    ],
    nodes: [
      // Main Pen Barrel with luxury lacquer clearcoat in user-requested color
      {
        name: 'pen_barrel_main',
        geometry: { type: 'cylinder', params: { radiusTop: 0.048, radiusBottom: 0.052, height: 1.1, radialSegments: 32 } },
        material: { type: 'physical', color: palette.primary, roughness: palette.roughness, metalness: palette.metalness, clearcoat: 0.95, clearcoatRoughness: 0.1 },
        transform: { position: [0, 0.15, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
      },
      // Upper Barrel / Cap Section
      {
        name: 'pen_upper_body',
        geometry: { type: 'cylinder', params: { radiusTop: 0.052, radiusBottom: 0.052, height: 0.55, radialSegments: 32 } },
        material: { type: 'physical', color: palette.primary, roughness: palette.roughness, metalness: palette.metalness, clearcoat: 0.95 },
        transform: { position: [0, 0.82, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
      },
      // Center Decorative Trim Ring (Chrome/Gold)
      {
        name: 'center_trim_ring',
        geometry: { type: 'cylinder', params: { radiusTop: 0.055, radiusBottom: 0.055, height: 0.035, radialSegments: 32 } },
        material: { type: 'physical', color: '#f1f5f9', roughness: 0.1, metalness: 0.98, clearcoat: 0.8 },
        transform: { position: [0, 0.55, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
      },
      // Lower Ergonomic Grip Section
      {
        name: 'ergonomic_grip',
        geometry: { type: 'cylinder', params: { radiusTop: 0.05, radiusBottom: 0.042, height: 0.35, radialSegments: 32 } },
        material: { type: 'physical', color: '#18181b', roughness: 0.65, metalness: 0.15 },
        transform: { position: [0, -0.45, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
      },
      // Tapered Front Cone
      {
        name: 'front_taper_cone',
        geometry: { type: 'cylinder', params: { radiusTop: 0.042, radiusBottom: 0.018, height: 0.22, radialSegments: 32 } },
        material: { type: 'physical', color: '#f1f5f9', roughness: 0.12, metalness: 0.95 },
        transform: { position: [0, -0.72, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
      },
      // Ballpoint Nib Tip
      {
        name: 'ballpoint_nib',
        geometry: { type: 'sphere', params: { radius: 0.012, widthSegments: 16, heightSegments: 16 } },
        material: { type: 'physical', color: '#cbd5e1', roughness: 0.05, metalness: 0.98 },
        transform: { position: [0, -0.835, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
      },
      // Chrome Pocket Clip
      {
        name: 'pocket_clip_stem',
        geometry: { type: 'box', params: { width: 0.018, height: 0.55, depth: 0.012 } },
        material: { type: 'physical', color: '#f1f5f9', roughness: 0.1, metalness: 0.95 },
        transform: { position: [0, 0.78, 0.068], rotation: [0, 0, 0], scale: [1, 1, 1] }
      },
      {
        name: 'pocket_clip_ball',
        geometry: { type: 'sphere', params: { radius: 0.018, widthSegments: 16, heightSegments: 16 } },
        material: { type: 'physical', color: '#f1f5f9', roughness: 0.1, metalness: 0.95 },
        transform: { position: [0, 0.52, 0.068], rotation: [0, 0, 0], scale: [1, 1, 1] }
      },
      // Top Plunger / Clicker Button
      {
        name: 'top_clicker_button',
        geometry: { type: 'cylinder', params: { radiusTop: 0.038, radiusBottom: 0.038, height: 0.12, radialSegments: 24 } },
        material: { type: 'physical', color: '#f1f5f9', roughness: 0.12, metalness: 0.95 },
        transform: { position: [0, 1.14, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
      }
    ]
  };
}

function synthesizePotionSpec(name, palette, polycount) {
  return {
    name: name || 'AlchemicalPotionFlask',
    archetype: 'game-prop',
    target_polycount: polycount || 8500,
    camera: { position: [0, 1.2, 2.8], fov: 40, target: [0, 0.4, 0] },
    lights: [
      { type: 'ambient', color: '#ffffff', intensity: 0.7 },
      { type: 'directional', color: '#ffffff', intensity: 2.0, position: [3, 4, 3] },
      { type: 'point', color: palette.emissive, intensity: 2.5, position: [0, 0.5, 0] }
    ],
    nodes: [
      // Glass Flask Body
      {
        name: 'glass_bulb',
        geometry: { type: 'sphere', params: { radius: 0.65, widthSegments: 32, heightSegments: 32 } },
        material: { type: 'physical', color: '#ffffff', roughness: 0.05, metalness: 0.1, transmission: 0.9, transparent: true, ior: 1.52 },
        transform: { position: [0, 0.65, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
      },
      // Inner Glowing Liquid in user-requested color
      {
        name: 'potion_liquid',
        geometry: { type: 'sphere', params: { radius: 0.58, widthSegments: 32, heightSegments: 32 } },
        material: { type: 'physical', color: palette.primary, roughness: 0.1, metalness: 0.2, transmission: 0.4, emissive: palette.emissive, emissiveIntensity: 3.5, transparent: true, opacity: 0.85 },
        transform: { position: [0, 0.6, 0], rotation: [0, 0, 0], scale: [1, 0.85, 1] }
      },
      // Flask Neck
      {
        name: 'glass_neck',
        geometry: { type: 'cylinder', params: { radiusTop: 0.18, radiusBottom: 0.22, height: 0.55, radialSegments: 24 } },
        material: { type: 'physical', color: '#ffffff', roughness: 0.05, metalness: 0.1, transmission: 0.9, transparent: true, ior: 1.52 },
        transform: { position: [0, 1.35, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
      },
      // Flask Rim Lip
      {
        name: 'glass_rim',
        geometry: { type: 'torus', params: { radius: 0.19, tube: 0.04, radialSegments: 16, tubularSegments: 32 } },
        material: { type: 'physical', color: '#ffffff', roughness: 0.05, metalness: 0.1, transmission: 0.9, transparent: true },
        transform: { position: [0, 1.62, 0], rotation: [1.5708, 0, 0], scale: [1, 1, 1] }
      },
      // Cork Stopper
      {
        name: 'cork_stopper',
        geometry: { type: 'cylinder', params: { radiusTop: 0.19, radiusBottom: 0.16, height: 0.25, radialSegments: 20 } },
        material: { type: 'physical', color: '#78350f', roughness: 0.85, metalness: 0.05 },
        transform: { position: [0, 1.7, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
      }
    ]
  };
}

function synthesizeSwordSpec(name, palette, polycount) {
  return {
    name: name || 'RunicBattleBlade',
    archetype: 'game-weapon',
    target_polycount: polycount || 12000,
    camera: { position: [0, 1.2, 3.2], fov: 38, target: [0, 0.8, 0] },
    lights: [
      { type: 'ambient', color: '#ffffff', intensity: 0.7 },
      { type: 'directional', color: '#fef08a', intensity: 2.2, position: [3, 5, 4] },
      { type: 'point', color: palette.emissive, intensity: 2.0, position: [0, 0.8, 0.2] }
    ],
    nodes: [
      { name: 'pommel', geometry: { type: 'sphere', params: { radius: 0.12, widthSegments: 20, heightSegments: 20 } }, material: { type: 'physical', color: '#94a3b8', roughness: 0.25, metalness: 0.85 }, transform: { position: [0, -0.05, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
      { name: 'grip', geometry: { type: 'cylinder', params: { radiusTop: 0.065, radiusBottom: 0.075, height: 0.58, radialSegments: 20 } }, material: { type: 'physical', color: '#27272a', roughness: 0.75, metalness: 0.2 }, transform: { position: [0, 0.3, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
      { name: 'crossguard', geometry: { type: 'box', params: { width: 0.85, height: 0.12, depth: 0.18 } }, material: { type: 'physical', color: '#475569', roughness: 0.25, metalness: 0.9 }, transform: { position: [0, 0.65, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
      { name: 'rune_core', geometry: { type: 'octahedron', params: { radius: 0.11, detail: 1 } }, material: { type: 'physical', color: palette.primary, roughness: 0.1, metalness: 0.3, emissive: palette.emissive, emissiveIntensity: 3.5 }, transform: { position: [0, 0.65, 0.1], rotation: [0, 0, 0], scale: [1, 1, 1] } },
      { name: 'blade_spine', geometry: { type: 'box', params: { width: 0.18, height: 2.1, depth: 0.06 } }, material: { type: 'physical', color: '#f8fafc', roughness: 0.15, metalness: 0.95, clearcoat: 0.85 }, transform: { position: [0, 1.75, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
      { name: 'fuller_inlay', geometry: { type: 'box', params: { width: 0.04, height: 1.5, depth: 0.07 } }, material: { type: 'physical', color: palette.primary, roughness: 0.15, metalness: 0.5, emissive: palette.emissive, emissiveIntensity: 2.8 }, transform: { position: [0, 1.55, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } }
    ]
  };
}
function synthesizeHoverbikeSpec(name, palette, polycount) {
  return {
    name: name || 'CyberpunkHoverbike',
    archetype: 'vehicle',
    target_polycount: polycount || 14000,
    camera: { position: [3.5, 2.0, 3.5], fov: 40, target: [0, 0.7, 0] },
    lights: [
      { type: 'ambient', color: '#ffffff', intensity: 0.8 },
      { type: 'directional', color: '#fef08a', intensity: 2.2, position: [3, 5, 4] },
      { type: 'point', color: palette.emissive || '#00f0ff', intensity: 2.5, position: [0, 1, 0] }
    ],
    nodes: [
      { name: 'main_fuselage', geometry: { type: 'capsule', params: { radius: 0.35, length: 2.2, capSegments: 12, radialSegments: 24 } }, material: { type: 'physical', color: palette.primary, roughness: 0.25, metalness: 0.85, clearcoat: 0.8 }, transform: { position: [0, 0.65, 0], rotation: [1.5708, 0, 0], scale: [0.85, 1, 0.75] } },
      { name: 'front_cowl', geometry: { type: 'cone', params: { radius: 0.42, height: 0.9, radialSegments: 24 } }, material: { type: 'physical', color: '#18181b', roughness: 0.2, metalness: 0.9, clearcoat: 0.9 }, transform: { position: [0, 0.75, 1.25], rotation: [-1.4, 0, 0], scale: [0.8, 1, 0.7] } },
      { name: 'windscreen', geometry: { type: 'box', params: { width: 0.45, height: 0.35, depth: 0.04 } }, material: { type: 'physical', color: palette.accent || '#06b6d4', roughness: 0.05, metalness: 0.1, transmission: 0.85, transparent: true, ior: 1.52 }, transform: { position: [0, 1.05, 0.9], rotation: [-0.65, 0, 0], scale: [1, 1, 1] } },
      { name: 'cockpit_dash', geometry: { type: 'box', params: { width: 0.28, height: 0.16, depth: 0.08 } }, material: { type: 'physical', color: palette.primary, roughness: 0.1, metalness: 0.2, emissive: palette.emissive || '#00f0ff', emissiveIntensity: 3.5 }, transform: { position: [0, 0.92, 0.75], rotation: [-0.5, 0, 0], scale: [1, 1, 1] } },
      { name: 'saddle_seat', geometry: { type: 'box', params: { width: 0.36, height: 0.12, depth: 0.85 } }, material: { type: 'physical', color: '#27272a', roughness: 0.85, metalness: 0.05 }, transform: { position: [0, 0.82, -0.15], rotation: [-0.08, 0, 0], scale: [1, 1, 1] } },
      { name: 'handlebars', geometry: { type: 'cylinder', params: { radiusTop: 0.025, radiusBottom: 0.025, height: 0.85, radialSegments: 16 } }, material: { type: 'physical', color: '#38bdf8', roughness: 0.3, metalness: 0.8 }, transform: { position: [0, 0.95, 0.65], rotation: [0, 0, 1.5708], scale: [1, 1, 1] } },
      { name: 'repulsor_ring_front_outer', geometry: { type: 'torus', params: { radius: 0.55, tube: 0.06, radialSegments: 24, tubularSegments: 48 } }, material: { type: 'physical', color: '#18181b', roughness: 0.3, metalness: 0.9 }, transform: { position: [0, 0.45, 1.1], rotation: [0, 0, 1.5708], scale: [1, 1, 1] } },
      { name: 'repulsor_emitter_front', geometry: { type: 'cylinder', params: { radiusTop: 0.42, radiusBottom: 0.42, height: 0.14, radialSegments: 32 } }, material: { type: 'physical', color: palette.primary, roughness: 0.1, metalness: 0.2, emissive: palette.emissive || '#00f0ff', emissiveIntensity: 4.0 }, transform: { position: [0, 0.45, 1.1], rotation: [0, 0, 1.5708], scale: [1, 1, 1] } },
      { name: 'repulsor_ring_rear_outer', geometry: { type: 'torus', params: { radius: 0.62, tube: 0.07, radialSegments: 24, tubularSegments: 48 } }, material: { type: 'physical', color: '#18181b', roughness: 0.3, metalness: 0.9 }, transform: { position: [0, 0.48, -1.05], rotation: [0, 0, 1.5708], scale: [1, 1, 1] } },
      { name: 'repulsor_emitter_rear', geometry: { type: 'cylinder', params: { radiusTop: 0.48, radiusBottom: 0.48, height: 0.18, radialSegments: 32 } }, material: { type: 'physical', color: palette.primary, roughness: 0.1, metalness: 0.2, emissive: palette.emissive || '#00f0ff', emissiveIntensity: 4.0 }, transform: { position: [0, 0.48, -1.05], rotation: [0, 0, 1.5708], scale: [1, 1, 1] } },
      { name: 'thruster_pod_left', geometry: { type: 'cylinder', params: { radiusTop: 0.16, radiusBottom: 0.19, height: 0.85, radialSegments: 24 } }, material: { type: 'physical', color: '#27272a', roughness: 0.35, metalness: 0.85 }, transform: { position: [-0.42, 0.65, -0.9], rotation: [1.5708, 0, 0], scale: [1, 1, 1] } },
      { name: 'thruster_nozzle_left', geometry: { type: 'cone', params: { radius: 0.14, height: 0.3, radialSegments: 24 } }, material: { type: 'physical', color: palette.primary, roughness: 0.1, metalness: 0.2, emissive: palette.emissive || '#00f0ff', emissiveIntensity: 5.0 }, transform: { position: [-0.42, 0.65, -1.4], rotation: [-1.5708, 0, 0], scale: [1, 1, 1] } },
      { name: 'thruster_pod_right', geometry: { type: 'cylinder', params: { radiusTop: 0.16, radiusBottom: 0.19, height: 0.85, radialSegments: 24 } }, material: { type: 'physical', color: '#27272a', roughness: 0.35, metalness: 0.85 }, transform: { position: [0.42, 0.65, -0.9], rotation: [1.5708, 0, 0], scale: [1, 1, 1] } },
      { name: 'thruster_nozzle_right', geometry: { type: 'cone', params: { radius: 0.14, height: 0.3, radialSegments: 24 } }, material: { type: 'physical', color: palette.primary, roughness: 0.1, metalness: 0.2, emissive: palette.emissive || '#00f0ff', emissiveIntensity: 5.0 }, transform: { position: [0.42, 0.65, -1.4], rotation: [-1.5708, 0, 0], scale: [1, 1, 1] } },
      { name: 'stabilizer_fin_left', geometry: { type: 'box', params: { width: 0.55, height: 0.04, depth: 0.38 } }, material: { type: 'physical', color: '#09090b', roughness: 0.2, metalness: 0.9, clearcoat: 0.6 }, transform: { position: [-0.58, 0.68, -0.4], rotation: [0, 0, -0.25], scale: [1, 1, 1] } },
      { name: 'stabilizer_fin_right', geometry: { type: 'box', params: { width: 0.55, height: 0.04, depth: 0.38 } }, material: { type: 'physical', color: '#09090b', roughness: 0.2, metalness: 0.9, clearcoat: 0.6 }, transform: { position: [0.58, 0.68, -0.4], rotation: [0, 0, 0.25], scale: [1, 1, 1] } }
    ]
  };
}

function synthesizeTankSpec(name, palette, polycount) {
  return {
    name: name || 'AssaultRailgunTank',
    archetype: 'vehicle',
    target_polycount: polycount || 22000,
    camera: { position: [4.5, 3.0, 4.5], fov: 40, target: [0, 1.0, 0] },
    lights: [
      { type: 'ambient', color: '#ffffff', intensity: 0.8 },
      { type: 'directional', color: '#fef08a', intensity: 2.2, position: [3, 5, 4] },
      { type: 'point', color: palette.emissive || '#00f0ff', intensity: 2.0, position: [0, 2, 0] }
    ],
    nodes: [
      { name: 'lower_chassis', geometry: { type: 'box', params: { width: 2.4, height: 0.65, depth: 4.8 } }, material: { type: 'physical', color: palette.primary, roughness: 0.65, metalness: 0.75 }, transform: { position: [0, 0.65, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
      { name: 'sloped_glacis', geometry: { type: 'box', params: { width: 2.38, height: 0.45, depth: 1.4 } }, material: { type: 'physical', color: '#334155', roughness: 0.5, metalness: 0.8 }, transform: { position: [0, 0.95, 1.8], rotation: [-0.45, 0, 0], scale: [1, 1, 1] } },
      { name: 'reactive_tile_row1', geometry: { type: 'box', params: { width: 2.1, height: 0.12, depth: 0.35 } }, material: { type: 'physical', color: '#475569', roughness: 0.4, metalness: 0.85 }, transform: { position: [0, 1.1, 1.6], rotation: [-0.45, 0, 0], scale: [1, 1, 1] } },
      { name: 'track_belt_left', geometry: { type: 'box', params: { width: 0.55, height: 0.75, depth: 5.0 } }, material: { type: 'physical', color: '#09090b', roughness: 0.85, metalness: 0.3 }, transform: { position: [-1.35, 0.55, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
      { name: 'track_belt_right', geometry: { type: 'box', params: { width: 0.55, height: 0.75, depth: 5.0 } }, material: { type: 'physical', color: '#09090b', roughness: 0.85, metalness: 0.3 }, transform: { position: [1.35, 0.55, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
      { name: 'armor_skirt_left', geometry: { type: 'box', params: { width: 0.12, height: 0.55, depth: 4.8 } }, material: { type: 'physical', color: '#334155', roughness: 0.6, metalness: 0.75 }, transform: { position: [-1.68, 0.75, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
      { name: 'armor_skirt_right', geometry: { type: 'box', params: { width: 0.12, height: 0.55, depth: 4.8 } }, material: { type: 'physical', color: '#334155', roughness: 0.6, metalness: 0.75 }, transform: { position: [1.68, 0.75, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
      { name: 'turret_housing', geometry: { type: 'box', params: { width: 1.85, height: 0.75, depth: 2.4 } }, material: { type: 'physical', color: palette.primary, roughness: 0.4, metalness: 0.85, clearcoat: 0.4 }, transform: { position: [0, 1.5, -0.15], rotation: [0, 0, 0], scale: [1, 1, 1] } },
      { name: 'railgun_barrel_left', geometry: { type: 'box', params: { width: 0.16, height: 0.18, depth: 3.4 } }, material: { type: 'physical', color: '#e2e8f0', roughness: 0.15, metalness: 0.95, clearcoat: 0.7 }, transform: { position: [-0.35, 1.5, 2.8], rotation: [0, 0, 0], scale: [1, 1, 1] } },
      { name: 'railgun_barrel_right', geometry: { type: 'box', params: { width: 0.16, height: 0.18, depth: 3.4 } }, material: { type: 'physical', color: '#e2e8f0', roughness: 0.15, metalness: 0.95, clearcoat: 0.7 }, transform: { position: [0.35, 1.5, 2.8], rotation: [0, 0, 0], scale: [1, 1, 1] } },
      { name: 'mag_coil_l1', geometry: { type: 'torus', params: { radius: 0.18, tube: 0.035, radialSegments: 16, tubularSegments: 32 } }, material: { type: 'physical', color: '#06b6d4', roughness: 0.1, metalness: 0.5, emissive: palette.emissive || '#00f0ff', emissiveIntensity: 3.8 }, transform: { position: [-0.35, 1.5, 2.2], rotation: [0, 0, 0], scale: [1, 1, 1] } },
      { name: 'mag_coil_r1', geometry: { type: 'torus', params: { radius: 0.18, tube: 0.035, radialSegments: 16, tubularSegments: 32 } }, material: { type: 'physical', color: '#06b6d4', roughness: 0.1, metalness: 0.5, emissive: palette.emissive || '#00f0ff', emissiveIntensity: 3.8 }, transform: { position: [0.35, 1.5, 2.2], rotation: [0, 0, 0], scale: [1, 1, 1] } }
    ]
  };
}

function synthesizeKeyboardSpec(name, palette, polycount, prompt) {
  const isRainbow = /rainbow|rgb|backlight|chroma/i.test(prompt || '');
  const rainbowColors = ['#ff1744', '#ff6d00', '#ffea00', '#00e676', '#00e5ff', '#2979ff', '#d500f9'];
  const nodes = [
    // Keyboard main chassis case
    {
      name: 'keyboard_chassis_base',
      geometry: { type: 'box', params: { width: 3.2, height: 0.22, depth: 1.35 } },
      material: { type: 'physical', color: palette.primary || '#f8fafc', roughness: 0.2, metalness: 0.05, clearcoat: 0.25 },
      transform: { position: [0, 0.1, 0], rotation: [0.08, 0, 0], scale: [1, 1, 1] }
    },
    // Aluminum switch mounting plate
    {
      name: 'switch_mounting_plate',
      geometry: { type: 'box', params: { width: 3.05, height: 0.05, depth: 1.2 } },
      material: { type: 'physical', color: '#e2e8f0', roughness: 0.25, metalness: 0.8 },
      transform: { position: [0, 0.22, 0], rotation: [0.08, 0, 0], scale: [1, 1, 1] }
    },
    // Frosted acrylic RGB diffuser base
    {
      name: 'rgb_diffuser_layer',
      geometry: { type: 'box', params: { width: 3.12, height: 0.04, depth: 1.28 } },
      material: { type: 'physical', color: '#ffffff', roughness: 0.15, transmission: 0.8, transparent: true },
      transform: { position: [0, 0.04, 0], rotation: [0.08, 0, 0], scale: [1, 1, 1] }
    }
  ];

  // RGB Backlight LED strips (Rainbow or user-accent glow)
  const segWidth = 3.0 / rainbowColors.length;
  rainbowColors.forEach((color, idx) => {
    const xPos = -1.5 + (idx + 0.5) * segWidth;
    nodes.push({
      name: `rgb_backlight_seg_${idx + 1}`,
      geometry: { type: 'box', params: { width: segWidth * 0.95, height: 0.015, depth: 1.15 } },
      material: {
        type: 'physical',
        color: isRainbow ? color : (palette.emissive || '#38bdf8'),
        roughness: 0.1,
        metalness: 0.1,
        emissive: isRainbow ? color : (palette.emissive || '#38bdf8'),
        emissiveIntensity: 4.0
      },
      transform: { position: [xPos, 0.24, 0], rotation: [0.08, 0, 0], scale: [1, 1, 1] }
    });
  });

  // 5 Rows of Mechanical Keycaps
  const rowConfigs = [
    { z: -0.42, cols: 14, w: 0.17, h: 0.12, d: 0.16 }, // Function / Number row
    { z: -0.21, cols: 14, w: 0.17, h: 0.12, d: 0.16 }, // QWERTY row
    { z: 0.0, cols: 13, w: 0.18, h: 0.12, d: 0.16 },   // ASDF row
    { z: 0.21, cols: 12, w: 0.19, h: 0.12, d: 0.16 }   // ZXCV row
  ];

  rowConfigs.forEach((cfg, rIdx) => {
    const startX = -1.35;
    const stepX = 2.7 / (cfg.cols - 1);
    for (let c = 0; c < cfg.cols; c++) {
      const kx = startX + c * stepX;
      nodes.push({
        name: `keycap_r${rIdx + 1}_${c + 1}`,
        geometry: { type: 'box', params: { width: cfg.w, height: cfg.h, depth: cfg.d } },
        material: { type: 'physical', color: palette.primary || '#f8fafc', roughness: 0.35, metalness: 0.02, clearcoat: 0.15 },
        transform: { position: [kx, 0.28, cfg.z], rotation: [0.08, 0, 0], scale: [1, 1, 1] }
      });
    }
  });

  // Spacebar and Bottom Modifiers Row
  nodes.push({
    name: 'keycap_spacebar',
    geometry: { type: 'box', params: { width: 1.25, height: 0.12, depth: 0.17 } },
    material: { type: 'physical', color: palette.primary || '#f8fafc', roughness: 0.35, metalness: 0.02, clearcoat: 0.2 },
    transform: { position: [0, 0.28, 0.42], rotation: [0.08, 0, 0], scale: [1, 1, 1] }
  });
  [-1.2, -0.9, 0.9, 1.2].forEach((xPos, idx) => {
    nodes.push({
      name: `keycap_mod_${idx + 1}`,
      geometry: { type: 'box', params: { width: 0.22, height: 0.12, depth: 0.17 } },
      material: { type: 'physical', color: palette.primary || '#f8fafc', roughness: 0.35, metalness: 0.02, clearcoat: 0.15 },
      transform: { position: [xPos, 0.28, 0.42], rotation: [0.08, 0, 0], scale: [1, 1, 1] }
    });
  });

  return {
    name: name || 'ComputerKeyboard',
    archetype: 'game-prop',
    target_polycount: polycount || 12000,
    camera: { position: [0, 2.6, 2.8], fov: 42, target: [0, 0.15, 0] },
    lights: [
      { type: 'ambient', color: '#ffffff', intensity: 0.8 },
      { type: 'directional', color: '#ffffff', intensity: 2.2, position: [3, 5, 4] },
      { type: 'point', color: isRainbow ? '#38bdf8' : (palette.emissive || '#38bdf8'), intensity: 2.0, position: [0, 1.2, 0] }
    ],
    nodes
  };
}

function synthesizeSceneFromPrompt(prompt, name = 'HeroAsset', targetPolycount = 8000, _fallbackArchetype = 'application') {
  const p = (prompt || '').toLowerCase();
  const palette = extractPalette(p);
  const safeName = String(name || 'HeroAsset').replace(/[^a-zA-Z0-9_-]/g, '_');

  // Computer Keyboards & Keypads (with RGB Rainbow backlighting)
  if (/\b(keyboard|keypad|numpad|keycaps|keeb)\b/.test(p)) {
    return synthesizeKeyboardSpec(safeName, palette, targetPolycount, p);
  }

  // Stationery & Office Instruments (e.g. pen, ballpoint, pencil, marker)
  if (/\b(pen|ballpoint|fountain-pen|pencil|marker|stylus|quill)\b/.test(p)) {
    return synthesizePenSpec(safeName, palette, targetPolycount);
  }

  // Hovercraft & Hoverbikes
  if (/\b(hoverbike|speeder|jetbike|hover-bike)\b/.test(p)) {
    return synthesizeHoverbikeSpec(safeName, palette, targetPolycount);
  }

  // Assault Tanks & Heavy Armored Vehicles
  if (/\b(tank|railgun|assault-tank|panzer)\b/.test(p)) {
    return synthesizeTankSpec(safeName, palette, targetPolycount);
  }

  // Alchemical Potion / Flask / Bottles
  if (/\b(potion|flask|bottle|vial|elixir)\b/.test(p)) {
    return synthesizePotionSpec(safeName, palette, targetPolycount);
  }

  // Swords / Bladed Weapons
  if (/\b(sword|blade|broadsword|katana|rapier|dagger|saber)\b/.test(p)) {
    return synthesizeSwordSpec(safeName, palette, targetPolycount);
  }

  return null;
}

module.exports = {
  extractPalette,
  synthesizeSceneFromPrompt
};
