"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const background = fs.readFileSync(path.join(__dirname, "../extension/background.js"), "utf8");

function fixture(accounts) {
  const folders = {
    account1: [
      { id: "account1://INBOX", accountId: "account1", name: "Inbox", path: "/INBOX", specialUse: ["inbox"] },
      { id: "account1://Faktury", accountId: "account1", name: "Faktury", path: "/Faktury", specialUse: [] },
    ],
    account2: [
      { id: "account2://INBOX", accountId: "account2", name: "Inbox", path: "/INBOX", specialUse: ["inbox"] },
      { id: "account2://Projekty", accountId: "account2", name: "Projekty", path: "/Projekty", specialUse: [] },
    ],
    account3: [
      { id: "account3://Trash", accountId: "account3", name: "Trash", path: "/Trash", specialUse: ["trash"] },
      { id: "account3://Archiwum lokalne", accountId: "account3", name: "Archiwum lokalne", path: "/Archiwum lokalne", specialUse: [] },
    ],
  };
  const queries = [];
  const messenger = {
    accounts: { list: async () => accounts },
    folders: { query: async q => folders[q.accountId] || [] },
    messages: { query: async q => { queries.push(q); return { messages: [] }; } },
    runtime: { getManifest: () => ({ version: "test" }) },
  };
  const context = vm.createContext({ messenger, console, setTimeout, clearTimeout, fetch: async () => new Promise(() => {}) });
  vm.runInContext(background, context);
  return { context, queries };
}

const gmail = { id: "account1", name: "Gmail prywatny", type: "imap" };
const work = { id: "account2", name: "Gmail firmowy", type: "imap" };
const local = { id: "account3", name: "Local Folders", type: "none" };

test("folder ID prefix selects its own account", async () => {
  const { context, queries } = fixture([gmail, work, local]);
  assert.equal((await context.resolveAccount({ folder: "account2://INBOX" })).id, "account2");
  await context.executeRequest({ op: "count", args: { folder: "account2://INBOX" } });
  assert.equal(queries[0].accountId, "account2");
  assert.equal(queries[0].folderId, "account2://INBOX");
});

test("folder name present on several mail accounts fails instead of picking the first IMAP", async () => {
  const { context, queries } = fixture([gmail, work, local]);
  await assert.rejects(context.executeRequest({ op: "search", args: { folder: "Inbox" } }), /kilku kontach/);
  assert.equal(queries.length, 0);
});

test("unique folder names pick their account, including Local Folders", async () => {
  const { context } = fixture([gmail, work, local]);
  assert.equal((await context.resolveAccount({ folder: "Projekty" })).id, "account2");
  assert.equal((await context.resolveAccount({ folder: "Faktury" })).id, "account1");
  assert.equal((await context.resolveAccount({ folder: "Archiwum lokalne" })).id, "account3");
  assert.equal((await context.resolveAccount({})).id, "account1", "no folder keeps the first-IMAP default");
});

test("single mail account keeps the previous default", async () => {
  const { context } = fixture([gmail, local]);
  assert.equal((await context.resolveAccount({ folder: "Inbox" })).id, "account1");
});

test("account names: exact first, then a unique substring, ambiguous substrings fail", async () => {
  const { context } = fixture([gmail, work, { id: "account4", name: "Gmail", type: "imap" }]);
  assert.equal((await context.resolveAccount({ account: "gmail" })).id, "account4");
  assert.equal((await context.resolveAccount({ account: "firmowy" })).id, "account2");
  assert.equal((await context.resolveAccount({ account: "gmail p" })).id, "account1");
  await assert.rejects(context.resolveAccount({ account: "mail" }), /Niejednoznaczna nazwa konta/);
});
