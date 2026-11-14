"use strict";

// Thunderbird AI Bridge protocol 2 ("tb-bridge/2") cryptography.
//
// Pairing agrees on a 256-bit secret through ECDH P-256 authenticated by a
// one-time 16-character code; every connection then runs a mutual HMAC-SHA256
// challenge-response, and every request and response carries an HMAC over
// method, path, timestamp, nonce and a SHA-256 of the body. docs/PROTOCOL.md is
// the normative description; the SuperCli host implements the same functions
// in internal/tools/mail/thunderbird_bridge_auth.go.
const BridgeAuth = (() => {
  const PROTOCOL = 2;
  const NAME = "tb-bridge/2";
  const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const CODE_LENGTH = 16;
  const MAX_SKEW_MS = 60 * 1000;
  const subtle = globalThis.crypto.subtle;
  const encoder = new TextEncoder();

  function toBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return encoder.encode(String(value ?? ""));
  }

  function b64u(bytes) {
    const view = toBytes(bytes);
    let binary = "";
    for (let i = 0; i < view.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, view.subarray(i, i + 0x8000));
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function fromB64u(text) {
    const value = String(text || "");
    if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new Error("invalid base64url");
    const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
    const binary = atob(padded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  function randomB64(size) {
    return b64u(globalThis.crypto.getRandomValues(new Uint8Array(size)));
  }

  // Accepts what a person types: lower case, spaces, dashes, O/I/L look-alikes.
  function normalizeCode(input) {
    let out = "";
    for (let ch of String(input || "").toUpperCase()) {
      if (ch === " " || ch === "-" || ch === "\t") continue;
      if (ch === "O") ch = "0";
      if (ch === "I" || ch === "L") ch = "1";
      if (!CODE_ALPHABET.includes(ch)) return null;
      out += ch;
    }
    return out.length === CODE_LENGTH ? out : null;
  }

  async function sha256(bytes) {
    return new Uint8Array(await subtle.digest("SHA-256", toBytes(bytes)));
  }

  async function sha256B64(bytes) {
    return b64u(await sha256(bytes));
  }

  async function codeKey(normalized) {
    return sha256(`${NAME} pairing code\n${normalized}`);
  }

  async function hmacKey(raw) {
    return subtle.importKey("raw", toBytes(raw), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  }

  async function mac(key, fields) {
    const cryptoKey = key instanceof Uint8Array ? await hmacKey(key) : key;
    return new Uint8Array(await subtle.sign("HMAC", cryptoKey, encoder.encode(fields.join("\n"))));
  }

  async function mac64(key, fields) {
    return b64u(await mac(key, fields));
  }

  // Constant-time comparison of the decoded MAC.
  async function verifyMac(key, given, fields) {
    let got;
    try {
      got = fromB64u(given);
    } catch (_) {
      return false;
    }
    const want = await mac(key, fields);
    if (got.length !== want.length) return false;
    let diff = 0;
    for (let i = 0; i < want.length; i++) diff |= got[i] ^ want[i];
    return diff === 0;
  }

  async function pairTranscript(hostId, extPub, hostPub, extNonce, hostNonce) {
    return sha256B64([`${NAME} pair`, hostId, extPub, hostPub, extNonce, hostNonce].join("\n"));
  }

  async function generateEcdh() {
    const pair = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
    const raw = new Uint8Array(await subtle.exportKey("raw", pair.publicKey));
    return { privateKey: pair.privateKey, publicB64: b64u(raw) };
  }

  async function ecdhShared(privateKey, peerPublicB64) {
    const peer = await subtle.importKey("raw", fromB64u(peerPublicB64), { name: "ECDH", namedCurve: "P-256" }, false, []);
    return new Uint8Array(await subtle.deriveBits({ name: "ECDH", public: peer }, privateKey, 256));
  }

  // HKDF-SHA256(ikm = ECDH shared value, salt = code key, info = transcript).
  async function pairingKey(shared, codeKeyBytes, transcript) {
    const ikm = await subtle.importKey("raw", shared, "HKDF", false, ["deriveBits"]);
    const bits = await subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: codeKeyBytes, info: encoder.encode(`${NAME} pairing key\n${transcript}`) },
      ikm,
      256
    );
    return new Uint8Array(bits);
  }

  async function sessionKey(pairingKeyBytes, hostNonce, extNonce, sessionId) {
    return mac(pairingKeyBytes, ["session", hostNonce, extNonce, sessionId]);
  }

  function requestFields(method, pathAndQuery, ts, nonce, bodyHash) {
    return ["req", String(method).toUpperCase(), pathAndQuery, ts, nonce, bodyHash];
  }

  function responseFields(status, requestNonce, ts, bodyHash) {
    return ["res", String(status), requestNonce, ts, bodyHash];
  }

  function timestampFresh(ts, now = Date.now()) {
    const value = Number(ts);
    return Number.isSafeInteger(value) && Math.abs(now - value) <= MAX_SKEW_MS;
  }

  return {
    PROTOCOL, NAME, CODE_LENGTH, MAX_SKEW_MS,
    b64u, fromB64u, randomB64, normalizeCode, sha256, sha256B64, codeKey,
    hmacKey, mac, mac64, verifyMac, pairTranscript, generateEcdh, ecdhShared,
    pairingKey, sessionKey, requestFields, responseFields, timestampFresh,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = BridgeAuth;
