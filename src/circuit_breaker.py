#!/usr/bin/env python3
"""
src/circuit_breaker.py — Thread-safe Circuit Breaker for Konoha MCP services.
Guards external requests (SearXNG instances, API calls, subagent tasks) with
fast-failing state transitions (CLOSED -> OPEN -> HALF_OPEN).
"""

import time
import threading
from typing import Dict, Any, Optional


class CircuitState:
    CLOSED = "CLOSED"
    OPEN = "OPEN"
    HALF_OPEN = "HALF_OPEN"


class CircuitBreaker:
    """
    Stateful circuit breaker pattern implementation.

    - CLOSED: Normal operation. All requests allowed. Failures increase failure count.
      Trips to OPEN when failure_count >= failure_threshold.
    - OPEN: Service is degraded/failing. Requests are rejected immediately (<1ms)
      without making network I/O calls. Transitions to HALF_OPEN after recovery_timeout_sec.
    - HALF_OPEN: Probe state. Allows a limited number of trial requests. If successful,
      resets to CLOSED; if failed, immediately re-trips to OPEN.
    """

    def __init__(
        self,
        name: str,
        failure_threshold: int = 3,
        recovery_timeout_sec: float = 60.0,
        half_open_max_probes: int = 1,
    ):
        self.name = name
        self.failure_threshold = failure_threshold
        self.recovery_timeout_sec = recovery_timeout_sec
        self.half_open_max_probes = half_open_max_probes

        self.state = CircuitState.CLOSED
        self.failure_count = 0
        self.success_count = 0
        self.last_state_change = time.time()
        self.last_failure_time = 0.0
        self._lock = threading.Lock()

    def allow_request(self) -> bool:
        """Check if a request is permitted under the current circuit state."""
        with self._lock:
            now = time.time()
            if self.state == CircuitState.CLOSED:
                return True

            if self.state == CircuitState.OPEN:
                if now - self.last_state_change >= self.recovery_timeout_sec:
                    self.state = CircuitState.HALF_OPEN
                    self.last_state_change = now
                    self.success_count = 0
                    return True
                return False

            if self.state == CircuitState.HALF_OPEN:
                return True

            return False

    def record_success(self):
        """Record a successful request execution."""
        with self._lock:
            if self.state == CircuitState.HALF_OPEN:
                self.success_count += 1
                if self.success_count >= self.half_open_max_probes:
                    self.state = CircuitState.CLOSED
                    self.failure_count = 0
                    self.last_state_change = time.time()
            elif self.state == CircuitState.CLOSED:
                self.failure_count = 0

    def record_failure(self):
        """Record a failed request execution."""
        with self._lock:
            now = time.time()
            self.failure_count += 1
            self.last_failure_time = now

            if self.state == CircuitState.CLOSED:
                if self.failure_count >= self.failure_threshold:
                    self.state = CircuitState.OPEN
                    self.last_state_change = now
            elif self.state == CircuitState.HALF_OPEN:
                self.state = CircuitState.OPEN
                self.last_state_change = now

    def reset(self):
        """Explicitly reset the circuit breaker back to CLOSED state."""
        with self._lock:
            self.state = CircuitState.CLOSED
            self.failure_count = 0
            self.success_count = 0
            self.last_state_change = time.time()

    def get_status(self) -> Dict[str, Any]:
        """Return a snapshot dictionary of the current circuit breaker status."""
        with self._lock:
            return {
                "name": self.name,
                "state": self.state,
                "failure_count": self.failure_count,
                "success_count": self.success_count,
                "last_failure_time": self.last_failure_time,
                "last_state_change": self.last_state_change,
                "recovery_timeout_sec": self.recovery_timeout_sec,
                "failure_threshold": self.failure_threshold,
            }


class CircuitBreakerRegistry:
    """Thread-safe registry for managing multiple named circuit breakers."""

    def __init__(self):
        self._breakers: Dict[str, CircuitBreaker] = {}
        self._lock = threading.Lock()

    def get_or_create(
        self,
        name: str,
        failure_threshold: int = 3,
        recovery_timeout_sec: float = 60.0,
    ) -> CircuitBreaker:
        with self._lock:
            if name not in self._breakers:
                self._breakers[name] = CircuitBreaker(
                    name=name,
                    failure_threshold=failure_threshold,
                    recovery_timeout_sec=recovery_timeout_sec,
                )
            return self._breakers[name]

    def get_all_statuses(self) -> Dict[str, Dict[str, Any]]:
        with self._lock:
            return {name: cb.get_status() for name, cb in self._breakers.items()}

    def reset_all(self):
        with self._lock:
            for cb in self._breakers.values():
                cb.reset()


# Global default registry singleton
global_circuit_registry = CircuitBreakerRegistry()
