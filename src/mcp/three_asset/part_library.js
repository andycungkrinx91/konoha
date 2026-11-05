'use strict';

/**
 * Enterprise Realistic 3D Part Template Library & Detail Part Generator.
 * Provides curved, chamfered, high-segment primitives and physical PBR materials.
 */

const PALETTE = {
  P1: '#3b82f6', // Blueprint Blue
  P2: '#06b6d4', // Cyan Tech
  P3: '#10b981', // Emerald Mint
  P4: '#f59e0b', // Amber Industrial
  P5: '#6366f1', // Indigo Cyber
  P6: '#ec4899', // Pink Laser
  P7: '#8b5cf6', // Violet Neon
  P8: '#14b8a6', // Teal Marine
  N1: '#f8fafc', // Ultra White
  N2: '#cbd5e1', // Light Steel
  N3: '#64748b', // Slate Gray
  N4: '#334155', // Deep Charcoal
  N5: '#0f172a'  // Obsidian Black
};

const ENTERPRISE_MATERIALS = {
  brushed_titanium: { type: 'physical', color: '#94a3b8', metalness: 0.90, roughness: 0.28, clearcoat: 0.2 },
  anodized_aluminum: { type: 'physical', color: '#38bdf8', metalness: 0.85, roughness: 0.32, clearcoat: 0.3 },
  polished_chrome: { type: 'physical', color: '#f8fafc', metalness: 0.98, roughness: 0.05, clearcoat: 1.0 },
  optical_glass: { type: 'physical', color: '#ffffff', metalness: 0.0, roughness: 0.02, transmission: 0.95, ior: 1.52 },
  carbon_fiber: { type: 'physical', color: '#1e293b', metalness: 0.15, roughness: 0.45, clearcoat: 0.7 },
  matte_polymer: { type: 'physical', color: '#0f172a', metalness: 0.05, roughness: 0.65, clearcoat: 0.0 },
  satin_gold: { type: 'physical', color: '#eab308', metalness: 0.92, roughness: 0.22, clearcoat: 0.4 },
  ceramic_white: { type: 'physical', color: '#f1f5f9', metalness: 0.05, roughness: 0.18, clearcoat: 0.9 },
  led_cyan_emissive: { type: 'physical', color: '#0891b2', metalness: 0.1, roughness: 0.2, emissive: '#06b6d4', emissiveIntensity: 3.5 }
};

function boxNode(name, w, h, d, ...rest) {
  const [x, y, z, color, rot = [0, 0, 0], metal = 0.5, rough = 0.35, clearcoat = 0.2] = rest;
  return {
    name,
    geometry: { type: 'box', params: { width: w, height: h, depth: d } },
    material: { type: 'physical', color, roughness: rough, metalness: metal, clearcoat },
    transform: { position: [x, y, z], rotation: rot, scale: [1, 1, 1] }
  };
}

function cylinderNode(name, rTop, rBot, h, ...rest) {
  const [x, y, z, color, rot = [0, 0, 0], metal = 0.6, rough = 0.3, radialSegments = 48] = rest;
  return {
    name,
    geometry: { type: 'cylinder', params: { radiusTop: rTop, radiusBottom: rBot, height: h, radialSegments } },
    material: { type: 'physical', color, roughness: rough, metalness: metal, clearcoat: 0.25 },
    transform: { position: [x, y, z], rotation: rot, scale: [1, 1, 1] }
  };
}

function capsuleNode(name, radius, length, ...rest) {
  const [x, y, z, color, rot = [0, 0, 0], metal = 0.7, rough = 0.25] = rest;
  return {
    name,
    geometry: { type: 'capsule', params: { radius, length, capSegments: 16, radialSegments: 32 } },
    material: { type: 'physical', color, roughness: rough, metalness: metal, clearcoat: 0.3 },
    transform: { position: [x, y, z], rotation: rot, scale: [1, 1, 1] }
  };
}

function sphereNode(name, radius, x, y, ...rest) {
  const [z, color, rot = [0, 0, 0], metal = 0.8, rough = 0.15] = rest;
  return {
    name,
    geometry: { type: 'sphere', params: { radius, widthSegments: 48, heightSegments: 32 } },
    material: { type: 'physical', color, roughness: rough, metalness: metal, clearcoat: 0.8 },
    transform: { position: [x, y, z], rotation: rot, scale: [1, 1, 1] }
  };
}

function torusNode(name, radius, tube, ...rest) {
  const [x, y, z, color, rot = [0, 0, 0], metal = 0.85, rough = 0.2] = rest;
  return {
    name,
    geometry: { type: 'torus', params: { radius, tube, radialSegments: 24, tubularSegments: 48 } },
    material: { type: 'physical', color, roughness: rough, metalness: metal, clearcoat: 0.5 },
    transform: { position: [x, y, z], rotation: rot, scale: [1, 1, 1] }
  };
}

function coneNode(name, radius, h, ...rest) {
  const [x, y, z, color, rot = [0, 0, 0], metal = 0.5, rough = 0.4] = rest;
  return {
    name,
    geometry: { type: 'cone', params: { radius, height: h, radialSegments: 36 } },
    material: { type: 'physical', color, roughness: rough, metalness: metal, clearcoat: 0.2 },
    transform: { position: [x, y, z], rotation: rot, scale: [1, 1, 1] }
  };
}

const ENTERPRISE_TEMPLATES = {
  'game-character': [
    cylinderNode('pedestal_base', 0.9, 0.95, 0.1, 0, 0.05, 0, PALETTE.N5, [0, 0, 0], 0.9, 0.2),
    capsuleNode('leg_l', 0.12, 0.5, -0.22, 0.4, 0, PALETTE.N4, [0, 0, 0], 0.7, 0.3),
    capsuleNode('leg_r', 0.12, 0.5, 0.22, 0.4, 0, PALETTE.N4, [0, 0, 0], 0.7, 0.3),
    boxNode('torso_core', 0.55, 0.65, 0.35, 0, 1.05, 0, PALETTE.P1, [0, 0, 0], 0.85, 0.25, 0.6),
    boxNode('chest_armor_plate', 0.48, 0.38, 0.12, 0, 1.15, 0.18, PALETTE.N2, [0, 0, 0], 0.95, 0.15, 0.8),
    capsuleNode('arm_l', 0.1, 0.48, -0.42, 1.02, 0, PALETTE.N3, [0, 0, 0.15], 0.8, 0.25),
    capsuleNode('arm_r', 0.1, 0.48, 0.42, 1.02, 0, PALETTE.N3, [0, 0, -0.15], 0.8, 0.25),
    sphereNode('head_helmet', 0.24, 0, 1.58, 0, PALETTE.N2, [0, 0, 0], 0.9, 0.1),
    boxNode('visor_optical', 0.26, 0.08, 0.12, 0, 1.58, 0.18, PALETTE.P2, [0, 0, 0], 0.1, 0.05, 1.0),
    torusNode('shoulder_guard_l', 0.16, 0.04, -0.42, 1.25, 0, PALETTE.P1, [1.57, 0, 0], 0.9, 0.2),
    torusNode('shoulder_guard_r', 0.16, 0.04, 0.42, 1.25, 0, PALETTE.P1, [1.57, 0, 0], 0.9, 0.2)
  ],

  'game-prop': [
    boxNode('case_base', 1.0, 0.45, 0.65, 0, 0.225, 0, PALETTE.N4, [0, 0, 0], 0.7, 0.35),
    boxNode('case_lid', 1.02, 0.2, 0.67, 0, 0.55, 0, PALETTE.N3, [0, 0, 0], 0.85, 0.25, 0.5),
    boxNode('latch_l', 0.08, 0.14, 0.06, -0.3, 0.45, 0.34, PALETTE.P4, [0, 0, 0], 0.95, 0.15),
    boxNode('latch_r', 0.08, 0.14, 0.06, 0.3, 0.45, 0.34, PALETTE.P4, [0, 0, 0], 0.95, 0.15),
    capsuleNode('handle_grip', 0.03, 0.24, 0, 0.68, 0, PALETTE.P1, [0, 0, 1.57], 0.9, 0.2),
    cylinderNode('corner_bumper_fl', 0.05, 0.05, 0.55, -0.5, 0.3, 0.32, PALETTE.N5, [0, 0, 0], 0.2, 0.6),
    cylinderNode('corner_bumper_fr', 0.05, 0.05, 0.55, 0.5, 0.3, 0.32, PALETTE.N5, [0, 0, 0], 0.2, 0.6),
    cylinderNode('corner_bumper_bl', 0.05, 0.05, 0.55, -0.5, 0.3, -0.32, PALETTE.N5, [0, 0, 0], 0.2, 0.6),
    cylinderNode('corner_bumper_br', 0.05, 0.05, 0.55, 0.5, 0.3, -0.32, PALETTE.N5, [0, 0, 0], 0.2, 0.6)
  ],

  'game-weapon': [
    cylinderNode('pommel', 0.08, 0.08, 0.12, 0, 0.06, 0, PALETTE.P4, [0, 0, 0], 0.95, 0.15),
    cylinderNode('grip_handle', 0.045, 0.045, 0.32, 0, 0.28, 0, PALETTE.N4, [0, 0, 0], 0.3, 0.6),
    boxNode('crossguard', 0.58, 0.07, 0.12, 0, 0.47, 0, PALETTE.P4, [0, 0, 0], 0.95, 0.2),
    boxNode('blade_core', 0.14, 1.25, 0.04, 0, 1.12, 0, PALETTE.N1, [0, 0, 0], 0.98, 0.05, 1.0),
    coneNode('blade_tip', 0.07, 0.25, 0, 1.87, 0, PALETTE.N1, [0, 0, 0], 0.98, 0.05),
    sphereNode('energy_gem', 0.055, 0, 0.47, 0.06, PALETTE.P2, [0, 0, 0], 0.1, 0.05),
    torusNode('guard_ring_l', 0.08, 0.02, -0.25, 0.47, 0, PALETTE.P4, [0, 1.57, 0], 0.95, 0.15),
    torusNode('guard_ring_r', 0.08, 0.02, 0.25, 0.47, 0, PALETTE.P4, [0, 1.57, 0], 0.95, 0.15)
  ],

  'game-vehicle': [
    boxNode('chassis_frame', 1.2, 0.28, 2.2, 0, 0.35, 0, PALETTE.N4, [0, 0, 0], 0.8, 0.3),
    boxNode('cabin_canopy', 0.85, 0.42, 1.1, 0, 0.7, 0.1, PALETTE.P1, [0, 0, 0], 0.9, 0.2, 0.8),
    cylinderNode('wheel_fl', 0.22, 0.22, 0.16, -0.68, 0.22, 0.72, PALETTE.N5, [0, 0, 1.57], 0.2, 0.7),
    cylinderNode('wheel_fr', 0.22, 0.22, 0.16, 0.68, 0.22, 0.72, PALETTE.N5, [0, 0, 1.57], 0.2, 0.7),
    cylinderNode('wheel_rl', 0.24, 0.24, 0.18, -0.68, 0.24, -0.72, PALETTE.N5, [0, 0, 1.57], 0.2, 0.7),
    cylinderNode('wheel_rr', 0.24, 0.24, 0.18, 0.68, 0.24, -0.72, PALETTE.N5, [0, 0, 1.57], 0.2, 0.7),
    boxNode('front_spoiler', 1.05, 0.06, 0.25, 0, 0.18, 1.12, PALETTE.P1, [0, 0, 0], 0.85, 0.25),
    boxNode('rear_wing', 0.95, 0.05, 0.28, 0, 0.95, -0.95, PALETTE.P1, [0, 0, 0], 0.85, 0.25),
    boxNode('headlight_l', 0.14, 0.08, 0.04, -0.42, 0.38, 1.12, PALETTE.P2, [0, 0, 0], 0.1, 0.05),
    boxNode('headlight_r', 0.14, 0.08, 0.04, 0.42, 0.38, 1.12, PALETTE.P2, [0, 0, 0], 0.1, 0.05),
    boxNode('front_grille', 0.72, 0.22, 0.05, 0, 0.35, 1.13, PALETTE.N5, [0, 0, 0], 0.9, 0.1),
    boxNode('cargo_bed', 1.05, 0.45, 1.15, 0, 0.65, -0.65, PALETTE.N3, [0, 0, 0], 0.8, 0.3)
  ],

  'vehicle': [
    boxNode('chassis', 1.15, 0.3, 2.1, 0, 0.36, 0, PALETTE.N4, [0, 0, 0], 0.85, 0.25),
    boxNode('body_cabin', 0.82, 0.44, 1.15, 0, 0.72, 0.05, PALETTE.P1, [0, 0, 0], 0.9, 0.2, 0.8),
    cylinderNode('wheel_fl', 0.22, 0.22, 0.15, -0.66, 0.22, 0.7, PALETTE.N5, [0, 0, 1.57], 0.2, 0.7),
    cylinderNode('wheel_fr', 0.22, 0.22, 0.15, 0.66, 0.22, 0.7, PALETTE.N5, [0, 0, 1.57], 0.2, 0.7),
    cylinderNode('wheel_rl', 0.24, 0.24, 0.16, -0.66, 0.24, -0.7, PALETTE.N5, [0, 0, 1.57], 0.2, 0.7),
    cylinderNode('wheel_rr', 0.24, 0.24, 0.16, 0.66, 0.24, -0.7, PALETTE.N5, [0, 0, 1.57], 0.2, 0.7),
    capsuleNode('roof_rail_l', 0.03, 1.0, -0.42, 0.96, 0.05, PALETTE.N2, [1.57, 0, 0], 0.95, 0.1),
    capsuleNode('roof_rail_r', 0.03, 1.0, 0.42, 0.96, 0.05, PALETTE.N2, [1.57, 0, 0], 0.95, 0.1),
    boxNode('front_grille', 0.75, 0.2, 0.05, 0, 0.35, 1.08, PALETTE.N5, [0, 0, 0], 0.9, 0.1),
    boxNode('front_bumper', 1.05, 0.12, 0.15, 0, 0.22, 1.12, PALETTE.N3, [0, 0, 0], 0.85, 0.2),
    boxNode('cargo_bed', 1.02, 0.4, 1.0, 0, 0.65, -0.6, PALETTE.N3, [0, 0, 0], 0.8, 0.3)
  ],

  'game-environment': [
    cylinderNode('ground_slab', 1.45, 1.5, 0.12, 0, 0.06, 0, PALETTE.N4, [0, 0, 0], 0.3, 0.7),
    cylinderNode('grass_plateau', 1.25, 1.3, 0.15, 0, 0.19, 0, PALETTE.P3, [0, 0, 0], 0.1, 0.8),
    cylinderNode('rock_formation_1', 0.35, 0.42, 0.6, -0.65, 0.45, -0.45, PALETTE.N3, [0, 0.4, 0], 0.4, 0.6),
    cylinderNode('rock_formation_2', 0.25, 0.3, 0.4, 0.7, 0.35, 0.5, PALETTE.N3, [0, -0.3, 0], 0.4, 0.6),
    capsuleNode('tree_trunk', 0.09, 0.75, 0.45, 0.62, -0.5, PALETTE.N4, [0, 0, 0], 0.2, 0.8),
    coneNode('tree_canopy_lower', 0.55, 0.65, 0.45, 1.15, -0.5, PALETTE.P3, [0, 0, 0], 0.1, 0.7),
    coneNode('tree_canopy_upper', 0.42, 0.55, 0.45, 1.55, -0.5, PALETTE.P3, [0, 0, 0], 0.1, 0.7),
    sphereNode('crystal_cluster', 0.14, -0.4, 0.35, 0.65, PALETTE.P2, [0, 0, 0], 0.1, 0.05)
  ],

  'game-tileset': [
    boxNode('tile_base', 1.8, 0.18, 1.8, 0, 0.09, 0, PALETTE.N4, [0, 0, 0], 0.5, 0.5),
    boxNode('pavement_slab_1', 0.82, 0.06, 0.82, -0.44, 0.21, -0.44, PALETTE.N2, [0, 0, 0], 0.8, 0.3),
    boxNode('pavement_slab_2', 0.82, 0.06, 0.82, 0.44, 0.21, -0.44, PALETTE.N2, [0, 0, 0], 0.8, 0.3),
    boxNode('pavement_slab_3', 0.82, 0.06, 0.82, -0.44, 0.21, 0.44, PALETTE.N2, [0, 0, 0], 0.8, 0.3),
    boxNode('pavement_slab_4', 0.82, 0.06, 0.82, 0.44, 0.21, 0.44, PALETTE.N2, [0, 0, 0], 0.8, 0.3),
    cylinderNode('drain_grate', 0.15, 0.15, 0.04, 0, 0.23, 0, PALETTE.N5, [0, 0, 0], 0.9, 0.2),
    boxNode('edge_curb_n', 1.8, 0.08, 0.12, 0, 0.22, -0.84, PALETTE.N3, [0, 0, 0], 0.6, 0.4)
  ],

  'game-creature': [
    cylinderNode('shadow_pedestal', 0.95, 1.0, 0.1, 0, 0.05, 0, PALETTE.N5, [0, 0, 0], 0.9, 0.2),
    capsuleNode('body_core', 0.36, 0.60, 0, 0.76, 0, PALETTE.P7, [1.57, 0, 0], 0.7, 0.3),
    capsuleNode('leg_fl', 0.1, 0.32, -0.35, 0.34, 0.3, PALETTE.N4, [0, 0, 0], 0.8, 0.25),
    capsuleNode('leg_fr', 0.1, 0.32, 0.35, 0.34, 0.3, PALETTE.N4, [0, 0, 0], 0.8, 0.25),
    capsuleNode('leg_bl', 0.12, 0.36, -0.38, 0.36, -0.32, PALETTE.N4, [0, 0, 0], 0.8, 0.25),
    capsuleNode('leg_br', 0.12, 0.36, 0.38, 0.36, -0.32, PALETTE.N4, [0, 0, 0], 0.8, 0.25),
    sphereNode('creature_head', 0.26, 0, 0.92, 0.52, PALETTE.P7, [0, 0, 0], 0.7, 0.25),
    coneNode('horn_l', 0.06, 0.28, -0.16, 1.2, 0.52, PALETTE.P4, [0.3, 0, -0.2], 0.9, 0.15),
    coneNode('horn_r', 0.06, 0.28, 0.16, 1.2, 0.52, PALETTE.P4, [0.3, 0, 0.2], 0.9, 0.15),
    capsuleNode('tail', 0.08, 0.65, 0, 0.62, -0.68, PALETTE.P7, [-0.8, 0, 0], 0.7, 0.3)
  ],

  'game-building': [
    boxNode('foundation_slab', 1.6, 0.22, 1.6, 0, 0.11, 0, PALETTE.N4, [0, 0, 0], 0.6, 0.4),
    boxNode('ground_floor', 1.3, 0.75, 1.3, 0, 0.59, 0, PALETTE.N2, [0, 0, 0], 0.8, 0.25),
    boxNode('second_floor', 1.15, 0.68, 1.15, 0, 1.3, 0, PALETTE.N3, [0, 0, 0], 0.85, 0.25),
    boxNode('roof_terrace', 1.25, 0.08, 1.25, 0, 1.68, 0, PALETTE.P1, [0, 0, 0], 0.9, 0.2),
    cylinderNode('spire_tower', 0.12, 0.18, 0.75, 0, 2.05, 0, PALETTE.P4, [0, 0, 0], 0.95, 0.15),
    boxNode('entrance_door', 0.35, 0.52, 0.06, 0, 0.48, 0.66, PALETTE.P4, [0, 0, 0], 0.9, 0.2),
    boxNode('window_l', 0.24, 0.32, 0.04, -0.38, 1.32, 0.58, PALETTE.P2, [0, 0, 0], 0.1, 0.05, 1.0),
    boxNode('window_r', 0.24, 0.32, 0.04, 0.38, 1.32, 0.58, PALETTE.P2, [0, 0, 0], 0.1, 0.05, 1.0)
  ],

  'logistics': [
    boxNode('chassis', 1.2, 0.28, 2.3, 0, 0.35, 0, PALETTE.N4, [0, 0, 0], 0.8, 0.3),
    boxNode('truck_cab', 0.95, 0.65, 0.85, 0, 0.82, 0.65, PALETTE.P1, [0, 0, 0], 0.9, 0.2),
    boxNode('windshield', 0.85, 0.32, 0.12, 0, 0.88, 1.05, PALETTE.P2, [0, 0, 0], 0.1, 0.05, 1.0),
    boxNode('cargo_container', 1.05, 0.78, 1.35, 0, 0.88, -0.42, PALETTE.N3, [0, 0, 0], 0.85, 0.25),
    cylinderNode('wheel_fl', 0.22, 0.22, 0.16, -0.68, 0.22, 0.75, PALETTE.N5, [0, 0, 1.57], 0.2, 0.7),
    cylinderNode('wheel_fr', 0.22, 0.22, 0.16, 0.68, 0.22, 0.75, PALETTE.N5, [0, 0, 1.57], 0.2, 0.7),
    cylinderNode('wheel_rl1', 0.24, 0.24, 0.18, -0.68, 0.24, -0.25, PALETTE.N5, [0, 0, 1.57], 0.2, 0.7),
    cylinderNode('wheel_rr1', 0.24, 0.24, 0.18, 0.68, 0.24, -0.25, PALETTE.N5, [0, 0, 1.57], 0.2, 0.7),
    cylinderNode('wheel_rl2', 0.24, 0.24, 0.18, -0.68, 0.24, -0.75, PALETTE.N5, [0, 0, 1.57], 0.2, 0.7),
    cylinderNode('wheel_rr2', 0.24, 0.24, 0.18, 0.68, 0.24, -0.75, PALETTE.N5, [0, 0, 1.57], 0.2, 0.7),
    boxNode('headlight_l', 0.14, 0.08, 0.04, -0.38, 0.42, 1.08, PALETTE.P4, [0, 0, 0], 0.95, 0.15),
    boxNode('headlight_r', 0.14, 0.08, 0.04, 0.38, 0.42, 1.08, PALETTE.P4, [0, 0, 0], 0.95, 0.15)
  ],

  'commerce': [
    cylinderNode('pedestal_base', 1.0, 1.05, 0.15, 0, 0.075, 0, PALETTE.N5, [0, 0, 0], 0.9, 0.2),
    cylinderNode('display_column', 0.75, 0.8, 0.45, 0, 0.375, 0, PALETTE.N4, [0, 0, 0], 0.85, 0.25),
    cylinderNode('turntable_disc', 0.65, 0.65, 0.06, 0, 0.63, 0, PALETTE.P4, [0, 0, 0], 0.95, 0.15),
    sphereNode('luxury_product', 0.26, 0, 0.95, 0, PALETTE.P1, [0, 0, 0], 0.92, 0.1, 0.8),
    torusNode('halo_ring', 0.42, 0.03, 0, 0.95, 0, PALETTE.P2, [1.57, 0, 0], 0.98, 0.05),
    boxNode('price_stand', 0.18, 0.22, 0.08, 0.42, 0.72, 0.32, PALETTE.N2, [0, -0.4, 0], 0.8, 0.3)
  ],

  'dashboard': [
    boxNode('desk_stand', 1.5, 0.1, 0.75, 0, 0.05, 0, PALETTE.N5, [0, 0, 0], 0.8, 0.3),
    cylinderNode('mount_pillar', 0.06, 0.06, 0.65, 0, 0.42, 0, PALETTE.N2, [0, 0, 0], 0.95, 0.1),
    boxNode('curved_monitor', 1.35, 0.75, 0.08, 0, 0.85, 0.05, PALETTE.N4, [0, 0, 0], 0.85, 0.2),
    boxNode('screen_display', 1.28, 0.68, 0.02, 0, 0.85, 0.09, PALETTE.P1, [0, 0, 0], 0.1, 0.05, 1.0),
    boxNode('keyboard_deck', 0.65, 0.04, 0.22, 0, 0.12, 0.22, PALETTE.N3, [0.08, 0, 0], 0.7, 0.35),
    cylinderNode('smart_dial', 0.08, 0.08, 0.05, 0.48, 0.12, 0.22, PALETTE.P2, [0, 0, 0], 0.95, 0.15)
  ],

  'portfolio': [
    cylinderNode('plinth', 0.85, 0.9, 0.2, 0, 0.1, 0, PALETTE.N4, [0, 0, 0], 0.8, 0.3),
    boxNode('frame_support', 0.9, 1.15, 0.1, 0, 0.78, 0, PALETTE.P4, [0, 0, 0], 0.95, 0.15),
    boxNode('canvas_board', 0.78, 1.0, 0.04, 0, 0.78, 0.06, PALETTE.N1, [0, 0, 0], 0.1, 0.2),
    sphereNode('art_orb', 0.18, 0, 0.78, 0.22, PALETTE.P6, [0, 0, 0], 0.9, 0.1, 0.8),
    torusNode('orbit_ring', 0.34, 0.025, 0, 0.78, 0.22, PALETTE.P2, [0.8, 0.5, 0], 0.95, 0.1),
    capsuleNode('stylus_brush', 0.025, 0.32, 0.52, 0.32, 0.15, PALETTE.P4, [0, 0, 0], 0.85, 0.25),
    boxNode('palette_slab', 0.38, 0.03, 0.28, -0.48, 0.22, 0.15, PALETTE.N3, [0, 0.2, 0], 0.7, 0.35)
  ],

  'saas': [
    boxNode('server_rack_base', 1.0, 0.15, 0.85, 0, 0.075, 0, PALETTE.N5, [0, 0, 0], 0.9, 0.2),
    boxNode('rack_chassis', 0.9, 1.45, 0.75, 0, 0.88, 0, PALETTE.N4, [0, 0, 0], 0.85, 0.25),
    boxNode('blade_server_1', 0.82, 0.18, 0.7, 0, 0.45, 0.04, PALETTE.P1, [0, 0, 0], 0.9, 0.2),
    boxNode('blade_server_2', 0.82, 0.18, 0.7, 0, 0.75, 0.04, PALETTE.P1, [0, 0, 0], 0.9, 0.2),
    boxNode('blade_server_3', 0.82, 0.18, 0.7, 0, 1.05, 0.04, PALETTE.P1, [0, 0, 0], 0.9, 0.2),
    boxNode('led_status_strip', 0.78, 0.04, 0.02, 0, 1.35, 0.39, PALETTE.P3, [0, 0, 0], 0.1, 0.05),
    cylinderNode('cooling_fan', 0.14, 0.14, 0.03, 0, 1.48, 0, PALETTE.N2, [1.57, 0, 0], 0.95, 0.1)
  ],

  'landing': [
    cylinderNode('stage_base', 1.3, 1.35, 0.12, 0, 0.06, 0, PALETTE.N5, [0, 0, 0], 0.9, 0.2),
    cylinderNode('hero_podium', 0.9, 0.95, 0.32, 0, 0.28, 0, PALETTE.N3, [0, 0, 0], 0.85, 0.25),
    boxNode('feature_monolith', 0.55, 1.1, 0.2, 0, 0.98, 0, PALETTE.P1, [0, 0, 0], 0.9, 0.2, 0.8),
    torusNode('glow_accent_ring', 0.58, 0.03, 0, 0.98, 0, PALETTE.P2, [1.57, 0, 0], 0.95, 0.1),
    sphereNode('floating_icon', 0.16, 0, 1.68, 0, PALETTE.P4, [0, 0, 0], 0.95, 0.15),
    cylinderNode('beacon_pillar', 0.04, 0.04, 0.45, 0.52, 0.45, 0.35, PALETTE.N2, [0, 0, 0], 0.95, 0.1),
    sphereNode('pulse_core', 0.12, -0.52, 0.45, -0.25, PALETTE.P2, [0, 0, 0], 0.1, 0.05)
  ],

  'application': [
    cylinderNode('desk_mat', 1.2, 1.25, 0.08, 0, 0.04, 0, PALETTE.N4, [0, 0, 0], 0.7, 0.4),
    boxNode('device_chassis', 0.92, 0.06, 0.65, 0, 0.11, 0, PALETTE.N2, [0, 0, 0], 0.95, 0.15),
    boxNode('device_screen', 0.86, 0.02, 0.58, 0, 0.15, 0, PALETTE.P1, [0, 0, 0], 0.1, 0.05, 1.0),
    capsuleNode('stylus_pen', 0.02, 0.28, 0.52, 0.2, 0.1, PALETTE.P4, [0, 0, 0], 0.9, 0.2),
    cylinderNode('dial_controller', 0.12, 0.12, 0.06, -0.42, 0.11, 0.42, PALETTE.N3, [0, 0, 0], 0.95, 0.15),
    boxNode('wireless_mouse', 0.14, 0.06, 0.22, 0.52, 0.11, -0.22, PALETTE.N3, [0, 0.1, 0], 0.8, 0.3),
    sphereNode('status_led', 0.025, 0, 0.15, 0.34, PALETTE.P3, [0, 0, 0], 0.1, 0.05)
  ]
};

// Backward-compatible alias for existing callers
const ROBLOX_TEMPLATES = ENTERPRISE_TEMPLATES;

/**
 * Generate parametric detail parts to pad node count and enrich realism
 */
function detailParts(targetCount, baseNodes = [], palette = PALETTE) {
  const parts = [];
  const needed = Math.max(0, targetCount - baseNodes.length);
  if (needed <= 0) return parts;

  const colors = [palette.P1, palette.P2, palette.P3, palette.P4, palette.N1, palette.N2, palette.N3];

  for (let i = 0; i < needed; i++) {
    const pairIdx = Math.floor(i / 2);
    const isOddLast = (i === needed - 1) && (needed % 2 === 1);
    const r = 0.28 + (pairIdx % 3) * 0.12;
    const sign = i % 2 === 0 ? -1 : 1;
    const x = isOddLast ? 0 : Number((sign * r).toFixed(4));
    const z = Number((0.18 + (pairIdx % 2) * 0.12).toFixed(4));
    const y = Number((0.25 + (pairIdx % 4) * 0.18).toFixed(4));
    const color = colors[pairIdx % colors.length];

    if (pairIdx % 2 === 0) {
      parts.push(cylinderNode(`detail_stud_${i}`, 0.04, 0.04, 0.06, x, y, z, color, [0, 0, 0], 0.8, 0.3));
    } else {
      parts.push(boxNode(`detail_bracket_${i}`, 0.08, 0.06, 0.08, x, y, z, color, [0, 0, 0], 0.7, 0.35));
    }
  }

  return parts;
}

module.exports = {
  PALETTE,
  ENTERPRISE_MATERIALS,
  ENTERPRISE_TEMPLATES,
  ROBLOX_TEMPLATES,
  detailParts,
  boxNode,
  cylinderNode,
  capsuleNode,
  sphereNode,
  torusNode,
  coneNode
};
