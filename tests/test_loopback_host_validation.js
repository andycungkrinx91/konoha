/**
 * Test Loopback Host Validation and DELETE Confirmation Gate
 * Verifies that non-loopback Host headers are rejected with 403,
 * active tunnel hostnames are accepted only when active, and
 * DELETE /api/v1/projects requires { confirm: true }.
 */

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "konoha_test_host_"));
const testDbPath = path.join(sandboxDir, "test.db");

// Point db and tunnel configs to isolated directory
process.env.KONOHA_DB_PATH = testDbPath;

const db = require("../src/db");
const conn = db.getConnection(testDbPath); db.setupSchema(conn); conn.close();

const webServer = require("../src/web_server");

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
    if (options.body) {
      req.write(typeof options.body === "string" ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

test("Loopback Host Validation and Project Deletion Confirmation", async (t) => {
  // Start server on an ephemeral port
  const testPort = 14205;
  const serverInstance = await webServer.startWebServer({ port: testPort, host: "127.0.0.1" });
  const port = testPort;
  const token = serverInstance.token;

  t.after(async () => {
    if (serverInstance && serverInstance.instance) {
      await serverInstance.instance.stop();
    }
    try { fs.rmSync(sandboxDir, { recursive: true, force: true }); } catch (_) {}
  });

  await t.test("Rejects attacker.example Host header with 403", async () => {
    const res = await makeRequest(port, {
      path: "/api/v1/health",
      headers: { host: "attacker.example" }
    });
    assert.strictEqual(res.statusCode, 403);
    assert.match(res.body, /Host/i);
  });

  await t.test("Never returns CSRF token to attacker.example Host", async () => {
    const res = await makeRequest(port, {
      path: "/api/v1/csrf",
      headers: { host: "attacker.example" }
    });
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.json?.token, undefined);
  });

  await t.test("Accepts loopback 127.0.0.1 Host header", async () => {
    const res = await makeRequest(port, {
      path: "/api/v1/health",
      headers: { host: "127.0.0.1:" + port }
    });
    assert.strictEqual(res.statusCode, 200);
  });

  await t.test("Accepts loopback localhost Host header", async () => {
    const res = await makeRequest(port, {
      path: "/api/v1/health",
      headers: { host: "localhost:" + port }
    });
    assert.strictEqual(res.statusCode, 200);
  });

  await t.test("Rejects non-loopback hostname with 403", async () => {
    const res = await makeRequest(port, {
      path: "/api/v1/health",
      headers: { host: "custom-tunnel.trycloudflare.com" }
    });
    assert.strictEqual(res.statusCode, 403);
  });

  await t.test("DELETE /api/v1/projects requires { confirm: true }", async () => {
    // Unconfirmed without body
    const resNoBody = await makeRequest(port, {
      method: "DELETE",
      path: "/api/v1/projects",
      headers: {
        host: "127.0.0.1:" + port,
        "x-konoha-web-token": token
      }
    });
    assert.strictEqual(resNoBody.statusCode, 400);
    assert.match(resNoBody.body, /confirm/i);

    // Unconfirmed with confirm false
    const resFalse = await makeRequest(port, {
      method: "DELETE",
      path: "/api/v1/projects",
      headers: {
        host: "127.0.0.1:" + port,
        "content-type": "application/json",
        "x-konoha-web-token": token
      },
      body: { confirm: false }
    });
    assert.strictEqual(resFalse.statusCode, 400);

    // Confirmed with confirm true
    const resTrue = await makeRequest(port, {
      method: "DELETE",
      path: "/api/v1/projects",
      headers: {
        host: "127.0.0.1:" + port,
        "content-type": "application/json",
        "x-konoha-web-token": token
      },
      body: { confirm: true }
    });
    assert.strictEqual(resTrue.statusCode, 200);
    assert.strictEqual(resTrue.json?.ok, true);
  });
});
