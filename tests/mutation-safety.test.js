"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const background = fs.readFileSync(path.join(__dirname, "../extension/background.js"), "utf8");

function fixture() {
  const account = { id: "account1", name: "Work", type: "imap" };
  const folders = [
    { id: "inbox", accountId: account.id, path: "/INBOX", name: "Inbox", specialUse: ["inbox"] },
    { id: "trash", accountId: account.id, path: "/Trash", name: "Trash", specialUse: ["trash"] },
    { id: "archive", accountId: account.id, path: "/Archive", name: "Archive", specialUse: [] },
  ];
  const accounts = [account];
  let messages = [
    { id: 1, author: "target@example.com", recipients: ["other@example.com"], subject: "fixture", folderId: "inbox" },
    { id: 2, author: "other@example.com", recipients: ["target@example.com"], subject: "fixture", folderId: "inbox" },
    { id: 3, author: "other@example.com", recipients: ["other@example.com"], subject: "fixture", folderId: "inbox" },
  ];
  const mutations = [];
  const messenger = {
    accounts: { list: async () => accounts },
    folders: { query: async () => folders },
    messages: {
      query: async q => ({ messages: messages.filter(m => (!q.folderId || m.folderId === q.folderId) && (!q.author || m.author.includes(q.author)) && (!q.recipients || m.recipients.some(r => r.includes(q.recipients))) && (!q.subject || m.subject.includes(q.subject))) }),
      move: async (ids, destination) => {
        mutations.push({ ids, destination });
        messages = messages.map(m => ids.includes(m.id) ? { ...m, folderId: destination } : m);
      },
    },
  };
  const context = vm.createContext({ messenger, console, setTimeout, clearTimeout, fetch: async () => new Promise(() => {}) });
  vm.runInContext(background, context);
  return { context, messenger, account, accounts, folders, mutations };
}

test("all mutation gates reject truthy non-boolean confirmation before side effects", async () => {
  for (const op of ["create_folder", "rename_folder", "delete_folder", "compact_folder", "import_msg", "move", "trash", "restore", "empty_trash", "purge", "delete_permanently"]) {
    for (const confirm of ["false", "true", 1, {}, []]) {
      const { context } = fixture();
      await assert.rejects(context.executeRequest({ op, args: { confirm, subject: "fixture", destination: "archive", folder: "inbox", name: "test", new_name: "renamed", transfer_id: "fixture" } }), /confirm:true/, `${op} must reject ${JSON.stringify(confirm)}`);
    }
  }
});

test("bulk address filter cannot silently move unrelated messages", async () => {
  const { context, mutations } = fixture();
  await context.executeRequest({ op: "move", args: { confirm: true, subject: "fixture", address: "target@example.com", destination: "archive" } });
  assert.deepEqual(Array.from(mutations[0].ids).sort(), [1, 2]);
});

test("recipient-only filters are valid mutation filters", async () => {
  const { context, mutations } = fixture();
  await context.executeRequest({ op: "move", args: { confirm: true, recipient: "target@example.com", destination: "archive" } });
  assert.deepEqual(Array.from(mutations[0].ids), [2]);
});

test("continuations reject changed recipient and subfolder scope without consuming token", async () => {
  for (const changed of [{ to: "target@example.com" }, { includeSubFolders: true }, { address: "target@example.com" }]) {
    const { context, mutations } = fixture();
    const args = { confirm: true, subject: "fixture", destination: "archive", batch_size: 1 };
    const first = await context.executeRequest({ op: "move", args });
    assert.equal(first.more, true);
    await assert.rejects(context.executeRequest({ op: "move", args: { ...args, ...changed, continuation: first.continuation } }), /continuation/);
    assert.equal(mutations.length, 1);
    const second = await context.executeRequest({ op: "move", args: { ...args, continuation: first.continuation } });
    assert.equal(second.movedTotal, 2);
  }
});

test("ambiguous folder names fail closed, stable IDs and exact paths still work", async () => {
  const { context, account, folders } = fixture();
  folders.unshift({ id: "nested-archive", accountId: account.id, path: "/Other/Archive", name: "Archive" });
  await assert.rejects(context.resolveFolder(account, "Archive"), /[Nn]iejednoznacz/);
  assert.equal((await context.resolveFolder(account, "archive")).id, "archive");
  assert.equal((await context.resolveFolder(account, "/Archive")).id, "archive");
});

test("ambiguous account names fail closed and exact IDs beat substring names", async () => {
  const { context, accounts } = fixture();
  accounts.unshift({ id: "account2", name: "Work account1", type: "imap" });
  await assert.rejects(context.resolveAccount({ account: "Work" }), /[Nn]iejednoznacz/);
  assert.equal((await context.resolveAccount({ account: "account1" })).id, "account1");
});

test("inbox search cannot silently widen to entire account when inbox is missing", async () => {
  const { context, folders } = fixture();
  folders.splice(0, 1);
  await assert.rejects(context.buildMessageQuery({}), /Inbox/);
  assert.equal((await context.buildMessageQuery({ scope: "account" })).query.folderId, undefined);
});

test("empty_trash never reports verification when matching messages remain", async () => {
  const { context, messenger } = fixture();
  messenger.mailbridge = { emptyTrashAndRefresh: async () => true };
  messenger.messages.query = async () => ({ messages: [{ id: 99 }] });
  const result = await context.executeRequest({ op: "empty_trash", args: { confirm: true } });
  assert.equal(result.serverVerified, false);
  assert.equal(result.status, "verification_failed");
});

test("purge cannot claim verified server deletion if native compaction was skipped", async () => {
  const { context, messenger } = fixture();
  messenger.mailbridge = { compactAndRefresh: async () => ({ skipped: true }) };
  messenger.messages.delete = async () => {};
  const result = await context.executeRequest({ op: "purge", args: { confirm: true, subject: "fixture" } });
  assert.equal(result.serverVerified, false);
  assert.equal(result.pendingExpunge, true);
  assert.equal(result.status, "server_expunge_not_confirmed");
});

test("address query clears stale sender/recipient aliases in its OR branches", async () => {
  const { context } = fixture();
  const result = await context.searchMessages({ address: "target@example.com", author: "unrelated@example.com", recipient: "unrelated@example.com" });
  assert.deepEqual(Array.from(result.messages, m => m.id).sort(), [1, 2]);
});

test("purge verification uses the same address filter as mutation selection", async () => {
  const { context, messenger, account } = fixture();
  account.type = "none";
  let matchingPresent = true;
  messenger.messages.query = async q => ({ messages: (q.author || q.recipients) ? (matchingPresent ? [{ id: 1 }] : []) : [{ id: 3 }] });
  messenger.messages.delete = async ids => { assert.deepEqual(Array.from(ids), [1]); matchingPresent = false; };
  const result = await context.executeRequest({ op: "purge", args: { confirm: true, subject: "fixture", address: "target@example.com" } });
  assert.equal(result.localVerified, true);
  assert.equal(result.deletedPermanently, 1);
});

test("ambiguous special-use or fallback folders fail closed", async () => {
  for (const specialUse of ["inbox", "trash"]) {
    for (const flagged of [false, true]) {
      const { context, account, folders } = fixture();
      const original = folders.find(f => f.id === specialUse);
      original.specialUse = flagged ? [specialUse] : [];
      folders.push({ id: `other-${specialUse}`, accountId: account.id, name: original.name, path: `/Other/${original.name}`, specialUse: flagged ? [specialUse] : [] });
      await assert.rejects(context.resolveSpecialFolder(account, specialUse, [original.name]), /[Nn]iejednoznacz/);
    }
  }
});

test("continuations bind the resolved destination ID for move, trash and restore", async () => {
  for (const op of ["move", "trash", "restore"]) {
    const { context, messenger, folders, mutations } = fixture();
    messenger.messages.query = async () => ({ messages: [{ id: 1 }, { id: 2 }] });
    const args = { confirm: true, subject: "fixture", batch_size: 1, ...(op === "move" ? { destination: "Archive" } : {}) };
    const first = await context.executeRequest({ op, args });
    assert.equal(first.more, true);
    const destination = folders.find(f => f.id === (op === "move" ? "archive" : op === "trash" ? "trash" : "inbox"));
    const originalId = destination.id;
    destination.id = `${originalId}-replacement`;
    await assert.rejects(context.executeRequest({ op, args: { ...args, continuation: first.continuation } }), /continuation/);
    assert.equal(mutations.length, 1);
    destination.id = originalId;
    const second = await context.executeRequest({ op, args: { ...args, continuation: first.continuation } });
    assert.equal(second.processed, 1);
    assert.equal(mutations.length, 2);
  }
});
