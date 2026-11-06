'use strict';

/** Pure refine-test fixtures: node naming, unique target selection and a synthetic parent spec. */

function humanizeNodeName(name) {
  return String(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Picks a restyle target that the fail-closed resolver maps to EXACTLY one node: a single node
 * when the parent offers one, otherwise the first candidate the resolver narrows to one part.
 */
function pickUniqueTarget(spec, refineDsl) {
  const nodes = (spec.nodes || []).filter((n) => n && n.name);
  if (nodes.length === 0) return null;
  const single = refineDsl.parseRefineIntent('make it red', { nodes });
  if (!single.error_code && single.targets.length === 1) {
    return nodes.find((n) => n.name === single.targets[0]) || null;
  }
  const ordered = [pickNode(spec), ...nodes];
  return ordered.find((candidate) => {
    if (!candidate) return false;
    const res = refineDsl.parseRefineIntent(`make the ${humanizeNodeName(candidate.name)} red`, { nodes });
    return !res.error_code && res.targets.length === 1 && res.targets[0] === candidate.name;
  }) || null;
}

function pickNode(spec) {
  const nodes = spec.nodes || [];
  return nodes.find((n) => /hull|core|body|base|frame|tower|fuselage/i.test(n.name)) || nodes[0];
}

/** Deterministic, hand-built parent spec so tests (i)-(l) never depend on LLM output. */
function syntheticParentSpec() {
  return {
    archetype: 'game-prop',
    target_polycount: 12000,
    nodes: [
      { name: 'chest_body', material: { color: '#334155', metalness: 0.6, roughness: 0.5 }, part: { primitive: 'box', size: [1.4, 1.0, 0.9] }, transform: { position: [0, 0.5, 0], rotation: [0, 0, 0] } },
      { name: 'chest_lid', material: { color: '#475569', metalness: 0.55, roughness: 0.6 }, part: { primitive: 'box', size: [1.4, 0.18, 0.9] }, transform: { position: [0, 1.09, 0], rotation: [0, 0, 0] } },
      { name: 'side_handle', material: { color: '#94a3b8', metalness: 0.7, roughness: 0.4, emissiveIntensity: 0 }, part: { primitive: 'cylinder', size: [0.16, 0.16, 0.6] }, transform: { position: [0.78, 0.6, 0], rotation: [0, 0, 1.5708] } },
      { name: 'side_handle_bar', material: { color: '#94a3b8', metalness: 0.7, roughness: 0.4 }, part: { primitive: 'cylinder', size: [0.08, 0.08, 1.1] }, transform: { position: [0.9, 0.6, 0], rotation: [0, 0, 0] } }
    ],
    lights: [{ type: 'point', position: [2, 3, 2], intensity: 1.2, color: '#ffffff' }]
  };
}

module.exports = { humanizeNodeName, pickUniqueTarget, pickNode, syntheticParentSpec };
