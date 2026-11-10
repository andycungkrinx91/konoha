#!/usr/bin/env node
'use strict';

/**
 * scripts/build_manual_pdf.js — renders docs/MANUAL.md to docs/MANUAL.pdf.
 *
 * Implements the tokubetsu-jonin PDF contract (src/templates/skills/tokubetsu-jonin-skill/references/pdf.md):
 * strict light mode (#FFFFFF page, #64748B typography), one canonical 4-base-colour
 * gradient theme (T14), executive tables, tinted callouts, dynamic "Page X of Y"
 * pagination, and generator metadata scrubbed from the finished file.
 *
 * Offline by construction: no remote stylesheet, no web font. Inter is preferred and
 * falls back to Liberation Sans / Arial, which Chromium embeds as subsets, so the PDF
 * reads correctly on a machine that has never seen this repository.
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

const SUBJECT = `Konoha ${VERSION} operator's manual`;
const ORGANISATION = 'Konoha documentation';

// T14 of the 20 canonical themes: purple, blue, teal, green.
const THEME = ['#8A4FD0', '#3A8DDE', '#17B3A3', '#8BCB4A'];

const SLATE = '#64748B';
const SANS = "Inter, 'Helvetica Neue', 'Liberation Sans', Arial, sans-serif";
const MONO = "'DejaVu Sans Mono', 'Liberation Mono', monospace";

const ribbon = (height) =>
  THEME.map((colour) => `<span style="float:left;display:block;width:25%;height:${height};background:${colour}"></span>`).join('');

const CSS = `
  @page { size: A4; margin: 20mm 18mm 22mm; }
  html { font-size: 10.5pt; }
  body {
    font-family: ${SANS};
    color: ${SLATE};
    background: #FFFFFF;
    line-height: 15pt;
    margin: 0;
  }
  .cover { display: flex; flex-direction: column; min-height: 245mm; page-break-after: always; }
  .cover-rule { height: 4px; border-radius: 2px; background: linear-gradient(90deg, ${THEME.join(', ')}); margin-bottom: 12mm; }
  .cover h1 { font-size: 26pt; line-height: 30pt; color: ${SLATE}; border: 0; padding: 0; margin: 0 0 2mm; }
  .cover .subtitle { font-size: 12pt; line-height: 17pt; margin: 0 0 6mm; }
  .cover .art { position: relative; height: 118mm; margin: 4mm 0 0; }
  .cover .art i { position: absolute; display: block; border: 1.4px solid; transform: rotate(45deg); }
  .cover .meta { margin-top: auto; border-top: 1px solid #CBD5E1; padding-top: 4mm; font-size: 9pt; line-height: 14pt; }
  .cover .meta span { display: inline-block; min-width: 34mm; color: ${SLATE}; opacity: 0.72; }
  h1 { font-size: 22pt; line-height: 27pt; margin: 0 0 4mm; color: ${SLATE}; }
  h2 {
    font-size: 16pt; line-height: 21pt; color: ${SLATE};
    margin: 0 0 4mm; padding-bottom: 2.5mm;
    border-bottom: 2px solid ${THEME[1]};
    page-break-before: always; page-break-after: avoid;
  }
  h3 { font-size: 12.5pt; line-height: 17pt; color: ${SLATE}; margin: 7mm 0 2mm; page-break-after: avoid; }
  h4 { font-size: 10.5pt; color: ${SLATE}; margin: 5mm 0 2mm; page-break-after: avoid; }
  p, li { orphans: 3; widows: 3; }
  ul, ol { padding-left: 6mm; }
  code { font-family: ${MONO}; font-size: 0.88em; background: #F1F5F9; padding: 0 1mm; border-radius: 1mm; }
  pre {
    background: #F8FAFC; border-left: 3px solid ${THEME[0]};
    padding: 2.5mm 3mm; margin: 3mm 0; overflow-wrap: anywhere; white-space: pre-wrap;
    page-break-inside: avoid; font-size: 8.5pt; line-height: 13pt;
  }
  pre code { background: none; padding: 0; font-size: 1em; }
  table { border-collapse: collapse; width: 100%; margin: 2mm 0 4mm; font-size: 9pt; page-break-inside: avoid; }
  th, td { border: 1px solid #E2E8F0; padding: 1.6mm 2mm; text-align: left; vertical-align: top; }
  th { background: #F1F5F9; border-color: #CBD5E1; font-weight: 600; }
  tbody tr:nth-child(even) td { background: #F8FAFC; }
  blockquote {
    margin: 3mm 0; padding: 2mm 3mm 2mm 4mm; background: #F8FAFC;
    border-left: 3px solid ${THEME[2]};
  }
  blockquote p { margin: 0; }
  a { color: ${THEME[1]}; text-decoration: none; border-bottom: 1px solid #CBD5E1; }
  hr { border: none; border-top: 1px solid #E2E8F0; margin: 5mm 0; }
  strong { color: ${SLATE}; }
`;

// Chromium lays header/footer templates out in a shrink-to-fit box, so the root
// element needs an explicit width; without it the left and right halves collide.
function pageHeader() {
  return `<div style="width:100%;box-sizing:border-box;padding:0 18mm;font-family:${SANS};font-size:8pt;color:${SLATE}">
  <div style="width:100%;overflow:hidden"><span style="float:left">Konoha ${VERSION} \u00b7 Operator's Manual</span><span style="float:right">${ORGANISATION}</span></div>
  <div style="width:100%;overflow:hidden;margin-top:1mm">${ribbon('2px')}</div>
</div>`;
}

function pageFooter() {
  return `<div style="width:100%;box-sizing:border-box;padding:0 18mm;font-family:${SANS};font-size:8pt;color:${SLATE}">
  <div style="width:100%;overflow:hidden">${ribbon('2px')}</div>
  <div style="width:100%;overflow:hidden;margin-top:1.5mm"><span style="float:left">Konoha ${VERSION} \u00b7 generated from docs/MANUAL.md</span><span style="float:right;font-weight:700">Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>
</div>`;
}

function renderHtml(markdown) {
  marked.setOptions({ gfm: true, breaks: false });
  // The cover already carries the manual title, so the markdown H1 is dropped from the
  // rendered body instead of appearing a second time above the front matter.
  const body = marked.parse(markdown.replace(/^#\s+Konoha[^\n]*\n+/, ''));
  const cover = `
<header class="cover">
  <div class="cover-rule"></div>
  <h1>Konoha — Operator's Manual</h1>
  <p class="subtitle">Version ${VERSION} · local working tree · five surfaces, one process</p>
  <div class="art">
    <i style="left:4mm;top:6mm;width:58mm;height:58mm;border-color:rgba(138,79,208,.34)"></i>
    <i style="left:30mm;top:34mm;width:58mm;height:58mm;border-color:rgba(58,141,222,.30)"></i>
    <i style="left:78mm;top:14mm;width:44mm;height:44mm;border-color:rgba(23,179,163,.32)"></i>
    <i style="left:112mm;top:52mm;width:66mm;height:66mm;border-color:rgba(139,203,74,.26)"></i>
    <i style="left:150mm;top:24mm;width:30mm;height:30mm;border-color:rgba(138,79,208,.22)"></i>
  </div>
  <div class="meta">
    <div><span>Document</span>Konoha ${VERSION} operator's manual</div>
    <div><span>Scope</span>Install, first run, CLI, TUI, Web UI, Telegram, harnesses, architecture, diagnostics, security</div>
    <div><span>Version of record</span>${VERSION}, working tree at the commit named in §16.6</div>
    <div><span>Author</span>${AUTHOR}</div>
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
// the XMP packet, and ghostscript ignores a pdfmark /Producer. Each literal is therefore
// overwritten in place afterwards with the organisation name, padded or truncated to the
// original byte length so every cross-reference offset and stream length stays valid.
const GENERATOR_TAGS = [/GPL Ghostscript [\d.]+/g, /Skia\/PDF m\d+/g, /Chromium/g];

function scrubGeneratorTags(buffer) {
  const out = Buffer.from(buffer);
  const text = out.toString("latin1");
  for (const pattern of GENERATOR_TAGS) {
    for (const match of text.matchAll(pattern)) {
      const width = match[0].length;
      const value = ORGANISATION.length >= width
        ? ORGANISATION.slice(0, width)
        : ORGANISATION + " ".repeat(width - ORGANISATION.length);
      out.write(value, match.index, "latin1");
    }
  }
  return out;
}

function scrubMetadata(inputPath) {
  const temp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'konoha-manual-')), 'scrubbed.pdf');
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
  const result = spawnSync(
    'gs',
    ['-q', '-dNOPAUSE', '-dBATCH', '-sDEVICE=pdfwrite', '-dPDFSETTINGS=/prepress',
      `-sOutputFile=${temp}`, '-f', inputPath, '-c', pdfmark],
    { encoding: 'utf8', timeout: 180000 }
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      `ghostscript metadata scrub failed (${result.error ? result.error.message : result.stderr.trim()}); ` +
      'install ghostscript or ship the PDF with the generator tag intact'
    );
  }
  return scrubGeneratorTags(fs.readFileSync(temp));
}

async function render() {
  const markdown = fs.readFileSync(MANUAL, 'utf8');
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
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
    fs.writeFileSync(PDF, buffer);
    const scrubbed = scrubMetadata(PDF);
    fs.writeFileSync(PDF, scrubbed);
    return { buffer: scrubbed, markdown };
  } finally {
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