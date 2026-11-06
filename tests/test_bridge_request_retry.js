#!/usr/bin/env node
'use strict';

/**
 * Same-provider retry before the first byte (src/bridge/request_retry.js).
 *
 * A chat/completions POST is not idempotent, so the retry classifier must only
 * ever retry failures that PROVE the provider never processed the request.
 * Indeterminate transport failures (ECONNRESET / ETIMEDOUT after the body was
 * written) must surface immediately — retrying them would double-charge.
 *
 * Cases:
 *   (a) ECONNREFUSED is retryable, with bounded attempts
 *   (b) indeterminate ECONNRESET / ETIMEDOUT are NOT retryable
 *   (c) 502/503/504 are retryable, other 4xx are not
 *   (d) 429 is retryable and honours Retry-After
 *   (e) exhaustion surfaces attempts + final status/code + verbatim message
 *   (f) the same bridge, model and body are re-sent (no substitution)
 *   (g) ECONNREFUSED (never connected) -> retried
 *   (h) ECONNRESET after body written -> NOT retried (double-charge guard)
 *   (i) ETIMEDOUT after body written -> NOT retried
 *   (j) 429 + Retry-After: 1 -> retried, delay respects the header
 *   (k) exactly N dispatches for N attempts, at most one committed response
 *   (l) max attempts is exactly 3 and backoff never exceeds 2000ms
 *   hasFlushed negative control: once the client has bytes, nothing retries.
 */

const assert = require('assert');
const http = require('http');
const requestRetry = require('../src/bridge/request_retry');

const {
  MAX_ATTEMPTS,
  MAX_BACKOFF_MS,
  isTransportRetryable,
  isRetryableStatus,
  hasFlushed,
  computeBackoffDelay,
  computeRetryDelay,
  classifyRetryDecision,
  forwardWithRetry,
  readUpstreamBody
} = requestRetry;

const noSleep = () => Promise.resolve();
const fixedRandom = () => 0.5;

function listen(handler) {
  const sockets = new Set();
  const server = http.createServer(handler);
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        port: server.address().port,
        url: `http://127.0.0.1:${server.address().port}/v1/chat/completions`,
        close: () => new Promise((done) => {
          for (const socket of sockets) socket.destroy();
          server.close(done);
        })
      });
    });
  });
}

/**
 * Wait until the server has observed a request body end, so we can be certain
 * the body was fully transmitted before the failure is injected.
 */
function waitForBodyEnd(req) {
  return new Promise((resolve) => {
    req.on('data', () => {});
    req.on('end', resolve);
  });
}

function jsonResponse(res, statusCode, payload, headers = {}) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(payload));
}

async function caseA_connectionRefused() {
  const outcome = await forwardWithRetry({
    url: 'http://127.0.0.1:1/v1/chat/completions',
    headers: { 'content-type': 'application/json' },
    body: '{"model":"m"}',
    sleep: noSleep
  });

  assert.strictEqual(outcome.delivered, false);
  assert.strictEqual(outcome.attempts, MAX_ATTEMPTS, 'ECONNREFUSED should be retried up to the cap');
  assert.strictEqual(outcome.retried.length, MAX_ATTEMPTS - 1);
  assert.ok(outcome.retried.every((r) => r.code === 'ECONNREFUSED'));
  assert.strictEqual(outcome.error.error.final_transport_code, 'ECONNREFUSED');
  console.log('  (a) ECONNREFUSED retried to the bounded cap, code surfaced verbatim.');
}

async function caseB_indeterminateTransport() {
  assert.strictEqual(isTransportRetryable('ECONNRESET'), false);
  assert.strictEqual(isTransportRetryable('ETIMEDOUT'), false);
  assert.strictEqual(isTransportRetryable('EPIPE'), false);

  for (const code of ['ECONNRESET', 'ETIMEDOUT']) {
    const decision = classifyRetryDecision({
      attempt: 1,
      maxAttempts: MAX_ATTEMPTS,
      error: Object.assign(new Error(code), { code }),
      res: { headersSent: false }
    });
    assert.strictEqual(decision.retry, false, `${code} must never be retried`);
    assert.strictEqual(decision.reason, 'transport_indeterminate');
  }
  console.log('  (b) ECONNRESET / ETIMEDOUT classified as indeterminate and not retryable.');
}

async function caseC_statusClassification() {
  for (const status of [502, 503, 504]) {
    assert.strictEqual(isRetryableStatus(status), true, `${status} must be retryable`);
  }
  assert.strictEqual(isRetryableStatus(429), true);
  for (const status of [400, 401, 403, 404, 409, 422, 500]) {
    assert.strictEqual(isRetryableStatus(status), false, `${status} must not be retryable`);
  }

  let dispatches = 0;
  const upstream = await listen((req, res) => {
    dispatches += 1;
    waitForBodyEnd(req).then(() => jsonResponse(res, 400, { error: { message: 'bad request' } }));
  });
  try {
    const outcome = await forwardWithRetry({ url: upstream.url, headers: {}, body: '{}', sleep: noSleep });
    assert.strictEqual(outcome.delivered, false);
    assert.strictEqual(outcome.attempts, 1, 'a 4xx other than 429 must not be retried');
    assert.strictEqual(dispatches, 1);
    assert.strictEqual(outcome.error.error.final_status, 400);
  } finally {
    await upstream.close();
  }
  console.log('  (c) 502/503/504 retryable; non-429 4xx delivered without retry.');
}

async function caseD_rateLimitedRetryAfter() {
  let dispatches = 0;
  const delays = [];
  const upstream = await listen((req, res) => {
    dispatches += 1;
    waitForBodyEnd(req).then(() => {
      if (dispatches === 1) {
        jsonResponse(res, 429, { error: { message: 'rate limited' } }, { 'Retry-After': '1' });
        return;
      }
      jsonResponse(res, 200, { id: 'ok', choices: [] });
    });
  });
  try {
    const outcome = await forwardWithRetry({
      url: upstream.url,
      headers: {},
      body: '{}',
      random: fixedRandom,
      sleep: async (ms) => { delays.push(ms); }
    });
    assert.strictEqual(outcome.delivered, true);
    assert.strictEqual(outcome.attempts, 2);
    assert.strictEqual(outcome.retried[0].delay_source, 'retry_after');
    assert.ok(outcome.retried[0].delay_ms >= 1000, 'Retry-After: 1 must yield >= 1000ms');
  } finally {
    await upstream.close();
  }
  console.log('  (d) 429 retried; Retry-After: 1 produced a >= 1000ms delay.');
}

async function caseE_exhaustionSurface() {
  const upstream = await listen((req, res) => {
    waitForBodyEnd(req).then(() => jsonResponse(res, 503, { error: { message: 'upstream is restarting, try later' } }));
  });
  try {
    const outcome = await forwardWithRetry({ url: upstream.url, headers: {}, body: '{}', sleep: noSleep });
    const err = outcome.error.error;

    assert.strictEqual(outcome.delivered, false);
    assert.strictEqual(err.attempts_made, MAX_ATTEMPTS);
    assert.strictEqual(err.final_status, 503);
    assert.strictEqual(err.upstream_message, 'upstream is restarting, try later', 'upstream message must be verbatim');
    assert.strictEqual(err.message, 'upstream is restarting, try later');
    assert.notStrictEqual(err.message, 'failed');
    assert.strictEqual(outcome.error.retry_suppressed_reason, 'attempts_exhausted');
  } finally {
    await upstream.close();
  }
  console.log('  (e) Exhaustion surfaces attempts, final status and the verbatim upstream message.');
}

async function caseF_sameProviderSameModel() {
  const seenModels = [];
  const seenBodies = [];
  let dispatches = 0;
  const upstream = await listen((req, res) => {
    dispatches += 1;
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      seenBodies.push(raw);
      seenModels.push(JSON.parse(raw).model);
      if (dispatches < 3) {
        jsonResponse(res, 502, { error: { message: 'bad gateway' } });
        return;
      }
      jsonResponse(res, 200, { id: 'ok', choices: [] });
    });
  });
  try {
    const requestedModel = 'ag/gemini-3.8-flash-high';
    const body = JSON.stringify({ model: requestedModel, messages: [{ role: 'user', content: 'ping' }], stream: true });
    const outcome = await forwardWithRetry({ url: upstream.url, headers: { authorization: 'Bearer k' }, body, sleep: noSleep });

    assert.strictEqual(outcome.delivered, true);
    assert.strictEqual(outcome.attempts, 3);
    assert.strictEqual(seenModels.length, 3);
    assert.ok(seenModels.every((m) => m === requestedModel), 'model must never be rewritten between attempts');
    assert.ok(seenBodies.every((b) => b === body), 'body must be byte-identical between attempts');
  } finally {
    await upstream.close();
  }
  console.log('  (f) Same bridge/model/body re-sent unchanged across attempts.');
}

async function caseG_econnrefusedRetried() {
  // Bind then release a port so we know it is closed: the kernel refuses fast.
  const probe = await listen((req, res) => res.end());
  const deadUrl = `http://127.0.0.1:${probe.port}/v1/chat/completions`;
  await probe.close();

  const outcome = await forwardWithRetry({ url: deadUrl, headers: {}, body: '{}', sleep: noSleep });
  assert.strictEqual(outcome.delivered, false);
  assert.ok(outcome.attempts > 1, 'ECONNREFUSED (never connected) must be retried');
  assert.strictEqual(outcome.attempts, MAX_ATTEMPTS);
  assert.strictEqual(outcome.retried.every((r) => r.code === 'ECONNREFUSED'), true);
  console.log('  (g) ECONNREFUSED (connection never established) was retried.');
}

async function caseH_econnresetAfterBodyNotRetried() {
  let dispatches = 0;
  let bodyEndedBeforeReset = false;
  const upstream = await listen((req, res) => {
    dispatches += 1;
    waitForBodyEnd(req).then(() => {
      bodyEndedBeforeReset = true;
      // Destroy the socket with zero response bytes: the provider may already
      // have executed (and billed) the request, so this is indeterminate.
      req.socket.destroy();
    });
  });
  try {
    const outcome = await forwardWithRetry({ url: upstream.url, headers: {}, body: '{"model":"m"}', sleep: noSleep });

    assert.strictEqual(bodyEndedBeforeReset, true, 'the body must be written before the reset');
    assert.strictEqual(dispatches, 1, 'DOUBLE-CHARGE GUARD: ECONNRESET after body must not be retried');
    assert.strictEqual(outcome.delivered, false);
    assert.strictEqual(outcome.attempts, 1);
    assert.strictEqual(outcome.retried.length, 0);
    assert.strictEqual(outcome.error.retry_suppressed_reason, 'transport_indeterminate');
    assert.strictEqual(outcome.error.error.final_transport_code, 'ECONNRESET');
    assert.ok(outcome.error.error.message.length > 0 && outcome.error.error.message !== 'failed');
  } finally {
    await upstream.close();
  }
  console.log('  (h) ECONNRESET after body written: exactly 1 dispatch, error surfaced (no double charge).');
}

async function caseI_etimedoutAfterBodyNotRetried() {
  // A body was fully written to a provider that then went silent: the fate of
  // the request is unknown, so it must not be retried.
  let calls = 0;
  const dispatch = () => {
    calls += 1;
    return Promise.resolve({
      kind: 'error',
      attempt: calls,
      code: 'ETIMEDOUT',
      error: Object.assign(new Error('body sent, provider silent'), { code: 'ETIMEDOUT', bodyWritten: true })
    });
  };
  const outcome = await forwardWithRetry({ url: 'http://127.0.0.1:9/v1/x', headers: {}, body: '{"model":"m"}', dispatch, sleep: noSleep });

  assert.strictEqual(calls, 1, 'ETIMEDOUT after body must not be retried');
  assert.strictEqual(outcome.attempts, 1);
  assert.strictEqual(outcome.delivered, false);
  assert.strictEqual(outcome.error.retry_suppressed_reason, 'transport_indeterminate');
  assert.strictEqual(outcome.error.error.final_transport_code, 'ETIMEDOUT');

  const decision = classifyRetryDecision({
    attempt: 1,
    maxAttempts: MAX_ATTEMPTS,
    error: Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }),
    res: { headersSent: false }
  });
  assert.strictEqual(decision.retry, false);
  console.log('  (i) ETIMEDOUT after body written: exactly 1 dispatch, error surfaced.');
}

async function caseJ_retryAfterRespected() {
  let dispatches = 0;
  const upstream = await listen((req, res) => {
    dispatches += 1;
    waitForBodyEnd(req).then(() => {
      if (dispatches === 1) {
        jsonResponse(res, 429, { error: { message: 'slow down' } }, { 'Retry-After': '1' });
        return;
      }
      jsonResponse(res, 200, { id: 'ok' });
    });
  });
  try {
    const outcome = await forwardWithRetry({ url: upstream.url, headers: {}, body: '{}', random: fixedRandom, sleep: noSleep });
    assert.strictEqual(dispatches, 2);
    assert.strictEqual(outcome.delivered, true);
    const retry = outcome.retried[0];
    assert.strictEqual(retry.delay_source, 'retry_after');
    assert.ok(retry.delay_ms >= 1000, `delay ${retry.delay_ms} must honour Retry-After: 1`);
    assert.ok(retry.delay_ms <= MAX_BACKOFF_MS || retry.delay_source === 'retry_after');
  } finally {
    await upstream.close();
  }
  console.log('  (j) 429 + Retry-After: 1 scheduled a delay >= 1000ms.');
}

async function caseK_noDuplicateDispatch() {
  let dispatches = 0;
  let completed = 0;
  const upstream = await listen((req, res) => {
    dispatches += 1;
    const thisDispatch = dispatches;
    waitForBodyEnd(req).then(() => {
      if (thisDispatch < MAX_ATTEMPTS) {
        jsonResponse(res, 503, { error: { message: `attempt ${thisDispatch} unavailable` } });
        return;
      }
      completed += 1;
      jsonResponse(res, 200, { id: 'final', choices: [] });
    });
  });
  try {
    const outcome = await forwardWithRetry({ url: upstream.url, headers: {}, body: '{}', sleep: noSleep });

    assert.strictEqual(outcome.delivered, true);
    assert.strictEqual(outcome.attempts, MAX_ATTEMPTS);
    assert.strictEqual(dispatches, outcome.attempts, 'upstream must receive exactly N dispatches for N attempts');
    assert.strictEqual(completed, 1, 'exactly one dispatch may reach a committed response');
  } finally {
    await upstream.close();
  }
  console.log('  (k) Exactly 3 dispatches for 3 attempts; exactly one committed response.');
}

async function caseL_bounds() {
  assert.strictEqual(MAX_ATTEMPTS, 3, 'max attempts must be exactly 3 (1 initial + 2 retries)');
  assert.strictEqual(MAX_BACKOFF_MS, 2000);

  let observedMax = 0;
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    for (let i = 0; i < 300; i += 1) {
      const delay = computeBackoffDelay(attempt, Math.random);
      assert.ok(Number.isFinite(delay) && delay >= 0, 'backoff must be a finite non-negative number');
      observedMax = Math.max(observedMax, delay);
    }
  }
  assert.ok(observedMax <= MAX_BACKOFF_MS, `backoff ${observedMax}ms exceeded the ${MAX_BACKOFF_MS}ms cap`);

  const expectedNoJitter = [250, 500, 1000, 2000, 2000, 2000];
  expectedNoJitter.forEach((expected, i) => {
    assert.strictEqual(computeBackoffDelay(i + 1, fixedRandom), expected);
  });

  // Retry-After may legitimately exceed the backoff cap, but a retry that would
  // blow the total request budget is refused instead of stalling.
  const upstream = await listen((req, res) => {
    waitForBodyEnd(req).then(() => jsonResponse(res, 503, { error: { message: 'budget check' } }));
  });
  try {
    const outcome = await forwardWithRetry({
      url: upstream.url,
      headers: {},
      body: '{}',
      maxRetryBudgetMs: 1,
      sleep: noSleep
    });
    assert.strictEqual(outcome.delivered, false);
    assert.strictEqual(outcome.error.retry_suppressed_reason, 'retry_budget_exceeded');
  } finally {
    await upstream.close();
  }
  console.log('  (l) max attempts = 3, backoff capped at 2000ms, retry budget enforced.');
}

async function hasFlushedNegativeControl() {
  assert.strictEqual(hasFlushed(null), false);
  assert.strictEqual(hasFlushed({ headersSent: false, writableEnded: false }), false);
  assert.strictEqual(hasFlushed({ headersSent: true }), true);
  assert.strictEqual(hasFlushed({ writableEnded: true }), true);

  const decision = classifyRetryDecision({ attempt: 1, maxAttempts: MAX_ATTEMPTS, statusCode: 503, res: { headersSent: true } });
  assert.strictEqual(decision.retry, false);
  assert.strictEqual(decision.reason, 'response_already_flushed');

  // Real socket: flush one byte, then inject a retryable failure on the second
  // attempt. The supervisor must stop instead of retrying.
  let dispatches = 0;
  const upstream = await listen((req, res) => {
    dispatches += 1;
    waitForBodyEnd(req).then(() => {
      if (dispatches === 1) {
        jsonResponse(res, 503, { error: { message: 'first failure' } });
        return;
      }
      jsonResponse(res, 200, { id: 'should-not-happen' });
    });
  });

  try {
    const clientRes = { headersSent: false, writableEnded: false };
    const outcome = await forwardWithRetry({
      url: upstream.url,
      headers: {},
      body: '{}',
      res: clientRes,
      sleep: async () => {
        // Simulate the first byte reaching the client between attempts.
        clientRes.headersSent = true;
      }
    });

    assert.strictEqual(outcome.delivered, false);
    assert.strictEqual(outcome.error.retry_suppressed_reason, 'response_already_flushed');
    assert.strictEqual(dispatches, 1, 'no further upstream dispatch after the client was flushed');
  } finally {
    await upstream.close();
  }
  console.log('  hasFlushed negative control: a flushed client response blocks all retries.');
}

async function readBodyVerbatim() {
  const upstream = await listen((req, res) => {
    waitForBodyEnd(req).then(() => {
      res.writeHead(418, { 'Content-Type': 'text/plain' });
      res.end('plain text upstream failure');
    });
  });
  try {
    const outcome = await forwardWithRetry({ url: upstream.url, headers: {}, body: '{}', sleep: noSleep });
    assert.strictEqual(outcome.attempts, 1);
    assert.strictEqual(outcome.error.error.upstream_message, 'plain text upstream failure');
  } finally {
    await upstream.close();
  }
  assert.strictEqual(readUpstreamBody instanceof Function, true);
  console.log('  Non-JSON upstream error bodies surface verbatim.');
}

/**
 * Wiring proof: the gateway chat/completions path must actually go through the
 * retry supervisor, so a pre-first-byte 503 is retried transparently.
 */
async function wiringGatewayRetriesBeforeFlush() {
  const { handleChatCompletions } = require('../src/bridge/gateway');
  const { bridgeModelsCache } = require('../src/bridge/gateway_router');

  let dispatches = 0;
  const upstream = await listen((req, res) => {
    dispatches += 1;
    waitForBodyEnd(req).then(() => {
      if (dispatches === 1) {
        jsonResponse(res, 503, { error: { message: 'transient' } });
        return;
      }
      jsonResponse(res, 200, { id: 'chatcmpl-wired', object: 'chat.completion', choices: [] });
    });
  });

  try {
    // Base model id is intentionally distinct from the alias so the response
    // body is untouched by model-rewriting (that path is covered elsewhere).
    bridgeModelsCache.set('wired', { data: [{ id: 'gpt-test' }], timestamp: Date.now() });
    const activeBridges = new Map([['wired', { bridgeConfig: { port: upstream.port, provider: 'openai-compatible' } }]]);

    const captured = await invokeChatCompletions(handleChatCompletions, activeBridges, { model: 'wired-gpt-test', messages: [] });

    assert.strictEqual(dispatches, 2, 'gateway must retry the 503 before any byte is flushed');
    assert.strictEqual(captured.status, 200);
    assert.strictEqual(captured.body.id, 'chatcmpl-wired');
  } finally {
    bridgeModelsCache.delete('wired');
    await upstream.close();
  }
  console.log('  Wiring: gateway chat/completions retried a 503 pre-flush and delivered 200.');
}

function invokeChatCompletions(handler, activeBridges, payload) {
  const { Readable } = require('stream');
  const { EventEmitter } = require('events');
  return new Promise((resolve) => {
    const req = Readable.from([Buffer.from(JSON.stringify(payload))]);
    req.method = 'POST';
    req.url = '/v1/chat/completions';
    req.headers = { host: '127.0.0.1:19999', 'content-type': 'application/json' };

    const captured = { status: null, body: null, chunks: [] };
    const res = new EventEmitter();
    Object.assign(res, {
      headersSent: false,
      writableEnded: false,
      setHeader() {},
      getHeader() { return undefined; },
      writeHead(status) { captured.status = status; res.headersSent = true; },
      write(chunk) {
        if (chunk) captured.chunks.push(Buffer.from(chunk));
        return true;
      },
      end(chunk) {
        if (chunk) captured.chunks.push(Buffer.from(chunk));
        res.writableEnded = true;
        const raw = Buffer.concat(captured.chunks).toString('utf8');
        try { captured.body = raw ? JSON.parse(raw) : null; } catch (_) { captured.body = raw; }
        res.emit('finish');
      }
    });
    res.once('finish', () => resolve(captured));
    handler(activeBridges, req, res);
  });
}

async function run() {
  console.log('Running test_bridge_request_retry.js...');
  await caseA_connectionRefused();
  await caseB_indeterminateTransport();
  await caseC_statusClassification();
  await caseD_rateLimitedRetryAfter();
  await caseE_exhaustionSurface();
  await caseF_sameProviderSameModel();
  await caseG_econnrefusedRetried();
  await caseH_econnresetAfterBodyNotRetried();
  await caseI_etimedoutAfterBodyNotRetried();
  await caseJ_retryAfterRespected();
  await caseK_noDuplicateDispatch();
  await caseL_bounds();
  await hasFlushedNegativeControl();
  await readBodyVerbatim();
  await wiringGatewayRetriesBeforeFlush();
  console.log('All tests in test_bridge_request_retry.js passed.');
}

run().catch((err) => {
  console.error('Test failed:', err && err.stack ? err.stack : err);
  process.exit(1);
});
