"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const background = fs.readFileSync(path.join(__dirname, "../extension/background.js"), "utf8");

function fixture({ accountName = "Praca", type = "imap" } = {}) {
  const account = { id: "account1", name: accountName, type };
  const folders = [
    { id: "account1://INBOX", accountId: "account1", name: "Odebrane", path: "/INBOX", specialUse: ["inbox"] },
    { id: "account1://Faktury", accountId: "account1", name: "Faktury", path: "/Faktury", specialUse: [] },
    { id: "account1://Archiwum", accountId: "account1", name: "Archiwum", path: "/Archiwum", specialUse: [] },
    { id: "account1://[Gmail]/All Mail", accountId: "account1", name: "Wszystkie", path: "/[Gmail]/All Mail", specialUse: ["archives"] },
    { id: "account1://[Gmail]/Trash", accountId: "account1", name: "Kosz", path: "/[Gmail]/Trash", specialUse: ["trash"] },
  ];
  const byId = id => folders.find(folder => folder.id === id);
  // Message 1 lives in Inbox and the Faktury label; message 2 only in Faktury.
  let messages = [
    { id: 10, headerMessageId: "shared@test", folderId: "account1://INBOX" },
    { id: 11, headerMessageId: "shared@test", folderId: "account1://Faktury" },
    { id: 12, headerMessageId: "shared@test", folderId: "account1://[Gmail]/All Mail" },
    { id: 21, headerMessageId: "only-label@test", folderId: "account1://Faktury" },
    { id: 22, headerMessageId: "only-label@test", folderId: "account1://[Gmail]/All Mail" },
  ].map(m => ({ ...m, subject: "fixture", author: "a@b.test", date: new Date("2026-01-01") }));
  const calls = { delete: [], move: [] };
  const view = m => ({ ...m, folder: byId(m.folderId) });
  const messenger = {
    accounts: { list: async () => [account] },
    folders: { query: async () => folders },
    messages: {
      query: async q => ({
        messages: messages
          .filter(m => !q.folderId || m.folderId === q.folderId)
          .filter(m => !q.headerMessageId || m.headerMessageId === q.headerMessageId)
          .map(view),
      }),
      get: async id => {
        const found = messages.find(m => m.id === id);
        if (!found) throw new Error("gone");
        return view(found);
      },
      delete: async (ids, options) => {
        calls.delete.push({ ids: Array.from(ids), options });
        messages = messages.map(m => ids.includes(m.id) ? { ...m, id: m.id + 1000, folderId: "account1://[Gmail]/Trash" } : m);
      },
      move: async (ids, destination) => {
        calls.move.push({ ids: Array.from(ids), destination });
        messages = messages.map(m => ids.includes(m.id) ? { ...m, folderId: destination } : m);
      },
    },
    runtime: { getManifest: () => ({ version: "test" }) },
  };
  const context = vm.createContext({ messenger, console, setTimeout: fn => { fn(); return 1; }, clearTimeout, fetch: async () => new Promise(() => {}) });
  vm.runInContext(background, context);
  return { context, calls };
}

test("Gmail trash from a label is blocked when the message is also in Inbox", async () => {
  const { context, calls } = fixture();
  await assert.rejects(
    context.executeRequest({ op: "trash", args: { confirm: true, folder: "Faktury", subject: "fixture" } }),
    error => /etykiety Gmail "Faktury" jest zablokowana/.test(error.message) && /shared@test/.test(error.message) && /Odebranych/.test(error.message)
  );
  await assert.rejects(
    context.executeRequest({ op: "trash", args: { confirm: true, folder: "Faktury", subject: "fixture", dry_run: true } }),
    /zablokowana/
  );
  assert.equal(calls.delete.length, 0);
});

test("Gmail move from a label is blocked unless the caller opts into label-only removal", async () => {
  const { context, calls } = fixture();
  await assert.rejects(
    context.executeRequest({ op: "move", args: { confirm: true, folder: "Faktury", destination: "Archiwum", subject: "fixture" } }),
    /allow_other_labels/
  );
  assert.equal(calls.move.length, 0);
  const result = await context.executeRequest({ op: "move", args: { confirm: true, folder: "Faktury", destination: "Archiwum", subject: "fixture", allow_other_labels: true } });
  assert.equal(result.moved, 2);
});

test("Gmail label-only messages and Inbox sources stay allowed", async () => {
  const { context, calls } = fixture();
  const labelOnly = await context.executeRequest({ op: "trash", args: { confirm: true, folder: "Faktury", header_message_id: "only-label@test" } });
  assert.equal(labelOnly.moved, 1);
  const inbox = await context.executeRequest({ op: "trash", args: { confirm: true, header_message_id: "shared@test" } });
  assert.equal(inbox.moved, 1);
  assert.deepEqual(calls.delete.map(call => call.ids), [[21], [10]]);
});

test("non-Gmail IMAP accounts are not affected by the label guard", async () => {
  // Without [Gmail] folders or a Gmail name/identity this is a plain IMAP server.
  const plain = fixture({ accountName: "Firma" });
  const folders = await plain.context.messenger.folders.query({});
  for (const folder of folders) folder.path = folder.path.replace("[Gmail]", "Mail");
  const result = await plain.context.executeRequest({ op: "move", args: { confirm: true, folder: "Faktury", destination: "Archiwum", subject: "fixture" } });
  assert.equal(result.moved, 2);
});
