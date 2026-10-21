#!/usr/bin/env node
'use strict';

/**
 * bin/postinstall.js — Post-install guidance.
 * Setup is not executed during package installation.
 * Users must explicitly run 'npx konoha init --yes' or 'konoha init --yes'.
 */

if (require.main === module) {
  process.stdout.write('Konoha MCP package installed.\nTo initialize runtime and configure integrations, run: npx konoha init --yes\n');
}
