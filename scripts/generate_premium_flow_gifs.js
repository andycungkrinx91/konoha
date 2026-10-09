#!/usr/bin/env node
// Generates the premium flow GIFs embedded in the README:
//   assets/konoha-orchestration-flow.gif  — MCP orchestration & execution flow
//   assets/konoha-jonin-flow.gif          — Jonin premium UI build pipeline
//   assets/konoha-kage-gate.gif           — Kage final review gate
//   assets/konoha-qa-flow.gif            — Anbu QA automation workflow
//   assets/konoha-telegram-flow.gif      — Telegram remote workflow & Kage gate notifier
'use strict';

const {
  THEME,
  baseCanvas,
  glassCard,
  stepBadge,
  connector,
  curveConnector,
  pulse,
  pathPoint,
  insideNode,
  drawChrome,
  stamp,
  ringGauge,
  metricBar,
  saveAsset,
} = require('./lib/premium_gif');

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

function frame(W, H, paint, duration) {
  const canvas = baseCanvas(W, H);
  const ctx = canvas.getContext('2d');
  paint(ctx);
  return { canvas, duration };
}

function drawFeedbackLoop(ctx, pathPts, alpha, dashOffset, text, tx, ty) {
  if (alpha <= 0) return;
  connector(ctx, pathPts, {
    from: THEME.red, to: THEME.amber, alpha, dashed: true, dash: [5, 5], dashOffset,
  });
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = '10px "KonohaMono"';
  ctx.fillStyle = 'rgba(248,113,113,0.95)';
  ctx.textAlign = 'left';
  ctx.fillText(text, tx, ty);
  ctx.restore();
}

function drawReviewMetricsPanel(ctx, cfg) {
  const { cx, cy, r, pct, threshold, label, bars, baseY, fillDenom, statusText, statusY, approved, stampText, stampY } = cfg;
  ringGauge(ctx, cx, cy, r, pct, { threshold, label });
  const fill = Math.min(1, pct / fillDenom);
  bars.forEach((b, i) => {
    metricBar(ctx, 660, baseY + i * 36, 460, b.label, Math.round(b.val * fill), b.accent, 1);
  });
  if (pct > 0 && !approved && statusText) {
    ctx.save();
    ctx.font = '13px "KonohaMonoBold"';
    ctx.fillStyle = 'rgba(248,113,113,0.95)';
    ctx.textAlign = 'center';
    ctx.fillText(statusText, cx, statusY);
    ctx.restore();
  }
  if (approved && stampText) {
    stamp(ctx, cx, stampY, stampText, THEME.emerald, 1, -0.06);
  }
}

/* ================================================================== *
 * 1. MCP Orchestration & Execution Flow
 * ================================================================== */

function orchestrationScene() {
  const W = 1200;
  const H = 675;

  const N = {
    prompt: { x: 60, y: 100, w: 190, h: 52, accent: THEME.blue, title: 'USER PROMPT', detail: 'user · resume' },
    orch: { x: 330, y: 92, w: 250, h: 68, accent: THEME.violet, title: 'PRIMARY ORCHESTRATOR', detail: 'main agent · 7 coding clients' },
    ctx: { x: 60, y: 205, w: 350, h: 58, accent: THEME.emerald, title: '1. PROJECT MEMORY & CONTEXT', detail: 'stack detect · auto-inject invariants' },
    disc: { x: 500, y: 205, w: 350, h: 58, accent: THEME.cyan, title: '2. DISCOVER SKILL & HYGIENE', detail: 'find_skill · semble.search · aislop_scan' },
    dele: { x: 330, y: 312, w: 350, h: 58, accent: THEME.violet, title: '3. STRUCTURED MCP DELEGATION', detail: 'delegate_to_jonin / anbu / kage' },
    agents: { x: 345, y: 418, w: 510, h: 74, accent: THEME.violet, title: '4. SPECIALIST NINJA AGENTS', detail: 'single-thread persona adoption', chips: ['genin', 'kage', 'jonin', 'anbu', 'chunin', 'tokubetsu'] },
    report: { x: 60, y: 545, w: 170, h: 52, accent: THEME.emerald, title: '5. REPORT', detail: 'report_from_agent' },
    kage: { x: 285, y: 535, w: 240, h: 62, accent: THEME.amber, title: '6. KAGE REVIEW GATE', detail: 'zero-AI-slop · ≥98% conf' },
    synth: { x: 580, y: 545, w: 170, h: 52, accent: THEME.violet, title: '7. SYNTHESIZE', detail: 'sannin final report' },
    resp: { x: 820, y: 545, w: 160, h: 52, accent: THEME.blue, title: 'RESPONSE', detail: 'to user' },
  };
  const order = ['prompt', 'orch', 'ctx', 'disc', 'dele', 'agents', 'report', 'kage', 'synth', 'resp'];

  const ARROWS = [
    [[250, 126], [330, 126]],
    [[400, 160], [240, 182], [240, 205]],
    [[520, 160], [675, 182], [675, 205]],
    [[410, 234], [505, 272], [505, 312]],
    [[675, 263], [560, 312]],
    [[505, 370], [505, 418]],
    [[380, 492], [160, 520], [160, 545]],
    [[230, 571], [285, 571]],
    [[525, 566], [580, 566]],
    [[750, 571], [820, 571]],
  ];

  const REMED_START = [365, 535];
  const REMED_CTRL = [295, 450];
  const REMED_END = [390, 370];

  const PULSE_PATH = [
    [250, 126], [455, 126], [675, 160], [675, 263], [505, 312],
    [505, 492], [405, 535], [405, 566], [750, 571], [900, 571],
  ];

  const chrome = (ctx) =>
    drawChrome(ctx, W, H, {
      title: 'KONOHA MCP ORCHESTRATION & EXECUTION FLOW',
      subtitle: 'Single-Thread Persona Adoption via MCP Tools · v2.1.17',
      badge: '83–98% TOKEN SAVINGS',
      footer: '40 canonical MCP tools · 7 coding clients · zero process cold-start · transparent delegate.md / result.md contracts',
    });

  const paint = (opts) => (ctx) => {
    chrome(ctx);
    const { nodeCount, arrowCount, dashOffset, remedAlpha = 0, pulseT = -1, glowKey = null } = opts;
    for (let i = 0; i < arrowCount; i++) {
      connector(ctx, ARROWS[i], { dashOffset, width: 1.8 });
    }
    if (remedAlpha > 0) {
      curveConnector(ctx, REMED_START, REMED_CTRL, REMED_END, THEME.amber, { alpha: remedAlpha, dashOffset, dash: [5, 5] });
      ctx.save();
      ctx.globalAlpha = remedAlpha;
      ctx.font = '10px "KonohaMono"';
      ctx.fillStyle = 'rgba(245,158,11,0.9)';
      ctx.textAlign = 'center';
      ctx.fillText('slop-fix · ≤7 cycles', 250, 462);
      ctx.restore();
    }
    let pulsePos = null;
    if (pulseT >= 0) pulsePos = pathPoint(PULSE_PATH, pulseT);
    for (let i = 0; i < nodeCount; i++) {
      const key = order[i];
      const glow = key === glowKey || (pulsePos && insideNode(N[key], pulsePos[0], pulsePos[1], 10));
      glassCard(ctx, N[key], { glow: !!glow });
    }
    if (pulsePos) pulse(ctx, pulsePos[0], pulsePos[1], THEME.cyan);
  };

  const frames = [];
  const rev = [
    { d: 1400, o: { nodeCount: 0, arrowCount: 0 } },
    { d: 450, o: { nodeCount: 1, arrowCount: 0 } },
    { d: 450, o: { nodeCount: 2, arrowCount: 1 } },
    { d: 650, o: { nodeCount: 4, arrowCount: 3 } },
    { d: 550, o: { nodeCount: 5, arrowCount: 5 } },
    { d: 700, o: { nodeCount: 6, arrowCount: 6 } },
    { d: 650, o: { nodeCount: 10, arrowCount: 10 } },
    { d: 550, o: { nodeCount: 10, arrowCount: 10, remedAlpha: 1 } },
  ];
  for (const r of rev) frames.push(frame(W, H, paint({ ...r.o, dashOffset: 0 }), r.d));
  for (let i = 0; i < 10; i++) {
    frames.push(frame(W, H, paint({ nodeCount: 10, arrowCount: 10, remedAlpha: 1, dashOffset: -i * 11 }), 90));
  }
  for (let i = 0; i <= 14; i++) {
    frames.push(frame(W, H, paint({ nodeCount: 10, arrowCount: 10, remedAlpha: 1, dashOffset: -i * 8, pulseT: i / 14 }), 120));
  }
  frames.push(frame(W, H, paint({ nodeCount: 10, arrowCount: 10, remedAlpha: 1, dashOffset: -60, glowKey: 'kage' }), 1100));
  saveAsset(frames, 'konoha-orchestration-flow.gif');
}

/* ================================================================== *
 * 2. Jonin Premium UI Build Pipeline
 * ================================================================== */

function joninScene() {
  const W = 1200;
  const H = 760;
  const X = 300;
  const NW = 600;
  const NH = 56;

  const defs = [
    { title: 'USER PROMPT', detail: 'build portfolio website', accent: THEME.blue },
    { title: 'BUILD SPEC GENERATION', detail: 'framework · archetype · taste dials', accent: THEME.violet, note: 'src/mcp/build_spec.js' },
    { title: 'TASTE-SKILL DESIGN ENGINE', chips: ['DESIGN_VARIANCE 8', 'MOTION_INTENSITY 7', 'VISUAL_DENSITY 6'], accent: THEME.violet, note: 'tasteskill.dev' },
    { title: 'SCAFFOLD & COMPOSE', detail: 'pnpm · 10 themes · hero carousel', accent: THEME.cyan },
    { title: 'HUMAN-BUILT FINGERPRINT', detail: 'Phosphor icons · custom assets · no generator tags', accent: THEME.emerald, note: 'PLAN_HUMAN_BUILT' },
    { title: 'ANTI-SLOP DELIVERY GATE', detail: 'aislop scan 100/100 · antislop rules', accent: THEME.amber },
    { title: 'KAGE REVIEW', detail: '≥98% confidence · security · rollback', accent: THEME.amber },
    { title: 'PREMIUM WEBSITE', detail: 'delivered · zero AI fingerprints', accent: THEME.emerald },
  ];
  const nodes = defs.map((d, i) => ({ ...d, x: X, y: 96 + i * 78, w: NW, h: NH }));
  const spine = (i) => [[600, nodes[i].y + NH], [600, nodes[i + 1].y]];

  const chrome = (ctx) =>
    drawChrome(ctx, W, H, {
      title: 'JONIN PREMIUM UI BUILD PIPELINE',
      subtitle: 'build_from_text / build_from_source · Taste-Skill Design Engine · v2.1.17',
      badge: 'PREMIUM UI AGENT',
      footer: 'design match comparison · component architecture · 3D web experiences · Phosphor icons — never Lucide',
    });

  const paint = (opts) => (ctx) => {
    chrome(ctx);
    const { nodeCount, dashOffset, pulseT = -1, final = false } = opts;
    for (let i = 0; i < nodeCount - 1; i++) {
      connector(ctx, spine(i), { dashOffset, width: 1.8 });
    }
    let pulsePos = null;
    if (pulseT >= 0) pulsePos = pathPoint([[600, 96], [600, nodes[7].y + NH / 2]], pulseT);
    for (let i = 0; i < nodeCount; i++) {
      const glow = (pulsePos && insideNode(nodes[i], pulsePos[0], pulsePos[1], 10)) || (final && i === 7);
      glassCard(ctx, nodes[i], { glow: !!glow });
      stepBadge(ctx, X - 32, nodes[i].y + NH / 2, i + 1, nodes[i].accent, 1, !!glow);
      if (nodes[i].note) {
        ctx.save();
        ctx.font = '10px "KonohaMono"';
        ctx.fillStyle = 'rgba(125,146,184,0.85)';
        ctx.textAlign = 'left';
        ctx.fillText(nodes[i].note, X + NW + 18, nodes[i].y + NH / 2 + 3.5);
        ctx.restore();
      }
    }
    if (pulsePos) pulse(ctx, pulsePos[0], pulsePos[1], THEME.violet);
    if (final) stamp(ctx, 985, nodes[7].y + NH / 2, 'DELIVERED', THEME.emerald, 1, -0.08);
  };

  const frames = [];
  frames.push(frame(W, H, paint({ nodeCount: 0, dashOffset: 0 }), 1300));
  for (let n = 1; n <= 8; n++) frames.push(frame(W, H, paint({ nodeCount: n, dashOffset: 0 }), 380));
  for (let i = 0; i < 10; i++) frames.push(frame(W, H, paint({ nodeCount: 8, dashOffset: -i * 11 }), 90));
  for (let i = 0; i <= 15; i++) frames.push(frame(W, H, paint({ nodeCount: 8, dashOffset: -i * 8, pulseT: i / 15 }), 110));
  frames.push(frame(W, H, paint({ nodeCount: 8, dashOffset: -60, final: true }), 1200));
  saveAsset(frames, 'konoha-jonin-flow.gif');
}

/* ================================================================== *
 * 3. Kage Final Review Gate
 * ================================================================== */

function kageScene() {
  const W = 1200;
  const H = 675;

  const steps = [
    { title: 'SUBMISSION', detail: 'all tasks completed · validation evidence', accent: THEME.blue },
    { title: 'STEP 1 · AISLOP SCAN', detail: 'changed files only · score 100 · 0 findings', accent: THEME.cyan },
    { title: 'STEP 2 · ANTI-SLOP RULES', detail: 'vendored antislop filters · 0 findings', accent: THEME.cyan },
    { title: 'VERIFICATION MATRIX', detail: 'tasks ✓ · security ✓ · rollback ✓', accent: THEME.violet },
    { title: 'CONFIDENCE COMPUTATION', detail: 'every category ≥ 98%', accent: THEME.violet },
  ].map((d, i) => ({ ...d, x: 60, y: 96 + i * 82, w: 520, h: 64 }));

  const BARS = [
    { label: 'TASKS VERIFIED', val: 100, accent: THEME.violet },
    { label: 'SECURITY REVIEW', val: 100, accent: THEME.cyan },
    { label: 'ROLLBACK PLAN', val: 98, accent: THEME.amber },
    { label: 'AI-SLOP CLEAN', val: 100, accent: THEME.emerald },
  ];
  const REMED_PATH = [[60, 456], [30, 456], [30, 210], [60, 210]];

  const chrome = (ctx) =>
    drawChrome(ctx, W, H, {
      title: 'KAGE FINAL REVIEW GATE',
      subtitle: 'PLAN_NATIVE_SDLC §2.4 · hard-mandatory delivery gate · v2.1.17',
      badge: 'ZERO-AI-SLOP PRE-GATE',
      badgeAccent: THEME.amber,
      footer: 'aislop_scan → anti-slop rules → result / fixing · remediation loop ≤7 cycles · sannin synthesizes on APPROVED',
    });

  const paint = (opts) => (ctx) => {
    chrome(ctx);
    const { stepCount, dashOffset, remedAlpha = 0, pct = 0, approved = false } = opts;
    for (let i = 0; i < stepCount - 1; i++) {
      connector(ctx, [[320, steps[i].y + 64], [320, steps[i + 1].y]], { dashOffset, width: 1.8 });
    }
    drawFeedbackLoop(ctx, REMED_PATH, remedAlpha, dashOffset, 'FAIL <98% → remediate & re-dispatch', 66, 512);
    for (let i = 0; i < stepCount; i++) glassCard(ctx, steps[i], {});
    drawReviewMetricsPanel(ctx, {
      cx: 890, cy: 250, r: 105, pct, threshold: 98, label: 'KAGE CONFIDENCE',
      bars: BARS, baseY: 420, fillDenom: 98, statusText: 'BLOCKED', statusY: 388,
      approved, stampText: 'DELIVERY APPROVED', stampY: 588,
    });
  };

  const frames = [];
  frames.push(frame(W, H, paint({ stepCount: 0, dashOffset: 0 }), 1300));
  for (let n = 1; n <= 5; n++) frames.push(frame(W, H, paint({ stepCount: n, dashOffset: 0 }), 420));
  frames.push(frame(W, H, paint({ stepCount: 5, dashOffset: 0, remedAlpha: 1, pct: 0 }), 600));
  const COUNT = 20;
  for (let i = 1; i <= COUNT; i++) {
    const pct = Math.round(easeOutCubic(i / COUNT) * 98);
    frames.push(frame(W, H, paint({ stepCount: 5, dashOffset: -i * 8, remedAlpha: 1, pct, approved: pct >= 98 }), 110));
  }
  frames.push(frame(W, H, paint({ stepCount: 5, dashOffset: -80, remedAlpha: 1, pct: 98, approved: true }), 1300));
  saveAsset(frames, 'konoha-kage-gate.gif');
}

/* ================================================================== *
 * 4. Anbu QA Automation Workflow
 * ================================================================== */

function qaScene() {
  const W = 1200;
  const H = 760;

  const steps = [
    { title: '1. TASK & PORT ISOLATION', detail: 'QA scope identified · preview server isolated on port 4173', accent: THEME.blue },
    { title: '2. AGENT-BROWSER EXPLORATION', detail: 'interactive discovery · scoped snapshot -i -c (<500 tokens)', accent: THEME.cyan },
    { title: '3. DECLARATIVE FLOW SPEC', detail: 'tests/e2e/flows/*.json declarative schema · semantic locators', accent: THEME.cyan },
    { title: '4. DETERMINISTIC QA_CODIFY', detail: 'qaCodify compiler · lint gate · clean .spec.js generated', accent: THEME.violet },
    { title: '5. RED RUN VERIFICATION', detail: 'qa_e2e_run reproduces failure · failure stack extracted', accent: THEME.red },
    { title: '6. TARGETED REMEDIATION', detail: 'Anbu backend fix / Jonin UI fix · zero untouched code changes', accent: THEME.amber },
    { title: '7. GREEN RUN VERIFICATION', detail: 'qa_e2e_run passes · 0 failures · unique run_id (<2000 chars)', accent: THEME.emerald },
    { title: '8. DOGFOOD REPORT & KAGE GATE', detail: 'markdown dogfood report · Kage reviewer confidence ≥98%', accent: THEME.emerald },
  ].map((d, i) => ({ ...d, x: 60, y: 96 + i * 78, w: 540, h: 58 }));

  const BARS = [
    { label: 'TOKEN REDUCTION (VS RAW)', val: 92, accent: THEME.emerald },
    { label: 'JSON OUTPUT CHAR CAP', val: 100, accent: THEME.cyan },
    { label: 'ZERO-AI-SLOP SCORE', val: 100, accent: THEME.emerald },
    { label: 'KAGE GATE CONFIDENCE', val: 98, accent: THEME.violet },
  ];

  const LOOP_PATH = [[600, 437], [635, 437], [635, 515], [600, 515]];

  const chrome = (ctx) =>
    drawChrome(ctx, W, H, {
      title: 'ANBU QA AUTOMATION WORKFLOW',
      subtitle: 'agent-browser scoped exploration · flows/*.json · qa_codify · qa_e2e_run loop · v2.1.17',
      badge: 'QA AUTOMATION PIPELINE',
      badgeAccent: THEME.emerald,
      footer: 'token-efficient browser QA · Playwright compilation · isolated preview port · 0 slop · Anbu owner',
    });

  const paint = (opts) => (ctx) => {
    chrome(ctx);
    const { stepCount, dashOffset, loopAlpha = 0, pct = 0, approved = false } = opts;
    for (let i = 0; i < stepCount - 1; i++) {
      connector(ctx, [[330, steps[i].y + 58], [330, steps[i + 1].y]], { dashOffset, width: 1.8 });
    }
    drawFeedbackLoop(ctx, LOOP_PATH, loopAlpha, dashOffset, 'FAIL (RED) → fix', 640, 480);
    for (let i = 0; i < stepCount; i++) glassCard(ctx, steps[i], {});
    drawReviewMetricsPanel(ctx, {
      cx: 890, cy: 240, r: 100, pct, threshold: 98, label: 'E2E PASS RATE',
      bars: BARS, baseY: 410, fillDenom: 98, statusText: 'TESTING', statusY: 375,
      approved, stampText: 'QA VERIFIED', stampY: 595,
    });
  };

  const frames = [];
  frames.push(frame(W, H, paint({ stepCount: 0, dashOffset: 0 }), 1300));
  for (let n = 1; n <= 8; n++) frames.push(frame(W, H, paint({ stepCount: n, dashOffset: 0 }), 380));
  frames.push(frame(W, H, paint({ stepCount: 8, dashOffset: 0, loopAlpha: 1, pct: 0 }), 600));
  const COUNT = 20;
  for (let i = 1; i <= COUNT; i++) {
    const pct = Math.round(easeOutCubic(i / COUNT) * 100);
    frames.push(frame(W, H, paint({ stepCount: 8, dashOffset: -i * 8, loopAlpha: 1, pct, approved: pct >= 98 }), 110));
  }
  frames.push(frame(W, H, paint({ stepCount: 8, dashOffset: -80, loopAlpha: 1, pct: 100, approved: true }), 1300));
  saveAsset(frames, 'konoha-qa-flow.gif');
}

/* ================================================================== *
 * 5. Telegram Remote Workflow & Kage Gate Notifier
 * ================================================================== */

function telegramScene() {
  const W = 1200;
  const H = 760;

  const steps = [
    { title: '1. TELEGRAM INGRESS / PROMPT', detail: '/run <task> · /sh <cmd> · /session · /kage · plain text prompt', accent: THEME.blue },
    { title: '2. CHAT_ID WHITELIST GATE', detail: 'outbound HTTPS long polling · unauthorized senders dropped', accent: THEME.cyan },
    { title: '3. SECURITY GUARDRAILS', detail: 'isDangerousCommand blocks destructive patterns · safe workspace check', accent: THEME.cyan },
    { title: '4. UNIFIED PROMPT QUEUE', detail: 'atomic SQLite state machine (pending) · ~/.konoha/inbox/ session mirror', accent: THEME.violet },
    { title: '5. AUTONOMOUS WORKER', detail: 'operational branch (0 tokens) / AI coding branch (headless agy -p)', accent: THEME.violet },
    { title: '6. TASK EXECUTION & EVIDENCE', detail: 'target workspace runner · token savings recorded (83%–98%)', accent: THEME.emerald },
    { title: '7. KAGE REVIEW GATE', detail: '100/100 zero-AI-slop scan · verification evidence ≥98% confidence', accent: THEME.amber },
    { title: '8. OUTBOUND TELEGRAM REPORT', detail: 'zero-emoji [KONOHA TASK REPORT] / [KAGE REVIEW GATE PASSED] delivered', accent: THEME.emerald },
  ].map((d, i) => ({ ...d, x: 60, y: 96 + i * 78, w: 540, h: 58 }));

  const BARS = [
    { label: 'CHAT ID WHITELIST GATED', val: 100, accent: THEME.cyan },
    { label: 'ZERO-EMOJI STANDARD', val: 100, accent: THEME.emerald },
    { label: 'TOKEN REDUCTION (SAVED)', val: 97, accent: THEME.emerald },
    { label: 'KAGE GATE CONFIDENCE', val: 100, accent: THEME.violet },
  ];

  const chrome = (ctx) =>
    drawChrome(ctx, W, H, {
      title: 'TELEGRAM REMOTE WORKFLOW & KAGE GATE NOTIFIER',
      subtitle: 'Native Long Polling · Whitelist Gated · Dual-Mode Ingress · One-Way Gate Alert · v2.1.17',
      badge: 'REMOTE AUTOMATION',
      badgeAccent: THEME.cyan,
      footer: '0 open ports · outbound HTTPS · zero-emoji reports · instant mobile delivery on Kage approval',
    });

  const paint = (opts) => (ctx) => {
    chrome(ctx);
    const { stepCount, dashOffset, pct = 0, approved = false } = opts;
    for (let i = 0; i < stepCount - 1; i++) {
      connector(ctx, [[330, steps[i].y + 58], [330, steps[i + 1].y]], { dashOffset, width: 1.8 });
    }
    for (let i = 0; i < stepCount; i++) glassCard(ctx, steps[i], {});
    drawReviewMetricsPanel(ctx, {
      cx: 890, cy: 240, r: 100, pct, threshold: 98, label: 'GATE CONFIDENCE',
      bars: BARS, baseY: 410, fillDenom: 98, statusText: 'PROCESSING', statusY: 375,
      approved, stampText: 'TELEGRAM DELIVERED', stampY: 595,
    });
  };

  const frames = [];
  frames.push(frame(W, H, paint({ stepCount: 0, dashOffset: 0 }), 1300));
  for (let n = 1; n <= 8; n++) frames.push(frame(W, H, paint({ stepCount: n, dashOffset: 0 }), 380));
  frames.push(frame(W, H, paint({ stepCount: 8, dashOffset: 0, pct: 0 }), 600));
  const COUNT = 20;
  for (let i = 1; i <= COUNT; i++) {
    const pct = Math.round(easeOutCubic(i / COUNT) * 100);
    frames.push(frame(W, H, paint({ stepCount: 8, dashOffset: -i * 8, pct, approved: pct >= 98 }), 110));
  }
  frames.push(frame(W, H, paint({ stepCount: 8, dashOffset: -80, pct: 100, approved: true }), 1300));
  saveAsset(frames, 'konoha-telegram-flow.gif');
}

/* ------------------------------------------------------------------ */

function main() {
  console.log('=== Konoha premium flow GIFs ===');
  orchestrationScene();
  joninScene();
  kageScene();
  qaScene();
  telegramScene();
  console.log('✓ All premium flow GIFs generated.');
}

main();
