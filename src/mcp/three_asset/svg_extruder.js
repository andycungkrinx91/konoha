'use strict';

/**
 * src/mcp/three_asset/svg_extruder.js
 *
 * Converts 2D SVG vectors into watertight 3D extruded geometry in Three.js r187.
 * Pure Node.js zero-dependency XML-to-DOM parser feeding SVGLoader.
 */

const fs = require('fs');
const depLoader = require('./dep_loader');
const THREE = depLoader.loadThree();
const { ensureHeadlessShim } = require('./headless_shim');

function createDomNode(name, attrs = {}) {
  return {
    nodeName: name,
    tagName: name,
    nodeType: 1,
    textContent: '',
    childNodes: [],
    style: {},
    getAttribute(attr) {
      return attrs[attr] !== undefined ? String(attrs[attr]) : null;
    },
    hasAttribute(attr) {
      return attrs[attr] !== undefined;
    }
  };
}

function parseSvgXmlToDom(xmlText) {
  const clean = String(xmlText || '').replace(/<!--[\s\S]*?-->/g, '').trim();
  const tagRegex = /<(\/?[a-zA-Z0-9:-]+)((?:\s+[a-zA-Z0-9:-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;
  const attrRegex = /([a-zA-Z0-9:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;

  const root = createDomNode('root');
  const stack = [root];

  let match;
  while ((match = tagRegex.exec(clean)) !== null) {
    const rawTag = match[1];
    const rawAttrs = match[2] || '';
    const isSelfClosing = match[3] === '/' || rawTag.startsWith('?') || rawTag.startsWith('!');

    if (rawTag.startsWith('/')) {
      if (stack.length > 1) stack.pop();
      continue;
    }

    if (rawTag.startsWith('?') || rawTag.startsWith('!')) continue;

    const attrs = {};
    let attrMatch;
    while ((attrMatch = attrRegex.exec(rawAttrs)) !== null) {
      const key = attrMatch[1];
      const val = attrMatch[2] !== undefined ? attrMatch[2] : (attrMatch[3] !== undefined ? attrMatch[3] : attrMatch[4]);
      attrs[key] = val;
    }

    const node = createDomNode(rawTag, attrs);
    const parent = stack[stack.length - 1];
    parent.childNodes.push(node);

    if (!isSelfClosing && !['path', 'polygon', 'polyline', 'rect', 'circle', 'ellipse', 'line'].includes(rawTag)) {
      stack.push(node);
    }
  }

  const docEl = root.childNodes.find(n => n.nodeName.toLowerCase() === 'svg') || root.childNodes[0] || createDomNode('svg');
  return {
    documentElement: docEl,
    getElementById: (id) => {
      function findId(curr) {
        if (curr.getAttribute('id') === id) return curr;
        for (const child of curr.childNodes) {
          const res = findId(child);
          if (res) return res;
        }
        return null;
      }
      return findId(docEl);
    },
    querySelectorAll: () => []
  };
}

class HeadlessSvgDomParser {
  parseFromString(text) {
    return parseSvgXmlToDom(text);
  }
}

function ensureSvgDomParser() {
  ensureHeadlessShim();
  if (typeof globalThis.DOMParser === 'undefined') {
    globalThis.DOMParser = HeadlessSvgDomParser;
  }
}

function parseSvgColor(colorStr, fallbackHex = '#4f46e5') {
  if (!colorStr || colorStr === 'none' || colorStr === 'transparent') return fallbackHex;
  if (colorStr.startsWith('#')) return colorStr;
  if (colorStr.startsWith('rgb')) {
    const m = colorStr.match(/\d+/g);
    if (m && m.length >= 3) {
      const hex = ((1 << 24) + (Number(m[0]) << 16) + (Number(m[1]) << 8) + Number(m[2])).toString(16).slice(1);
      return `#${hex}`;
    }
  }
  return fallbackHex;
}

function buildSvg3DScene(svgInput, options = {}) {
  ensureSvgDomParser();
  const { SVGLoader } = depLoader.loadAddon('loaders/SVGLoader.js');

  let svgText = '';
  if (typeof svgInput === 'string') {
    if (fs.existsSync(svgInput)) {
      svgText = fs.readFileSync(svgInput, 'utf8');
    } else {
      svgText = svgInput;
    }
  }

  const loader = new SVGLoader();
  const svgData = loader.parse(svgText);

  const scene = new THREE.Scene();
  scene.background = null;

  const modelGroup = new THREE.Group();
  modelGroup.name = options.name || 'ExtrudedSvgModel';
  scene.add(modelGroup);

  const depth = options.depth || 0.28;
  const extrudeSettings = {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.035,
    bevelSize: 0.02,
    bevelSegments: 4,
    curveSegments: 16
  };

  const defaultColor = options.color || '#4f46e5';
  let triangleCount = 0;
  let meshCount = 0;

  for (const pathItem of svgData.paths) {
    const fillColor = pathItem.userData && pathItem.userData.style
      ? parseSvgColor(pathItem.userData.style.fill, defaultColor)
      : defaultColor;

    const material = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(fillColor),
      roughness: options.roughness !== undefined ? options.roughness : 0.22,
      metalness: options.metalness !== undefined ? options.metalness : 0.78,
      clearcoat: options.clearcoat !== undefined ? options.clearcoat : 0.85,
      clearcoatRoughness: 0.1,
      reflectivity: 0.5
    });

    const shapes = typeof pathItem.toShapes === 'function' ? pathItem.toShapes(true) : [];

    for (const shape of shapes) {
      const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
      geometry.computeVertexNormals();

      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      modelGroup.add(mesh);

      const pos = geometry.attributes.position;
      triangleCount += pos ? pos.count / 3 : 0;
      meshCount++;
    }
  }

  // Compute bounding box to normalize scale and center in unit space
  const box = new THREE.Box3().setFromObject(modelGroup);
  const size = new THREE.Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z, 0.001);
  const targetScale = 2.0 / maxDim;
  modelGroup.scale.set(targetScale, -targetScale, targetScale); // Invert Y because SVG origin is top-left

  const center = new THREE.Vector3();
  box.getCenter(center);
  modelGroup.position.x = -center.x * targetScale;
  modelGroup.position.y = center.y * targetScale;
  modelGroup.position.z = -center.z * targetScale;

  // Add 3-point studio lighting
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
  keyLight.position.set(3, 4, 3);
  keyLight.castShadow = true;
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0x38bdf8, 1.2);
  fillLight.position.set(-3, 1, 2);
  scene.add(fillLight);

  const rimLight = new THREE.DirectionalLight(0x818cf8, 1.8);
  rimLight.position.set(0, 3, -3);
  scene.add(rimLight);

  return {
    scene,
    modelGroup,
    triangleCount: Math.round(triangleCount),
    meshCount
  };
}

module.exports = {
  buildSvg3DScene,
  ensureSvgDomParser
};
