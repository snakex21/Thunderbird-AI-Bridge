"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const background = fs.readFileSync(path.join(__dirname, "../extension/background.js"), "utf8");

const inbox = { id: "account1://INBOX", accountId: "account1", name: "Odebrane", path: "/INBOX", specialUse: ["inbox"] };
const studia = { id: "account1://studia", accountId: "account1", name: "studia", path: "/studia", specialUse: [] };
const allMail = { id: "account1://[Gmail]/All Mail", accountId: "account1", name: "Wszystkie", path: "/[Gmail]/All Mail", specialUse: ["archives"] };

function msg(id, headerMessageId, folder, extra = {}) {
  return {
    id, headerMessageId, folder, size: 100, subject: `temat ${id}`,
    author: "Uczelnia <dziekanat@uczelnia.test>", date: new Date(Date.UTC(2026, 0, id)), read: true, ...extra,
  };
}

function fixture({ accountName = "Gmail", folders = [inbox, studia, allMail], messages }) {
  const queries = [];
  const messenger = {
    accounts: { list: async () => [{ id: "account1", name: accountName, type: "imap" }] },
    folders: { query: async () => folders },
    messages: {
      query: async q => {
        queries.push(q);
        return { messages: messages.filter(m => !q.folderId || m.folder.id === q.folderId) };
      },
    },
    runtime: { getManifest: () => ({ version: "test" }) },
  };
  const context = vm.createContext({ messenger, console, setTimeout, clearTimeout, fetch: async () => new Promise(() => {}) });
  vm.runInContext(background, context);
  return { run: (op, args) => context.executeRequest({ op, args }), queries };
}

// Gmail: one message seen in Inbox, a label and All Mail; one only in All Mail.
const gmailMessages = () => [
  msg(1, "<a@uczelnia.test>", allMail),
  msg(2, "<a@uczelnia.test>", inbox),
  msg(3, "<A@uczelnia.test>", studia),
  msg(4, "b@uczelnia.test", allMail),
  msg(5, "", inbox),
  msg(6, "", studia),
];

test("Gmail scope:account count counts each Message-ID once", async () => {
  const f = fixture({ messages: gmailMessages() });
  const result = await f.run("count", { scope: "account" });
  assert.equal(result.count, 4, "a, b and the two messages without Message-ID");
  assert.equal(result.deduplicatedByMessageId, true);
  assert.equal(result.crossFolderDeduplication, true);
  assert.equal(result.duplicatesSkipped, 2);
  assert.equal(result.crossFolderDuplicates, 2);
  assert.equal(result.duplicateRecords, 0);
  assert.equal(result.scannedRecords, 6);
});

test("include_duplicates:true restores the raw per-record count", async () => {
  const f = fixture({ messages: gmailMessages() });
  const result = await f.run("count", { scope: "account", include_duplicates: true });
  assert.equal(result.count, 6);
  assert.equal(result.deduplicatedByMessageId, false);
  assert.equal(result.duplicatesSkipped, 0);
});

test("Gmail scope:account search returns one copy per Message-ID, never the All Mail one when a label copy exists", async () => {
  const f = fixture({ messages: gmailMessages() });
  const result = await f.run("search", { scope: "account", limit: 10 });
  assert.equal(result.count, 4);
  const a = result.messages.filter(m => m.headerMessageId.toLowerCase() === "<a@uczelnia.test>");
  assert.equal(a.length, 1);
  assert.notEqual(a[0].folder.path, "/[Gmail]/All Mail");
  assert.equal(result.messages.find(m => m.headerMessageId === "b@uczelnia.test").folder.path, "/[Gmail]/All Mail",
    "a message that exists only in All Mail is still returned");
  assert.equal(result.duplicatesSkipped, 2);
});

test("Gmail scope:account senders counts a labelled message once", async () => {
  const f = fixture({ messages: gmailMessages() });
  const result = await f.run("senders", { scope: "account" });
  assert.equal(result.totalMessages, 4);
  assert.equal(result.senders[0].count, 4);
  assert.equal(result.crossFolderDuplicates, 2);
  const raw = await f.run("senders", { scope: "account", include_duplicates: true });
  assert.equal(raw.totalMessages, 6);
});

// Duplicate index records inside one folder (live: 75 records, 67 Message-IDs).
const studiaMessages = () => [
  msg(10, "x@uczelnia.test", studia),
  msg(11, "y@uczelnia.test", studia),
  msg(12, "x@uczelnia.test", studia),
  msg(13, "z@uczelnia.test", studia),
  msg(14, "y@uczelnia.test", studia),
  msg(15, "y@uczelnia.test", studia),
];

for (const accountName of ["Gmail", "Firma"]) {
  test(`${accountName}: count/search/senders report unique messages in one folder`, async () => {
    const f = fixture({ accountName, messages: studiaMessages() });
    const count = await f.run("count", { folder: "studia" });
    assert.equal(count.count, 3);
    assert.equal(count.duplicateRecords, 3);
    assert.equal(count.crossFolderDuplicates, 0);
    assert.equal(count.scannedRecords, 6);

    const search = await f.run("search", { folder: "studia", limit: 100 });
    const ids = search.messages.map(m => m.headerMessageId);
    assert.equal(new Set(ids).size, ids.length, "no Message-ID twice from one folder");
    assert.deepEqual(Array.from(search.messages, m => m.id).sort((a, b) => a - b), [12, 13, 15], "newest index record is kept");

    const senders = await f.run("senders", { folder: "studia" });
    assert.equal(senders.totalMessages, 3);
    assert.equal(senders.duplicateRecords, 3);

    const raw = await f.run("count", { folder: "studia", include_duplicates: true });
    assert.equal(raw.count, 6);
  });
}

test("search limit applies after deduplication", async () => {
  const f = fixture({ accountName: "Firma", messages: studiaMessages() });
  const result = await f.run("search", { folder: "studia", limit: 2 });
  assert.deepEqual(Array.from(result.messages, m => m.id), [15, 13], "newest unique messages first");
  assert.equal(result.duplicatesSkipped, 3);
});

test("non-Gmail servers keep the same Message-ID in different folders", async () => {
  const f = fixture({ accountName: "Firma", folders: [inbox, studia, { ...allMail, path: "/Archive" }], messages: gmailMessages() });
  const result = await f.run("count", { scope: "account" });
  assert.equal(result.count, 6);
  assert.equal(result.crossFolderDeduplication, false);
  assert.equal(result.duplicatesSkipped, 0);
});

test("mutation selection still sees every record", async () => {
  const f = fixture({ accountName: "Firma", messages: studiaMessages() });
  const result = await f.run("move", { confirm: true, folder: "studia", destination: "Odebrane", subject: "temat", dry_run: true, batch_size: 10 });
  assert.equal(result.wouldProcess, 6);
});

test("folders reports uniqueMessageCount and duplicateRecords only when asked", async () => {
  const f = fixture({ accountName: "Firma", messages: [...studiaMessages(), msg(20, "q@uczelnia.test", inbox)] });
  const plain = await f.run("folders", {});
  assert.equal(plain.uniqueCountsIncluded, false);
  assert.equal(plain.folders[1].uniqueMessageCount, undefined);
  assert.equal(f.queries.length, 0, "the default listing scans no headers");

  const all = await f.run("folders", { include_unique_counts: true });
  const byPath = Object.fromEntries(Array.from(all.folders, item => [item.path, item]));
  assert.equal(byPath["/studia"].messageRecords, 6);
  assert.equal(byPath["/studia"].uniqueMessageCount, 3);
  assert.equal(byPath["/studia"].duplicateRecords, 3);
  assert.equal(byPath["/INBOX"].uniqueMessageCount, 1);

  const one = await f.run("folders", { include_unique_counts: true, folder: "studia" });
  const onePaths = Object.fromEntries(Array.from(one.folders, item => [item.path, item]));
  assert.equal(onePaths["/studia"].uniqueMessageCount, 3);
  assert.equal(onePaths["/INBOX"].uniqueMessageCount, undefined, "only the requested folder is scanned");
});
