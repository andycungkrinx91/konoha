#!/usr/bin/env node
'use strict';

/**
 * scripts/build_manual_pdf.js — renders docs/MANUAL.md to docs/MANUAL.pdf.
 *
 * Implements the tokubetsu-jonin PDF contract (src/templates/skills/tokubetsu-jonin-skill/references/pdf.md):
 * strict light mode (#FFFFFF page, #64748B typography), a 4-base-colour gradient
 * theme (red, orange, green, blue), executive tables, tinted callouts, dynamic "Page X of Y"
 * pagination, and generator metadata scrubbed from the finished file.
 *
 * Offline by construction: no remote stylesheet, no web font. Inter is preferred and
 * falls back to Lato / Open Sans / Liberation Sans / Arial, which Chromium embeds as
 * subsets, so the PDF reads correctly on a machine that has never seen this repository.
 *
 * Usage:
 *   node scripts/build_manual_pdf.js            # write docs/MANUAL.pdf
 *   node scripts/build_manual_pdf.js --check    # fail if the PDF is missing, stale, or unscrubbed
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { marked } = require('marked');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const MANUAL = path.join(ROOT, 'docs', 'MANUAL.md');
const PDF = path.join(ROOT, 'docs', 'MANUAL.pdf');

const { version: VERSION, author: AUTHOR } = (() => {
  const pkg = require(path.join(ROOT, 'package.json'));
  return { version: pkg.version, author: 'Andy Setiyawan' };
})();

const LOGO_DATA_URI = `data:image/webp;base64,${fs.readFileSync(path.join(ROOT, 'assets', 'konoha_logo_kyubi.webp')).toString('base64')}`;
const SUBJECT = `Konoha ${VERSION} operator's manual`;
const ORGANISATION = 'Konoha documentation';
const SOURCE_DATE_EPOCH = Number(process.env.SOURCE_DATE_EPOCH || 1794268800);

// 4-base-colour gradient theme: red, orange, green, blue.
const THEME = ['#F08A24', '#8A4FD0', '#3A8DDE', '#8BCB4A'];

const SLATE = '#64748B';
const SANS = "Inter, 'Liberation Sans', 'Helvetica Neue', 'Open Sans', Arial, sans-serif";
const MONO = "'Liberation Mono', 'DejaVu Sans Mono', monospace";

const ribbon = (height) =>
  THEME.map((colour) => `<span style="float:left;display:block;width:25%;height:${height};background:${colour}"></span>`).join('');

const CSS = `
  @page { size: A4; margin: 20mm 18mm 22mm; }
  html { font-size: 10.8pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    font-family: ${SANS};
    color: ${SLATE};
    background: #FFFFFF;
    line-height: 15.6pt;
    margin: 0;
    font-weight: 400;
  }
  .cover { display: flex; flex-direction: column; min-height: 245mm; page-break-after: always; padding-top: 6mm; }
  .cover .top-band { overflow: hidden; border-radius: 2px; margin: 0 0 8mm; }
  .cover .kicker { font-size: 11pt; line-height: 14pt; letter-spacing: 0.22em; text-transform: uppercase; font-weight: 700; color: ${THEME[0]}; margin: 0 0 4mm; }
  .cover h1 { font-size: 38pt; line-height: 42pt; color: ${SLATE}; font-weight: 700; border: 0; padding: 0; margin: 0 0 4mm; letter-spacing: -0.01em; }
  .cover .subtitle { font-size: 14pt; line-height: 20pt; margin: 0 0 6mm; font-weight: 400; }
  .cover .accent-bar { height: 6px; border-radius: 3px; background: linear-gradient(90deg, ${THEME.join(', ')}); margin-bottom: 8mm; }
  .cover .hero { flex: 1 0 auto; display: flex; align-items: center; justify-content: center; margin: 6mm 0; }
  .cover .hero img { width: 140mm; height: 140mm; }
  .cover .detail { margin-top: auto; margin-bottom: 0; border-top: 4px solid transparent; border-image: linear-gradient(90deg, ${THEME.join(', ')}) 1; padding-top: 5mm; }
  .cover .detail .row { overflow: hidden; font-size: 10.2pt; line-height: 16.2pt; margin-bottom: 2.4mm; }
  .cover .detail .row:last-child { margin-bottom: 0; }
  .cover .detail .swatch { float: left; width: 4.5mm; height: 4.5mm; border-radius: 1mm; margin: 1mm 3mm 0 0; }
  .cover .detail .label { float: left; width: 36mm; font-weight: 700; color: ${SLATE}; }
  .cover .detail .value { overflow: hidden; color: ${SLATE}; }
  h1 { font-size: 23pt; line-height: 28pt; margin: 0 0 5mm; padding-top: 2mm; color: ${SLATE}; font-weight: 700; }
  h2 {
    font-size: 17pt; line-height: 23pt; color: ${SLATE}; font-weight: 700;
    margin: 4mm 0 2.5mm; padding-bottom: 2mm;
    border-bottom: 2.5px solid transparent;
    border-image: linear-gradient(90deg, ${THEME.join(', ')}) 1;
    page-break-after: avoid; break-after: avoid;
  }
  h2.chapter { page-break-before: always; margin-top: 0; padding-top: 0; margin-bottom: 3mm; }
  h2.chapter:first-of-type { page-break-before: auto; }
  h3 {
    font-size: 12.5pt; line-height: 17pt; color: ${SLATE}; font-weight: 700;
    margin: 6mm 0 2.5mm; padding-left: 2.5mm;
    border-left: 3.5px solid ${THEME[1]};
    page-break-after: avoid; break-after: avoid;
  }
  h4 {
    font-size: 10.8pt; line-height: 15pt; color: ${SLATE}; font-weight: 700;
    margin: 4.5mm 0 2mm; page-break-after: avoid; break-after: avoid;
    text-transform: uppercase; letter-spacing: 0.03em;
  }
  p { margin: 0 0 3.2mm; orphans: 3; widows: 3; }
  li { margin-bottom: 1.8mm; orphans: 3; widows: 3; }
  ul, ol { padding-left: 6mm; margin: 2.5mm 0 4.5mm; }
  code {
    font-family: ${MONO}; font-size: 0.86em; font-weight: 600;
    background-color: #E4ECFB;
    background-image: linear-gradient(135deg, #E4ECFB 0%, #F3E8FB 25%, #FDF4E7 55%, #FFFFFF 100%);
    color: ${SLATE};
    padding: 0.2mm 1.2mm; border: 1px solid #CBD5E1; border-radius: 0.8mm;
    -webkit-box-decoration-break: clone; box-decoration-break: clone;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  pre {
    background-color: #E7F5DE;
    background-image: linear-gradient(135deg, #E7F5DE 0%, #E4ECFB 18%, #F3E8FB 38%, #FDF4E7 62%, #FFFFFF 100%);
    border: 1px solid #E2E8F0; border-left: 3.5px solid ${THEME[0]};
    border-radius: 0 1.5mm 1.5mm 0;
    padding: 2.5mm 3.5mm; margin: 4mm 0 5mm; overflow-wrap: anywhere; white-space: pre-wrap;
    page-break-inside: avoid; break-inside: avoid; font-size: 9pt; line-height: 13.4pt;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  pre code { background: none; border: none; padding: 0; font-size: 1em; font-weight: 400; }
  table {
    border-collapse: collapse; width: 100%; margin: 3mm 0 5.5mm; font-size: 9.4pt; line-height: 13.5pt;
  }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; break-inside: avoid; }
  th, td { border: 1px solid #E2E8F0; padding: 1.8mm 2.4mm; text-align: left; vertical-align: top; }
  thead, thead tr {
    background: linear-gradient(90deg, ${THEME.join(', ')});
  }
  thead th {
    background: transparent;
    color: #FFFFFF; font-weight: 700;
    border: 1px solid #FFFFFF;
  }
  tbody tr:nth-child(even) td { background: #F1F5F9; }
  blockquote {
    margin: 4mm 0 5mm; padding: 2.5mm 3.5mm; background: #F8FAFC;
    border: 1px solid #E2E8F0; border-left: 3.5px solid ${THEME[2]};
    border-radius: 0 1.5mm 1.5mm 0;
  }
  blockquote p { margin: 0; }
  a { color: ${THEME[3]}; text-decoration: none; border-bottom: 1px solid #CBD5E1; }
  hr { border: none; border-top: 1px solid #E2E8F0; margin: 7mm 0; }
  strong, b { font-weight: 700; color: ${SLATE}; }
`;

// Chromium lays header/footer templates out in a shrink-to-fit box without CSS
// background preservation unless print-color-adjust:exact and explicit box/span
// styles are declared.
function pageHeader() {
  return `<div style="width:100%;box-sizing:border-box;padding:0 18mm;font-family:${SANS};font-size:8.5pt;color:${SLATE};-webkit-print-color-adjust:exact;print-color-adjust:exact">
  <div style="width:100%;overflow:hidden"><span style="float:left;font-weight:700;color:${SLATE}">Konoha ${VERSION} \u00b7 Operator's Manual</span><span style="float:right;color:${SLATE}">${ORGANISATION}</span></div>
  <div style="width:100%;overflow:hidden;margin-top:1.2mm">${ribbon('3px')}</div>
</div>`;
}

function pageFooter() {
  return `<div style="width:100%;box-sizing:border-box;padding:0 18mm;font-family:${SANS};font-size:8.5pt;color:${SLATE};-webkit-print-color-adjust:exact;print-color-adjust:exact">
  <div style="width:100%;overflow:hidden">${ribbon('3px')}</div>
  <div style="width:100%;overflow:hidden;margin-top:1.5mm"><span style="float:left;color:${SLATE}">Konoha ${VERSION} \u00b7 docs/MANUAL.md</span><span style="float:right;font-weight:700;color:${SLATE}">Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>
</div>`;
}

function renderHtml(markdown) {
  marked.setOptions({ gfm: true, breaks: false });
  // The cover already carries the manual title, so the markdown H1 is dropped from the
  // rendered body instead of appearing a second time above the front matter.
  let body = marked.parse(markdown.replace(/^#\s+Konoha[^\n]*\n+/, ''));
  body = body.replace(/<h2>(\d+\.\s+[^<]+)<\/h2>/g, '<h2 class="chapter">$1</h2>');
  const cover = `
<header class="cover">
  <div class="top-band">${ribbon('5px')}</div>
  <p class="kicker">Konoha &middot; Operator Edition</p>
  <h1>Konoha — Operator's Manual</h1>
  <p class="subtitle">Version ${VERSION} · local working tree · five surfaces, one process</p>
  <div class="accent-bar"></div>
  <div class="hero"><img src="${LOGO_DATA_URI}" alt="Konoha logo" width="529" height="529"></div>
  <div class="detail">
    <div class="row"><span class="swatch" style="background:${THEME[0]}"></span><span class="label">Document</span><span class="value">Konoha ${VERSION} operator's manual</span></div>
    <div class="row"><span class="swatch" style="background:${THEME[1]}"></span><span class="label">Scope</span><span class="value">Install, first run, CLI, TUI, Web UI, Telegram, harnesses, architecture, diagnostics, security</span></div>
    <div class="row"><span class="swatch" style="background:${THEME[2]}"></span><span class="label">Version of record</span><span class="value">v${VERSION}</span></div>
    <div class="row"><span class="swatch" style="background:${THEME[3]}"></span><span class="label">Author</span><span class="value">${AUTHOR}</span></div>
  </div>
</header>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Konoha — Operator's Manual ${VERSION}</title>
<meta name="author" content="${AUTHOR}">
<meta name="description" content="${SUBJECT}">
<style>${CSS}</style>
</head><body>
${cover}
${body}
</body></html>`;
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function pdfHexString(text) {
  const bytes = Buffer.from(text, "utf16le");
  const swapped = Buffer.from(bytes);
  for (let i = 0; i < swapped.length; i += 2) {
    const low = swapped[i];
    swapped[i] = swapped[i + 1];
    swapped[i + 1] = low;
  }
  return "<FEFF" + swapped.toString("hex").toUpperCase() + ">";
}

// ghostscript and Chromium both stamp generator strings into the Info dictionary and
// the XMP packet, and ghostscript ignores a pdfmark /Producer. Each literal and
// non-deterministic date/UUID/trailer ID is therefore overwritten in place with fixed
// byte widths so every cross-reference offset stays valid and repeated builds match bit-for-bit.
const GENERATOR_TAGS = [/GPL Ghostscript [\d.]+/g, /Skia\/PDF m\d+/g, /Chromium/g];

function formatUtcDates(epochSeconds) {
  const d = new Date(epochSeconds * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  const y = d.getUTCFullYear();
  const m = pad(d.getUTCMonth() + 1);
  const day = pad(d.getUTCDate());
  const hh = pad(d.getUTCHours());
  const mm = pad(d.getUTCMinutes());
  const ss = pad(d.getUTCSeconds());
  return {
    isoZ: `${y}-${m}-${day}T${hh}:${mm}:${ss}Z`,
    isoOffset: `${y}-${m}-${day}T${hh}:${mm}:${ss}+00:00`,
    pdfZ: `D:${y}${m}${day}${hh}${mm}${ss}Z`,
    pdfOffset: `D:${y}${m}${day}${hh}${mm}${ss}+00'00'`
  };
}

function scrubGeneratorTags(buffer, markdown) {
  const out = Buffer.from(buffer);
  const text = out.toString('latin1');
  for (const pattern of GENERATOR_TAGS) {
    for (const match of text.matchAll(pattern)) {
      const width = match[0].length;
      const value = ORGANISATION.length >= width
        ? ORGANISATION.slice(0, width)
        : ORGANISATION + ' '.repeat(width - ORGANISATION.length);
      out.write(value, match.index, 'latin1');
    }
  }

  const hash = sha256(Buffer.from(markdown || '', 'utf8'));
  const uuid = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  const trailerId = hash.slice(0, 32).toUpperCase();
  const dates = formatUtcDates(SOURCE_DATE_EPOCH);

  for (const match of text.matchAll(/<(xmp:(?:ModifyDate|CreateDate))>([^<]+)<\/\1>/g)) {
    const replacement = match[2].length === dates.isoZ.length
      ? dates.isoZ
      : (match[2].length === dates.isoOffset.length ? dates.isoOffset : null);
    if (replacement) out.write(`<${match[1]}>${replacement}</${match[1]}>`, match.index, 'latin1');
  }
  for (const match of text.matchAll(/xapMM:DocumentID='uuid:[^']+'/g)) {
    const val = `xapMM:DocumentID='uuid:${uuid}'`;
    if (val.length === match[0].length) out.write(val, match.index, 'latin1');
  }
  for (const match of text.matchAll(/\/(CreationDate|ModDate)\((D:[^)]+)\)/g)) {
    const replacement = match[2].length === dates.pdfZ.length
      ? dates.pdfZ
      : (match[2].length === dates.pdfOffset.length ? dates.pdfOffset : null);
    if (replacement) out.write(`/${match[1]}(${replacement})`, match.index, 'latin1');
  }
  for (const match of text.matchAll(/\/ID\s*\[<[0-9A-Fa-f]{32}><[0-9A-Fa-f]{32}>\]/g)) {
    const val = `/ID [<${trailerId}><${trailerId}>]`;
    if (val.length === match[0].length) out.write(val, match.index, 'latin1');
  }

  return out;
}

function scrubMetadata(inputPath, markdown) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-manual-'));
  const temp = path.join(tmpDir, 'scrubbed.pdf');
  const pdfmark = [
    `[ /Title ${pdfHexString(`Konoha — Operator's Manual ${VERSION}`)}`,
    `/Author ${pdfHexString(AUTHOR)}`,
    `/Subject ${pdfHexString(SUBJECT)}`,
    `/Creator ${pdfHexString(ORGANISATION)}`,
    `/Author (${AUTHOR})`,
    `/Subject (${SUBJECT})`,
    `/Creator (${ORGANISATION})`,
    `/Producer (${ORGANISATION})`,
    '/DOCINFO pdfmark'
  ].join(' ');
  try {
    const result = spawnSync(
      'gs',
      ['-q', '-dNOPAUSE', '-dBATCH', '-sDEVICE=pdfwrite', '-dPDFSETTINGS=/prepress',
        `-sOutputFile=${temp}`, '-f', inputPath, '-c', pdfmark],
      {
        encoding: 'utf8',
        timeout: 180000,
        env: { ...process.env, TZ: 'UTC', SOURCE_DATE_EPOCH: String(SOURCE_DATE_EPOCH) }
      }
    );
    if (result.error || result.status !== 0) {
      throw new Error(
        `ghostscript metadata scrub failed (${result.error ? result.error.message : result.stderr.trim()}); ` +
        'install ghostscript or ship the PDF with the generator tag intact'
      );
    }
    return scrubGeneratorTags(fs.readFileSync(temp), markdown);
  } finally {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function render() {
  const markdown = fs.readFileSync(MANUAL, 'utf8');
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-raw-'));
  const rawPath = path.join(tmpDir, 'raw.pdf');
  try {
    const page = await browser.newPage();
    await page.setContent(renderHtml(markdown), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const buffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: pageHeader(),
      footerTemplate: pageFooter(),
      margin: { top: '20mm', right: '18mm', bottom: '22mm', left: '18mm' }
    });
    fs.writeFileSync(rawPath, buffer);
    const scrubbed = scrubMetadata(rawPath, markdown);
    fs.writeFileSync(PDF, scrubbed);
    return { buffer: scrubbed, markdown };
  } finally {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    await browser.close();
  }
}

function readPdfInfo() {
  const info = spawnSync('pdfinfo', [PDF], { encoding: 'utf8', timeout: 30000 });
  return info.error || info.status !== 0 ? null : info.stdout;
}

async function main() {
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(PDF)) {
      console.error('docs/MANUAL.pdf is missing; run: node scripts/build_manual_pdf.js');
      process.exit(1);
    }
    const stat = fs.statSync(PDF);
    if (stat.mtimeMs + 1000 < fs.statSync(MANUAL).mtimeMs) {
      console.error('docs/MANUAL.pdf is older than docs/MANUAL.md; rebuild it.');
      process.exit(1);
    }
    const info = readPdfInfo();
    if (info && /chromium|skia|playwright|reportlab|weasyprint/i.test(info)) {
      console.error('docs/MANUAL.pdf still carries a generator tag; rebuild it.');
      process.exit(1);
    }
    console.log(`docs/MANUAL.pdf present (${(stat.size / 1024).toFixed(0)} KB, metadata scrubbed)`);
    return;
  }

  if (!fs.existsSync(PDF)) fs.writeFileSync(PDF, '');
  const { buffer, markdown } = await render();
  console.log(`Wrote docs/MANUAL.pdf (${(buffer.length / 1024).toFixed(0)} KB)`);
  console.log(`source docs/MANUAL.md sha256 ${sha256(markdown).slice(0, 16)}`);
  console.log(`output docs/MANUAL.pdf sha256 ${sha256(buffer).slice(0, 16)}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}

module.exports = { renderHtml, pageHeader, pageFooter, main, THEME };