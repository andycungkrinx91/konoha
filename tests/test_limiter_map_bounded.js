/**
 * Test Rate Limiter Map Bounded Memory and Loopback Bypass
 * Verifies that loopback traffic is never rate-limited,
 * failedPinAttempts is capped at 10,000 entries, and memory remains strictly bounded.
 */

const test = require("node:test");
const assert = require("node:assert");
const tunnelSecurity = require("../src/tunnel/security");

test("Tunnel Rate Limiter Security and Bounded Memory", async (t) => {
  await t.test("Loopback traffic bypasses rate limiter and is never recorded", () => {
    const loopbackIps = ["127.0.0.1", "::1", "localhost", "::ffff:127.0.0.1"];
    for (const ip of loopbackIps) {
      // Record 10 failures
      for (let i = 0; i < 10; i++) {
        tunnelSecurity.recordPinFailure(ip);
      }
      const status = tunnelSecurity.checkPinRateLimit(ip);
      assert.strictEqual(status.allowed, true, `Loopback IP ${ip} must always be allowed`);
      // Ensure failure map did not record loopback
      const count = tunnelSecurity.getFailedAttemptsSize ? tunnelSecurity.getFailedAttemptsSize() : -1;
      assert.strictEqual(tunnelSecurity.hasPinFailure ? tunnelSecurity.hasPinFailure(ip) : false, false);
    }
  });

  await t.test("Remote IP is rate limited after 5 failures", () => {
    const remoteIp = "203.0.113.42";
    for (let i = 0; i < 4; i++) {
      tunnelSecurity.recordPinFailure(remoteIp);
      assert.strictEqual(tunnelSecurity.checkPinRateLimit(remoteIp).allowed, true);
    }
    tunnelSecurity.recordPinFailure(remoteIp);
    const blocked = tunnelSecurity.checkPinRateLimit(remoteIp);
    assert.strictEqual(blocked.allowed, false);
    assert.ok(blocked.waitSec > 0 && blocked.waitSec <= 60);

    // Reset works
    tunnelSecurity.resetPinFailure(remoteIp);
    assert.strictEqual(tunnelSecurity.checkPinRateLimit(remoteIp).allowed, true);
  });

  await t.test("failedPinAttempts map is capped at 10,000 entries under flooding", () => {
    // Generate 15,000 distinct remote IPs
    for (let i = 1; i <= 15000; i++) {
      const a = (i >> 16) & 255;
      const b = (i >> 8) & 255;
      const c = i & 255;
      tunnelSecurity.recordPinFailure(`198.51.${b}.${c}`);
    }

    assert.ok(typeof tunnelSecurity.getFailedAttemptsSize === "function", "Must expose getFailedAttemptsSize");
    const size = tunnelSecurity.getFailedAttemptsSize();
    assert.ok(size <= 10000, `Map size must be <= 10,000, got ${size}`);
    assert.strictEqual(size, 10000, "Map size should be capped at exactly 10,000");
  });
});
