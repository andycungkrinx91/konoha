/**
 * Test Tunnel Hostname Requirement and Validation
 * Verifies that tunnel start requires a valid DNS hostname,
 * normalizes schemes/ports, rejects invalid hostnames (wildcards, IPs, spaces),
 * and integrates with Host header validation (accepted only while active, legacy no-domain accepts loopback only).
 */

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "konoha_test_tun_host_"));
const testDbPath = path.join(sandboxDir, "test.db");

process.env.KONOHA_DB_PATH = testDbPath;
const db = require("../src/db");
const conn = db.getConnection(testDbPath);
db.setupSchema(conn);
conn.close();

const webServer = require("../src/web_server");
const tunnelConfig = require("../src/tunnel/config");
const tunnelManager = require("../src/tunnel/manager");

function makeRequest(port, options = {}) {
  return new Promise((resolve, reject) => {
    const payload = options.body !== undefined ? (typeof options.body === "string" ? options.body : JSON.stringify(options.body)) : null;
    const reqOptions = {
      hostname: "127.0.0.1",
      port: port,
      path: options.path || "/api/v1/health",
      method: options.method || "GET",
      headers: {
        ...(options.headers || {}),
        ...(payload !== null ? { "Content-Length": Buffer.byteLength(payload) } : {})
      }
    };
    const req = http.request(reqOptions, (res) => {
      let data = "";
      res.on("data", chunk => { data += chunk; });
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(data); } catch (_) {}
        resolve({ statusCode: res.statusCode, headers: res.headers, body: data, json });
      });
    });
    req.on("error", reject);
    if (payload !== null) {
      req.write(payload);
    }
    req.end();
  });
}

test("Tunnel Hostname Requirement and Validation", async (t) => {
  const testPort = 14210;
  const serverInstance = await webServer.startWebServer({ port: testPort, host: "127.0.0.1" });
  const port = testPort;
  const token = serverInstance.token;

  t.after(async () => {
    tunnelManager.stopTunnel();
    if (serverInstance && serverInstance.instance) {
      await serverInstance.instance.stop();
    }
    try { fs.rmSync(sandboxDir, { recursive: true, force: true }); } catch (_) {}
  });

  await t.test("Empty hostname refuses tunnel start via manager and API", async () => {
    // 1. Manager startTunnel
    await assert.rejects(
      async () => {
        await tunnelManager.startTunnel({ custom_domain: "" });
      },
      /hostname is required/i
    );

    // 2. API POST /api/v1/tunnel/start
    const res = await makeRequest(port, {
      method: "POST",
      path: "/api/v1/tunnel/start",
      headers: {
        host: "127.0.0.1:" + port,
        "content-type": "application/json",
        "x-konoha-web-token": token
      },
      body: { domain: "" }
    });
    assert.strictEqual(res.statusCode, 400);
    assert.match(res.body, /hostname is required/i);
  });

  await t.test("Invalid hostnames (wildcard, IP literals, spaces) are rejected", async () => {
    const invalidCases = [
      { input: "*.example.com", expected: /wildcard/i },
      { input: "https://*.example.com", expected: /wildcard/i },
      { input: "192.168.1.1", expected: /IP literal/i },
      { input: "127.0.0.1", expected: /IP literal/i },
      { input: "::1", expected: /IP literal/i },
      { input: "[::1]", expected: /IP literal/i },
      { input: "remote domain.com", expected: /space/i },
      { input: "invalid_label", expected: /valid DNS/i }
    ];

    for (const { input, expected } of invalidCases) {
      assert.throws(
        () => {
          tunnelManager.normalizeAndValidateTunnelHostname(input);
        },
        expected,
        `Should reject invalid hostname: ${input}`
      );
    }
  });

  await t.test("Valid hostname is normalized and stored", () => {
    const normalized = tunnelManager.normalizeAndValidateTunnelHostname("HTTPS://Remote.YourDomain.COM:8443/path?query=1");
    assert.strictEqual(normalized, "remote.yourdomain.com");
  });

  await t.test("Active tunnel with stored hostname accepts Host; inactive rejects", async () => {
    // 1. Active with valid custom_domain
    tunnelConfig.saveTunnelConfig({
      custom_domain: "remote.yourdomain.com",
      active_pid: process.pid,
      mode: "named"
    });

    const resActive = await makeRequest(port, {
      path: "/api/v1/health",
      headers: { host: "remote.yourdomain.com" }
    });
    assert.strictEqual(resActive.statusCode, 200, "Active tunnel hostname must be accepted");

    // 2. Attacker host still rejected with 403
    const resAttacker = await makeRequest(port, {
      path: "/api/v1/health",
      headers: { host: "attacker.example" }
    });
    assert.strictEqual(resAttacker.statusCode, 403, "Attacker host must be rejected with 403");

    // 3. Active tunnel with empty hostname (legacy config) accepts loopback only
    tunnelConfig.saveTunnelConfig({
      custom_domain: "",
      public_url: "https://legacy-tunnel.trycloudflare.com",
      active_pid: process.pid
    });

    const resLegacy = await makeRequest(port, {
      path: "/api/v1/health",
      headers: { host: "legacy-tunnel.trycloudflare.com" }
    });
    assert.strictEqual(resLegacy.statusCode, 403, "Legacy tunnel without stored hostname must reject non-loopback Host");

    // Loopback remains accepted
    const resLoopback = await makeRequest(port, {
      path: "/api/v1/health",
      headers: { host: "127.0.0.1:" + port }
    });
    assert.strictEqual(resLoopback.statusCode, 200);

    // 4. Inactive tunnel rejects hostname
    tunnelConfig.saveTunnelConfig({
      custom_domain: "remote.yourdomain.com",
      active_pid: 0
    });

    const resInactive = await makeRequest(port, {
      path: "/api/v1/health",
      headers: { host: "remote.yourdomain.com" }
    });
    assert.strictEqual(resInactive.statusCode, 403, "Inactive tunnel must reject hostname with 403");
  });
});
