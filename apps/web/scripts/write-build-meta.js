#!/usr/bin/env node

/**
 * scripts/write-build-meta.js — stamp the built Web UI with the version that
 * produced it. Runs after `vite build` so installs can reject a stale artifact
 * tree instead of relabelling it with the current package version.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(webRoot, 'build');
const pkg = JSON.parse(fs.readFileSync(path.join(webRoot, 'package.json'), 'utf8'));

const rawEpoch = process.env.SOURCE_DATE_EPOCH;
const builtAt = rawEpoch && /^\d+$/.test(rawEpoch.trim())
  ? new Date(Number(rawEpoch.trim()) * 1000).toISOString()
  : new Date().toISOString();

fs.mkdirSync(buildDir, { recursive: true });
fs.writeFileSync(
  path.join(buildDir, 'build-meta.json'),
  JSON.stringify({ version: pkg.version, builtAt }, null, 2) + '\n'
);

process.stdout.write(`build-meta.json: ${pkg.version}\n`);
