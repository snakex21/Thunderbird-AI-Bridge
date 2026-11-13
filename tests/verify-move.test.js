"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const background = fs.readFileSync(path.join(__dirname, "../extension/background.js"), "utf8");

const folders = [
  { id: "account1://INBOX", accountId: "account1", name: "Odebrane", path: "/INBOX", specialUse: ["inbox"] },
  { id: "account1://zakupy", accountId: "account1", name: "zakupy", path: "/zakupy", specialUse: [] },
  { id: "account1://[Gmail]/All Mail", accountId: "account1", name: "Wszystkie", path: "/[Gmail]/All Mail", specialUse: ["archives"] },
];

function fixture({ accountName = "Gmail", type = "imap" } = {}) {
  const state = {
    messages: [1, 2, 3].map(i => ({
      id: i, headerMessageId: `buy-${i}@shop.test`, folderId: "account1://INBOX", subject: "zamówienie", author: "shop@shop.test", date: new Date("2026-02-01"),
    })),
    refreshed: [],
    mutations: 0,
  };
  const view = m => ({ ...m, folder: folders.find(f => f.id === m.folderId) });
  let nextId = 100;
  const messenger = {
    accounts: { list: async () => [{ id: "account1", name: accountName, type }] },
    folders: { query: async () => folders },
    mailbridge: { refreshFolder: async (accountId, folderPath) => { state.refreshed.push(folderPath); return true; } },
    messages: {
      query: async q => ({
        messages: state.messages
          .filter(m => !q.folderId || m.folderId === q.folderId)
          .filter(m => !q.headerMessageId || m.headerMessageId === q.headerMessageId)
          .map(view),
      }),
      get: async id => {
        const found = state.messages.find(m => m.id === id);
        if (!found) throw new Error("gone");
        return view(found);
      },
      move: async (ids, destination) => {
        state.mutations++;
        state.messages = state.messages.map(m => ids.includes(m.id) ? { ...m, id: nextId++, folderId: destination } : m);
      },
      delete: async () => { state.mutations++; },
      copy: async () => { state.mutations++; },
    },
    runtime: { getManifest: () => ({ version: "test" }) },
  };
  const context = vm.createContext({
    messenger, console, clearTimeout, fetch: async () => new Promise(() => {}),
    setTimeout: (fn) => setTimeout(fn, 0),
  });
  vm.runInContext(background, context);
  return { run: (op, args) => context.executeRequest({ op, args }), state };
}

test("Gmail move result carries recheckAfterMs and a ready verify_move request", async () => {
  const f = fixture();
  const result = await f.run("move", { confirm: true, subject: "zamówienie", destination: "zakupy" });
  assert.equal(result.verified, true);
  assert.equal(result.recheckAfterMs, 180000);
  assert.deepEqual(Array.from(result.messageIds).sort(), ["buy-1@shop.test", "buy-2@shop.test", "buy-3@shop.test"]);
  assert.equal(result.recheck.op, "verify_move");
  assert.equal(result.recheck.args.destination, "account1://zakupy");
  assert.equal(result.recheck.args.source, "account1://INBOX");

  const mutationsAfterMove = f.state.mutations;
  const check = await f.run(result.recheck.op, JSON.parse(JSON.stringify(result.recheck.args)));
  assert.equal(check.verified, true);
  assert.equal(check.status, "verified_moved");
  assert.equal(check.checked, 3);
  assert.equal(check.inDestination, 3);
  assert.equal(check.readOnly, true);
  assert.equal(f.state.mutations, mutationsAfterMove, "verify_move changes nothing");
});

test("verify_move reports a Gmail label dropped minutes later (message only in All Mail)", async () => {
  const f = fixture();
  const moved = await f.run("move", { confirm: true, subject: "zamówienie", destination: "zakupy" });
  // Later: Gmail removes the label from one message.
  f.state.messages = f.state.messages.map(m => m.headerMessageId === "buy-2@shop.test" ? { ...m, folderId: "account1://[Gmail]/All Mail" } : m);
  f.state.refreshed = [];
  const check = await f.run("verify_move", JSON.parse(JSON.stringify(moved.recheck.args)));
  assert.equal(check.verified, false);
  assert.equal(check.status, "moved_but_unverified");
  assert.deepEqual(Array.from(check.missingInDestination), ["buy-2@shop.test"]);
  assert.equal(check.labelDropped, 1);
  assert.equal(check.locations[0].onlyInAllMail, true);
  assert.deepEqual(Array.from(check.locations[0].foundIn), ["/[Gmail]/All Mail"]);
  assert.match(check.warning, /etykietę/);
  assert.deepEqual(Array.from(f.state.refreshed), ["/zakupy", "/INBOX"], "both folders are refreshed from the server");
});

test("verify_move reports messages still in the source", async () => {
  const f = fixture();
  const check = await f.run("verify_move", {
    source: "Odebrane", destination: "zakupy", header_message_ids: ["<buy-1@shop.test>"], refresh: false,
  });
  assert.equal(check.verified, false);
  assert.equal(check.stillInSourceCount, 1);
  assert.equal(check.missingInDestinationCount, 1);
  assert.equal(check.locations[0].onlyInAllMail, false);
  assert.deepEqual(Array.from(check.locations[0].foundIn), ["/INBOX"]);
  assert.equal(check.refreshed, false);
});

test("verify_move validates its arguments", async () => {
  const f = fixture();
  await assert.rejects(f.run("verify_move", { header_message_ids: ["a@b"] }), /destination/);
  await assert.rejects(f.run("verify_move", { destination: "zakupy" }), /header_message_ids/);
  const tooMany = Array.from({ length: 501 }, (_, i) => `m${i}@x.test`);
  await assert.rejects(f.run("verify_move", { destination: "zakupy", header_message_ids: tooMany }), /najwyżej 500/);
});

test("local folders get no recheck hint", async () => {
  const f = fixture({ accountName: "Lokalne", type: "none" });
  const result = await f.run("move", { confirm: true, subject: "zamówienie", destination: "zakupy" });
  assert.equal(result.recheckAfterMs, null);
  assert.equal(result.recheck, null);
});

test("verify_move keeps the Message-ID spelling for the account-wide lookup", async () => {
  const f = fixture();
  f.state.messages[0].headerMessageId = "Buy-1@Shop.TEST";
  const check = await f.run("verify_move", { destination: "zakupy", header_message_ids: ["<Buy-1@Shop.TEST>"], refresh: false });
  assert.equal(check.locations[0].headerMessageId, "Buy-1@Shop.TEST");
  assert.deepEqual(Array.from(check.locations[0].foundIn), ["/INBOX"]);
});
