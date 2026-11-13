"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const background = fs.readFileSync(path.join(__dirname, "../extension/background.js"), "utf8");

// Thunderbird's author/recipients query only matches full addresses or names,
// so the mock mirrors that: a bare domain never matches through the query.
function tbAddressMatches(values, wanted) {
  const needle = String(wanted).toLowerCase();
  return values.some(value => {
    const raw = String(value).toLowerCase();
    const email = (raw.match(/[^\s<>"]+@[^\s<>"]+/) || [""])[0];
    return needle.includes("@") ? email === needle : raw.replace(email, "").includes(needle);
  });
}

function fixture() {
  const account = { id: "account1", name: "Work", type: "imap" };
  const folders = [
    { id: "account1://INBOX", accountId: account.id, path: "/INBOX", name: "Inbox", specialUse: ["inbox"] },
    { id: "account1://Archive", accountId: account.id, path: "/Archive", name: "Archive", specialUse: [] },
  ];
  const at = day => new Date(`2026-03-${String(day).padStart(2, "0")}T10:00:00Z`);
  let messages = [
    { id: 1, author: "Alice <alice@Example.COM>", recipients: ["me@home.test"], subject: "a", date: at(1) },
    { id: 2, author: "Bob <bob@mail.example.com>", recipients: ["me@home.test"], subject: "b", date: at(5) },
    { id: 3, author: "Eve <eve@notexample.com>", recipients: ["me@home.test"], subject: "c", date: at(3) },
    { id: 4, author: "Mallory <m@example.com.evil.org>", recipients: ["me@home.test"], subject: "d", date: at(4) },
    { id: 5, author: "me@home.test", recipients: ["Carol <carol@example.com>"], subject: "e", date: at(2) },
    { id: 6, author: "me@home.test", recipients: ["x@other.test"], ccList: ["Dan <dan@EXAMPLE.com>"], subject: "f", date: at(6) },
    { id: 7, author: "J.Smith <js@other.test>", recipients: ["me@home.test"], subject: "g", date: at(7) },
  ].map(m => ({ ...m, folderId: "account1://INBOX", headerMessageId: `m${m.id}@test` }));
  const moved = [];
  const queries = [];
  const messenger = {
    accounts: { list: async () => [account] },
    folders: { query: async () => folders },
    messages: {
      query: async q => {
        queries.push(q);
        return {
          messages: messages
            .filter(m => !q.folderId || m.folderId === q.folderId)
            .filter(m => !q.author || tbAddressMatches([m.author], q.author))
            .filter(m => !q.recipients || tbAddressMatches(m.recipients, q.recipients))
            .map(m => ({ ...m, folder: folders.find(f => f.id === m.folderId) })),
        };
      },
      move: async (ids, destination) => {
        moved.push(...ids);
        messages = messages.map(m => ids.includes(m.id) ? { ...m, folderId: destination } : m);
      },
    },
    runtime: { getManifest: () => ({ version: "test" }) },
  };
  const context = vm.createContext({ messenger, console, setTimeout: fn => setTimeout(fn, 0), clearTimeout, fetch: async () => new Promise(() => {}) });
  vm.runInContext(background, context);
  return { context, moved, queries };
}

const ids = result => Array.from(result.messages, m => m.id).sort((a, b) => a - b);

test("from by bare domain or @domain matches exact domain and subdomains only", async () => {
  for (const from of ["example.com", "@example.com", "EXAMPLE.COM"]) {
    const { context, queries } = fixture();
    const result = await context.executeRequest({ op: "search", args: { from, limit: 100 } });
    assert.deepEqual(ids(result), [1, 2], from);
    assert.equal(queries[0].author, undefined, "domain must not be sent as Thunderbird author query");
  }
});

test("to by domain covers To and Cc; count and address use the same rules", async () => {
  const { context } = fixture();
  assert.deepEqual(ids(await context.executeRequest({ op: "search", args: { to: "@example.com" } })), [5, 6]);
  const count = await context.executeRequest({ op: "count", args: { from: "example.com" } });
  assert.equal(count.count, 2);
  const address = await context.executeRequest({ op: "search", args: { address: "@example.com" } });
  assert.deepEqual(ids(address), [1, 2, 5, 6]);
  const addressCount = await context.executeRequest({ op: "count", args: { address: "example.com" } });
  assert.equal(addressCount.count, 4);
});

test("senders aggregates domain-filtered messages", async () => {
  const { context } = fixture();
  const result = await context.executeRequest({ op: "senders", args: { from: "@example.com" } });
  assert.equal(result.totalMessages, 2);
  assert.deepEqual(Array.from(result.senders, s => s.author).sort(), ["Alice <alice@Example.COM>", "Bob <bob@mail.example.com>"]);
});

test("full addresses and names still use Thunderbird's query", async () => {
  const { context, queries } = fixture();
  const result = await context.executeRequest({ op: "search", args: { from: "alice@example.com" } });
  assert.equal(queries[0].author, "alice@example.com");
  assert.deepEqual(ids(result), [1]);
  // A dotted display-name fragment is not lost when it looks like a domain.
  assert.deepEqual(ids(await context.executeRequest({ op: "search", args: { from: "j.smith" } })), [7]);
});

test("bulk move by domain selects only matching messages", async () => {
  const { context, moved } = fixture();
  const dry = await context.executeRequest({ op: "move", args: { confirm: true, from: "@example.com", destination: "Archive", dry_run: true } });
  assert.equal(dry.wouldProcess, 2);
  assert.equal(moved.length, 0);
  await context.executeRequest({ op: "move", args: { confirm: true, address: "example.com", destination: "Archive" } });
  assert.deepEqual(moved.slice().sort((a, b) => a - b), [1, 2, 5, 6]);
});

test("search results are newest-first and the limit keeps the newest", async () => {
  const { context } = fixture();
  const all = await context.executeRequest({ op: "search", args: { limit: 100 } });
  assert.deepEqual(Array.from(all.messages, m => m.id), [7, 6, 2, 4, 3, 5, 1]);
  const top = await context.executeRequest({ op: "search", args: { limit: 2 } });
  assert.deepEqual(Array.from(top.messages, m => m.id), [7, 6]);
  const address = await context.executeRequest({ op: "search", args: { address: "me@home.test", limit: 3 } });
  assert.deepEqual(Array.from(address.messages, m => m.id), [7, 6, 2]);
});
