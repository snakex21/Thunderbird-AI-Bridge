"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const background = fs.readFileSync(path.join(__dirname, "../extension/background.js"), "utf8");

function fixture() {
  const folder = { id: "account1://INBOX", accountId: "account1", name: "Inbox", path: "/INBOX", specialUse: ["inbox"] };
  const messages = Array.from({ length: 30 }, (_, i) => ({
    id: i + 1, headerMessageId: `m${i + 1}@test`, author: "a@b.test", subject: `s${i + 1}`,
    date: new Date(Date.UTC(2026, 0, 1 + i)), folder,
  }));
  const stats = { calls: 0, active: 0, peak: 0 };
  const messenger = {
    accounts: { list: async () => [{ id: "account1", name: "Work", type: "imap" }] },
    folders: { query: async () => [folder] },
    messages: {
      query: async () => ({ messages }),
      get: async id => messages.find(m => m.id === id),
      listAttachments: async id => {
        stats.calls++;
        stats.active++;
        stats.peak = Math.max(stats.peak, stats.active);
        await new Promise(resolve => setImmediate(resolve));
        stats.active--;
        return id % 2 ? [{ name: "invoice.pdf", contentType: "application/pdf", size: 10, partName: "1.2" }] : [];
      },
      listInlineTextParts: async () => [{ contentType: "text/plain", content: "body" }],
    },
    runtime: { getManifest: () => ({ version: "test" }) },
  };
  const context = vm.createContext({ messenger, console, setTimeout, clearTimeout, fetch: async () => new Promise(() => {}) });
  vm.runInContext(background, context);
  return { context, stats };
}

test("search does not list attachments unless include_attachments:true", async () => {
  const { context, stats } = fixture();
  const result = await context.executeRequest({ op: "search", args: { limit: 100 } });
  assert.equal(result.count, 30);
  assert.equal(result.attachmentsIncluded, false);
  assert.equal(stats.calls, 0);
  assert.equal(result.messages[0].attachments, undefined);
});

test("include_attachments lists metadata with bounded concurrency", async () => {
  const { context, stats } = fixture();
  const result = await context.executeRequest({ op: "search", args: { limit: 100, include_attachments: true } });
  assert.equal(result.attachmentsIncluded, true);
  assert.equal(stats.calls, 30);
  assert.ok(stats.peak <= 6, `peak concurrency ${stats.peak}`);
  const withAttachment = result.messages.find(m => m.id === 29);
  assert.equal(withAttachment.hasAttachments, true);
  assert.equal(withAttachment.attachments[0].extension, "pdf");
});

test("read still returns attachment metadata", async () => {
  const { context, stats } = fixture();
  const result = await context.executeRequest({ op: "read", args: { message_id: 1 } });
  assert.equal(stats.calls, 1);
  assert.equal(result.message.attachmentCount, 1);
});
