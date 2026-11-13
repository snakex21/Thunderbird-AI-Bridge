"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const background = fs.readFileSync(path.join(__dirname, "../extension/background.js"), "utf8");

const inbox = { id: "account1://INBOX", accountId: "account1", name: "Odebrane", path: "/INBOX", specialUse: ["inbox"] };
const label = { id: "account1://Faktury", accountId: "account1", name: "Faktury", path: "/Faktury", specialUse: [] };
const allMail = { id: "account1://[Gmail]/All Mail", accountId: "account1", name: "Wszystkie", path: "/[Gmail]/All Mail", specialUse: ["archives"] };

function fixture(accountName) {
  const paths = accountName === "Gmail" ? [inbox, label, allMail] : [inbox, label, { ...allMail, path: "/Archive" }];
  const [i, l, a] = paths;
  const messages = [
    { id: 1, headerMessageId: "big@test", size: 9000, folder: a },
    { id: 2, headerMessageId: "big@test", size: 9000, folder: i },
    { id: 3, headerMessageId: "big@test", size: 9000, folder: l },
    { id: 4, headerMessageId: "small@test", size: 100, folder: a },
    { id: 5, headerMessageId: "", size: 50, folder: i },
  ].map(m => ({ ...m, subject: "x", author: "a@b.test", date: new Date("2026-01-01") }));
  const messenger = {
    accounts: { list: async () => [{ id: "account1", name: accountName, type: "imap" }] },
    folders: { query: async () => paths },
    messages: { query: async () => ({ messages }) },
    runtime: { getManifest: () => ({ version: "test" }) },
  };
  const context = vm.createContext({ messenger, console, setTimeout, clearTimeout, fetch: async () => new Promise(() => {}) });
  vm.runInContext(background, context);
  return context;
}

test("Gmail account-wide largest counts each Message-ID once", async () => {
  const result = await fixture("Gmail").executeRequest({ op: "largest", args: { scope: "account" } });
  assert.equal(result.totalMessages, 3);
  assert.equal(result.totalBytes, 9150);
  assert.equal(result.duplicatesSkipped, 2);
  assert.equal(result.deduplicatedByMessageId, true);
  assert.equal(result.largest[0].folder.path, "/INBOX", "a labelled copy is preferred over All Mail");
});

test("non-Gmail servers keep real duplicate copies", async () => {
  const result = await fixture("Firma").executeRequest({ op: "largest", args: { scope: "account" } });
  assert.equal(result.totalMessages, 5);
  assert.equal(result.deduplicatedByMessageId, false);
});
