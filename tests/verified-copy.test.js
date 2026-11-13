"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const extensionRoot = path.resolve(__dirname, "..", "extension");
const source = { id: "account1://ALL", accountId: "account1", name: "Wszystkie", path: "/[Gmail]/Wszystkie", specialUse: ["archives"] };
const destination = { id: "account2://Archive", accountId: "account2", name: "Archive", path: "/Archive" };
const serverDestination = { id: "account1://Archive", accountId: "account1", name: "Archive", path: "/Archive" };
const original = {
  id: 7,
  headerMessageId: "verified@example.com",
  size: 123456,
  author: "Sender <sender@example.com>",
  subject: "Verified copy",
  date: new Date("2026-08-12T12:00:00Z"),
  folder: source,
};
let localCopies = [];

const messenger = {
  messages: {
    query: async query => {
      if (query.folderId === destination.id) return { messages: localCopies };
      if (query.folderId === source.id && query.headerMessageId === original.headerMessageId) return { messages: [original] };
      return { messages: [] };
    },
    copy: async ids => {
      assert.equal(ids.join(","), "7");
      localCopies = [{ ...original, id: 70, folder: destination }];
    },
  },
  accounts: {
    list: async () => [
      { id: "account1", name: "gmail@example.com", type: "imap" },
      { id: "account2", name: "Local Folders", type: "none" },
    ],
  },
  folders: { query: async ({ accountId }) => accountId === "account2" ? [destination] : [source, serverDestination] },
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
  const result = await context.executeRequest({
    op: "copy",
    args: {
      account: "account1",
      folder: "Wszystkie",
      destination_account: "Local Folders",
      destination: "Archive",
      header_message_id: original.headerMessageId,
      confirm: true,
    },
  });
  assert.equal(result.copied, 1);
  assert.equal(result.skipped, 0);
  assert.equal(result.copiedBytes, 123456);
  assert.equal(result.verified, true);
  assert.equal(result.messageIds.join(","), original.headerMessageId);

  const retry = await context.executeRequest({
    op: "copy",
    args: {
      account: "account1",
      folder: "Wszystkie",
      destination_account: "Local Folders",
      destination: "Archive",
      header_message_id: original.headerMessageId,
      confirm: true,
    },
  });
  assert.equal(retry.copied, 0);
  assert.equal(retry.skipped, 1);
  assert.equal(retry.verified, true);

  await assert.rejects(
    context.executeRequest({
      op: "copy",
      args: {
        account: "account1",
        folder: "Wszystkie",
        destination_account: "account1",
        destination: "Archive",
        header_message_id: original.headerMessageId,
        confirm: true,
      },
    }),
    /Kopiowanie z Gmail All Mail\/Wszystkie do tego samego konta jest zablokowane/
  );
  console.log("PASS Thunderbird exact Message-ID copy and local verification");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
