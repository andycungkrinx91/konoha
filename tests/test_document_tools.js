/**
 * Test Suite: Document Engine Tools (document_create, spreadsheet_create, presentation_create, diagram_create, animation_export)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { executeToolSync, executeTool } = require('../src/mcp/tool_dispatch.js');
const { validateAnimatedWebP } = require('../src/workflow/tokubetsu-scribe/document_engine');

const TMP_DIR = path.resolve(__dirname, '.tmp_doctools');

function setup() {
  if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
  }
}

function cleanup() {
  if (fs.existsSync(TMP_DIR)) {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  }
}

function parseResult(res) {
  if (typeof res === 'object' && res !== null) return res;
  try {
    return JSON.parse(res);
  } catch (e) {
    return { raw: res };
  }
}

async function runTests() {
  console.log('\n📄 Testing Document Engine MCP Tools (src/tools/document_engine.js)...\n');
  setup();

  let passed = 0;
  let failed = 0;

  function testSync(name, fn) {
    try {
      fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}:`, err.message);
      failed++;
    }
  }

  async function testAsync(name, fn) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}:`, err.message);
      failed++;
    }
  }

  // 1. document_create (DOCX)
  testSync('document_create creates valid DOCX file', () => {
    const docxPath = path.join(TMP_DIR, 'test_doc.docx');
    const raw = executeToolSync('document_create', {
      format: 'docx',
      output_path: docxPath,
      title: 'Architecture Review',
      author: 'Andy Setiyawan',
      sections: [
        {
          title: 'Executive Summary',
          paragraphs: ['This document outlines the high-performance event bus architecture for cloud telemetry.']
        }
      ]
    });
    const result = parseResult(raw);

    assert.strictEqual(result.success, true, 'Result success should be true');
    assert.strictEqual(result.format, 'docx', 'Format should be docx');
    assert.ok(fs.existsSync(docxPath), 'DOCX file must exist on disk');
    assert.ok(fs.statSync(docxPath).size > 1000, 'DOCX file must have non-zero size');
  });

  // 2. document_create (PDF)
  await testAsync('document_create creates valid PDF file via Playwright HTML/CSS', async () => {
    const pdfPath = path.join(TMP_DIR, 'test_doc.pdf');
    const raw = await executeTool('document_create', {
      format: 'pdf',
      output_path: pdfPath,
      title: 'Service Level Agreement',
      author: 'Platform Engineering Team',
      sections: [
        {
          title: 'Core Metrics',
          paragraphs: ['All production ingress gateways maintain 99.95% availability targets evaluated per rolling 30-day window.']
        }
      ]
    });
    const result = parseResult(raw);

    assert.strictEqual(result.success, true, 'Result success should be true');
    assert.strictEqual(result.format, 'pdf', 'Format should be pdf');
    assert.ok(fs.existsSync(pdfPath), 'PDF file must exist on disk');
    assert.ok(fs.statSync(pdfPath).size > 5000, 'PDF file must have non-zero size');
  });

  // 3. spreadsheet_create (XLSX)
  testSync('spreadsheet_create creates multi-sheet XLSX with uppercase formulas', () => {
    const xlsxPath = path.join(TMP_DIR, 'test_sheet.xlsx');
    const raw = executeToolSync('spreadsheet_create', {
      output_path: xlsxPath,
      sheets: [
        {
          name: 'Q3 Budgets',
          headers: ['Category', 'Cost USD', 'Allocated USD'],
          rows: [
            ['Compute Clusters', 12500, 15000],
            ['Object Storage', 3400, 4000],
            ['Total', { formula: '=SUM(B2:B3)', result: 15900 }, { formula: '=SUM(C2:C3)', result: 19000 }]
          ]
        },
        {
          name: 'SLA Tracking',
          headers: ['Service', 'Availability', 'Target'],
          rows: [
            ['API Gateway', '99.98%', '99.90%'],
            ['Auth Service', '99.99%', '99.95%']
          ]
        }
      ]
    });
    const result = parseResult(raw);

    assert.strictEqual(result.success, true, 'Result success should be true');
    assert.strictEqual(result.sheet_count, 2, 'Sheet count should be 2');
    assert.ok(fs.existsSync(xlsxPath), 'XLSX file must exist on disk');
    assert.ok(fs.statSync(xlsxPath).size > 2000, 'XLSX file must have non-zero size');
  });

  // 4. presentation_create (PPTX)
  testSync('presentation_create creates valid PPTX with light executive slides', () => {
    const pptxPath = path.join(TMP_DIR, 'test_deck.pptx');
    const raw = executeToolSync('presentation_create', {
      output_path: pptxPath,
      title: 'DevOps Engineering Standards',
      author: 'Andy Setiyawan',
      slides: [
        {
          title: 'DevOps Engineering Standards',
          subtitle: 'Continuous Integration & Deployment Topologies'
        },
        {
          title: 'CAMS Model',
          bullets: [
            'Culture: Shared responsibility and post-incident blameless postmortems.',
            'Automation: Hermetic CI pipelines eliminating manual deployment toil.',
            'Measurement: DORA metrics guiding infrastructure investments.'
          ]
        }
      ]
    });
    const result = parseResult(raw);

    assert.strictEqual(result.success, true, 'Result success should be true');
    assert.strictEqual(result.slide_count, 2, 'Slide count should be 2');
    assert.ok(fs.existsSync(pptxPath), 'PPTX file must exist on disk');
    assert.ok(fs.statSync(pptxPath).size > 5000, 'PPTX file must have non-zero size');
  });

  // 5. diagram_create (SVG)
  testSync('diagram_create generates high-fidelity SVG diagram with nodes and edges', () => {
    const svgPath = path.join(TMP_DIR, 'test_diagram.svg');
    const raw = executeToolSync('diagram_create', {
      output_path: svgPath,
      title: 'GitOps Pipeline Topology',
      nodes: [
        { id: 'git', label: 'GitHub Repository', sublabel: 'main branch' },
        { id: 'ci', label: 'Hermetic CI Runner', sublabel: 'Docker container' },
        { id: 'reg', label: 'Artifact Registry', sublabel: 'Signed image' },
        { id: 'k8s', label: 'Production Cluster', sublabel: 'ArgoCD sync' }
      ],
      edges: [
        { from: 'git', to: 'ci', label: 'Webhook' },
        { from: 'ci', to: 'reg', label: 'Push & Sign' },
        { from: 'reg', to: 'k8s', label: 'Reconcile' }
      ]
    });
    const result = parseResult(raw);

    assert.strictEqual(result.success, true, 'Result success should be true');
    assert.strictEqual(result.node_count, 4, 'Node count should be 4');
    assert.strictEqual(result.edge_count, 3, 'Edge count should be 3');
    assert.ok(fs.existsSync(svgPath), 'SVG file must exist on disk');
    const svgContent = fs.readFileSync(svgPath, 'utf8');
    assert.ok(svgContent.includes('<svg'), 'Content must contain svg tag');
    assert.ok(svgContent.includes('GitOps Pipeline Topology'), 'Content must contain title');
  });

  // 6. animation_export (Canonical Animated WebP)
  await testAsync('animation_export converts SVG into canonical animated WebP via Playwright + FFmpeg', async () => {
    const svgPath = path.join(TMP_DIR, 'test_diagram.svg');
    const webpPath = path.join(TMP_DIR, 'test_animation.webp');

    const raw = await executeTool('animation_export', {
      input_path: svgPath,
      output_path: webpPath,
      fps: 10,
      duration: 1
    });
    const result = parseResult(raw);

    assert.strictEqual(result.success, true, 'Result success should be true');
    assert.strictEqual(result.format, 'webp', 'Format should be webp');
    assert.ok(fs.existsSync(webpPath), 'WebP file must exist on disk');
    const val = validateAnimatedWebP(webpPath);
    assert.strictEqual(val.valid, true, 'WebP must be valid bitstream');
    assert.strictEqual(val.isAnimated, true, 'WebP must be animated');
    assert.ok(val.frameCount > 0, 'Frame count must be > 0');
  });

  // 8. Dynamic recursive path resolution
  testSync('document_create dynamically creates nested parent directories', () => {
    const nestedDocx = path.join(TMP_DIR, 'nested', 'dynamic', 'deep', 'doc.docx');
    const raw = executeToolSync('document_create', {
      format: 'docx',
      output_path: nestedDocx,
      title: 'Dynamic Directory Test',
      sections: [{ title: 'Overview', paragraphs: ['Testing dynamic recursive mkdir.'] }]
    });
    const res = parseResult(raw);
    assert.strictEqual(res.success, true, 'Must succeed with dynamic nested path');
    assert.ok(fs.existsSync(nestedDocx), 'Nested file must exist on disk');
  });

  // 9. spreadsheet_create with autoFilter, kpi_cards, and column formatters
  testSync('spreadsheet_create generates autoFilter, KPI cards, and column formatters', () => {
    const advancedXlsx = path.join(TMP_DIR, 'advanced_sheet.xlsx');
    const raw = executeToolSync('spreadsheet_create', {
      output_path: advancedXlsx,
      sheets: [
        {
          name: 'Metrics',
          kpi_cards: [
            { label: 'Total Services', formula: '=COUNTA(A6:A7)', format: 'integer' },
            { label: 'Avg Availability', formula: '=AVERAGE(C6:C7)', format: 'percent' }
          ],
          headers: ['Service', 'Deployments', 'Availability', 'Run Cost'],
          columns: [
            { header: 'Service', width: 20, format: 'text' },
            { header: 'Deployments', width: 16, format: 'integer' },
            { header: 'Availability', width: 16, format: 'percent' },
            { header: 'Run Cost', width: 16, format: 'currency' }
          ],
          rows: [
            ['Edge Gateway', 42, 0.9995, 12000],
            ['Auth Engine', 18, 0.9999, 8500]
          ],
          summary: ['Average', { formula: '=AVERAGE(B6:B7)' }, { formula: '=AVERAGE(C6:C7)' }, { formula: '=SUM(D6:D7)' }]
        }
      ]
    });
    const res = parseResult(raw);
    assert.strictEqual(res.success, true, 'Advanced spreadsheet must succeed');
    assert.ok(fs.existsSync(advancedXlsx), 'Advanced XLSX must exist');
  });

  // 10. presentation_create with cards, columns, and checklist layouts
  testSync('presentation_create supports cards, columns, and checklist layouts within budget', () => {
    const deckPath = path.join(TMP_DIR, 'advanced_deck.pptx');
    const raw = executeToolSync('presentation_create', {
      output_path: deckPath,
      title: 'DevOps Architecture Deck',
      slides: [
        { layout: 'title', title: 'DevOps Standards' },
        {
          layout: 'cards',
          category: 'OPERATIONAL METRICS',
          title: 'DORA Core Indicators',
          cards: [
            { tag: 'VELOCITY', title: 'Deployment Frequency', metric: '14/day', body: 'Elite performers deploy daily.' },
            { tag: 'LATENCY', title: 'Lead Time for Changes', metric: '42 mins', body: 'Code commit to production execution.' }
          ]
        },
        {
          layout: 'columns',
          category: 'TOPOLOGY',
          title: 'Trunk Development',
          columns: [
            { title: 'Trunk-Based', bullets: ['Short branches', 'Fast merges'] },
            { title: 'GitFlow', bullets: ['Long release cycles', 'Merge friction'] }
          ]
        },
        {
          layout: 'checklist',
          category: 'GOVERNANCE',
          title: 'Production Sign-Off',
          checklist: {
            left_title: 'Pre-Deploy Gates',
            left_items: ['✓ Gate 1: SAST clean', '✓ Gate 2: SBOM signed'],
            right_title: 'Runtime Gates',
            right_items: ['✓ Gate 3: Error budget ok'],
            signoff: 'Author: Platform Team | Oct 2026'
          }
        }
      ]
    });
    const res = parseResult(raw);
    assert.strictEqual(res.success, true, 'Advanced deck must succeed');
    assert.strictEqual(res.slide_count, 4, 'Must have 4 slides');
    assert.ok(fs.existsSync(deckPath), 'Deck file must exist on disk');
  });

  // Cleanup
  cleanup();

  console.log(`\nDocument Engine Tools: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
