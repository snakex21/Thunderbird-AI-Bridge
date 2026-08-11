"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const extensionRoot = path.resolve(__dirname, "..", "extension");
const longPlainBody = `Plain body wins.\n${"x".repeat(1400)}`;

const messenger = {
  messages: {
    get: async (id) => ({
      id,
      author: "Sender <sender@example.com>",
      recipients: ["reader@example.com"],
      subject: id === 1 ? "Multipart" : "HTML only",
      date: new Date("2026-08-11T12:00:00Z"),
      read: false,
      folder: { id: "account1://INBOX", accountId: "account1", name: "Inbox", path: "/INBOX" },
    }),
    listAttachments: async () => [],
    listInlineTextParts: async (id) => id === 1
      ? [
          { contentType: "text/plain", content: longPlainBody },
          { contentType: "text/html", content: "<p>HTML alternative must not be duplicated.</p>" },
        ]
      : [{ contentType: "text/html", content: "<p>Hello <b>HTML</b></p>" }],
    getFull: async () => { throw new Error("getFull fallback should not be needed"); },
  },
  messengerUtilities: {
    convertToPlainText: async (html) => html.replace(/<[^>]+>/g, "").trim(),
  },
  accounts: { list: async () => [] },
  folders: {},
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
vm.runInContext(fs.readFileSync(path.join(extensionRoot, "background.js"), "utf8"), context, {
  filename: "background.js",
});

(async () => {
  const first = await context.executeRequest({
    op: "read",
    args: { message_id: 1, max_chars: 500 },
  });
  assert.equal(first.bodyFormat, "plain");
  assert.equal(first.body.length, 500);
  assert.equal(first.hasMore, true);
  assert.equal(first.nextStartChar, 500);
  assert.equal(first.readStateChanged, false);
  assert.match(first.body, /^Plain body wins\./);
  assert.doesNotMatch(first.body, /HTML alternative/);

  const second = await context.executeRequest({
    op: "read",
    args: { message_id: 1, max_chars: 500, start_char: first.nextStartChar },
  });
  assert.equal(second.startChar, 500);
  assert.equal(second.body.length, 500);

  const html = await context.executeRequest({ op: "read", args: { message_id: 2 } });
  assert.equal(html.bodyFormat, "html-converted");
  assert.equal(html.body, "Hello HTML");
  console.log("PASS Thunderbird message body read, HTML conversion and paging");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
