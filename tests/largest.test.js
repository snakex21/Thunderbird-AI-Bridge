"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const extensionRoot = path.resolve(__dirname, "..", "extension");
const folder = { id: "account1://INBOX", accountId: "account1", name: "Inbox", path: "/INBOX", specialUse: ["inbox"] };
const messages = [
  { id: 1, headerMessageId: "small@example", size: 10, author: "A", subject: "small", date: new Date("2026-01-01"), folder },
  { id: 2, headerMessageId: "large@example", size: 5000, author: "B", subject: "large", date: new Date("2026-01-02"), folder },
  { id: 3, headerMessageId: "medium@example", size: 1000, author: "C", subject: "medium", date: new Date("2026-01-03"), folder },
];

const messenger = {
  messages: { query: async () => ({ messages }) },
  accounts: { list: async () => [{ id: "account1", name: "test@example.com", type: "imap" }] },
  folders: { query: async () => [folder] },
  runtime: { getManifest: () => ({ version: "test" }) },
};

const context = vm.createContext({
  messenger,
  console,
  setTimeout,
  clearTimeout,
  URLSearchParams,
  fetch: async () => new Promise(() => {}),
});
vm.runInContext(fs.readFileSync(path.join(extensionRoot, "background.js"), "utf8"), context, { filename: "background.js" });

(async () => {
  const result = await context.executeRequest({ op: "largest", args: { folder: "Inbox", limit: 2 } });
  assert.equal(result.totalMessages, 3);
  assert.equal(result.totalBytes, 6010);
  assert.equal(result.largest.map(item => item.id).join(","), "2,3");
  assert.equal(result.largest[0].size, 5000);
  assert.equal(result.largest[0].headerMessageId, "large@example");
  console.log("PASS Thunderbird largest-message aggregation");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
