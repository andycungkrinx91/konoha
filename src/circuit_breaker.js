/**
 * src/circuit_breaker.js — Thread-safe Circuit Breaker for Konoha MCP services.
 * Guards external requests (SearXNG instances, API calls, subagent tasks) with
 * fast-failing state transitions (CLOSED -> OPEN -> HALF_OPEN).
 * Pure Node.js replacement for src/circuit_breaker.py.
 */

const CircuitState = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN'
};

class CircuitBreaker {
  constructor(name, failureThreshold = 3, recoveryTimeoutSec = 60.0, halfOpenMaxProbes = 1) {
    this.name = name;
    this.failureThreshold = failureThreshold;
    this.recoveryTimeoutSec = recoveryTimeoutSec;
    this.halfOpenMaxProbes = halfOpenMaxProbes;

    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastStateChange = Date.now() / 1000;
    this.lastFailureTime = 0.0;
  }

  get failure_count() {
    return this.failureCount;
  }

  allowRequest() {
    const now = Date.now() / 1000;
    if (this.state === CircuitState.CLOSED) {
      return true;
    }

    if (this.state === CircuitState.OPEN) {
      if (now - this.lastStateChange >= this.recoveryTimeoutSec) {
        this.state = CircuitState.HALF_OPEN;
        this.lastStateChange = now;
        this.successCount = 0;
        return true;
      }
      return false;
    }

    if (this.state === CircuitState.HALF_OPEN) {
      return true;
    }

    return false;
  }

  allow_request() {
    return this.allowRequest();
  }

  recordSuccess() {
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount += 1;
      if (this.successCount >= this.halfOpenMaxProbes) {
        this.state = CircuitState.CLOSED;
        this.failureCount = 0;
        this.lastStateChange = Date.now() / 1000;
      }
    } else if (this.state === CircuitState.CLOSED) {
      this.failureCount = 0;
    }
  }

  record_success() {
    this.recordSuccess();
  }

  recordFailure() {
    const now = Date.now() / 1000;
    this.failureCount += 1;
    this.lastFailureTime = now;

    if (this.state === CircuitState.CLOSED) {
      if (this.failureCount >= this.failureThreshold) {
        this.state = CircuitState.OPEN;
        this.lastStateChange = now;
      }
    } else if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.OPEN;
      this.lastStateChange = now;
    }
  }

  record_failure() {
    this.recordFailure();
  }

  reset() {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastStateChange = Date.now() / 1000;
  }

  getStatus() {
    return {
      name: this.name,
      state: this.state,
      failure_count: this.failureCount,
      success_count: this.successCount,
      last_failure_time: this.lastFailureTime,
      last_state_change: this.lastStateChange,
      recovery_timeout_sec: this.recoveryTimeoutSec,
      failure_threshold: this.failureThreshold
    };
  }

  get_status() {
    return this.getStatus();
  }
}

class CircuitBreakerRegistry {
  constructor() {
    this.breakers = new Map();
  }

  getOrCreate(name, failureThreshold = 3, recoveryTimeoutSec = 60.0) {
    if (!this.breakers.has(name)) {
      this.breakers.set(
        name,
        new CircuitBreaker(name, failureThreshold, recoveryTimeoutSec)
      );
    }
    return this.breakers.get(name);
  }

  get_or_create(name, failureThreshold = 3, recoveryTimeoutSec = 60.0) {
    return this.getOrCreate(name, failureThreshold, recoveryTimeoutSec);
  }

  getAllStatuses() {
    const result = {};
    for (const [name, cb] of this.breakers.entries()) {
      result[name] = cb.getStatus();
    }
    return result;
  }

  get_all_statuses() {
    return this.getAllStatuses();
  }

  resetAll() {
    for (const cb of this.breakers.values()) {
      cb.reset();
    }
  }

  reset_all() {
    this.resetAll();
  }
}

const globalCircuitRegistry = new CircuitBreakerRegistry();

module.exports = {
  CircuitState,
  CircuitBreaker,
  CircuitBreakerRegistry,
  globalCircuitRegistry,
  global_circuit_registry: globalCircuitRegistry
};
