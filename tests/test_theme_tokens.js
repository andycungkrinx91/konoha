#!/usr/bin/env node
'use strict';

/**
 * tests/test_theme_tokens.js — Assert the Konoha theme contract stays coherent:
 *  - exactly the ten canonical palettes with their exact names and 4 ordered stops
 *  - explicit light + dark token matrices (core surfaces, text, borders, states)
 *  - apps/web/src/app.css mirrors the default Light/Dark token matrix
 *  - no component reintroduces hardcoded light-only Tailwind surfaces
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WEB_SRC = path.join(ROOT, 'apps', 'web', 'src');

function read(file) {
  return fs.readFileSync(path.join(WEB_SRC, file), 'utf-8');
}

const CANONICAL_STOPS = {
  chidori: ['#10132B', '#35206B', '#8B5CF6', '#FF4FA3'],
  byakugan: ['#0B1729', '#124A72', '#0788C9', '#36DFFF'],
  'konoha-leaf': ['#101D13', '#285225', '#68A82E', '#B8FF49'],
  rasengan: ['#21102B', '#66245E', '#D946EF', '#FF8748'],
  sharingan: ['#101A35', '#263F8F', '#4F83FF', '#B18CFF'],
  'hokage-gold': ['#251016', '#70202B', '#F04452', '#FF8A38'],
  'anbu-shadow': ['#0C2525', '#11665E', '#19B5A5', '#65F5D5'],
  'sage-mode': ['#1C1030', '#633078', '#FF42C8', '#35E8FF'],
  'sound-village': ['#21190D', '#6B4517', '#D9A52E', '#FFE477'],
  akatsuki: ['#0B211D', '#126447', '#21C98B', '#58FFE0']
};

const REQUIRED_TOKEN_KEYS = [
  'bg', 'surface', 'surfaceHover', 'surfaceActive', 'border', 'text', 'textMuted', 'cardBg', 'cardBorder'
];

async function run() {
  console.log('Running test_theme_tokens tests...');
  const themeFile = read('lib/state/themeState.svelte.js');
  const appCss = read('app.css');

  // Evaluate the module with a stubbed rune so plain Node can read THEMES.
  const runnable = themeFile
    .replace(/^\/\* eslint-disable no-undef \*\/\n/, '')
    .replace(/^export /gm, '');
  const factory = new Function('$state', runnable + '\nreturn { THEMES };');
  const { THEMES } = factory((initial) => initial);

  // 1. Ten canonical palettes, exact ids/stops/order.
  assert.strictEqual(THEMES.length, 10, 'Theme picker must expose exactly 10 palettes');
  for (const [id, stops] of Object.entries(CANONICAL_STOPS)) {
    const theme = THEMES.find(t => t.id === id);
    assert.ok(theme, `Missing canonical palette: ${id}`);
    assert.deepStrictEqual(theme.gradient, stops, `${id} must keep its ordered 4-stop gradient`);
    assert.ok(['Cyberpunk', 'Hacker', 'General UI'].includes(theme.category), `${id} has an unknown category`);
  }

  // 2. Every palette defines both appearance modes with complete semantic tokens.
  for (const theme of THEMES) {
    for (const mode of ['light', 'dark']) {
      const tokens = theme[mode];
      assert.ok(tokens, `${theme.id} is missing its ${mode} token matrix`);
      for (const key of REQUIRED_TOKEN_KEYS) {
        assert.ok(typeof tokens[key] === 'string' && tokens[key].length > 0, `${theme.id}.${mode}.${key} is missing`);
      }
    }
  }

  // 3. applyTheme writes the full semantic contract (incl. mode-aware surfaces/glow).
  const contractVars = [
    '--theme-bg', '--theme-surface', '--theme-surface-raised', '--theme-surface-hover',
    '--theme-surface-active', '--theme-overlay', '--theme-text', '--theme-text-secondary',
    '--theme-muted', '--theme-text-disabled', '--theme-text-inverse', '--theme-border',
    '--theme-border-strong', '--theme-border-subtle', '--theme-focus', '--theme-link',
    '--theme-selection', '--theme-success', '--theme-warning', '--theme-danger', '--theme-info',
    '--gradient-1', '--gradient-2', '--gradient-3', '--gradient-4', '--gradient',
    '--theme-gradient', '--theme-glow', '--shadow-3d', '--shadow-3d-hover',
    '--glass-edge', '--glass-highlight'
  ];
  for (const name of contractVars) {
    assert.ok(themeFile.includes(`'${name}'`), `themeState must set ${name}`);
  }

  // 4. app.css mirrors the default Light/Dark token matrix.
  const modeDefault = (selector) => {
    let from = 0;
    const blocks = [];
    while (true) {
      const start = appCss.indexOf(selector, from);
      if (start === -1) break;
      const end = appCss.indexOf('\n}', start);
      assert.ok(end !== -1, `Unterminated block for ${selector}`);
      blocks.push(appCss.slice(start, end));
      from = end + 1;
    }
    assert.ok(blocks.length > 0, `app.css is missing ${selector}`);
    return blocks.join('\n');
  };
  const light = modeDefault('html.theme-light {');
  const dark = modeDefault('html.theme-dark {');
  for (const name of ['--theme-text-disabled', '--theme-focus', '--theme-link', '--theme-success', '--theme-warning', '--theme-danger', '--theme-info']) {
    assert.ok(light.includes(name), `html.theme-light default is missing ${name}`);
  }
  assert.ok(dark.includes('--theme-text-disabled: #94a3b8'), 'Dark disabled text must stay legible (#94a3b8)');
  assert.ok(dark.includes('--theme-success: #34d399'), 'Dark success accent must be lifted for contrast');

  // 5. Palette-driven neutral utilities exist for both modes.
  for (const util of ['theme-bg-surface', 'theme-text-muted', 'badge-status-danger', 'bg-status-info-soft']) {
    assert.ok(appCss.includes(`.${util}`), `app.css is missing .${util}`);
  }

  // 6. No component may reintroduce hardcoded light-only surfaces.
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.svelte')) continue;
      const content = fs.readFileSync(full, 'utf-8');
      const matches = content.match(/(?<![\w:-])(bg-white|bg-slate-(50|100|200)|bg-gray-(50|100|200)|text-slate-(400|500|600|700|800|900)|text-gray-(400|500|600|700|800|900)|border-slate-(100|200|300)|border-gray-(200|300)|divide-slate-(100|200))\b/g);
      if (matches) offenders.push(`${path.relative(ROOT, full)}: ${[...new Set(matches)].join(', ')}`);
    }
  };
  walk(WEB_SRC);
  assert.deepStrictEqual(offenders, [], `Hardcoded light utility classes found:\n${offenders.join('\n')}`);

  console.log('✓ 10 canonical palettes with ordered 4-stop gradients');
  console.log('✓ Light and Dark semantic token matrices complete');
  console.log('✓ applyTheme writes the full semantic + depth contract');
  console.log('✓ app.css mirrors mode defaults and palette-driven utilities');
  console.log('✓ No hardcoded light-only surfaces in components');
}

run().then(() => {
  console.log('✅ All test_theme_tokens tests passed!');
  process.exit(0);
}).catch(err => {
  console.error('❌ test_theme_tokens failed:', err.message || err);
  process.exit(1);
});
