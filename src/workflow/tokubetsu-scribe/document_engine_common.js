'use strict';

const fs = require('fs');
const path = require('path');

function cleanHexColor(c) {
  if (!c) return '000000';
  let s = String(c).trim();
  if (s.startsWith('#')) s = s.slice(1);
  if (s.length === 8 && s.toLowerCase().startsWith('ff')) s = s.slice(2);
  return s.toUpperCase();
}

function resolveDynamicOutputPath(targetPath, defaultFilename) {
  const resolved = path.resolve(targetPath || path.join(process.cwd(), 'output', defaultFilename));
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return resolved;
}

module.exports = {
  cleanHexColor,
  resolveDynamicOutputPath
};
