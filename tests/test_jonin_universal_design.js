'use strict';

/**
 * Regression Test Suite: Jonin Universal, Brief-Driven Design (no house template)
 * Verifies:
 * 1. Every build returns a 9-field design brief and no archetype bucket.
 * 2. Domain hints diverge across domains instead of collapsing into one bucket.
 * 3. Directives carry no template leftovers (dock, 10-theme FAB, forced carousel, filler catalog).
 * 4. Commerce language appears only for commerce briefs.
 * 5. Chunin REA research is domain-keyed and never fabricates scores or observations.
 * 6. `build_from_source` has the same brief/anti-template contract.
 * 7. Agent rule surfaces no longer mandate the old layout template.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildFromText, buildFromSource } = require('../src/mcp/build_spec');
const { inferDomainHints, DESIGN_BRIEF_FIELDS } = require('../src/mcp/build_spec_common');
const { discoverFramerMarketplaceComponents } = require('../src/workflow/chunin-intel/framer_marketplace_rea');

const PROJECTS = [
  { name: 'atelier-north', description: 'Architecture and interior studio showcasing spatial projects and materials.' },
  { name: 'clinic-vale', description: 'Pediatric clinic with practitioner profiles and online appointment booking.' },
  { name: 'ledger-review', description: 'Investigative news magazine with long-form editorial features and archives.' },
  { name: 'treasury-bank', description: 'Fintech bank treasury dashboard with account positions and payment flows.' },
  { name: 'kiln-store', description: 'Online store for handmade ceramics with product catalog and checkout.' },
  { name: 'agent-platform', description: 'AI developer platform with model SDK docs and an agent playground.' }
];

const TEMPLATE_MARKERS = ['10-Theme', '10-theme', 'Bottom Dock', 'Mobile Dock', 'hero carousel', 'four-slide', '50-item', '50-Item'];

function parseSpec(raw) {
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

function runTests() {
  // 1 & 3: brief present, archetype gone, no template leftovers
  for (const p of PROJECTS) {
    const spec = parseSpec(buildFromText(p.name, p.description, 'nextjs'));
    assert.deepStrictEqual(spec.design_brief.fields, DESIGN_BRIEF_FIELDS, `${p.name}: brief fields must be the 9 canonical keys`);
    assert.strictEqual(spec.design_brief.fields.length, 9, `${p.name}: brief must have 9 fields`);
    assert.strictEqual(spec.archetype, undefined, `${p.name}: archetype bucket must not exist`);
    assert.strictEqual(spec.design_tokens.hero_autoplay, undefined, `${p.name}: hero_autoplay must be gone`);
    assert.strictEqual(spec.design_tokens.theme_storage_key, undefined, `${p.name}: theme_storage_key must be gone`);
    assert.strictEqual(spec.design_tokens.color_modes, undefined, `${p.name}: color_modes mandate must be gone`);

    const directives = (spec.directives || []).join('\n');
    for (const marker of TEMPLATE_MARKERS) {
      assert.ok(!directives.includes(marker), `${p.name}: directive leaks template marker "${marker}"`);
    }
    assert.ok(directives.includes('Anti-Template'), `${p.name}: directives must carry the Anti-Template Gate`);
  }

  // 2: domain hints diverge
  const firstHints = PROJECTS.map((p) => inferDomainHints(p.description)[0]);
  assert.ok(firstHints.every(Boolean), 'every sample description must yield at least one domain hint');
  assert.strictEqual(new Set(firstHints).size, PROJECTS.length, `first domain hint must be distinct per project, got ${firstHints.join(',')}`);

  for (const p of PROJECTS) {
    const hints = inferDomainHints(p.description);
    const isCommerce = p.name === 'kiln-store';
    assert.strictEqual(hints.includes('ecommerce_marketplace'), isCommerce, `${p.name}: ecommerce hint must appear only for the store description`);
  }

  // 4: commerce language only when the brief asks for commerce
  const GATE_CLAUSE = 'zero unrequested commerce/SaaS/catalog/pricing/cart/checkout/testimonials';
  for (const p of PROJECTS.filter((x) => x.name !== 'kiln-store')) {
    const spec = parseSpec(buildFromText(p.name, p.description, 'nextjs'));
    const directives = (spec.directives || []).join('\n').split(GATE_CLAUSE).join('');
    for (const term of ['catalog', 'cart', 'checkout']) {
      assert.ok(!directives.includes(term), `${p.name}: directive must not force "${term}" without a commerce brief`);
    }
  }
  const storeSpec = parseSpec(buildFromText('kiln-store', 'Online store for handmade ceramics with product catalog and checkout.', 'nextjs'));
  assert.ok(storeSpec.design_brief.inferred_domain_hints.includes('ecommerce_marketplace'), 'store brief must infer ecommerce');

  // 5: REA is domain-keyed and non-fabricating
  const rea = discoverFramerMarketplaceComponents({ domainHints: ['architecture_interior'] });
  assert.ok(rea.components.length > 0, 'domain hints must produce research candidates');
  for (const c of rea.components) {
    assert.ok(c.id.startsWith('rea-architecture_interior-'), `candidate id must be domain-keyed, got ${c.id}`);
    assert.strictEqual(c.suitability_score, null, 'suitability must never be fabricated');
    assert.strictEqual(c.observed_tokens, null, 'observed tokens must never be fabricated');
    assert.strictEqual(c.preview_url, null, 'no invented preview URL');
  }
  const emptyRea = discoverFramerMarketplaceComponents({});
  assert.strictEqual(emptyRea.needs_domain_hint, true, 'empty hints must request a domain hint');
  assert.strictEqual(emptyRea.candidates, undefined);
  assert.strictEqual(emptyRea.components.length, 0, 'empty hints must return no candidates');
  assert.strictEqual(emptyRea.includes_free_and_paid, false, 'free/paid must not be claimed without real data');

  // 6: source parity — buildFromSource only accepts dirs inside the workspace root
  const { setWorkspaceRoot } = require('../src/mcp/runtime_state');
  const repoRoot = path.join(__dirname, '..');
  setWorkspaceRoot(repoRoot);
  const srcDir = fs.mkdtempSync(path.join(repoRoot, '.tmp-universal-design-'));
  try {
    fs.writeFileSync(path.join(srcDir, 'index.html'), '<!doctype html><html><body><h1>Clinic</h1></body></html>');
    fs.writeFileSync(path.join(srcDir, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const sourceSpec = parseSpec(buildFromSource('clinic-source', srcDir, 'nextjs'));
    assert.strictEqual(sourceSpec.design_tokens.theme_storage_key, undefined, 'source spec must not carry a house theme key');
    assert.strictEqual(sourceSpec.design_tokens.hero_autoplay, undefined, 'source spec must not carry hero autoplay');
    assert.ok((sourceSpec.directives || []).join('\n').includes('Anti-Template Gate'), 'source spec must run the Anti-Template Gate');
  } finally {
    fs.rmSync(srcDir, { recursive: true, force: true });
  }

  // 7: shipped agent surfaces no longer mandate the template
  for (const rel of ['src/omp_manager.js', 'src/pi_manager.js']) {
    const text = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    assert.ok(!text.includes('Mandatory Default Konoha Design & Layout Invariants'), `${rel}: template mandate block must be removed`);
    assert.ok(!text.includes('10-Theme'), `${rel}: 10-Theme switcher mandate must be removed`);
    assert.ok(!text.includes('minimum of 4 high-definition slides'), `${rel}: forced carousel mandate must be removed`);
    assert.ok(text.includes('Project-Specific Design Mandate'), `${rel}: brief-driven mandate must be present`);
  }

  console.log('✓ Jonin Universal Design: brief-driven specs, domain divergence, no template leakage, domain-keyed REA: PASSED');
}

runTests();
