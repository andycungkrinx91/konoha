// Seed completeness checks, kept side-effect free so they can be unit tested.
// tests/run_all.js runs the whole suite harness at require time, so its own
// helpers cannot be imported without building a seed.

const fs = require('fs');
const path = require('path');

const SEED_SENTINELS = [
  ['.konoha', 'konoha.db'],
  ['.konoha', 'server.js'],
  ['.konoha', '.autosetup-done'],
  ['.agents', 'skills', 'konoha', 'SKILL.md']
];

function seedIsComplete(dir) {
  return SEED_SENTINELS.every((parts) => fs.existsSync(path.join(dir, ...parts)));
}

// The seed gate used to report only the init exit status, which stays 0 even when
// init silently skips work, so a missing sentinel was undiagnosable from CI.
function describeMissingSentinels(dir) {
  return SEED_SENTINELS
    .filter((parts) => !fs.existsSync(path.join(dir, ...parts)))
    .map((parts) => parts.join('/'));
}

function describeSeedContents(dir) {
  const describe = (label, target) => {
    try {
      const names = fs.readdirSync(target);
      return `${label}=[${names.slice(0, 12).join(',')}${names.length > 12 ? ',…' : ''}]`;
    } catch (_) {
      return `${label}=<absent>`;
    }
  };
  return [
    describe('.konoha', path.join(dir, '.konoha')),
    describe('.agents', path.join(dir, '.agents'))
  ].join(' ');
}

module.exports = { SEED_SENTINELS, seedIsComplete, describeMissingSentinels, describeSeedContents };
