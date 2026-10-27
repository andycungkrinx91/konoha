'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  diagramCreate,
  animationExport,
  validateAnimatedWebP
} = require('../src/workflow/tokubetsu-scribe/document_engine');

async function runBenchmark() {
  console.log('Running GIF vs Animated WebP Compression Benchmark...');
  const tmpDir = path.join(os.tmpdir(), `konoha_bench_${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const fixtures = [
    {
      name: 'Limited-Color Flow Diagram (LR)',
      orientation: 'LR',
      gradient_theme: 'cyber_teal',
      nodes: [
        { id: 'cli', label: 'CLI Tool', subtext: 'bin/cli.js' },
        { id: 'router', label: 'Command Router', subtext: 'bin/commands/' },
        { id: 'mcp', label: 'MCP Dispatch', subtext: 'stdio JSON-RPC' }
      ],
      edges: [
        { from: 'cli', to: 'router', label: 'parse' },
        { from: 'router', to: 'mcp', label: 'invoke' }
      ]
    },
    {
      name: 'High-Color Enterprise Architecture (TB)',
      orientation: 'TB',
      gradient_theme: 'sunset_violet',
      nodes: [
        { id: 'client', label: 'Client IDE / Agent', subtext: 'Antigravity / Cursor' },
        { id: 'gateway', label: 'Bridge Router', subtext: '127.0.0.1:1404' },
        { id: 'worker', label: 'Specialist Subagent', subtext: 'Tokubetsu-Jonin' },
        { id: 'storage', label: 'SQLite Store', subtext: 'WAL + FTS5' }
      ],
      edges: [
        { from: 'client', to: 'gateway', label: 'Tool Call' },
        { from: 'gateway', to: 'worker', label: 'SOP Execution' },
        { from: 'worker', to: 'storage', label: 'Commit' }
      ]
    },
    {
      name: 'Complex Microservices Mesh (Dual Flow)',
      orientation: 'LR',
      gradient_theme: 'ocean_electric',
      nodes: [
        { id: 'ingress', label: 'Ingress LB', subtext: 'Cloudflare Tunnel' },
        { id: 'auth', label: 'Auth Guard', subtext: 'PIN Token' },
        { id: 'engine', label: 'Doc Engine', subtext: 'document_engine.js' },
        { id: 'playwright', label: 'Playwright', subtext: 'Chromium' },
        { id: 'ffmpeg', label: 'FFmpeg libwebp', subtext: 'Encoder' }
      ],
      edges: [
        { from: 'ingress', to: 'auth', label: 'Verify' },
        { from: 'auth', to: 'engine', label: 'Dispatch' },
        { from: 'engine', to: 'playwright', label: 'Render' },
        { from: 'playwright', to: 'ffmpeg', label: 'Frames' }
      ]
    }
  ];

  const results = [];

  for (let i = 0; i < fixtures.length; i++) {
    const f = fixtures[i];
    const svgPath = path.join(tmpDir, `fixture_${i}.svg`);
    await diagramCreate({
      output_path: svgPath,
      orientation: f.orientation,
      gradient_theme: f.gradient_theme,
      nodes: f.nodes,
      edges: f.edges
    });

    // 1. Export GIF
    const gifPath = path.join(tmpDir, `fixture_${i}.gif`);
    const t0Gif = Date.now();
    await animationExport({
      input_path: svgPath,
      output_path: gifPath,
      format: 'gif',
      duration_sec: 2,
      fps: 15
    });
    const gifTimeMs = Date.now() - t0Gif;
    const gifSize = fs.existsSync(gifPath) ? fs.statSync(gifPath).size : 0;

    // 2. Export WebP
    const webpPath = path.join(tmpDir, `fixture_${i}.webp`);
    const t0Webp = Date.now();
    const webpRes = await animationExport({
      input_path: svgPath,
      output_path: webpPath,
      format: 'webp',
      duration_sec: 2,
      fps: 15
    });
    const webpTimeMs = Date.now() - t0Webp;
    const webpSize = fs.existsSync(webpPath) ? fs.statSync(webpPath).size : 0;
    const validation = validateAnimatedWebP(webpPath);

    const reductionPercent = gifSize > 0 ? (((gifSize - webpSize) / gifSize) * 100).toFixed(1) : 0;

    results.push({
      fixture: f.name,
      gifSizeKb: (gifSize / 1024).toFixed(1),
      webpSizeKb: (webpSize / 1024).toFixed(1),
      reduction: `${reductionPercent}%`,
      gifTimeMs,
      webpTimeMs,
      webpValid: validation.valid && validation.isAnimated ? 'PASS' : 'FAIL',
      frames: validation.frameCount
    });
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log('\n=== REPRODUCIBLE GIF VS ANIMATED WEBP BENCHMARK RESULTS ===');
  console.log('| Fixture Name | GIF Size | WebP Size | Reduction | GIF Time | WebP Time | WebP Valid | Frames |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    console.log(`| ${r.fixture} | ${r.gifSizeKb} KB | ${r.webpSizeKb} KB | **${r.reduction}** | ${r.gifTimeMs}ms | ${r.webpTimeMs}ms | ${r.webpValid} | ${r.frames} |`);
  }
}

runBenchmark().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
