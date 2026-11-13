"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const background = fs.readFileSync(path.join(__dirname, "../extension/background.js"), "utf8");
const experiment = fs.readFileSync(path.join(__dirname, "../extension/mailbridge.js"), "utf8");

// ---- Experiment (mailbridge.js) with mocked XPCOM ----

function nativeFixture({ locked = false, offline = false, pendingOps = 0, shownUri = "", virtual = false, maildir = false, imap = true, lockedPolls = 0 } = {}) {
  const calls = [];
  // A local reparse locks the folder only after updateFolder() starts it.
  let remainingLockedPolls = 0;
  const isLocked = locked;
  const store = {
    exists: () => true,
    isDirectory: () => maildir,
    remove: recursive => calls.push(`store.remove(${recursive})`),
  };
  const db = {
    set summaryValid(value) { calls.push(`summaryValid=${value}`); },
    listAllOfflineOpIds: () => Array.from({ length: pendingOps }, (_, i) => i),
  };
  const folder = {
    URI: "imap://user@imap.test/studia",
    name: "studia",
    localizedName: "studia",
    isServer: false,
    parent: {},
    server: { type: imap ? "imap" : "none" },
    get locked() {
      if (isLocked) return true;
      if (remainingLockedPolls > 0) { remainingLockedPolls--; return true; }
      return false;
    },
    supportsOffline: imap,
    filePath: store,
    msgDatabase: db,
    getFlag: flag => virtual && flag === 0x20,
    getTotalMessages: () => 67,
    closeAndBackupFolderDB: () => calls.push("closeAndBackupFolderDB"),
    ForceDBClosed: () => calls.push("ForceDBClosed"),
    updateFolder: () => { calls.push("updateFolder"); remainingLockedPolls = lockedPolls; },
    updateFolderWithListener: (_, listener) => {
      calls.push("updateFolderWithListener");
      setImmediate(() => listener.onStopRunningUrl(null, 0));
    },
    // Anything destructive would show up here.
    deleteMessages: () => calls.push("deleteMessages"),
    deleteSelf: () => calls.push("deleteSelf"),
  };
  const sandbox = {
    ChromeUtils: {
      importESModule: url => url.includes("Timer")
        ? { setTimeout: (fn, ms) => setTimeout(fn, ms >= 60000 ? ms : 0), clearTimeout }
        : { MailServices: { mfn: { notifyFolderReindexTriggered: () => calls.push("notifyFolderReindexTriggered") } } },
      generateQI: () => () => {},
    },
    Components: {
      interfaces: { nsMsgFolderFlags: { Virtual: 0x20 } },
      isSuccessCode: status => status === 0,
    },
    Services: {
      io: { offline },
      wm: {
        getEnumerator: () => [{
          document: { getElementById: () => ({ tabInfo: [{ folder: shownUri ? { URI: shownUri } : null }] }) },
        }],
      },
    },
    ExtensionCommon: { ExtensionAPI: class {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(experiment, sandbox);
  const api = new sandbox.mailbridge().getAPI({ extension: { folderManager: { get: () => folder } } }).mailbridge;
  return { api, calls, folder };
}

const destructive = calls => calls.filter(call => /store\.remove|summaryValid|closeAndBackup|ForceDBClosed|update|delete/i.test(call));

test("busy folder: refused in Polish, nothing touched", async () => {
  const f = nativeFixture({ locked: true });
  const result = await f.api.repairFolder("account1", "/studia");
  assert.equal(result.started, false);
  assert.equal(result.busy, true);
  assert.match(result.error, /inny proces ma do niego dostęp/);
  assert.match(result.error, /spróbuj ponownie za kilka minut/);
  assert.deepEqual(destructive(f.calls), []);
});

for (const [name, options, pattern] of [
  ["offline", { offline: true }, /trybie offline/],
  ["pending offline operations", { pendingOps: 2 }, /2 niewysłanych operacji offline/],
  ["shown in a tab", { shownUri: "imap://user@imap.test/studia" }, /otwarty w karcie/],
  ["virtual folder", { virtual: true }, /wyszukiwanie zapisane/],
  ["maildir store", { maildir: true }, /maildir/],
]) {
  test(`refuses when ${name}, before touching anything`, async () => {
    const f = nativeFixture(options);
    const result = await f.api.repairFolder("account1", "/studia");
    assert.equal(result.started, false);
    assert.match(result.error, pattern);
    assert.deepEqual(destructive(f.calls), []);
  });
}

test("IMAP repair mirrors the Repair Folder UI and never deletes messages", async () => {
  const f = nativeFixture();
  const result = await f.api.repairFolder("account1", "/studia");
  assert.equal(result.error, "");
  assert.equal(result.started, true);
  assert.equal(result.completed, true);
  assert.equal(result.offlineStoreRemoved, true);
  assert.equal(result.beforeTotal, 67);
  assert.deepEqual(f.calls, [
    "store.remove(false)",
    "notifyFolderReindexTriggered",
    "summaryValid=false",
    "closeAndBackupFolderDB",
    "updateFolderWithListener",
  ]);
  assert.ok(!f.calls.some(call => /deleteMessages|deleteSelf/.test(call)));
});

test("local folder repair reparses without removing the mbox and waits for the lock", async () => {
  const f = nativeFixture({ imap: false, lockedPolls: 3 });
  const result = await f.api.repairFolder("account1", "/studia");
  assert.equal(result.started, true);
  assert.equal(result.completed, true);
  assert.equal(result.offlineStoreRemoved, false);
  assert.deepEqual(f.calls, ["notifyFolderReindexTriggered", "summaryValid=false", "closeAndBackupFolderDB", "updateFolder"]);
});

// ---- background.js repair_folder op ----

const studia = { id: "account1://studia", accountId: "account1", name: "studia", path: "/studia", specialUse: [] };
const allMail = { id: "account1://[Gmail]/All Mail", accountId: "account1", name: "Wszystkie", path: "/[Gmail]/All Mail", specialUse: ["archives"] };

function backgroundFixture(repairFolder, options = {}) {
  let records = [1, 2, 3, 1].map((n, i) => ({ id: i + 1, headerMessageId: `m${n}@x.test`, folder: studia }));
  const calls = [];
  const messenger = {
    accounts: { list: async () => [{ id: "account1", name: "Gmail", type: "imap" }] },
    folders: { query: async () => [studia, allMail] },
    messages: {
      query: async q => ({
        messages: options.afterRepair && calls.length ? options.afterRepair() : records.filter(m => m.folder.id === q.folderId),
      }),
    },
    mailbridge: repairFolder ? {
      repairFolder: async (...args) => {
        calls.push(args);
        const result = await repairFolder();
        if (result.started) records = records.slice(0, 3);
        return result;
      },
    } : {},
    runtime: { getManifest: () => ({ version: "test" }) },
  };
  const context = vm.createContext({ messenger, console, setTimeout, clearTimeout, fetch: async () => new Promise(() => {}) });
  vm.runInContext(background, context);
  vm.runInContext("REPAIR_SETTLE_INITIAL_DELAY_MS = 5; REPAIR_SETTLE_MAX_DELAY_MS = 20;", context);
  if (options.settleTimeoutMs) vm.runInContext(`REPAIR_SETTLE_TIMEOUT_MS = ${options.settleTimeoutMs};`, context);
  return { run: args => context.executeRequest({ op: "repair_folder", args }), calls, context };
}

const ok = { error: "", busy: false, started: true, completed: true, beforeTotal: 4, afterTotal: 3, offlineStoreRemoved: true };

test("repair_folder requires confirm:true", async () => {
  const f = backgroundFixture(async () => ok);
  await assert.rejects(f.run({ folder: "studia" }), /confirm:true/);
  assert.equal(f.calls.length, 0);
});

test("repair_folder reports before/after unique counts and never claims deletions", async () => {
  const f = backgroundFixture(async () => ok);
  const result = await f.run({ folder: "studia", confirm: true });
  assert.deepEqual(Array.from(f.calls[0]), ["account1", "/studia"]);
  assert.equal(result.repaired, true);
  assert.equal(result.messagesDeleted, false);
  assert.equal(result.before.records, 4);
  assert.equal(result.before.uniqueMessages, 3);
  assert.equal(result.before.duplicateRecords, 1);
  assert.equal(result.after.records, 3);
  assert.equal(result.after.duplicateRecords, 0);
});

test("a busy folder surfaces the Polish retry-later error", async () => {
  const busy = { ...ok, started: false, completed: false, busy: true, error: "Folder „studia” jest zajęty: inny proces ma do niego dostęp. Spróbuj ponownie za kilka minut." };
  const f = backgroundFixture(async () => busy);
  await assert.rejects(f.run({ folder: "studia", confirm: true }), /inny proces ma do niego dostęp.*ponownie/);
});

test("an unfinished rebuild is reported as not completed, not as an error", async () => {
  const f = backgroundFixture(async () => ({ ...ok, completed: false }));
  const result = await f.run({ folder: "studia", confirm: true });
  assert.equal(result.repaired, false);
  assert.equal(result.completed, false);
  assert.match(result.warning, /nie zostały usunięte/);
});

test("Gmail All Mail needs allow_all_mail:true", async () => {
  const f = backgroundFixture(async () => ok);
  await assert.rejects(f.run({ folder: allMail.id, confirm: true }), /allow_all_mail/);
  assert.equal(f.calls.length, 0);
});

test("missing experiment gives a clear error; repair_folder is a long mutation", async () => {
  const f = backgroundFixture(null);
  await assert.rejects(f.run({ folder: "studia", confirm: true }), /niedostępna/);
  assert.equal(vm.runInContext('operationTimeoutMs("repair_folder")', f.context), 20 * 60 * 1000);
  assert.equal(vm.runInContext('MUTATING_OPERATIONS.has("repair_folder")', f.context), true);
});

// Live regression (Gmail label): Thunderbird reported the rebuild done after
// 185 ms while the new index still had 0 records; 67 appeared seconds later.
function gmailLabel(count) {
  return Array.from({ length: count }, (_, i) => ({ id: 100 + i, headerMessageId: `g${i}@x.test`, folder: studia }));
}

test("repair_folder waits for the rebuilt index instead of reporting 0 records", async () => {
  let t0 = 0;
  const f = backgroundFixture(async () => { t0 = Date.now(); return ok; }, {
    afterRepair: () => (Date.now() - t0 < 120 ? [] : gmailLabel(67)),
  });
  const result = await f.run({ folder: "studia", confirm: true });
  assert.equal(result.before.records, 4);
  assert.equal(result.after.records, 67);
  assert.equal(result.lastObservedRecords, 67);
  assert.equal(result.completed, true);
  assert.equal(result.repaired, true);
  assert.equal(result.rebuildInProgress, false);
  assert.equal(result.warning, undefined);
  assert.ok(result.settleChecks >= 3, `expected several checks, got ${result.settleChecks}`);
});

test("a rebuild that never stabilises is reported as in progress with the last count", async () => {
  let n = 0;
  const f = backgroundFixture(async () => ok, {
    settleTimeoutMs: 200,
    afterRepair: () => gmailLabel(n++ % 2 ? 0 : 10 + n),
  });
  const result = await f.run({ folder: "studia", confirm: true });
  assert.equal(result.completed, false);
  assert.equal(result.repaired, false);
  assert.equal(result.rebuildInProgress, true);
  assert.match(result.warning, /Przebudowa indeksu trwa — sprawdź ponownie za chwilę/);
  assert.equal(result.lastObservedRecords, result.after.records);
  assert.match(result.warning, new RegExp(`rekordów: ${result.after.records}`));
});

test("0 records after repair is never final when the folder had records before", async () => {
  const f = backgroundFixture(async () => ok, { settleTimeoutMs: 150, afterRepair: () => [] });
  const result = await f.run({ folder: "studia", confirm: true });
  assert.equal(result.after.records, 0);
  assert.equal(result.completed, false);
  assert.equal(result.rebuildInProgress, true);
  assert.match(result.warning, /Przebudowa indeksu trwa/);
  assert.match(result.warning, /rekordów: 0 \(przed naprawą: 4\)/);
});
