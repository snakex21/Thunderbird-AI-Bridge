"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const background = fs.readFileSync(path.join(__dirname, "../extension/background.js"), "utf8");

function fixture({ movesToTrash }) {
  const account = { id: "account3", name: "Local Folders", type: "none" };
  let folders = [
    { id: "account3://Trash", accountId: "account3", name: "Trash", path: "/Trash", specialUse: ["trash"] },
    { id: "account3://Stare", accountId: "account3", name: "Stare", path: "/Stare", specialUse: [] },
  ];
  const messenger = {
    accounts: { list: async () => [account] },
    folders: {
      query: async () => folders,
      delete: async id => {
        const folder = folders.find(item => item.id === id);
        folders = folders.filter(item => item.id !== id);
        if (movesToTrash) folders.push({ ...folder, id: `account3://Trash/${folder.name}`, path: `/Trash/${folder.name}` });
      },
    },
    runtime: { getManifest: () => ({ version: "test" }) },
  };
  const context = vm.createContext({ messenger, console, setTimeout: fn => setTimeout(fn, 0), clearTimeout, fetch: async () => new Promise(() => {}) });
  vm.runInContext(background, context);
  return { context };
}

test("Local Folders delete that lands in Trash reports movedToTrash and the new path", async () => {
  const { context } = fixture({ movesToTrash: true });
  const result = await context.executeRequest({ op: "delete_folder", args: { confirm: true, folder: "Stare" } });
  assert.equal(result.deleted, false);
  assert.equal(result.movedToTrash, true);
  assert.equal(result.newPath, "/Trash/Stare");
  assert.equal(result.trashedFolder.id, "account3://Trash/Stare");
});

test("a real delete still reports deleted:true", async () => {
  const { context } = fixture({ movesToTrash: false });
  const result = await context.executeRequest({ op: "delete_folder", args: { confirm: true, folder: "Stare" } });
  assert.equal(result.deleted, true);
  assert.equal(result.movedToTrash, false);
});
