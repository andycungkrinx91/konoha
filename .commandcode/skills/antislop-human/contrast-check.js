#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const REFERENCE_HEADER = '| Pairing (text on background) | Ratio | Normal text (4.5) | Large text (3.0) |';
const NAMED_COLORS = {
  black: [0, 0, 0],
  white: [255, 255, 255]
};

function parseHex(value) {
  let v = value.trim().replace(/^#/, '');
  if (v.length === 3) {
    v = v.split('').map(ch => ch + ch).join('');
  }
  if (!/^[0-9A-Fa-f]{6}$/.test(v)) {
    throw new Error(`Expected a hex color like #FFFFFF, got ${value}`);
  }
  return [
    parseInt(v.slice(0, 2), 16),
    parseInt(v.slice(2, 4), 16),
    parseInt(v.slice(4, 6), 16)
  ];
}

function parsePairing(pairing) {
  const parts = pairing.split(/\s+on\s+/i);
  if (parts.length !== 2) {
    throw new Error(`Expected two colors in pairing: ${pairing}`);
  }
  const colors = [];
  for (const token of parts) {
    const hexMatch = token.match(/#[0-9A-Fa-f]{3,6}/);
    if (hexMatch) {
      colors.push(parseHex(hexMatch[0]));
    } else if (NAMED_COLORS[token.trim().toLowerCase()]) {
      colors.push(NAMED_COLORS[token.trim().toLowerCase()]);
    } else {
      throw new Error(`Cannot parse color token: ${token}`);
    }
  }
  return colors;
}

function linearize(c) {
  const channel = c / 255.0;
  return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}

function luminance(rgb) {
  return 0.2126 * linearize(rgb[0]) + 0.7152 * linearize(rgb[1]) + 0.0722 * linearize(rgb[2]);
}

function contrastRatio(colorA, colorB) {
  const lumA = luminance(colorA);
  const lumB = luminance(colorB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

function parseReferenceRows(docPath) {
  const content = fs.readFileSync(docPath, 'utf8');
  const lines = content.split(/\r?\n/);
  const rows = [];
  let inTable = false;

  for (const line of lines) {
    if (line.startsWith(REFERENCE_HEADER)) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    if (!line.startsWith('|')) break;
    if (line.startsWith('|---')) continue;
    const cells = line.split('|').map(c => c.trim()).filter(Boolean);
    if (cells.length !== 4) continue;
    rows.push({
      pairing: cells[0],
      ratio: parseFloat(cells[1]),
      normal: cells[2],
      large: cells[3]
    });
  }
  return rows;
}

function runSelfTest() {
  const docPath = path.join(__dirname, 'SKILL.md');
  if (!fs.existsSync(docPath)) {
    console.error('selftest: SKILL.md not found next to script');
    return 2;
  }
  const rows = parseReferenceRows(docPath);
  if (!rows.length) {
    console.error('selftest: no reference rows found in SKILL.md');
    return 1;
  }

  let failures = 0;
  for (const row of rows) {
    const [colorA, colorB] = parsePairing(row.pairing);
    const computed = Math.round(contrastRatio(colorA, colorB) * 100) / 100;
    const expectedNormal = computed >= 4.5 ? 'Pass' : 'Fail';
    const expectedLarge = computed >= 3.0 ? 'Pass' : 'Fail';

    if (computed.toFixed(2) !== row.ratio.toFixed(2)) {
      failures++;
      console.error(`selftest: ${row.pairing}: table says ${row.ratio}, computed ${computed.toFixed(2)}`);
    }
    if (row.normal !== expectedNormal) {
      failures++;
      console.error(`selftest: ${row.pairing}: normal text marked ${row.normal}, expected ${expectedNormal}`);
    }
    if (row.large !== expectedLarge) {
      failures++;
      console.error(`selftest: ${row.pairing}: large text marked ${row.large}, expected ${expectedLarge}`);
    }
  }

  if (failures > 0) return 1;
  console.log(`selftest: ${rows.length} reference pairs OK`);
  return 0;
}

function main(args) {
  if (args.length === 1 && args[0] === '--selftest') {
    return runSelfTest();
  }
  if (args.length !== 2) {
    console.log('usage: node contrast-check.js <hex1> <hex2> | --selftest');
    return 2;
  }

  try {
    const ratio = contrastRatio(parseHex(args[0]), parseHex(args[1]));
    const normal = ratio >= 4.5;
    const large = ratio >= 3.0;
    console.log(`ratio: ${ratio.toFixed(2)}:1`);
    console.log(`normal text (4.5:1): ${normal ? 'PASS' : 'FAIL'}`);
    console.log(`large text  (3.0:1): ${large ? 'PASS' : 'FAIL'}`);
    return normal && large ? 0 : 1;
  } catch (err) {
    console.error(`error: ${err.message}`);
    return 2;
  }
}

if (require.main === module) {
  const code = main(process.argv.slice(2));
  process.exit(code);
}

module.exports = { contrastRatio, parseHex, luminance, linearize };
