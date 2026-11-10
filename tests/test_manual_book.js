#!/usr/bin/env node
'use strict';

/**
 * tests/test_manual_book.js — keeps docs/MANUAL.md and docs/MANUAL.pdf honest.
 *
 * Asserts:
 *   1. The manual's version table matches package.json.
 *   2. The Contents list is one-to-one with the numbered chapter headings, in order.
 *   3. Every relative link in the manual resolves, and none points into docs/archive/.
 *   4. docs/MANUAL.pdf exists, is a real PDF, and is newer than the Markdown that produced it.
 *   5. When pdftotext is installed, the PDF text carries every chapter title (a stale or
 *      truncated render fails here even if its mtime was refreshed).
 *   6. The generated HTML obeys the documentation style contract: 4-colour gradient palette,
 *      slate body text, no dark hexes, Inter-first stack with a Liberation Sans fallback.
 *   7. When pdfinfo/pdffonts are installed, the shipped PDF names no generator, embeds every
 *      font, and stamps "Page X of Y" exactly once per page.
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const MANUAL_PATH = path.join(ROOT_DIR, 'docs', 'MANUAL.md');
const PDF_PATH = path.join(ROOT_DIR, 'docs', 'MANUAL.pdf');
const PKG_VERSION = require('../package.json').version;

const manual = fs.readFileSync(MANUAL_PATH, 'utf8');

assert.ok(
  manual.includes(`| Manual version | ${PKG_VERSION} |`),
  `docs/MANUAL.md version table must name ${PKG_VERSION} (package.json)`
);

const chapters = [...manual.matchAll(/^## (\d+)\. (.+)$/gm)].map((m) => `${m[1]}. ${m[2].trim()}`);
assert.ok(chapters.length > 0, 'docs/MANUAL.md has no numbered chapters');

const contentsMatch = manual.match(/^## Contents\n\n((?:\d+\..*\n)+)/m);
assert.ok(contentsMatch, 'docs/MANUAL.md has no "## Contents" list');
const contents = contentsMatch[1].trim().split('\n').map((line) => line.trim());
assert.deepStrictEqual(contents, chapters, 'Contents list does not match the chapter headings');

const linkRe = /!?\[[^\]]*\]\(([^)]+)\)/g;
for (const [, raw] of manual.matchAll(linkRe)) {
  const target = raw.split('#')[0].split('?')[0];
  if (!target || /^(?:https?:|mailto:|data:)/i.test(target)) continue;
  const resolved = path.resolve(path.dirname(MANUAL_PATH), target);
  assert.ok(!resolved.includes(`${path.sep}archive${path.sep}`), `manual links into the archive: ${raw}`);
  assert.ok(fs.existsSync(resolved), `manual link does not resolve: ${raw}`);
}

assert.ok(fs.existsSync(PDF_PATH), 'docs/MANUAL.pdf is missing; run: node scripts/build_manual_pdf.js');
const pdf = fs.readFileSync(PDF_PATH);
assert.ok(pdf.subarray(0, 5).toString('latin1') === '%PDF-', 'docs/MANUAL.pdf is not a PDF');
assert.ok(pdf.length > 100 * 1024, `docs/MANUAL.pdf is suspiciously small (${pdf.length} bytes)`);
assert.ok(
  fs.statSync(PDF_PATH).mtimeMs + 1000 >= fs.statSync(MANUAL_PATH).mtimeMs,
  'docs/MANUAL.pdf is older than docs/MANUAL.md; rebuild it'
);
const expectedTrailerId = crypto.createHash('sha256').update(manual).digest('hex').slice(0, 32).toUpperCase();
assert.ok(
  pdf.includes(`/ID [<${expectedTrailerId}><${expectedTrailerId}>]`),
  'PDF trailer ID must derive deterministically from docs/MANUAL.md'
);

const pdftotext = spawnSync('pdftotext', [PDF_PATH, '-'], { encoding: 'utf8', timeout: 30000 });
if (!pdftotext.error && pdftotext.status === 0 && pdftotext.stdout) {
  const text = pdftotext.stdout.replace(/\s+/g, ' ');
  for (const chapter of chapters) {
    const title = chapter.replace(/^\d+\.\s*/, '');
    assert.ok(text.includes(title), `PDF text is missing chapter "${chapter}"; rebuild the PDF`);
  }
}

console.log(`Manual book OK: ${chapters.length} chapters, PDF ${(pdf.length / 1024).toFixed(0)} KB`);

const { renderHtml, pageHeader, pageFooter, THEME } = require('../scripts/build_manual_pdf.js');

// Documentation style contract: one canonical 4-colour gradient theme, slate text,
// tinted tables, no dark hexes.
assert.deepStrictEqual(THEME, ['#E8453C', '#F08A24', '#8BCB4A', '#3A8DDE'], 'PDF theme must be red, orange, green, blue');

const html = renderHtml(manual);
for (const hex of [...THEME, '#64748B', '#F1F5F9', '#CBD5E1', '#E2E8F0', '#F8FAFC']) {
  assert.ok(html.includes(hex), `generated HTML is missing style token ${hex}`);
}
const darkHex = html.match(/#(?:000000|000|0F172A|1E293B|1E3A8A|111827|1F2937)\b/i);
assert.ok(!darkHex, `generated HTML uses a forbidden dark colour: ${darkHex && darkHex[0]}`);
assert.ok(/font-family:\s*Inter,/.test(html), 'body font stack must start with Inter');
assert.ok(html.includes('Liberation Sans'), 'body font stack must fall back to Liberation Sans');
const chrome = pageHeader() + pageFooter();
assert.ok(chrome.includes('class="pageNumber"') && chrome.includes('class="totalPages"'), 'PDF must stamp Page X of Y');
assert.strictEqual((chrome.match(/width:100%;box-sizing:border-box/g) || []).length, 2, 'page header/footer need an explicitly sized root box');
assert.ok(chrome.includes(THEME[0]) && chrome.includes(THEME[3]), 'header/footer ribbon must carry the theme colours');
assert.ok(chrome.includes('print-color-adjust:exact'), 'header/footer must preserve exact print colours');
assert.ok(chrome.includes('color:#64748B'), 'header/footer text must explicitly enforce slate colour');
assert.strictEqual(
  (html.match(/Operator's Manual<\/h1>/g) || []).length,
  1,
  'the PDF must show the manual title once, on the cover'
);

const pdfinfo = spawnSync('pdfinfo', [PDF_PATH], { encoding: 'utf8', timeout: 30000 });
const pdffonts = spawnSync('pdffonts', [PDF_PATH], { encoding: 'utf8', timeout: 30000 });
const hasPdfInfo = !pdfinfo.error && pdfinfo.status === 0;
const hasPdfFonts = !pdffonts.error && pdffonts.status === 0;

if (hasPdfInfo) {
  assert.ok(!/chromium|skia|ghostscript|reportlab|weasyprint/i.test(pdfinfo.stdout), 'PDF metadata still names a generator');
  const pages = Number((pdfinfo.stdout.match(/^Pages:\s+(\d+)$/m) || [])[1]);
  assert.ok(pages > 0, 'PDF page count is unreadable');
  if (pdftotext.status === 0 && pdftotext.stdout) {
    const stamps = [...pdftotext.stdout.matchAll(/Page (\d+) of (\d+)/g)];
    assert.strictEqual(stamps.length, pages, `expected one Page X of Y stamp per page, found ${stamps.length} for ${pages}`);
    stamps.forEach(([, current, total], index) => {
      assert.strictEqual(current, String(index + 1), `page ${index + 1} is stamped ${current}`);
      assert.strictEqual(total, String(pages), 'page footer total disagrees with pdfinfo');
    });
  }
}

if (hasPdfFonts) {
  const rows = pdffonts.stdout.trim().split('\n').slice(2).filter(Boolean);
  assert.ok(rows.length > 0, 'PDF embeds no fonts');
  for (const row of rows) {
    assert.ok(/\byes\s+yes\s+yes\b/.test(row), `PDF font lacks embedding: ${row.trim()}`);
  }
}
