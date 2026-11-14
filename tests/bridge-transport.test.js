"use strict";
// Protocol 2 transport of the real background.js against a mock host written
// with node:crypto (independent of bridge-auth.js). The extension must only
// execute commands from a host that proved the pairing secret, and every
// command must carry a fresh signature bound to the poll that fetched it.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const auth = fs.readFileSync(path.join(__dirname, "../extension/bridge-auth.js"), "utf8");
const background = fs.readFileSync(path.join(__dirname, "../extension/background.js"), "utf8");

const hmac = (key, fields) => crypto.createHmac("sha256", key).update(fields.join("\n")).digest("base64url");
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("base64url");

function normalize(code) {
  return code.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
}

class MockHost {
  constructor({ hostId = "host-A", app = "SuperCli", knowsKeyOf = null } = {}) {
    this.hostId = hostId;
    this.app = app;
    this.window = null;
    this.pairing = knowsKeyOf ? knowsKeyOf.pairing : null;
    this.sessions = new Map();
    this.challenges = new Set();
    this.queue = [];
    this.results = [];
    this.seen = [];
    this.lastPollResponse = null;
    this.mode = "honest"; // honest | forge-auth | tamper-poll | replay-poll | old
  }
  startPairing(code) {
    this.window = { codeKey: crypto.createHash("sha256").update(`tb-bridge/2 pairing code\n${normalize(code)}`).digest() };
  }
  respond(status, body, headers = {}) {
    const bytes = body === null ? null : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
    return new Response(status === 204 ? null : bytes, { status, headers });
  }
  signed(session, nonce, status, body) {
    const bytes = body === null ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body));
    const ts = String(Date.now());
    const mac = hmac(session.key, ["res", String(status), nonce, ts, sha(bytes)]);
    return new Response(status === 204 ? null : bytes, { status, headers: { "X-TB-Ts": ts, "X-TB-Mac": mac, "Content-Type": "application/json" } });
  }
  async handle(url, options = {}) {
    const parsed = new URL(url);
    const route = parsed.pathname;
    const method = options.method || "GET";
    const body = options.body ? Buffer.from(options.body) : Buffer.alloc(0);
    this.seen.push(route);
    if (this.mode === "old") return this.respond(404, "not found");
    if (route === "/v2/hello") {
      const challenge = crypto.randomBytes(32).toString("base64url");
      if (this.pairing) this.challenges.add(challenge);
      return this.respond(200, { proto: 2, hostId: this.hostId, app: this.app, appVersion: "test", pid: 4242, paired: Boolean(this.pairing), challenge: this.pairing ? challenge : undefined });
    }
    if (route === "/v2/pair/start") {
      const req = JSON.parse(body);
      if (!this.window) return this.respond(403, { error: "pairing_not_active", message: "No pairing code is active." });
      if (hmac(this.window.codeKey, ["pair-start", req.extPub, req.extNonce]) !== req.mac) return this.respond(403, { error: "pairing_code_invalid", message: "Wrong pairing code." });
      const ecdh = crypto.createECDH("prime256v1");
      ecdh.generateKeys();
      const hostPub = ecdh.getPublicKey().toString("base64url");
      const hostNonce = crypto.randomBytes(32).toString("base64url");
      const transcript = sha([`tb-bridge/2 pair`, this.hostId, req.extPub, hostPub, req.extNonce, hostNonce].join("\n"));
      const shared = ecdh.computeSecret(Buffer.from(req.extPub, "base64url"));
      const key = Buffer.from(crypto.hkdfSync("sha256", shared, this.window.codeKey, `tb-bridge/2 pairing key\n${transcript}`, 32));
      this.window.pending = { key, transcript };
      return this.respond(200, { proto: 2, hostId: this.hostId, hostPub, hostNonce, app: this.app, appVersion: "test", mac: hmac(key, ["pair-host", transcript]) });
    }
    if (route === "/v2/pair/finish") {
      const req = JSON.parse(body);
      const pending = this.window?.pending;
      if (!pending || hmac(pending.key, ["pair-ext", pending.transcript]) !== req.mac) return this.respond(403, { error: "pairing_failed" });
      this.pairing = { id: crypto.randomBytes(9).toString("base64url"), key: pending.key };
      this.window = null;
      return this.respond(200, { ok: true, pairingId: this.pairing.id, mac: hmac(pending.key, ["pair-done", pending.transcript, this.pairing.id]) });
    }
    if (route === "/v2/auth") {
      const req = JSON.parse(body);
      const sessionId = crypto.randomBytes(18).toString("base64url");
      if (this.mode === "forge-auth") {
        // An impostor that copied the host id but not the secret.
        return this.respond(200, { ok: true, sessionId, mac: crypto.randomBytes(32).toString("base64url") });
      }
      if (!this.pairing || !this.challenges.delete(req.hostNonce) || req.pairingId !== this.pairing.id ||
          hmac(this.pairing.key, ["auth-ext", this.hostId, this.pairing.id, req.hostNonce, req.extNonce]) !== req.mac) {
        return this.respond(401, { error: "bad_proof" });
      }
      const key = crypto.createHmac("sha256", this.pairing.key).update(["session", req.hostNonce, req.extNonce, sessionId].join("\n")).digest();
      this.sessions.set(sessionId, { key, nonces: new Set() });
      return this.respond(200, { ok: true, sessionId, mac: hmac(this.pairing.key, ["auth-host", this.hostId, this.pairing.id, req.hostNonce, req.extNonce, sessionId]) });
    }
    // Signed endpoints.
    const h = options.headers || {};
    const session = this.sessions.get(h["X-TB-Session"]);
    if (!session) return this.respond(401, { error: "session_invalid" });
    const signedPath = parsed.pathname + parsed.search;
    const want = hmac(session.key, ["req", method, signedPath, h["X-TB-Ts"], h["X-TB-Nonce"], sha(body)]);
    if (want !== h["X-TB-Mac"] || session.nonces.has(h["X-TB-Nonce"])) return this.respond(401, { error: "bad_signature" });
    session.nonces.add(h["X-TB-Nonce"]);
    if (route === "/v2/poll") {
      if (this.mode === "replay-poll" && this.lastPollResponse) {
        const old = this.lastPollResponse;
        return new Response(old.bytes, { status: 200, headers: old.headers });
      }
      const next = this.queue.shift();
      if (!next) return this.signed(session, h["X-TB-Nonce"], 204, null);
      const response = this.signed(session, h["X-TB-Nonce"], 200, next);
      if (this.mode === "tamper-poll") {
        const forged = Buffer.from(JSON.stringify({ ...next, op: "create_folder", args: { confirm: true, name: "Injected" } }));
        return new Response(forged, { status: 200, headers: response.headers });
      }
      const bytes = Buffer.from(await response.clone().arrayBuffer());
      this.lastPollResponse = { bytes, headers: Object.fromEntries(response.headers) };
      return response;
    }
    if (route === "/v2/result") {
      this.results.push(JSON.parse(body));
      return this.signed(session, h["X-TB-Nonce"], 204, null);
    }
    return this.respond(404, "unknown");
  }
}

function extension(target) {
  const store = {};
  const mutations = [];
  const delays = [];
  const network = { target };
  const messenger = {
    accounts: { list: async () => [{ id: "acc1", name: "Fixture", type: "none" }] },
    folders: {
      query: async () => [],
      create: async (_parent, name) => { mutations.push(name); return { id: `f-${name}`, accountId: "acc1", name, path: `/${name}` }; },
    },
    storage: {
      local: {
        get: async (key) => ({ [key]: store[key] === undefined ? undefined : JSON.parse(JSON.stringify(store[key])) }),
        set: async (values) => { Object.assign(store, JSON.parse(JSON.stringify(values))); },
      },
    },
    runtime: { id: "supercli-bridge@local", getManifest: () => ({ version: "0.10.0" }) },
  };
  const context = vm.createContext({
    messenger, console: { warn() {}, log() {} },
    AbortController, TextEncoder, TextDecoder, URL, Blob, File, Response, Date, Math,
    atob, btoa, crypto: globalThis.crypto,
    // Background loops never end; unref'd timers let the test process exit.
    setTimeout: (fn, ms) => {
      delays.push(ms);
      const timer = setTimeout(fn, ms >= 60000 ? ms : Math.min(ms || 0, 3));
      timer.unref();
      return timer;
    },
    clearTimeout,
    fetch: async (url, options) => {
      if (!network.target) throw new TypeError("connection refused");
      return network.target.handle(url, options);
    },
  });
  vm.runInContext(`${auth}\n${background}`, context);
  return {
    context, store, mutations, delays, network,
    status: () => vm.runInContext("bridgeStatus.phase", context),
    pair: (code) => context.pairWithCode(code),
  };
}

async function until(predicate, label, ms = 3000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}

test("an unpaired extension never contacts anything", async () => {
  const host = new MockHost();
  const ext = extension(host);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.deepEqual(host.seen, []);
  assert.equal(ext.status(), "unpaired");
  ext.network.target = null;
});

test("happy path: pair with the code, authenticate both ways, run a signed command", async () => {
  const host = new MockHost();
  const ext = extension(host);
  host.startPairing("ABCD-EFGH-JKMN-PQRS");
  const paired = await ext.pair("abcd efgh jkmn pqrs");
  assert.equal(paired.hostId, "host-A");
  assert.ok(ext.store.bridgePairings["host-A"].key, "secret stored in extension storage");
  host.queue.push({ id: "r1", op: "create_folder", args: { confirm: true, name: "Bridge test", account: "acc1" } });
  await until(() => host.results.length === 1, "result");
  assert.equal(host.results[0].id, "r1");
  assert.equal(host.results[0].ok, true, host.results[0].error);
  assert.deepEqual(ext.mutations, ["Bridge test"]);
  assert.equal(ext.status(), "connected");
  ext.network.target = null;
});

test("a wrong pairing code is refused and nothing is stored", async () => {
  const host = new MockHost();
  const ext = extension(host);
  host.startPairing("ABCD-EFGH-JKMN-PQRS");
  await assert.rejects(ext.pair("0000-0000-0000-0000"), /Wrong pairing code/);
  assert.equal(ext.store.bridgePairings, undefined);
  await assert.rejects(ext.pair("too-short"), /16 characters/);
  ext.network.target = null;
});

test("an impostor on the port that copied the host id gets no commands and no results", async () => {
  const real = new MockHost();
  const ext = extension(real);
  real.startPairing("ABCD-EFGH-JKMN-PQRS");
  await ext.pair("ABCD-EFGH-JKMN-PQRS");
  await until(() => ext.status() === "connected", "connected to the real host");
  // The real host goes away; an impostor with the same host id takes the port.
  const impostor = new MockHost({ hostId: "host-A", app: "SuperCli" });
  impostor.pairing = { id: "fake", key: crypto.randomBytes(32) };
  impostor.mode = "forge-auth";
  impostor.queue.push({ id: "evil", op: "create_folder", args: { confirm: true, name: "Evil", account: "acc1" } });
  ext.network.target = impostor;
  ext.context.dropBridgeSession();
  await until(() => ext.status() === "host_impostor", "impostor detected");
  await new Promise((resolve) => setTimeout(resolve, 50));
  // A poll already signed for the old session may reach the new process; it
  // carries no secret and the impostor cannot answer it with a valid signature.
  assert.ok(impostor.seen.filter((route) => route === "/v2/poll").length <= 1, "kept polling the impostor");
  assert.ok(!impostor.seen.includes("/v2/result"), "never sent a result to the impostor");
  assert.equal(impostor.queue.length, 1, "the impostor's command was never delivered");
  assert.deepEqual(ext.mutations, []);
  ext.network.target = null;
});

test("a different, unpaired host on the port is ignored", async () => {
  const real = new MockHost();
  const ext = extension(real);
  real.startPairing("ABCD-EFGH-JKMN-PQRS");
  await ext.pair("ABCD-EFGH-JKMN-PQRS");
  const other = new MockHost({ hostId: "host-B", app: "NestCafe" });
  other.queue.push({ id: "x", op: "create_folder", args: { confirm: true, name: "X", account: "acc1" } });
  ext.network.target = other;
  ext.context.dropBridgeSession();
  await until(() => ext.status() === "host_not_paired", "unpaired host reported");
  assert.deepEqual([...new Set(other.seen)], ["/v2/hello"]);
  assert.deepEqual(ext.mutations, []);
  ext.network.target = null;
});

test("an old host without protocol 2 is reported and gets nothing", async () => {
  const real = new MockHost();
  const ext = extension(real);
  real.startPairing("ABCD-EFGH-JKMN-PQRS");
  await ext.pair("ABCD-EFGH-JKMN-PQRS");
  const old = new MockHost();
  old.mode = "old";
  ext.network.target = old;
  ext.context.dropBridgeSession();
  await until(() => ext.status() === "host_outdated", "old host reported");
  assert.deepEqual([...new Set(old.seen)], ["/v2/hello"]);
  ext.network.target = null;
});

test("a poll response modified in transit is discarded", async () => {
  const host = new MockHost();
  const ext = extension(host);
  host.startPairing("ABCD-EFGH-JKMN-PQRS");
  await ext.pair("ABCD-EFGH-JKMN-PQRS");
  await until(() => ext.status() === "connected", "connected");
  host.mode = "tamper-poll";
  host.queue.push({ id: "t1", op: "accounts", args: {} });
  await until(() => host.queue.length === 0, "tampered poll served");
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(ext.mutations, [], "forged command was not executed");
  assert.equal(host.results.length, 0);
  ext.network.target = null;
});

test("a replayed poll response is discarded", async () => {
  const host = new MockHost();
  const ext = extension(host);
  host.startPairing("ABCD-EFGH-JKMN-PQRS");
  await ext.pair("ABCD-EFGH-JKMN-PQRS");
  host.queue.push({ id: "once", op: "create_folder", args: { confirm: true, name: "Once", account: "acc1" } });
  await until(() => host.results.length === 1, "first result");
  host.mode = "replay-poll";
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.deepEqual(ext.mutations, ["Once"], "the old signed command ran exactly once");
  ext.network.target = null;
});

test("the poll loop pauses after a signed 204 instead of busy-waiting", async () => {
  const host = new MockHost();
  const ext = extension(host);
  host.startPairing("ABCD-EFGH-JKMN-PQRS");
  await ext.pair("ABCD-EFGH-JKMN-PQRS");
  await until(() => host.seen.filter((route) => route === "/v2/poll").length >= 3, "polls");
  assert.ok(ext.delays.filter((ms) => ms === 250).length >= 2, `delays: ${ext.delays.slice(0, 20)}`);
  ext.network.target = null;
});
