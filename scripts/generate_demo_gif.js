#!/usr/bin/env node
/** Legacy redirect to 100% authentic demo GIF generator. */
'use strict';

const path = require('path');
const { spawn } = require('child_process');

const target = path.join(__dirname, 'generate_real_demo_gifs.js');
const child = spawn(process.execPath, [target, ...process.argv.slice(2)], {
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code == null ? 1 : code);
  }
});
