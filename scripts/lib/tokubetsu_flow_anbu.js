'use strict';

/**
 * Tokubetsu-Jonin animated flow templates for Telegram, Akatsuki, Yamanaka 3D, and Anbu DB Recovery.
 * Split from tokubetsu_flow_templates.js to keep every module under 700 lines.
 */

const {
  C,
  PKG_VERSION,
  buildHtmlPage,
  renderCard,
  renderHeader,
  renderFooter,
  stdRoster,
  stdLink,
  stdNote
} = require('./tokubetsu_flow_templates');

function generateTelegramHtml() {
  const W = 1200;
  const H = 760;

  const header = renderHeader(W, 'TELEGRAM REMOTE AUTOMATION & TWO-STAGE HITL GATES', `LangGraph StateGraph Ingress · Outbound Reporter & Webhook Engine · v${PKG_VERSION}`, { text: 'HITL GATES ENABLED', col: C.azure });
  const roster = stdRoster('kage', C.azure);
  const footer = renderFooter(W, H, 'LangGraph Two-Stage HITL Gates · Outbound Reporter + Webhook Engine · 3-option [Approve] / [Reject] / [Refine] callbacks · /approval list · /doctor');

  const topTrackContainer = `
    <g transform="translate(50, 115)">
      <rect width="1100" height="225" rx="14" fill="${C.containerBg}" stroke="${C.azure}" stroke-width="1.5" />
      <text x="24" y="28" font-family="'Inter', sans-serif" font-size="12" font-weight="700" fill="${C.slateDark}">OUTBOUND TASK STATUS REPORTER &amp; WEBHOOK ENGINE (src/telegram/notifier.js &amp; src/webhook_manager.js)</text>
    </g>
  `;

  const bottomTrackContainer = `
    <g transform="translate(50, 415)">
      <rect width="1100" height="260" rx="14" fill="${C.containerBg}" stroke="${C.violet}" stroke-width="1.5" />
      <text x="24" y="28" font-family="'Inter', sans-serif" font-size="12" font-weight="700" fill="${C.slateDark}">INBOUND LONG POLLING DAEMON &amp; COMMAND ROUTER (src/telegram/poller.js &amp; session_manager.js)</text>
    </g>
  `;

  const securityBanner = `
    <g transform="translate(50, 355)">
      <rect width="1100" height="46" rx="8" fill="#FFFFFF" stroke="${C.emerald}" stroke-width="1.5" filter="url(#cardShadow)" />
      <circle cx="24" cy="23" r="5" fill="${C.emerald}" />
      <text x="38" y="28" font-family="'Inter', sans-serif" font-size="12" font-weight="700" fill="${C.slateDark}">SECURITY GUARDRAILS:</text>
      <text x="195" y="28" font-family="'Inter', sans-serif" font-size="11" fill="${C.slateMed}">Zero Open Inbound Ports · Chat ID Whitelist · Argon2id + timingSafeEqual PIN Auth · Loopback Binding (127.0.0.1:1404)</text>
    </g>
  `;

  const cards = [
    renderCard([80, 175, 220, 68], C.azure, 'SDLC TASK EVENT', 'queued / running / sign-off', 'anbu'),
    renderCard([350, 175, 230, 68], C.teal, 'TWO-STAGE HITL & REPORT', '83–98% telemetry · inline buttons', 'tokubetsu'),
    renderCard([630, 175, 230, 68], C.violet, 'TELEGRAM & WEBHOOK API', 'POST /sendMessage & webhooks', 'anbu'),
    renderCard([910, 175, 210, 68], C.emerald, 'AUTHORIZED OPERATOR', '3-option HITL inline keyboard', 'host'),
    renderCard([80, 475, 220, 72], C.azure, 'OPERATOR COMMANDS', '/approval, /doctor, /kage..yamanaka', 'host'),
    renderCard([350, 475, 230, 72], C.violet, 'WHITELISTED POLLER', 'GET /getUpdates · chat_id check', 'anbu'),
    renderCard([630, 475, 230, 72], C.amber, 'LANGGRAPH HITL RESOLUTION', 'pending_plan_approval & sign-off', 'sannin'),
    renderCard([910, 475, 210, 72], C.emerald, 'AUTONOMOUS QUEUE WORKER', 'worker.js resumes StateGraph DAG', 'anbu')
  ].join('\n');

  const paths = `
    <path class="bg-track" d="M 300 209 L 350 209" stroke="${C.teal}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 300 209 L 350 209" stroke="${C.teal}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-teal)" />
    <path class="bg-track" d="M 580 209 L 630 209" stroke="${C.violet}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 580 209 L 630 209" stroke="${C.violet}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-violet)" />
    <path class="bg-track" d="M 860 209 L 910 209" stroke="${C.emerald}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 860 209 L 910 209" stroke="${C.emerald}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-emerald)" />
    <path class="bg-track" d="M 300 511 L 350 511" stroke="${C.violet}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 300 511 L 350 511" stroke="${C.violet}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-violet)" />
    <path class="bg-track" d="M 580 511 L 630 511" stroke="${C.amber}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 580 511 L 630 511" stroke="${C.amber}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-amber)" />
    <path class="bg-track" d="M 860 511 L 910 511" stroke="${C.emerald}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 860 511 L 910 511" stroke="${C.emerald}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-emerald)" />
  `;

  return buildHtmlPage(W, H, `${header}\n${topTrackContainer}\n${bottomTrackContainer}\n${securityBanner}\n${paths}\n${cards}\n${roster}\n${footer}`);
}

function generateAkatsukiHtml() {
  const W = 1200;
  const H = 760;

  const header = renderHeader(W, 'AKATSUKI SECURITY CONTROLS & DUAL-MODE LAB LIFECYCLE', `LangGraph review_node Pre-Condition · Dual-Mode Isolation · Container Sandboxing · v${PKG_VERSION}`, { text: 'SECURITY GUARDIAN', col: C.crimson });
  const roster = stdRoster('akatsuki', C.crimson);
  const footer = renderFooter(W, H, 'LangGraph review_node Pre-Condition · mode: blue (defensive host default) · mode: red (isolated akatsuki-lab) · Written RoE gating · Persona firewall');

  const topTrackContainer = `
    <g transform="translate(40, 82)">
      <rect width="1120" height="110" rx="12" fill="${C.containerBg}" stroke="${C.azure}" stroke-width="1.5" />
      <text x="20" y="21" font-family="'Inter', sans-serif" font-size="11" font-weight="800" fill="${C.slateDark}" letter-spacing="0.5">BLUE-TEAM DEFENSIVE SECURITY TRACK (Default Mode: blue · Direct Host SAST, Socket CLI &amp; Secrets Audit)</text>
    </g>
  `;

  const middleRoeContainer = `
    <g transform="translate(40, 206)">
      <rect width="1120" height="106" rx="12" fill="${C.containerBg}" stroke="${C.amber}" stroke-width="1.5" />
      <text x="20" y="21" font-family="'Inter', sans-serif" font-size="11" font-weight="800" fill="${C.slateDark}" letter-spacing="0.5">MODE: RED AUTHORIZATION FIREWALL &amp; WRITTEN RULES OF ENGAGEMENT (RoE GATING)</text>
    </g>
  `;

  const sandboxContainer = `
    <g transform="translate(40, 326)">
      <rect width="740" height="360" rx="14" fill="${C.containerBg}" stroke="${C.crimson}" stroke-width="1.5" />
      <text x="20" y="23" font-family="'Inter', sans-serif" font-size="12" font-weight="800" fill="${C.slateDark}" letter-spacing="0.5">ISOLATED CONTAINER SANDBOX (akatsuki-lab · Zero Host Network &amp; Zero Host Mounts)</text>
      <g transform="translate(20, 306)">
        <rect width="700" height="40" rx="8" fill="#FFFFFF" stroke="${C.crimson}" stroke-width="1.5" filter="url(#cardShadow)" />
        <circle cx="20" cy="20" r="5" fill="${C.crimson}" />
        <text x="36" y="24" font-family="'Inter', sans-serif" font-size="11" font-weight="700" fill="${C.slateDark}">CONTAINER SAFETY INVARIANT: <tspan fill="${C.crimson}">Direct host execution strictly prohibited</tspan> · Dropped Capabilities (--cap-drop=ALL)</text>
      </g>
    </g>
  `;

  const rightGatePanel = `
    <g transform="translate(800, 326)">
      <rect width="360" height="360" rx="14" fill="${C.containerBg}" stroke="${C.teal}" stroke-width="1.5" />
      <text x="180" y="23" text-anchor="middle" font-family="'Inter', sans-serif" font-size="12" font-weight="800" fill="${C.slateDark}" letter-spacing="0.5">PERSONA BOUNDARY &amp; KAGE GATE</text>
    </g>
  `;

  const cards = [
    renderCard([60, 112, 180, 64], C.azure, '1. CLI INGRESS', 'konoha akatsuki [mode|env]', 'host'),
    renderCard([280, 112, 210, 64], C.violet, '2. BLUE DISPATCH', 'direct host static analysis', 'akatsuki'),
    renderCard([530, 112, 200, 64], C.teal, '3. SAST & SECRETS', 'Socket CLI · pnpm audit · .env', 'akatsuki'),
    renderCard([770, 112, 190, 64], C.violet, '4. SKILL GUARDIAN', 'fail-closed AST review', 'akatsuki'),
    renderCard([1000, 112, 140, 64], C.emerald, '5. BLUE GATE', '0 CVEs · lab stopped', 'akatsuki'),
    renderCard([60, 236, 220, 62], C.crimson, '6. MODE: RED INGRESS', 'konoha akatsuki mode red', 'host'),
    renderCard([310, 236, 260, 62], C.emerald, '7. WRITTEN RoE CHECK', 'scope · emergency cutoff · consent', 'akatsuki'),
    renderCard([600, 236, 270, 62], C.amber, '8. AUTO-PROVISION (akatsuki_init)', 'docker | lxc auto-detect · dual setup', 'akatsuki'),
    renderCard([900, 236, 240, 62], C.violet, '9. CHUNIN RECON', 'passive OSINT & ATT&CK intel', 'chunin'),
    renderCard([60, 362, 210, 64], C.amber, '10. MULTI-ENGINE SANDBOX', 'akatsuki-lab on docker | lxc', 'akatsuki'),
    renderCard([300, 362, 230, 64], C.crimson, '11. APPROVED 10-TOOL SUITE', 'nmap · nuclei · zap · trivy · ffuf', 'akatsuki'),
    renderCard([560, 362, 200, 64], C.teal, '12. EVIDENCE HARVEST', 'non-destructive PoC probes', 'akatsuki'),
    renderCard([120, 460, 290, 64], C.emerald, '13. DIAGNOSTIC CLEANUP', 'purge /tmp/akatsuki_* upon exit', 'akatsuki'),
    renderCard([440, 460, 280, 64], C.azure, '14. TOKUBETSU-JONIN PDF REPORT', 'publication-grade 8-section report', 'tokubetsu'),
    renderCard([820, 362, 320, 64], C.teal, 'STRICT PERSONA BOUNDARY', 'offensive skills restricted to @akatsuki', 'akatsuki'),
    renderCard([820, 460, 320, 64], C.crimson, 'REMEDIATION LOOP (♠ ANBU)', 'synthesizes patches for findings', 'anbu'),
    renderCard([820, 558, 320, 76], C.emerald, '15. LANGGRAPH REVIEW GATE', { detail: 'confidence ≥98% · @advisor · 0 CVEs', chips: ['0 CRIT/HIGH', 'FAIL-CLOSED'] }, 'kage')
  ].join('\n');

  const paths = `
    <path class="bg-track" d="M 240 144 L 280 144" stroke="${C.violet}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 240 144 L 280 144" stroke="${C.violet}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-violet)" />
    <path class="bg-track" d="M 490 144 L 530 144" stroke="${C.teal}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 490 144 L 530 144" stroke="${C.teal}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-teal)" />
    <path class="bg-track" d="M 730 144 L 770 144" stroke="${C.violet}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 730 144 L 770 144" stroke="${C.violet}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-violet)" />
    <path class="bg-track" d="M 960 144 L 1000 144" stroke="${C.emerald}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 960 144 L 1000 144" stroke="${C.emerald}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-emerald)" />
    <path class="bg-track" d="M 150 176 L 150 236" stroke="${C.crimson}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 150 176 L 150 236" stroke="${C.crimson}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-crimson)" />
    <path class="bg-track" d="M 280 267 L 310 267" stroke="${C.emerald}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 280 267 L 310 267" stroke="${C.emerald}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-emerald)" />
    <path class="bg-track" d="M 570 267 L 600 267" stroke="${C.amber}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 570 267 L 600 267" stroke="${C.amber}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-amber)" />
    <path class="bg-track" d="M 870 267 L 900 267" stroke="${C.violet}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 870 267 L 900 267" stroke="${C.violet}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-violet)" />
    <path class="bg-track" d="M 1020 298 C 1020 335, 165 326, 165 362" stroke="${C.amber}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 1020 298 C 1020 335, 165 326, 165 362" stroke="${C.amber}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-amber)" />
    <path class="bg-track" d="M 270 394 L 300 394" stroke="${C.crimson}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 270 394 L 300 394" stroke="${C.crimson}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-crimson)" />
    <path class="bg-track" d="M 530 394 L 560 394" stroke="${C.teal}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 530 394 L 560 394" stroke="${C.teal}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-teal)" />
    <path class="bg-track" d="M 660 426 C 660 446, 265 442, 265 460" stroke="${C.emerald}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 660 426 C 660 446, 265 442, 265 460" stroke="${C.emerald}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-emerald)" />
    <path class="bg-track" d="M 410 492 L 440 492" stroke="${C.azure}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 410 492 L 440 492" stroke="${C.azure}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-azure)" />
    <path d="M 265 524 C 265 548, 820 520, 820 492" stroke="${C.crimson}" stroke-width="2" stroke-linecap="round" stroke-dasharray="5 5" fill="none" marker-end="url(#arrow-crimson)" opacity="0.85" />
    <text x="540" y="544" font-family="'JetBrains Mono', monospace" font-size="10" font-weight="700" fill="${C.crimson}">REMEDIATION LOOP (♠ ANBU)</text>
    <path class="bg-track" d="M 720 492 C 760 492, 760 596, 820 596" stroke="${C.emerald}" stroke-width="6" stroke-opacity="0.15" fill="none" />
    <path class="flow-path" d="M 720 492 C 760 492, 760 596, 820 596" stroke="${C.emerald}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="8 6" fill="none" marker-end="url(#arrow-emerald)" />
  `;

  return buildHtmlPage(W, H, `${header}\n${topTrackContainer}\n${middleRoeContainer}\n${sandboxContainer}\n${rightGatePanel}\n${paths}\n${cards}\n${roster}\n${footer}`);
}

function generateAnbuHtml() {
  const W = 1200;
  const H = 760;

  const header = renderHeader(
    W,
    'ANBU SQLITE DISASTER RECOVERY & DB HEALTH PIPELINE',
    `konoha db check → PRAGMA quick/integrity check → verified backup rotation → atomic corrupt archive → restore | .recover salvage · v${PKG_VERSION}`,
    { text: 'FAIL-CLOSED RECOVERY', col: C.crimson }
  );
  const roster = stdRoster('anbu', C.crimson);
  const footer = renderFooter(
    W,
    H,
    'v2.2.22: konoha db check / konoha db restore · checkIntegrity + detectCorruption (header magic, size floor) · damaged DB archived before any write · constrained node:sqlite salvage'
  );

  const lanes = [
    stdNote(150, 152, 'DETECT & DIAGNOSE', C.slateMuted),
    stdNote(710, 152, 'RECOVER & VERIFY', C.slateMuted)
  ].join('\n');

  const left = [
    renderCard([150, 160, 340, 84], C.azure, '1 · CLI ENTRY & ROUTING', 'konoha db check | restore [path] --from --force', 'anbu'),
    renderCard([150, 280, 340, 84], C.teal, '2 · INTEGRITY DIAGNOSIS', 'PRAGMA quick_check + integrity_check · readOnly: true', 'anbu'),
    renderCard([150, 400, 340, 84], C.violet, '3 · CORRUPTION SIGNATURE', 'header magic · 100-byte floor · detectCorruption', 'anbu')
  ].join('\n');

  const right = [
    renderCard([710, 160, 340, 84], C.amber, '4 · VERIFIED BACKUP SELECT', 'backups/konoha_backup_*.db · newest verified', 'anbu'),
    renderCard([710, 280, 340, 84], C.crimson, '5 · ATOMIC CORRUPT ARCHIVE', 'db.corrupt.[timestamp] · archived before write', 'anbu'),
    renderCard([710, 400, 340, 84], C.emerald, '6 · RESTORE OR SALVAGE', 'copy verified backup | sqlite3 .recover pages', 'anbu')
  ].join('\n');

  const links = [
    stdLink('M 320 244 L 320 280', C.azure),
    stdLink('M 320 364 L 320 400', C.teal),
    stdLink('M 490 442 C 600 442, 600 202, 710 202', C.violet),
    stdLink('M 880 244 L 880 280', C.amber),
    stdLink('M 880 364 L 880 400', C.crimson),
    stdLink('M 880 484 L 880 512 L 700 512 L 700 540', C.emerald),
    stdLink('M 430 582 L 110 582 L 110 322 L 150 322', C.crimson)
  ].join('\n');

  const verdict = renderCard([430, 540, 340, 84], C.emerald, 'POST-RESTORE VERIFY GATE', 're-run checkIntegrity · roll back to original', 'anbu');
  const notes = stdNote(118, 600, 'FAIL → ORIGINAL PRESERVED', C.crimson);

  return buildHtmlPage(
    W,
    H,
    `${header}\n${lanes}\n${left}\n${right}\n${links}\n${verdict}\n${notes}\n${roster}\n${footer}`
  );
}

module.exports = {
  generateTelegramHtml,
  generateAkatsukiHtml,
  generateAnbuHtml
};
