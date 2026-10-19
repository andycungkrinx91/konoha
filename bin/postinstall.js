#!/usr/bin/env node
'use strict';

/**
 * bin/postinstall.js — Runs after npm/pnpm global or local installation.
 * Automatically initializes ~/.konoha runtime and reconciles global shims.
 */

try {
  const { installCliRuntime, reconcileGlobalCommand } = require('./lib/runtime');
  installCliRuntime();
  reconcileGlobalCommand();
} catch (_) {
  // Best-effort postinstall; never fail package installation
}
