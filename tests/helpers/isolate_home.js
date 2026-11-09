/**
 * Temp-HOME isolation helper.
 *
 * Every install path in Konoha derives from HOME/USERPROFILE, so any test that
 * copies runtime files, provisioned tools, or skills must run against a
 * throwaway home. This helper creates one, points the current process at it,
 * and returns a cleanup function for child processes that inherit the env.
 *
 * Usage:
 *   const { isolateHome } = require('./helpers/isolate_home');
 *   const home = isolateHome();
 *   ...
 *   home.cleanup();
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function isolateHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_test_home_'));
  const previous = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    KONOHA_DB_PATH: process.env.KONOHA_DB_PATH
  };

  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
  process.env.KONOHA_DB_PATH = path.join(dir, 'test.db');

  return {
    dir,
    konohaDir: path.join(dir, '.konoha'),
    env: () => ({ ...process.env, HOME: dir, USERPROFILE: dir, KONOHA_DB_PATH: path.join(dir, 'test.db') }),
    cleanup: () => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

module.exports = { isolateHome };
