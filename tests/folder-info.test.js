"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const background = fs.readFileSync(path.join(__dirname, "../extension/background.js"), "utf8");

function fixture(getFolderInfo) {
  const folders = [
    { id: "account1://INBOX", accountId: "account1", name: "Inbox", path: "/INBOX", specialUse: ["inbox"] },
    { id: "account1://Broken", accountId: "account1", name: "Broken", path: "/Broken", specialUse: [] },
  ];
  const messenger = {
    accounts: { list: async () => [{ id: "account1", name: "Work", type: "imap" }] },
    folders: { query: async () => folders, ...(getFolderInfo ? { getFolderInfo } : {}) },
    runtime: { getManifest: () => ({ version: "test" }) },
  };
  const context = vm.createContext({ messenger, console, setTimeout, clearTimeout, fetch: async () => new Promise(() => {}) });
  vm.runInContext(background, context);
  return context;
}

test("folders include total and unread counts from getFolderInfo", async () => {
  const context = fixture(async id => {
    if (id === "account1://Broken") throw new Error("db not open");
    return { totalMessageCount: 42, unreadMessageCount: 3 };
  });
  const result = await context.executeRequest({ op: "folders", args: {} });
  assert.equal(result.folderInfoAvailable, true);
  assert.equal(result.folders[0].totalMessageCount, 42);
  assert.equal(result.folders[0].unreadMessageCount, 3);
  assert.equal(result.folders[1].totalMessageCount, null, "one failing folder does not fail the listing");
  assert.equal(result.folders[1].path, "/Broken");
});

test("folders still work without getFolderInfo", async () => {
  const result = await fixture(null).executeRequest({ op: "folders", args: {} });
  assert.equal(result.folderInfoAvailable, false);
  assert.equal(result.folders.length, 2);
  assert.equal(result.folders[0].unreadMessageCount, null);
});
