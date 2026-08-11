"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const extensionRoot = path.resolve(__dirname, "..", "extension");
const account = {
  id: "account1",
  name: "Test IMAP",
  type: "imap",
  rootFolder: { id: "account1://", accountId: "account1", name: "Root", path: "/", specialUse: [] },
};
let folders = [];
let serial = 0;

const messenger = {
  accounts: {
    list: async () => [account],
  },
  folders: {
    query: async ({ accountId }) => folders.filter((folder) => folder.accountId === accountId),
    create: async (destination, name) => {
      assert.equal(destination, account.rootFolder.id, "create must use the stable root folder id");
      const folder = {
        id: `account1://folder-${++serial}`,
        accountId: account.id,
        name,
        path: `/${name}`,
        specialUse: [],
        capabilities: { canAddSubfolders: true, canBeDeleted: true, canBeRenamed: true },
      };
      folders.push(folder);
      return { ...folder };
    },
    rename: async () => { throw new Error("IMAP rename must use the native bridge"); },
    delete: async () => {
      throw new Error("IMAP delete must use the native bridge");
    },
  },
  mailbridge: {
    renameFolderAndRefresh: async (accountId, folderPath, newName) => {
      assert.equal(accountId, account.id);
      const folder = folders.find((item) => item.path === folderPath);
      assert.ok(folder);
      folder.name = newName;
      folder.path = `/${newName}`;
      folder.id = `account1://folder-${++serial}`;
      return "";
    },
    deleteFolderAndRefresh: async (accountId, folderPath) => {
      assert.equal(accountId, account.id);
      folders = folders.filter((folder) => folder.path !== folderPath);
      return "";
    },
    compactAndRefresh: async (accountId, folderPath) => {
      assert.equal(accountId, account.id);
      assert.ok(folders.some((folder) => folder.path === folderPath));
      return { beforeBytes: 1000, afterBytes: 400, reclaimedBytes: 600 };
    },
  },
  messages: {},
};

const context = vm.createContext({
  messenger,
  console,
  setTimeout,
  clearTimeout,
  URLSearchParams,
  fetch: async () => new Promise(() => {}),
});
const background = fs.readFileSync(path.join(extensionRoot, "background.js"), "utf8");
vm.runInContext(background, context, { filename: "background.js" });

(async () => {
  const created = await context.executeRequest({
    op: "create_folder",
    args: { name: "CRUD test", confirm: true },
  });
  assert.equal(created.created.name, "CRUD test");

  const renamed = await context.executeRequest({
    op: "rename_folder",
    args: { folder: created.created.id, new_name: "CRUD renamed", confirm: true },
  });
  assert.equal(renamed.renamed.name, "CRUD renamed");

  const compacted = await context.executeRequest({
    op: "compact_folder",
    args: { folder: renamed.renamed.id, confirm: true },
  });
  assert.equal(compacted.compacted, true);
  assert.equal(compacted.reclaimedBytes, 600);
  assert.equal(compacted.messagesChanged, false);

  const deleted = await context.executeRequest({
    op: "delete_folder",
    args: { folder: renamed.renamed.id, confirm: true },
  });
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.serverVerified, true);
  assert.equal(folders.length, 0);
  console.log("PASS Thunderbird folder create -> rename -> compact -> native IMAP delete");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
