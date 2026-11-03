'use strict';

/**
 * Cross-layout dependency resolver for the 3D asset pipeline.
 * Resolves three.js and manifold-3d across repository, deployed runtime,
 * and web workspace node_modules trees so deployed daemons never fail
 * with "Cannot find module 'three'".
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const RUNTIME_ROOT = path.join(os.homedir(), '.konoha');

function candidateNodeModulesRoots() {
  const roots = new Set([
    path.join(RUNTIME_ROOT, 'node_modules'),
    path.join(RUNTIME_ROOT, 'apps', 'web', 'node_modules'),
    path.join(REPO_ROOT, 'node_modules'),
    path.join(REPO_ROOT, 'apps', 'web', 'node_modules')
  ]);
  let cursor = __dirname;
  for (let depth = 0; depth < 8; depth += 1) {
    roots.add(path.join(cursor, 'node_modules'));
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return [...roots].filter((dir) => {
    try {
      return fs.statSync(dir).isDirectory();
    } catch {
      return false;
    }
  });
}

function createResolver(moduleRoot) {
  const anchor = path.join(moduleRoot, 'noop.js');
  return Module.createRequire(anchor);
}

function resolveFromRoots(specifier) {
  const errors = [];
  for (const root of candidateNodeModulesRoots()) {
    try {
      return createResolver(root).resolve(specifier);
    } catch (err) {
      errors.push(err.message);
    }
  }
  return null;
}

function loadModule(specifier) {
  try {
    return require(specifier);
  } catch (directErr) {
    const resolved = resolveFromRoots(specifier);
    if (!resolved) {
      const err = new Error(`Cannot resolve module '${specifier}' from ${__dirname}: ${directErr.message}`);
      err.code = 'MODULE_NOT_FOUND';
      throw err;
    }
    const loader = createResolver(path.dirname(resolved));
    return loader(resolved);
  }
}

function loadThree() {
  return loadModule('three');
}

function loadAddon(relativePath) {
  return loadModule(`three/addons/${relativePath}`);
}

function loadManifold() {
  return loadModule('manifold-3d');
}

function isModuleAvailable(specifier) {
  try {
    require.resolve(specifier);
    return true;
  } catch {
    return resolveFromRoots(specifier) !== null;
  }
}

module.exports = {
  candidateNodeModulesRoots,
  loadModule,
  loadThree,
  loadAddon,
  loadManifold,
  isModuleAvailable
};
