#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { CircuitBreaker, CircuitState, CircuitBreakerRegistry } = require('../src/circuit_breaker');

function testInitialStateClosed() {
  const cb = new CircuitBreaker('test-service', 3, 1.0);
  assert.strictEqual(cb.state, CircuitState.CLOSED);
  assert.strictEqual(cb.allow_request(), true);
}

function testTripToOpenOnThreshold() {
  const cb = new CircuitBreaker('test-service', 3, 0.5);

  cb.record_failure();
  assert.strictEqual(cb.state, CircuitState.CLOSED);
  assert.strictEqual(cb.allow_request(), true);

  cb.record_failure();
  assert.strictEqual(cb.state, CircuitState.CLOSED);
  assert.strictEqual(cb.allow_request(), true);

  cb.record_failure();
  assert.strictEqual(cb.state, CircuitState.OPEN);
  assert.strictEqual(cb.allow_request(), false);
}

function testRecoveryToHalfOpenAndClosed() {
  const cb = new CircuitBreaker('test-service', 2, 0.2);

  cb.record_failure();
  cb.record_failure();
  assert.strictEqual(cb.state, CircuitState.OPEN);
  assert.strictEqual(cb.allow_request(), false);

  const start = Date.now();
  while (Date.now() - start < 250) {}

  assert.strictEqual(cb.allow_request(), true);
  assert.strictEqual(cb.state, CircuitState.HALF_OPEN);

  cb.record_success();
  assert.strictEqual(cb.state, CircuitState.CLOSED);
  assert.strictEqual(cb.failure_count, 0);
  assert.strictEqual(cb.allow_request(), true);
}

function testHalfOpenFailureReTripsToOpen() {
  const cb = new CircuitBreaker('test-service', 2, 0.1);

  cb.record_failure();
  cb.record_failure();
  assert.strictEqual(cb.state, CircuitState.OPEN);

  const start = Date.now();
  while (Date.now() - start < 150) {}

  assert.strictEqual(cb.allow_request(), true);
  assert.strictEqual(cb.state, CircuitState.HALF_OPEN);

  cb.record_failure();
  assert.strictEqual(cb.state, CircuitState.OPEN);
  assert.strictEqual(cb.allow_request(), false);
}

function testRegistry() {
  const registry = new CircuitBreakerRegistry();
  const cb1 = registry.get_or_create('host1.example.com', 3);
  const cb2 = registry.get_or_create('host1.example.com', 3);
  assert.strictEqual(cb1, cb2);

  const cb3 = registry.get_or_create('host2.example.com');
  assert.notStrictEqual(cb1, cb3);

  const statuses = registry.get_all_statuses();
  assert.ok('host1.example.com' in statuses);
  assert.ok('host2.example.com' in statuses);
}

console.log('Running test_circuit_breaker.js...');
testInitialStateClosed();
testTripToOpenOnThreshold();
testRecoveryToHalfOpenAndClosed();
testHalfOpenFailureReTripsToOpen();
testRegistry();
console.log('test_circuit_breaker.js passed cleanly.');
