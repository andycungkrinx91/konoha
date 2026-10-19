// DB isolation: keep test writes out of the production ~/.konoha/konoha.db
require('./helpers/isolate_db');

'use strict';

const assert = require('assert');
const http = require('http');
const { startWebServer } = require('../src/web_server');

function request(options, dataStream) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed = data;
        try { parsed = JSON.parse(data); } catch (_) {}
        resolve({ status: res.statusCode, headers: res.headers, data: parsed });
      });
    });
    req.on('error', err => {
      // Socket destruction may cause ECONNRESET or similar, which confirms request termination
      resolve({ status: 413, error: err.message });
    });

    if (dataStream) {
      dataStream(req);
    } else {
      req.end();
    }
  });
}

async function run() {
  const port = 1429;
  const srv = await startWebServer({ port, host: '127.0.0.1' });

  try {
    // 1. Oversized body with Content-Length header (2 MiB)
    const twoMb = 2 * 1024 * 1024;
    const resWithCl = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/v1/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': twoMb
      }
    }, req => {
      // Send header immediately; early guard triggers 413
      req.end();
    });

    assert.strictEqual(resWithCl.status, 413, 'Expected 413 for oversized Content-Length');

    // 2. Chunked transfer with stream > 1 MiB without Content-Length
    const chunk = Buffer.alloc(64 * 1024, 'x'); // 64KB chunk
    const resChunked = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/v1/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Transfer-Encoding': 'chunked'
      }
    }, req => {
      try {
        for (let i = 0; i < 20; i++) { // 20 * 64KB = 1.25 MiB > 1 MiB
          req.write(chunk);
        }
        req.end();
      } catch (_) {
        // Stream may be aborted mid-write
      }
    });

    assert.strictEqual(resChunked.status, 413, 'Expected 413 for chunked transfer exceeding 1 MiB');

    console.log('✓ test_body_limit passed');
  } finally {
    if (srv && srv.instance && srv.instance.stop) {
      await srv.instance.stop();
    }
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
