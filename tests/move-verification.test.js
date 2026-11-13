"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const background = fs.readFileSync(path.join(__dirname, "../extension/background.js"), "utf8");

// Synthetic Gmail account: Inbox, label "zakupy" and All Mail. The optional
// afterSettle hook runs when the bridge waits for the post-move settle window,
// simulating Gmail dropping the label again minutes after an optimistic move.
function fixture({ afterSettle, refresh = true, batches = 1 } = {}) {
  const folders = [
    { id: "account1://INBOX", accountId: "account1", name: "Odebrane", path: "/INBOX", specialUse: ["inbox"] },
    { id: "account1://zakupy", accountId: "account1", name: "zakupy", path: "/zakupy", specialUse: [] },
    { id: "account1://[Gmail]/All Mail", accountId: "account1", name: "Wszystkie", path: "/[Gmail]/All Mail", specialUse: ["archives"] },
    { id: "account1://[Gmail]/Trash", accountId: "account1", name: "Kosz", path: "/[Gmail]/Trash", specialUse: ["trash"] },
  ];
  const state = {
    messages: Array.from({ length: 3 * batches }, (_, i) => ({
      id: i + 1, headerMessageId: `buy-${i + 1}@shop.test`, folderId: "account1://INBOX", subject: "zamówienie", author: "shop@shop.test", date: new Date("2026-02-01"),
    })),
    refreshed: [],
    settleWaits: [],
  };
  const view = m => ({ ...m, folder: folders.find(f => f.id === m.folderId) });
  let nextId = 100;
  const messenger = {
    accounts: { list: async () => [{ id: "account1", name: "Gmail", type: "imap" }] },
    folders: { query: async () => folders },
    mailbridge: refresh ? { refreshFolder: async (accountId, folderPath) => { state.refreshed.push(folderPath); return true; } } : undefined,
    messages: {
      query: async q => ({ messages: state.messages.filter(m => !q.folderId || m.folderId === q.folderId).map(view) }),
      get: async id => {
        const found = state.messages.find(m => m.id === id);
        if (!found) throw new Error("gone");
        return view(found);
      },
      move: async (ids, destination) => {
        // IMAP move gives the destination copy a new Thunderbird id.
        state.messages = state.messages.map(m => ids.includes(m.id) ? { ...m, id: nextId++, folderId: destination } : m);
      },
    },
    runtime: { getManifest: () => ({ version: "test" }) },
  };
  const context = vm.createContext({
    messenger, console, clearTimeout, fetch: async () => new Promise(() => {}),
    setTimeout: (fn, ms) => {
      if (ms === 10000) {
        state.settleWaits.push(ms);
        if (afterSettle) afterSettle(state);
      }
      return setTimeout(fn, 0);
    },
  });
  vm.runInContext(background, context);
  return { context, state };
}

const moveArgs = extra => ({ confirm: true, subject: "zamówienie", destination: "zakupy", ...extra });

test("Gmail move is verified after the settle window and a server refresh", async () => {
  const { context, state } = fixture();
  const result = await context.executeRequest({ op: "move", args: moveArgs() });
  assert.equal(result.moved, 3);
  assert.equal(result.verified, true);
  assert.equal(result.immediateVerified, true);
  assert.equal(result.status, "verified_moved");
  assert.equal(result.movedButUnverified, 0);
  assert.equal(result.moveMethod, "messages.move");
  assert.deepEqual(state.settleWaits, [10000]);
  assert.deepEqual(state.refreshed, ["/zakupy", "/INBOX"]);
  assert.equal(result.refreshed, true);
});

test("messages that vanish from the label after the delay are reported, not counted as success", async () => {
  const { context } = fixture({
    afterSettle: state => {
      // Gmail drops the label for one message; it remains only in All Mail.
      state.messages = state.messages.map(m => m.headerMessageId === "buy-2@shop.test" ? { ...m, folderId: "account1://[Gmail]/All Mail" } : m);
    },
  });
  const result = await context.executeRequest({ op: "move", args: moveArgs() });
  assert.equal(result.immediateVerified, true, "the immediate check alone would have reported success");
  assert.equal(result.verified, false);
  assert.equal(result.status, "moved_but_unverified");
  assert.equal(result.movedButUnverified, 1);
  assert.deepEqual(Array.from(result.missingInDestination), ["buy-2@shop.test"]);
  assert.match(result.warning, /nie przetrwało weryfikacji/);
});

test("an unverified batch withholds the continuation token", async () => {
  const { context } = fixture({
    batches: 2,
    afterSettle: state => {
      state.messages = state.messages.map(m => m.folderId === "account1://zakupy" ? { ...m, folderId: "account1://[Gmail]/All Mail" } : m);
    },
  });
  const result = await context.executeRequest({ op: "move", args: moveArgs({ batch_size: 3 }) });
  assert.equal(result.more, true);
  assert.equal(result.verified, false);
  assert.equal(result.continuation, "");
});

test("duplicate headers in the destination are surfaced as a warning", async () => {
  const { context } = fixture({
    afterSettle: state => {
      const copy = state.messages.find(m => m.folderId === "account1://zakupy");
      state.messages.push({ ...copy, id: 999 });
    },
  });
  const result = await context.executeRequest({ op: "move", args: moveArgs() });
  assert.equal(result.verified, true);
  assert.equal(result.destinationDuplicates.length, 1);
  assert.match(result.warning, /więcej niż raz/);
});

test("verification still runs without the refresh experiment", async () => {
  const { context } = fixture({ refresh: false });
  const result = await context.executeRequest({ op: "move", args: moveArgs() });
  assert.equal(result.verified, true);
  assert.equal(result.refreshed, false);
});
