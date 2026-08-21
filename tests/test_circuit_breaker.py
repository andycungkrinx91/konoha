#!/usr/bin/env python3
"""
tests/test_circuit_breaker.py — Unit tests for Konoha Circuit Breaker.
"""

import sys
import os
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from circuit_breaker import CircuitBreaker, CircuitState, CircuitBreakerRegistry


class TestCircuitBreaker(unittest.TestCase):
    def test_initial_state_closed(self):
        cb = CircuitBreaker("test-service", failure_threshold=3, recovery_timeout_sec=1.0)
        self.assertEqual(cb.state, CircuitState.CLOSED)
        self.assertTrue(cb.allow_request())

    def test_trip_to_open_on_threshold(self):
        cb = CircuitBreaker("test-service", failure_threshold=3, recovery_timeout_sec=0.5)
        
        # 1st failure
        cb.record_failure()
        self.assertEqual(cb.state, CircuitState.CLOSED)
        self.assertTrue(cb.allow_request())

        # 2nd failure
        cb.record_failure()
        self.assertEqual(cb.state, CircuitState.CLOSED)
        self.assertTrue(cb.allow_request())

        # 3rd failure -> Trips to OPEN
        cb.record_failure()
        self.assertEqual(cb.state, CircuitState.OPEN)
        self.assertFalse(cb.allow_request())

    def test_recovery_to_half_open_and_closed(self):
        cb = CircuitBreaker("test-service", failure_threshold=2, recovery_timeout_sec=0.2)
        
        cb.record_failure()
        cb.record_failure()
        self.assertEqual(cb.state, CircuitState.OPEN)
        self.assertFalse(cb.allow_request())

        # Wait for recovery cooldown
        time.sleep(0.25)

        # allow_request() should transition OPEN -> HALF_OPEN
        self.assertTrue(cb.allow_request())
        self.assertEqual(cb.state, CircuitState.HALF_OPEN)

        # Successful probe resets to CLOSED
        cb.record_success()
        self.assertEqual(cb.state, CircuitState.CLOSED)
        self.assertEqual(cb.failure_count, 0)
        self.assertTrue(cb.allow_request())

    def test_half_open_failure_re_trips_to_open(self):
        cb = CircuitBreaker("test-service", failure_threshold=2, recovery_timeout_sec=0.1)
        
        cb.record_failure()
        cb.record_failure()
        self.assertEqual(cb.state, CircuitState.OPEN)

        time.sleep(0.15)
        self.assertTrue(cb.allow_request())
        self.assertEqual(cb.state, CircuitState.HALF_OPEN)

        # Failed probe should re-trip immediately to OPEN
        cb.record_failure()
        self.assertEqual(cb.state, CircuitState.OPEN)
        self.assertFalse(cb.allow_request())

    def test_registry(self):
        registry = CircuitBreakerRegistry()
        cb1 = registry.get_or_create("host1.example.com", failure_threshold=3)
        cb2 = registry.get_or_create("host1.example.com", failure_threshold=3)
        self.assertIs(cb1, cb2)

        cb3 = registry.get_or_create("host2.example.com")
        self.assertIsNot(cb1, cb3)

        statuses = registry.get_all_statuses()
        self.assertIn("host1.example.com", statuses)
        self.assertIn("host2.example.com", statuses)


if __name__ == "__main__":
    unittest.main()
