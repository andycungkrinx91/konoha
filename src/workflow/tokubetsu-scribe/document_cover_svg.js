'use strict';

/**
 * Model 1: Generates cascading multifaceted geometric diamonds & prisms
 */
function buildGeometricPolyhedraSvg(colors, width, height, isWidescreen = false) {
  const [c1, c2, c3, c4] = colors;
  const cx = isWidescreen ? 420 : 220;
  const cy = isWidescreen ? 340 : 270;
  const scale = isWidescreen ? 0.95 : 0.72;

  return `
  <defs>
    <linearGradient id="polyGrad1" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${c1}" />
      <stop offset="100%" stop-color="${c2}" />
    </linearGradient>
    <linearGradient id="polyGrad2" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${c2}" />
      <stop offset="100%" stop-color="${c3}" />
    </linearGradient>
    <linearGradient id="polyGrad3" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${c3}" />
      <stop offset="100%" stop-color="${c4}" />
    </linearGradient>
  </defs>

  <g transform="translate(${cx}, ${cy}) scale(${scale})">
    <rect x="-380" y="-380" width="760" height="760" rx="36" transform="rotate(45)"
          fill="none" stroke="${c2}" stroke-width="2" stroke-opacity="0.18" stroke-dasharray="8 6" />
    <rect x="-320" y="-320" width="640" height="640" rx="28" transform="rotate(45)"
          fill="${c1}" fill-opacity="0.08" stroke="${c1}" stroke-width="2.5" stroke-opacity="0.35" />
    <rect x="-350" y="-460" width="460" height="460" rx="20" transform="rotate(30)"
          fill="${c2}" fill-opacity="0.14" stroke="${c2}" stroke-width="2" stroke-opacity="0.4" />
    <rect x="-240" y="-240" width="480" height="480" rx="24" transform="rotate(45)"
          fill="url(#polyGrad1)" fill-opacity="0.92" />
    <rect x="-170" y="-170" width="340" height="340" rx="16" transform="rotate(45)"
          fill="${c1}" fill-opacity="0.95" />
    <rect x="-40" y="40" width="320" height="320" rx="16" transform="rotate(60)"
          fill="url(#polyGrad2)" fill-opacity="0.88" />
    <rect x="-290" y="20" width="220" height="220" rx="12" transform="rotate(45)"
          fill="${c4}" fill-opacity="0.90" />
    <rect x="-90" y="-280" width="260" height="260" rx="14" transform="rotate(45)"
          fill="${c3}" fill-opacity="0.82" />
    <rect x="-120" y="-120" width="240" height="240" rx="10" transform="rotate(45)"
          fill="none" stroke="#FFFFFF" stroke-width="3" stroke-opacity="0.85" />
    <rect x="-30" y="-30" width="60" height="60" rx="6" transform="rotate(45)"
          fill="#FFFFFF" fill-opacity="0.95" />
    <rect x="180" y="-180" width="160" height="160" rx="10" transform="rotate(35)"
          fill="none" stroke="${c1}" stroke-width="2.5" stroke-opacity="0.5" />
    <rect x="220" y="80" width="120" height="120" rx="8" transform="rotate(45)"
          fill="${c2}" fill-opacity="0.25" stroke="${c2}" stroke-width="2" stroke-opacity="0.4" />
    <circle cx="140" cy="-120" r="14" fill="${c1}" fill-opacity="0.75" />
    <circle cx="-160" cy="180" r="10" fill="${c4}" fill-opacity="0.85" />
  </g>`;
}

/**
 * Model 2: Generates sweeping sinusoidal & cubic Bézier wave ribbons
 */
function buildWaveRibbonSvg(colors, width, height, isWidescreen = false) {
  const [c1, c2, c3, c4] = colors;
  const w = width;
  const baseY = isWidescreen ? 360 : 310;

  return `
  <defs>
    <linearGradient id="waveGrad1" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${c1}" />
      <stop offset="50%" stop-color="${c2}" />
      <stop offset="100%" stop-color="${c3}" />
    </linearGradient>
    <linearGradient id="waveGrad2" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${c2}" />
      <stop offset="100%" stop-color="${c4}" />
    </linearGradient>
    <linearGradient id="waveGrad3" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${c3}" />
      <stop offset="100%" stop-color="${c1}" />
    </linearGradient>
  </defs>

  <path d="M -60 -40 L ${w + 60} -40 L ${w + 60} ${baseY + 40} C ${w * 0.75} ${baseY + 120}, ${w * 0.45} ${baseY - 140}, -60 ${baseY - 20} Z"
        fill="${c1}" fill-opacity="0.07" />

  <path d="M -80 ${baseY - 120} C ${w * 0.25} ${baseY - 260}, ${w * 0.55} ${baseY + 60}, ${w + 80} ${baseY - 140} L ${w + 80} ${baseY - 60} C ${w * 0.55} ${baseY + 140}, ${w * 0.25} ${baseY - 180}, -80 ${baseY - 40} Z"
        fill="url(#waveGrad1)" fill-opacity="0.92" />

  <path d="M -80 ${baseY + 40} C ${w * 0.3} ${baseY + 140}, ${w * 0.65} ${baseY - 180}, ${w + 80} ${baseY + 20} L ${w + 80} ${baseY + 100} C ${w * 0.65} ${baseY - 100}, ${w * 0.3} ${baseY + 220}, -80 ${baseY + 120} Z"
        fill="url(#waveGrad2)" fill-opacity="0.86" />

  <path d="M -80 ${baseY - 40} C ${w * 0.2} ${baseY + 40}, ${w * 0.5} ${baseY - 90}, ${w * 0.8} ${baseY + 30} C ${w * 0.9} ${baseY + 70}, ${w + 60} ${baseY - 10}, ${w + 60} ${baseY - 50} C ${w * 0.8} ${baseY - 10}, ${w * 0.5} ${baseY - 130}, -80 ${baseY - 80} Z"
        fill="url(#waveGrad3)" fill-opacity="0.78" />

  <path d="M -60 ${baseY - 160} C ${w * 0.25} ${baseY - 300}, ${w * 0.55} ${baseY + 20}, ${w + 60} ${baseY - 180}"
        fill="none" stroke="${c2}" stroke-width="2" stroke-dasharray="6 6" stroke-opacity="0.45" />
  <path d="M -60 ${baseY + 80} C ${w * 0.3} ${baseY + 180}, ${w * 0.65} ${baseY - 140}, ${w + 60} ${baseY + 60}"
        fill="none" stroke="${c3}" stroke-width="2" stroke-opacity="0.5" />

  <circle cx="${Math.round(w * 0.32)}" cy="${baseY - 110}" r="12" fill="${c1}" fill-opacity="0.9" />
  <circle cx="${Math.round(w * 0.32)}" cy="${baseY - 110}" r="6" fill="#FFFFFF" />
  <circle cx="${Math.round(w * 0.68)}" cy="${baseY - 60}" r="10" fill="${c4}" fill-opacity="0.9" />
  <circle cx="${Math.round(w * 0.68)}" cy="${baseY - 60}" r="5" fill="#FFFFFF" />
  <circle cx="${Math.round(w * 0.84)}" cy="${baseY - 110}" r="7" fill="${c2}" fill-opacity="0.85" />`;
}

function makeIsoBlock(config) {
  const { gx, gy, bw, bh, baseColor, topGradId, s } = config;
  const bx = (gx - gy) * 58 * s;
  const by = (gx + gy) * 33 * s;
  const w = bw * s;
  const h = bh * s;
  const skewY = 30 * (Math.PI / 180);
  const hy = w * Math.sin(skewY);
  const hx = w * Math.cos(skewY);

  return `
  <g transform="translate(${bx}, ${by})">
    <path d="M 0 0 L 0 ${h} L ${-hx} ${h - hy} L ${-hx} ${-hy} Z"
          fill="${baseColor}" fill-opacity="0.88" stroke="${baseColor}" stroke-width="1.5" />
    <path d="M 0 0 L 0 ${h} L ${hx} ${h - hy} L ${hx} ${-hy} Z"
          fill="${baseColor}" fill-opacity="0.68" stroke="${baseColor}" stroke-width="1.5" />
    <path d="M 0 0 L ${hx} ${-hy} L 0 ${-2 * hy} L ${-hx} ${-hy} Z"
          fill="url(#${topGradId})" stroke="#FFFFFF" stroke-width="2" stroke-opacity="0.9" />
    <circle cx="0" cy="${-2 * hy}" r="${5 * s}" fill="#FFFFFF" />
  </g>`;
}

/**
 * Model 3: Generates 3D isometric infrastructure monoliths & coordinate grids
 */
function buildIsometricMonolithSvg(colors, width, height, isWidescreen = false) {
  const [c1, c2, c3, c4] = colors;
  const originX = isWidescreen ? 480 : 340;
  const originY = isWidescreen ? 360 : 300;
  const s = isWidescreen ? 1.05 : 0.82;

  return `
  <defs>
    <linearGradient id="isoGrad1" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${c1}" />
      <stop offset="100%" stop-color="${c2}" />
    </linearGradient>
    <linearGradient id="isoGrad2" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${c2}" />
      <stop offset="100%" stop-color="${c3}" />
    </linearGradient>
    <linearGradient id="isoGrad3" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${c3}" />
      <stop offset="100%" stop-color="${c4}" />
    </linearGradient>
    <linearGradient id="isoGrad4" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${c4}" />
      <stop offset="100%" stop-color="${c1}" />
    </linearGradient>
  </defs>

  <g transform="translate(${originX}, ${originY})">
    <path d="M -360 0 L 0 -208 L 360 0 L 0 208 Z"
          fill="${c1}" fill-opacity="0.05" stroke="${c2}" stroke-width="1.5" stroke-dasharray="8 6" stroke-opacity="0.3" />
    <path d="M -240 0 L 0 -138 L 240 0 L 0 138 Z"
          fill="none" stroke="${c1}" stroke-width="1.5" stroke-opacity="0.25" />

    ${makeIsoBlock({ gx: -2, gy: 0, bw: 70, bh: 110, baseColor: c1, topGradId: 'isoGrad1', s })}
    ${makeIsoBlock({ gx: 0, gy: -2, bw: 60, bh: 150, baseColor: c2, topGradId: 'isoGrad2', s })}
    ${makeIsoBlock({ gx: 0, gy: 0, bw: 80, bh: 190, baseColor: c3, topGradId: 'isoGrad3', s })}
    ${makeIsoBlock({ gx: 2, gy: 0, bw: 65, bh: 130, baseColor: c4, topGradId: 'isoGrad4', s })}
    ${makeIsoBlock({ gx: 0, gy: 2, bw: 55, bh: 90, baseColor: c2, topGradId: 'isoGrad1', s })}
    ${makeIsoBlock({ gx: -1, gy: 2, bw: 50, bh: 70, baseColor: c1, topGradId: 'isoGrad2', s })}

    <line x1="-120" y1="-80" x2="0" y2="-210" stroke="${c2}" stroke-width="2" stroke-dasharray="4 4" stroke-opacity="0.6" />
    <line x1="0" y1="-210" x2="130" y2="-90" stroke="${c3}" stroke-width="2" stroke-dasharray="4 4" stroke-opacity="0.6" />
    <circle cx="-120" cy="-80" r="8" fill="${c1}" />
    <circle cx="130" cy="-90" r="8" fill="${c4}" />
  </g>`;
}

/**
 * Model 4: Generates orbital quantum rings & radiant planetary nodes
 */
function buildOrbitalRingsSvg(colors, width, height, isWidescreen = false) {
  const [c1, c2, c3, c4] = colors;
  const cx = isWidescreen ? 480 : 360;
  const cy = isWidescreen ? 340 : 280;
  const s = isWidescreen ? 1.0 : 0.75;

  return `
  <defs>
    <linearGradient id="ringGrad1" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${c1}" />
      <stop offset="100%" stop-color="${c2}" />
    </linearGradient>
    <linearGradient id="ringGrad2" x1="100%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="${c2}" />
      <stop offset="100%" stop-color="${c3}" />
    </linearGradient>
    <linearGradient id="ringGrad3" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${c3}" />
      <stop offset="100%" stop-color="${c4}" />
    </linearGradient>
    <radialGradient id="coreAura" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${c1}" stop-opacity="0.3" />
      <stop offset="60%" stop-color="${c2}" stop-opacity="0.1" />
      <stop offset="100%" stop-color="${c3}" stop-opacity="0" />
    </radialGradient>
  </defs>

  <g transform="translate(${cx}, ${cy}) scale(${s})">
    <circle cx="0" cy="0" r="280" fill="url(#coreAura)" />
    <circle cx="0" cy="0" r="320" fill="none" stroke="${c2}" stroke-width="1.5" stroke-dasharray="6 8" stroke-opacity="0.3" />

    <ellipse cx="0" cy="0" rx="340" ry="120" transform="rotate(-24)"
             fill="none" stroke="url(#ringGrad1)" stroke-width="3" stroke-opacity="0.95" />
    <ellipse cx="0" cy="0" rx="280" ry="90" transform="rotate(32)"
             fill="none" stroke="url(#ringGrad2)" stroke-width="2.5" stroke-dasharray="12 6" stroke-opacity="0.85" />
    <ellipse cx="0" cy="0" rx="230" ry="70" transform="rotate(-62)"
             fill="none" stroke="url(#ringGrad3)" stroke-width="2" stroke-opacity="0.8" />
    <ellipse cx="0" cy="0" rx="170" ry="50" transform="rotate(12)"
             fill="none" stroke="${c4}" stroke-width="2" stroke-opacity="0.75" />

    <line x1="-360" y1="0" x2="360" y2="0" stroke="${c1}" stroke-width="1.5" stroke-dasharray="4 8" stroke-opacity="0.35" />
    <line x1="0" y1="-260" x2="0" y2="260" stroke="${c1}" stroke-width="1.5" stroke-dasharray="4 8" stroke-opacity="0.35" />

    <circle cx="0" cy="0" r="46" fill="url(#ringGrad1)" stroke="#FFFFFF" stroke-width="3" />
    <circle cx="0" cy="0" r="16" fill="#FFFFFF" />

    <g transform="rotate(-24)">
      <circle cx="340" cy="0" r="14" fill="${c1}" stroke="#FFFFFF" stroke-width="2.5" />
      <circle cx="-340" cy="0" r="10" fill="${c2}" stroke="#FFFFFF" stroke-width="2" />
      <circle cx="120" cy="112" r="8" fill="${c3}" stroke="#FFFFFF" stroke-width="1.5" />
    </g>
    <g transform="rotate(32)">
      <circle cx="280" cy="0" r="12" fill="${c2}" stroke="#FFFFFF" stroke-width="2" />
      <circle cx="-280" cy="0" r="9" fill="${c4}" stroke="#FFFFFF" stroke-width="1.5" />
    </g>
    <g transform="rotate(-62)">
      <circle cx="0" cy="70" r="10" fill="${c3}" stroke="#FFFFFF" stroke-width="2" />
      <circle cx="0" cy="-70" r="8" fill="${c1}" stroke="#FFFFFF" stroke-width="1.5" />
    </g>
  </g>`;
}

function buildGenerativeCoverArtSvg(colors, width, height, options = {}) {
  const isWidescreen = typeof options === 'boolean' ? options : Boolean(options.isWidescreen);
  const modelType = typeof options === 'string' ? options : (options.modelType || arguments[4] || null);

  if (modelType === 'contour_wave_ribbons') {
    return buildWaveRibbonSvg(colors, width, height, isWidescreen);
  }
  if (modelType === 'isometric_tech_monoliths') {
    return buildIsometricMonolithSvg(colors, width, height, isWidescreen);
  }
  if (modelType === 'orbital_quantum_rings') {
    return buildOrbitalRingsSvg(colors, width, height, isWidescreen);
  }
  return buildGeometricPolyhedraSvg(colors, width, height, isWidescreen);
}

module.exports = {
  buildGeometricPolyhedraSvg,
  buildWaveRibbonSvg,
  makeIsoBlock,
  buildIsometricMonolithSvg,
  buildOrbitalRingsSvg,
  buildGenerativeCoverArtSvg
};
