#!/usr/bin/env node
'use strict';

/**
 * bin/postinstall.js — Post-install guidance.
 *
 * Deliberately side-effect-free: no network calls, no global installs, no writes
 * to $HOME. A postinstall that installs or configures things is what makes global
 * installs slow and fragile, and it runs in CI and package-manager sandboxes where
 * those side effects are unwanted. Runtime setup stays an explicit user action.
 */

if (require.main === module) {
  process.stdout.write(
    'Konoha MCP package installed.\n' +
    'Initialize runtime and configure clients:  konoha init --yes\n' +
    'Upgrade an existing installation:          konoha upgrade\n' +
    'Try without installing:                    npm exec --yes --package=konoha-mcp@latest -- konoha --version\n'
  );
}
