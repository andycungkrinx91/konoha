#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function parseXmlSimple(xmlStr) {
  const cellRegex = /<mxCell\s+([^>]+?)(?:\/>|>(.*?)<\/mxCell>)/gs;
  const cells = [];
  let match;

  while ((match = cellRegex.exec(xmlStr)) !== null) {
    const rawAttrs = match[1];
    const inner = match[2] || '';
    const attrs = {};
    const attrRegex = /([a-zA-Z0-9_:]+)=(?:["']([^"']*)["']|(\S+))/g;
    let attrMatch;
    while ((attrMatch = attrRegex.exec(rawAttrs)) !== null) {
      attrs[attrMatch[1]] = attrMatch[2] !== undefined ? attrMatch[2] : attrMatch[3];
    }
    const hasGeometry = /<mxGeometry\b/.test(inner) || /<mxGeometry\b/.test(rawAttrs);
    const hasSourcePoint = /as=["']sourcePoint["']/.test(inner);
    const hasTargetPoint = /as=["']targetPoint["']/.test(inner);
    cells.push({
      attrs,
      inner,
      hasGeometry,
      hasSourcePoint,
      hasTargetPoint
    });
  }

  return { cells };
}

function validateFile(filePath) {
  const errors = [];
  if (!fs.existsSync(filePath)) {
    return [`File not found: ${filePath}`];
  }

  const content = fs.readFileSync(filePath, 'utf8');
  if (!content.includes('<mxfile')) {
    errors.push('Root element must be <mxfile>');
    return errors;
  }

  if (!content.includes('<diagram')) {
    errors.push('No <diagram> elements found inside <mxfile>');
    return errors;
  }

  if (!content.includes('<mxGraphModel')) {
    return errors;
  }

  if (!content.includes('<root>')) {
    errors.push('Missing <root> element inside <mxGraphModel>');
    return errors;
  }

  const { cells } = parseXmlSimple(content);
  if (!cells.length) {
    errors.push('No <mxCell> elements found in diagram');
    return errors;
  }

  const cellIds = new Map();
  let hasId0 = false;
  let hasId1 = false;

  for (let idx = 0; idx < cells.length; idx++) {
    const cell = cells[idx];
    const cid = cell.attrs.id;
    if (cid === undefined) {
      errors.push(`Found <mxCell> without an id attribute at index ${idx}`);
      continue;
    }
    if (cellIds.has(cid)) {
      errors.push(`Duplicate cell id='${cid}'`);
    }
    cellIds.set(cid, cell);
    if (cid === '0') hasId0 = true;
    if (cid === '1') hasId1 = true;
  }

  if (!hasId0) errors.push("Missing required root cell id='0'");
  if (!hasId1) errors.push("Missing required default-layer cell id='1'");

  if (cells.length >= 1 && cells[0].attrs.id !== '0') {
    errors.push(`First <mxCell> must have id='0', got id='${cells[0].attrs.id}'`);
  }
  if (cells.length >= 2 && cells[1].attrs.id !== '1') {
    errors.push(`Second <mxCell> must have id='1', got id='${cells[1].attrs.id}'`);
  }

  for (const cell of cells) {
    if (cell.attrs.id === '1' && cell.attrs.parent !== '0') {
      errors.push(`Cell id='1' must have parent='0', got parent='${cell.attrs.parent}'`);
    }
  }

  const hasTitleCell = cells.some(c => {
    const isVertex = c.attrs.vertex === '1';
    const style = c.attrs.style || '';
    const isTitleStyle = (style.startsWith('text;') || style.includes(';text;')) && style.includes('fontSize=18');
    return isVertex && isTitleStyle;
  });

  if (!hasTitleCell) {
    errors.push("No title cell found — add a vertex with style containing 'text;' and 'fontSize=18' at the top of the page");
  }

  for (const cell of cells) {
    const cid = cell.attrs.id || '<unknown>';
    const isVertex = cell.attrs.vertex === '1';
    const isEdge = cell.attrs.edge === '1';
    const parent = cell.attrs.parent;

    if (cid !== '0') {
      if (parent === undefined) {
        errors.push(`Cell id='${cid}' is missing a 'parent' attribute`);
      } else if (!cellIds.has(parent)) {
        errors.push(`Cell id='${cid}' references unknown parent='${parent}'`);
      }
    }

    if (isVertex && !cell.hasGeometry) {
      errors.push(`Vertex cell id='${cid}' is missing <mxGeometry>`);
    }

    if (isEdge) {
      const source = cell.attrs.source;
      const target = cell.attrs.target;
      if (!source && !cell.hasSourcePoint) {
        errors.push(`Edge cell id='${cid}' is missing 'source' attribute (and no sourcePoint)`);
      } else if (source && !cellIds.has(source)) {
        errors.push(`Edge id='${cid}' references unknown source='${source}'`);
      }
      if (!target && !cell.hasTargetPoint) {
        errors.push(`Edge cell id='${cid}' is missing 'target' attribute (and no targetPoint)`);
      } else if (target && !cellIds.has(target)) {
        errors.push(`Edge id='${cid}' references unknown target='${target}'`);
      }
    }
  }

  return errors;
}

function main(args) {
  if (args.length < 1) {
    console.log('Usage: node validate-drawio.js <diagram.drawio>');
    return 1;
  }
  const target = path.resolve(args[0]);
  console.log(`Validating: ${target}`);
  const errors = validateFile(target);
  if (errors.length > 0) {
    console.error(`\nFAIL — ${errors.length} error(s) found:`);
    for (const e of errors) console.error(`  ERROR: ${e}`);
    return 1;
  }
  console.log('PASS — No errors found.');
  return 0;
}

if (require.main === module) {
  const code = main(process.argv.slice(2));
  process.exit(code);
}

module.exports = { validateFile };
