"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const extensionRoot = path.resolve(__dirname, "..", "extension");
const source = { id: "account1://ALL", accountId: "account1", name: "Wszystkie", path: "/Wszystkie", specialUse: ["archives"] };
const trash = { id: "account1://TRASH", accountId: "account1", name: "Kosz", path: "/Kosz", specialUse: ["trash"] };
const destination = { id: "account1://TARGET", accountId: "account1", name: "ANK Kraków", path: "/ANK Kraków", specialUse: [] };
const original = {
  id: 42,
  headerMessageId: "safe-trash@example.com",
  size: 4096,
  author: "Sender <sender@example.com>",
  subject: "Safe trash",
  date: new Date("2026-08-12T12:00:00Z"),
  folder: source,
};
let sourceMessages = [original];
let trashMessages = [];
let deleteOptions = null;
let copyOptions = null;
let copyCalls = 0;

const messenger = {
  messages: {
    query: async query => {
      if (query.folderId === trash.id) return { messages: trashMessages };
      if (query.folderId === source.id) return { messages: sourceMessages };
      return { messages: [] };
    },
    get: async id => {
      const message = [...sourceMessages, ...trashMessages].find(item => item.id === id);
      if (!message) throw new Error("Message not found");
      return message;
    },
    copy: async (ids, folderId, options) => {
      assert.equal(folderId, trash.id);
      copyOptions = options;
      copyCalls++;
      trashMessages = [{ ...original, id: 420, folder: trash }];
    },
    delete: async (ids, options) => {
      deleteOptions = options;
      sourceMessages = [];
      if (!options.deletePermanently) {
        trashMessages = [{ ...original, id: 420, folder: trash }];
      }
    },
    move: async () => { throw new Error("trash must not use messages.move"); },
  },
  accounts: { list: async () => [{ id: "account1", name: "gmail@example.com", type: "imap" }] },
  folders: { query: async () => [source, trash, destination] },
  runtime: { getManifest: () => ({ version: "test" }) },
};

const context = vm.createContext({
  messenger,
  console,
  setTimeout: callback => { callback(); return 1; },
  clearTimeout,
  URLSearchParams,
  fetch: async () => new Promise(() => {}),
});
vm.runInContext(fs.readFileSync(path.join(extensionRoot, "background.js"), "utf8"), context, { filename: "background.js" });

(async () => {
  await assert.rejects(
    context.executeRequest({
      op: "trash",
      args: { account: "account1", folder: source.id, header_message_id: original.headerMessageId, confirm: true },
    }),
    /Gmail All Mail\/Wszystkie jest zablokowana/
  );
  assert.equal(copyCalls, 0);
  assert.equal(deleteOptions, null);

  const dryRun = await context.executeRequest({
    op: "trash",
    args: {
      account: "account1",
      folder: source.id,
      message_ids: [original.id],
      local_backup_verified: true,
      confirm: true,
      dry_run: true,
    },
  });
  assert.equal(dryRun.wouldProcess, 1);
  assert.equal(copyCalls, 0);
  assert.equal(deleteOptions, null);

  const gmailResult = await context.executeRequest({
    op: "trash",
    args: {
      account: "account1",
      folder: source.id,
      message_ids: [original.id],
      local_backup_verified: true,
      confirm: true,
    },
  });
  assert.equal(copyCalls, 1);
  assert.equal(deleteOptions.deletePermanently, true);
  assert.equal(gmailResult.moved, 1);
  assert.equal(gmailResult.trashVerified, true);
  assert.equal(gmailResult.sourceVerified, true);
  assert.match(gmailResult.deletionMethod, /^gmail-/);

  await assert.rejects(
    context.executeRequest({
      op: "move",
      args: { account: "account1", folder: source.id, destination: destination.id, header_message_id: original.headerMessageId, confirm: true },
    }),
    /Gmail All Mail\/Wszystkie jest zablokowana/
  );

  // Normal folders still use Thunderbird's native recoverable delete path.
  source.specialUse = ["inbox"];
  source.name = "Odebrane";
  source.path = "/INBOX";
  sourceMessages = [original];
  trashMessages = [];
  const result = await context.executeRequest({
    op: "trash",
    args: { account: "account1", folder: source.id, header_message_id: original.headerMessageId, confirm: true },
  });
  assert.equal(deleteOptions.deletePermanently, false);
  assert.equal(deleteOptions.isUserAction, true);
  assert.equal(result.moved, 1);
  assert.equal(result.permanent, false);
  assert.equal(result.trashVerified, true);
  assert.equal(result.sourceVerified, true);
  assert.equal(result.serverVerified, true);
  assert.equal(result.deletionMethod, "messages.delete(deletePermanently:false)");
  console.log("PASS Gmail All Mail Trash block and normal-folder settled verification");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
