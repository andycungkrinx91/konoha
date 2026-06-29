'use strict';

const http = require('http');
const https = require('https');
const http2 = require('http2');
const fs = require('fs');

// ─────────────────────────────────────────────
// ConnectRPC communication with the sidecar
// ─────────────────────────────────────────────

/**
 * Low-level H2 ConnectRPC unary call.
 * Both JSON and Proto callers delegate here — the only difference is
 * `contentType`, the serialised `payload` buffer, and how the caller
 * interprets the returned `Buffer`.
 */
// Errors that indicate the sidecar isn't speaking TLS — fall back to h2c.
const H2_TLS_FALLBACK_CODES = new Set([
  'ERR_SSL_WRONG_VERSION_NUMBER',
  'ERR_SSL_PROTOCOL_ERROR',
  'EPROTO',
  'ECONNRESET',
]);

function _isTlsFallbackError(err) {
  if (!err) return false;
  if (H2_TLS_FALLBACK_CODES.has(err.code)) return true;
  const msg = (err.message || '').toLowerCase();
  return (
    msg.includes('wrong version number') ||
    msg.includes('ssl routines') ||
    msg.includes('packet length too long') ||
    msg.includes('tlsv1 alert') ||
    msg.includes('protocol error')
  );
}

/**
 * Connect to the sidecar at `port`. Tries HTTPS (with optional mTLS cert)
 * first, then falls back to plain HTTP/2 (h2c) if the server doesn't speak
 * TLS. The Antigravity `language_server_linux_x64` ships with h2c-only
 * listeners on Linux (the bundled cert is unused on that platform); the
 * fallback keeps the bridge working there without breaking TLS-only builds.
 *
 * Returns `{ client, close }`. Caller must `close()` after the request.
 */
function _connectSidecar(port, certPath) {
  let ca;
  let rejectCert = false;
  if (certPath) {
    try {
      ca = fs.readFileSync(certPath);
    } catch {
      rejectCert = true;
    }
  } else {
    rejectCert = true;
  }

  // First attempt: HTTPS with mTLS cert if available. If the sidecar rejects
  // the TLS handshake (cleartext h2c listener), we'll get an error and retry
  // with http:// below.
  const client = http2.connect(`https://localhost:${port}`, {
    ca,
    rejectUnauthorized: rejectCert,
  });
  let fellBack = false;
  let fallbackClient = null;

  // Wire a one-shot error listener so we can decide whether to swap to h2c.
  // We attach our real listener only after the fallback attempt completes.
  let pendingError = null;
  let firstErrorHandler = null;
  const tryFallback = () => {
    if (fellBack) return;
    fellBack = true;
    try {
      client.close();
    } catch {}
    try {
      fallbackClient = http2.connect(`http://localhost:${port}`);
    } catch (e) {
      // Couldn't even open h2c — surface the original TLS error
      throw pendingError || e;
    }
  };

  return {
    client,
    fallbackClient,
    tryFallback,
    isFallback: () => fellBack,
    getActive: () => (fellBack ? fallbackClient : client),
    close: () => {
      try {
        client.close();
      } catch {}
      if (fallbackClient) {
        try {
          fallbackClient.close();
        } catch {}
      }
    },
    reportError: (err) => {
      pendingError = err;
      if (firstErrorHandler) firstErrorHandler(err);
    },
    onFirstError: (handler) => {
      firstErrorHandler = handler;
    },
  };
}

function _makeH2UnaryCallOnce(port, csrf, certPath, method, contentType, payload, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let conn;
    try {
      conn = _connectSidecar(port, certPath);
    } catch (e) {
      return reject(new Error('H2 connect: ' + e.message));
    }
    let client = conn.getActive();
    const chunks = [];
    let status;
    let settled = false;
    let timer;
    const settle = (fn, val) => {
      if (!settled) {
        settled = true;
        if (timer) clearTimeout(timer);
        conn.close();
        fn(val);
      }
    };
    const onConnectError = (err) => {
      if (!conn.isFallback() && _isTlsFallbackError(err)) {
        try {
          conn.tryFallback();
          client = conn.getActive();
          // Re-attach handlers on the new client
          wireClient(client);
          return;
        } catch (fallbackErr) {
          return settle(reject, new Error('H2 connect: ' + fallbackErr.message));
        }
      }
      settle(reject, new Error('H2 connect: ' + err.message));
    };
    const wireClient = (c) => {
      c.on('error', onConnectError);
      c.on('connect', onConnect);
    };
    const onConnect = () => {
      const req = client.request({
        ':method': 'POST',
        ':path': `/exa.language_server_pb.LanguageServerService/${method}`,
        'content-type': contentType,
        'connect-protocol-version': '1',
        'x-codeium-csrf-token': csrf,
      });
      req.on('response', (h) => {
        status = h[':status'];
      });
      req.on('data', (d) => {
        chunks.push(d);
      });
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        if (status === 200) {
          settle(resolve, body);
        } else {
          settle(reject, new Error(`HTTP ${status}: ${body.toString('utf8').substring(0, 1000)}`));
        }
      });
      req.on('error', (e) => {
        settle(reject, e);
      });
      req.write(payload);
      req.end();
    };
    wireClient(client);
    timer = setTimeout(() => {
      settle(reject, new Error('H2 timeout'));
    }, timeoutMs);
  });
}

/**
 * Low-level H2 ConnectRPC streaming call (server-streaming).
 * The server streams responses after receiving our single request frame.
 * Timeout resolution (not rejection) is intentional — the sidecar starts
 * processing asynchronously and we poll for results separately.
 */
function _makeH2StreamingCallOnce(port, csrf, certPath, method, contentType, payload) {
  return new Promise((resolve, reject) => {
    let conn;
    try {
      conn = _connectSidecar(port, certPath);
    } catch (e) {
      return reject(new Error('H2 connect: ' + e.message));
    }
    let client = conn.getActive();
    let status;
    const chunks = [];

    let timer;
    const settleResolve = () => {
      clearTimeout(timer);
      conn.close();
      resolve();
    };
    const settleReject = (err) => {
      clearTimeout(timer);
      conn.close();
      reject(err);
    };

    const onConnectError = (err) => {
      if (!conn.isFallback() && _isTlsFallbackError(err)) {
        try {
          conn.tryFallback();
          client = conn.getActive();
          wireClient(client);
          return;
        } catch (fallbackErr) {
          return settleReject(new Error('H2 connect: ' + fallbackErr.message));
        }
      }
      settleReject(new Error('H2 connect: ' + err.message));
    };

    const wireClient = (c) => {
      c.on('error', onConnectError);
      c.on('connect', onConnect);
    };

    const onConnect = () => {
      const req = client.request({
        ':method': 'POST',
        ':path': `/exa.language_server_pb.LanguageServerService/${method}`,
        'content-type': contentType,
        'connect-protocol-version': '1',
        'x-codeium-csrf-token': csrf,
      });
      req.on('response', (h) => {
        status = h[':status'];
      });
      req.on('data', (d) => {
        chunks.push(d);
      });
      req.on('end', () => {
        if (status === 200) settleResolve();
        else {
          const body = Buffer.concat(chunks).toString('utf8');
          settleReject(new Error(`HTTP ${status}: ${body.substring(0, 1000)}`));
        }
      });
      req.on('error', (e) => {
        if (status === 200 || chunks.length > 0) settleResolve();
        else settleReject(e);
      });
      req.write(payload);
      req.end();
    };
    wireClient(client);
    timer = setTimeout(() => {
      try {
        client.close();
      } catch {}
      settleResolve(); // streaming RPC — timeout is normal, server started streaming
    }, 30000);
  });
}

/** Retry wrapper for transient H2 connect/timeout errors */
async function _withRetry(fn, retries = 2, retryOnTimeout = true) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const isTimeout = e.message.includes('H2 timeout');
      const isConnect = e.message.includes('H2 connect:');
      // Don't retry on timeout if caller set a custom (long) timeout — the request legitimately failed
      if (attempt < retries && (isConnect || (isTimeout && retryOnTimeout))) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
}

// ─────────────────────────────────────────────
// Public: JSON calls
// ─────────────────────────────────────────────

/** Make a unary H2+JSON ConnectRPC call (with automatic retry) */
async function makeH2JsonCall(port, csrf, certPath, method, body, retries = 2, timeoutMs = 10000) {
  const payload = Buffer.from(JSON.stringify(body));
  // If caller set a custom timeout (e.g. for inference), don't retry on timeout — the request ran its full duration
  const retryOnTimeout = timeoutMs <= 10000;
  const raw = await _withRetry(
    () => _makeH2UnaryCallOnce(port, csrf, certPath, method, 'application/json', payload, timeoutMs),
    retries,
    retryOnTimeout,
  );
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    return raw.toString('utf8');
  }
}

/** Make a streaming H2+JSON ConnectRPC call */
function makeH2StreamingCall(port, csrf, certPath, method, body) {
  const payload = Buffer.from(JSON.stringify(body));
  return _makeH2StreamingCallOnce(port, csrf, certPath, method, 'application/json', payload);
}

// ─────────────────────────────────────────────
// Public: Proto calls
// ─────────────────────────────────────────────

/** Make a unary H2+Proto ConnectRPC call (with automatic retry) */
async function makeH2ProtoCall(port, csrf, certPath, method, protoBytes, retries = 2) {
  const payload = Buffer.from(protoBytes);
  const raw = await _withRetry(
    () => _makeH2UnaryCallOnce(port, csrf, certPath, method, 'application/proto', payload),
    retries,
  );
  return new Uint8Array(raw);
}

/** Make a streaming H2+Proto ConnectRPC call */
function makeH2ProtoStreamingCall(port, csrf, certPath, method, protoBytes) {
  const payload = Buffer.from(protoBytes);
  return _makeH2StreamingCallOnce(port, csrf, certPath, method, 'application/proto', payload);
}

// ─────────────────────────────────────────────
// Legacy: HTTP/1.1 ConnectRPC (with HTTPS→HTTP fallback)
// ─────────────────────────────────────────────

function makeConnectRpcCallOnPort(port, csrf, certPath, servicePath, payload) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port,
      path: servicePath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
        'x-codeium-csrf-token': csrf,
        'Content-Length': Buffer.byteLength(payload),
      },
      // Default to rejecting the server cert.  Only relax this if a
      // sidecar cert has been read successfully from disk.  Never accept
      // an arbitrary cert blindly.
      rejectUnauthorized: true,
    };

    if (certPath) {
      try {
        options.ca = fs.readFileSync(certPath);
        options.rejectUnauthorized = true;
      } catch {
        // Cert unreadable: keep rejectUnauthorized=true (refuse to talk).
      }
    }

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(body);
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${body.substring(0, 1000)}`));
        }
      });
    });

    req.on('error', (err) => {
      // If HTTPS fails, try HTTP
      if (
        err.code === 'ERR_SSL_WRONG_VERSION_NUMBER' ||
        err.message.includes('SSL') ||
        err.message.includes('ECONNRESET') ||
        err.message.includes('disconnected') ||
        err.message.includes('EPIPE')
      ) {
        const httpOpts = { ...options };
        delete httpOpts.ca;
        delete httpOpts.rejectUnauthorized;
        const httpReq = http.request(httpOpts, (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            if (res.statusCode === 200) {
              try {
                resolve(JSON.parse(body));
              } catch {
                resolve(body);
              }
            } else {
              reject(new Error(`HTTP ${res.statusCode}: ${body.substring(0, 1000)}`));
            }
          });
        });
        httpReq.on('error', reject);
        httpReq.setTimeout(10000, () => {
          httpReq.destroy(new Error('Timeout'));
        });
        httpReq.write(payload);
        httpReq.end();
      } else {
        reject(err);
      }
    });
    req.setTimeout(10000, () => {
      req.destroy(new Error('Timeout'));
    });
    req.write(payload);
    req.end();
  });
}

module.exports = {
  makeH2JsonCall,
  makeH2StreamingCall,
  makeH2ProtoCall,
  makeH2ProtoStreamingCall,
  makeConnectRpcCallOnPort,
};
