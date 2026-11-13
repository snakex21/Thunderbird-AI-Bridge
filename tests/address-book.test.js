"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const extensionRoot = path.resolve(__dirname, "..", "extension");
const inbox = {
  id: "account1://INBOX",
  accountId: "account1",
  name: "Inbox",
  path: "/INBOX",
  specialUse: ["inbox"],
};
const account = {
  id: "account1",
  name: "dad@example.test",
  type: "imap",
  identities: [{ email: "dad@example.test" }],
  rootFolder: { id: "account1://", accountId: "account1", name: "Root", path: "/", specialUse: [] },
};
let serial = 10;
const books = [{
  id: "book-personal",
  name: "Personal Address Book",
  type: "addressBook",
  readOnly: false,
  remote: false,
  contacts: [{
    id: "contact-alice",
    parentId: "book-personal",
    type: "contact",
    properties: { DisplayName: "Alice Example", PrimaryEmail: "alice@example.test" },
  }],
}];

const messenger = {
  runtime: { getManifest: () => ({ version: "0.9.32" }) },
  accounts: { list: async () => [account] },
  folders: { query: async () => [inbox] },
  messages: {
    query: async () => ({ messages: [
      { id: 1, author: "Alice Example <alice@example.test>", recipients: ["Dad <dad@example.test>"], ccList: [] },
      { id: 2, author: "Dad <dad@example.test>", recipients: ["Bob Example <bob@example.test>"], ccList: [] },
      { id: 3, author: "Alice Example <alice@example.test>", recipients: ["Bob Example <bob@example.test>"], ccList: [] },
    ] }),
  },
  addressBooks: {
    list: async () => books,
    create: async ({ name }) => {
      const id = `book-${++serial}`;
      books.push({ id, name, type: "addressBook", readOnly: false, remote: false, contacts: [] });
      return id;
    },
    get: async (id) => books.find(book => book.id === id),
  },
  contacts: {
    list: async (parentId) => books.find(book => book.id === parentId)?.contacts || [],
    create: async (parentId, properties) => {
      const book = books.find(item => item.id === parentId);
      assert.ok(book, "contact destination address book must exist");
      const id = `contact-${++serial}`;
      book.contacts.push({ id, parentId, type: "contact", properties });
      return id;
    },
    update: async (id, properties) => {
      for (const book of books) {
        const contact = book.contacts.find(item => item.id === id);
        if (contact) {
          contact.properties = properties;
          return;
        }
      }
      throw new Error(`unknown contact ${id}`);
    },
  },
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
  const status = await context.executeRequest({ op: "status", args: {} });
  assert.equal(status.addressBookAvailable, true);

  const candidates = await context.executeRequest({
    op: "contact_candidates",
    args: { account: account.id, folder: inbox.id, limit: 20 },
  });
  assert.equal(candidates.scannedMessages, 3);
  assert.equal(
    Array.from(candidates.candidates, item => item.email).sort().join(","),
    "alice@example.test,bob@example.test",
    "the account owner's address must be excluded from candidates",
  );

  const createdBook = await context.executeRequest({
    op: "create_address_book",
    args: { name: "Kontakty z poczty taty", confirm: true },
  });
  assert.equal(createdBook.created, true);

  const imported = await context.executeRequest({
    op: "add_contacts",
    args: {
      address_book: "Kontakty z poczty taty",
      confirm: true,
      contacts: [
        { name: "Alice Example", email: "alice@example.test" },
        { name: "Bob Example", email: "bob@example.test" },
        { name: "Broken", email: "not-an-email" },
      ],
    },
  });
  assert.equal(imported.createdCount, 2, "a contact in another book may also be added to the dedicated book");
  assert.equal(imported.skippedCount, 1);
  assert.deepEqual(Array.from(imported.created, item => item.email), ["alice@example.test", "bob@example.test"]);

  const retry = await context.executeRequest({
    op: "add_contacts",
    args: {
      address_book: createdBook.addressBook.id,
      confirm: true,
      contacts: [{ name: "Bob Example", email: "BOB@example.test" }],
    },
  });
  assert.equal(retry.createdCount, 0, "a retry must not duplicate an existing email address");
  assert.equal(retry.skippedCount, 1);

  const updated = await context.executeRequest({
    op: "update_contact",
    args: { contact_id: retry.skipped[0].email === "bob@example.test" ? imported.created[1].id : "", name: "Robert Example", confirm: true },
  });
  assert.equal(updated.contact.name, "Robert Example");
  assert.equal(updated.contact.email, "bob@example.test");
  console.log("PASS Thunderbird address-book candidates, per-book deduplication and contact editing");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
