/**
 * Test Suite: Document Engine Tools (document_create, spreadsheet_create, presentation_create, diagram_create, animation_export)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { executeToolSync, executeTool } = require('../src/mcp/tool_dispatch.js');

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

  // 6. animation_export (GIF)
  await testAsync('animation_export converts SVG into animated GIF via Playwright + FFmpeg', async () => {
    const svgPath = path.join(TMP_DIR, 'test_diagram.svg');
    const gifPath = path.join(TMP_DIR, 'test_animation.gif');

    const raw = await executeTool('animation_export', {
      input_path: svgPath,
      output_path: gifPath,
      fps: 10,
      duration: 1
    });
    const result = parseResult(raw);

    assert.strictEqual(result.success, true, 'Result success should be true');
    assert.strictEqual(result.format, 'gif', 'Format should be gif');
    assert.ok(fs.existsSync(gifPath), 'GIF file must exist on disk');
    const buf = fs.readFileSync(gifPath);
    assert.ok(buf.length > 500, 'GIF file must have non-zero size');
    assert.strictEqual(buf.subarray(0, 3).toString('ascii'), 'GIF', 'File header must match GIF');
  });

  // 7. Error validation
  testSync('document_create errors when format is unsupported', () => {
    const raw = executeToolSync('document_create', { format: 'unsupported_ext', output_path: path.join(TMP_DIR, 'err.xyz') });
    const res = parseResult(raw);
    assert.strictEqual(res.success, false, 'Must fail on unsupported format');
    assert.ok(res.error.includes('Unsupported document format'), 'Error message must specify format error');
  });

  await testAsync('animation_export errors when input_path does not exist', async () => {
    const raw = await executeTool('animation_export', { input_path: path.join(TMP_DIR, 'nonexistent.svg'), output_path: path.join(TMP_DIR, 'err.gif') });
    const res = parseResult(raw);
    assert.strictEqual(res.success, false, 'Must fail on missing input file');
    assert.ok(res.error.includes('Input file not found'), 'Error message must specify missing input file');
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
