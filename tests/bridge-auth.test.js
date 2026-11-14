"use strict";
// Unit tests for extension/bridge-auth.js: code handling, HMAC, replay
// windows, and a known-answer vector shared with the SuperCli Go host
// (internal/tools/mail/thunderbird_bridge_auth_test.go asserts the same values).
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const BridgeAuth = require("../extension/bridge-auth.js");

test("pairing codes are normalized like the host does", () => {
  assert.equal(BridgeAuth.normalizeCode("abcd-efgh-jkmn-pqrs"), "ABCDEFGHJKMNPQRS");
  assert.equal(BridgeAuth.normalizeCode(" ABCD EFGH\tJKMN-PQRS "), "ABCDEFGHJKMNPQRS");
  assert.equal(BridgeAuth.normalizeCode("oil0-OIL0-0000-0000"), "0110011000000000");
  for (const bad of ["", "ABCD-EFGH-JKMN-PQR", "ABCD-EFGH-JKMN-PQRSX", "ABCD-EFGH-JKMN-PQRU", "ABCD-EFGH-JKMN-PQR!"]) {
    assert.equal(BridgeAuth.normalizeCode(bad), null, bad);
  }
});

test("known-answer vector matches the SuperCli host", async () => {
  const normalized = BridgeAuth.normalizeCode("abcd-efgh-jkmn-pqrs");
  const codeKey = await BridgeAuth.codeKey(normalized);
  assert.equal(BridgeAuth.b64u(codeKey), "PfYzD32joV33Fl8OIZEDLzM3EaZbOBfjYeT3Y2xyySs");
  const transcript = await BridgeAuth.pairTranscript("host-1", "extpub", "hostpub", "en", "hn");
  assert.equal(transcript, "5KdZu0H-a9ZU60vbBS8jclaCyoFvTfeiaGn3MmLFUBg");
  const shared = new Uint8Array(32).map((_, i) => i);
  const key = await BridgeAuth.pairingKey(shared, codeKey, transcript);
  assert.equal(BridgeAuth.b64u(key), "1dDkYKVuspynCvVtCaddDpACV7zehowBxemVJN4q6xI");
  const session = await BridgeAuth.sessionKey(key, "hn2", "en2", "sid");
  assert.equal(BridgeAuth.b64u(session), "7dUX8O2G2p3WjC3bMKCKFGyaZ8E4pzppVBCqd9JuOpE");
  const bodyHash = await BridgeAuth.sha256B64("{}");
  assert.equal(bodyHash, "RBNvo1WzZ4oRRq0W9-hknpT7T8If536DEMBg9hyq_4o");
  const mac = await BridgeAuth.mac64(session, BridgeAuth.requestFields("post", "/v2/result", "1700000000000", "nonce-0123456789abcdef", bodyHash));
  assert.equal(mac, "ZZmrabyx4O--5l2jfPDOf0Uzeu483y2ezIa-_f1QLtM");
});

test("WebCrypto results equal an independent node:crypto implementation", async () => {
  const ext = await BridgeAuth.generateEcdh();
  const host = crypto.createECDH("prime256v1");
  host.generateKeys();
  const hostPub = host.getPublicKey().toString("base64url");
  const sharedExt = await BridgeAuth.ecdhShared(ext.privateKey, hostPub);
  const sharedHost = host.computeSecret(Buffer.from(ext.publicB64, "base64url"));
  assert.deepEqual(Buffer.from(sharedExt), sharedHost);
  const codeKey = await BridgeAuth.codeKey("ABCDEFGHJKMNPQRS");
  const transcript = await BridgeAuth.pairTranscript("h", ext.publicB64, hostPub, "en", "hn");
  const key = await BridgeAuth.pairingKey(sharedExt, codeKey, transcript);
  const reference = Buffer.from(crypto.hkdfSync("sha256", sharedHost, Buffer.from(codeKey), `tb-bridge/2 pairing key\n${transcript}`, 32));
  assert.deepEqual(Buffer.from(key), reference);
  const fields = ["auth-ext", "h", "p", "n1", "n2"];
  assert.equal(await BridgeAuth.mac64(key, fields), crypto.createHmac("sha256", reference).update(fields.join("\n")).digest("base64url"));
});

test("MAC verification rejects tampering, wrong keys and malformed input", async () => {
  const key = new Uint8Array(32).fill(1);
  const fields = BridgeAuth.requestFields("GET", "/v2/poll", "1", "nonce", await BridgeAuth.sha256B64(""));
  const mac = await BridgeAuth.mac64(key, fields);
  assert.equal(await BridgeAuth.verifyMac(key, mac, fields), true);
  for (let i = 0; i < fields.length; i++) {
    const changed = fields.slice();
    changed[i] += "x";
    assert.equal(await BridgeAuth.verifyMac(key, mac, changed), false, `field ${i}`);
  }
  assert.equal(await BridgeAuth.verifyMac(new Uint8Array(32).fill(2), mac, fields), false);
  for (const bad of ["", "!!!", mac.slice(0, 10), `${mac}AA`, null]) {
    assert.equal(await BridgeAuth.verifyMac(key, bad, fields), false, String(bad));
  }
});

test("response timestamps outside one minute are stale", () => {
  const now = 1_700_000_000_000;
  assert.equal(BridgeAuth.timestampFresh(String(now), now), true);
  assert.equal(BridgeAuth.timestampFresh(String(now - 59_000), now), true);
  assert.equal(BridgeAuth.timestampFresh(String(now - 61_000), now), false);
  assert.equal(BridgeAuth.timestampFresh(String(now + 61_000), now), false);
  assert.equal(BridgeAuth.timestampFresh("", now), false);
  assert.equal(BridgeAuth.timestampFresh("abc", now), false);
});

test("random nonces are unique base64url", () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const nonce = BridgeAuth.randomB64(16);
    assert.match(nonce, /^[A-Za-z0-9_-]{22}$/);
    assert.equal(seen.has(nonce), false);
    seen.add(nonce);
  }
});
