#!/usr/bin/env node
/**
 * Build the opt-in cyber pack release asset.
 *
 * The pack is not tracked in git. This script reads the local source tree (a
 * checkout of the upstream skills library, or a previously extracted pack) and
 * emits `dist/akatsuki-cyber-pack-<version>.tar.zst` plus `manifest.json`.
 *
 * Usage:
 *   node scripts/build_cyber_pack.js [--source <dir>] [--out <dir>]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { createTar } = require('../src/cyber_pack');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_SOURCE = path.join(
  REPO_ROOT,
  'src', 'templates', 'skills', 'akatsuki-skill', 'references',
  'anthropic-cybersecurity-skills-assets'
);

function argValue(args, flag) {
  const idx = args.indexOf(flag);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
}

function collectFiles(root, prefix = '') {
  const out = [];
  // Sorted so the archive bytes (and therefore the published sha256) are
  // identical on every rebuild; readdir order is filesystem-dependent.
  const entries = fs.readdirSync(root, { withFileTypes: true })
    .sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = path.join(root, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...collectFiles(full, rel));
    } else if (entry.isFile()) {
      out.push({ name: rel, data: fs.readFileSync(full) });
    }
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const source = path.resolve(argValue(args, '--source') || DEFAULT_SOURCE);
  const outDir = path.resolve(argValue(args, '--out') || path.join(REPO_ROOT, 'dist'));
  const version = require('../package.json').version;

  if (!fs.existsSync(source)) {
    console.error(`Source pack not found: ${source}`);
    console.error('Pass --source <dir> pointing at anthropic-cybersecurity-skills-assets.');
    process.exit(1);
  }

  const files = collectFiles(source);
  const skillCount = files.filter((f) => /^skills\/[^/]+\/SKILL\.md$/.test(f.name)).length;
  if (skillCount === 0) {
    console.error(`No skills/<name>/SKILL.md found under ${source}`);
    process.exit(1);
  }

  const tar = createTar(files);
  const archive = zlib.zstdCompressSync(tar, { params: { [zlib.constants.ZSTD_c_compressionLevel]: 19 } });
  const sha256 = crypto.createHash('sha256').update(archive).digest('hex');

  fs.mkdirSync(outDir, { recursive: true });
  const archiveName = `akatsuki-cyber-pack-${version}.tar.zst`;
  const archivePath = path.join(outDir, archiveName);
  fs.writeFileSync(archivePath, archive);

  const manifest = {
    version,
    sha256,
    size_bytes: archive.length,
    skill_count: skillCount,
    file_count: files.length,
    url: `https://github.com/andycungkrinx91/konoha/releases/download/v${version}/${archiveName}`,
    built_at: new Date().toISOString()
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log(`✓ ${archiveName} (${(archive.length / 1024 / 1024).toFixed(2)} MiB, ${files.length} files, ${skillCount} skills)`);
  console.log(`  sha256 ${sha256}`);
  console.log(`  manifest ${path.join(outDir, 'manifest.json')}`);
}

main();
