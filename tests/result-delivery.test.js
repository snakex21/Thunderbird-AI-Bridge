"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const source = fs.readFileSync(process.env.THUNDERBIRD_EXTENSION_SOURCE || path.join(__dirname, "../extension/background.js"), "utf8");

function fixture({ delivery = async () => ({ ok: true, status: 204 }), create, fastTimeout = false } = {}) {
  const posts = [];
  const folders = [];
  let mutations = 0;
  let now = 1000;
  const account = { id: "fake", name: "Fixture", type: "none" };
  const context = vm.createContext({
    messenger: {
      accounts: { list: async () => [account] },
      folders: {
        query: async () => folders,
        create: async (_, name) => {
          mutations++;
          if (create) await create();
          const folder = { id: `folder-${mutations}`, accountId: "fake", name, path: `/${name}` };
          folders.push(folder);
          return folder;
        },
      },
    },
    console: { warn() {}, log() {} },
    AbortController, TextEncoder,
    Date: class extends Date { static now() { return now; } },
    // Delivery delays run instantly; per-operation execution limits (>= 60 s)
    // keep their real duration and are cleared when the operation settles.
    setTimeout: (fn, ms) => setTimeout(fn, ms >= 60000 || (ms === 5000 && !fastTimeout) ? ms : 0), clearTimeout,
    fetch: async (url, options) => {
      if (url.includes("/poll?")) return new Promise(() => {});
      posts.push(options.body);
      return delivery(posts.length, options);
    },
  });
  vm.runInContext(source, context);
  return {
    context, posts, folders,
    mutations: () => mutations,
    advance: ms => { now += ms; },
    read: expression => vm.runInContext(expression, context),
    enqueue: (id = "id-1", name = "Synthetic") => context.enqueueRequest({ id, op: "create_folder", args: { confirm: true, name } }),
  };
}
async function idle(f) {
  for (let i = 0; i < 1000; i++) {
    if (!f.read("requestWorkerRunning || rejectionWorkerRunning")) return;
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  throw new Error("worker did not settle");
}

test("lost acknowledgement retries identical success without repeating mailbox mutation", async () => {
  const f = fixture({ delivery: async n => { if (n === 1) throw new Error("synthetic lost ACK"); return { ok: true, status: 204 }; } });
  f.enqueue();
  await idle(f);
  assert.equal(f.mutations(), 1);
  assert.equal(f.posts.length, 2);
  assert.equal(f.posts[0], f.posts[1]);
  assert.equal(JSON.parse(f.posts[1]).ok, true);
});

test("in-flight and completed same-ID replay executes once, even with mismatched arguments", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = fixture({ create: () => gate });
  f.enqueue(); f.enqueue("id-1", "Changed");
  release(); await idle(f);
  f.enqueue("id-1", "Changed"); await idle(f);
  assert.equal(f.mutations(), 1);
  assert.equal(f.posts.length, 2);
  assert.equal(f.posts[0], f.posts[1]);
  assert.equal(f.folders[0].name, "Synthetic");
  f.enqueue("id-2"); await idle(f);
  assert.equal(f.mutations(), 2, "new ID with identical arguments is a new operation");
});

test("delivery exhaustion and TTL never forget an unacknowledged operation", async () => {
  const f = fixture({ delivery: async () => { throw new Error("offline"); } });
  f.enqueue(); await idle(f);
  assert.equal(f.posts.length, 3);
  assert.ok(f.posts.every(body => body === f.posts[0] && JSON.parse(body).ok));
  f.advance(24 * 60 * 60 * 1000);
  f.read("pruneRequestRecords()");
  assert.equal(f.read("requestRecords.size"), 1);
  f.enqueue(); await idle(f);
  assert.equal(f.mutations(), 1);
  assert.equal(f.posts.length, 6);
});

test("terminal HTTP response stops retries without fabricating operation failure", async () => {
  const f = fixture({ delivery: async () => ({ ok: false, status: 404 }) });
  f.enqueue(); await idle(f);
  assert.equal(f.posts.length, 1);
  assert.equal(JSON.parse(f.posts[0]).ok, true);
  assert.equal(f.read("requestRecords.get('id-1').acknowledged"), false);
});

test("acknowledged cache entries expire; restart also loses deduplication", async () => {
  const f = fixture(); f.enqueue(); await idle(f);
  f.advance(5 * 60 * 1000);
  f.read("pruneRequestRecords()");
  assert.equal(f.read("requestRecords.size"), 0);
  assert.equal(f.read("resultBytes"), 0);
  f.enqueue(); await idle(f);
  assert.equal(f.mutations(), 2, "no exactly-once guarantee after retention window");
  const restarted = fixture(); restarted.enqueue(); await idle(restarted);
  assert.equal(restarted.mutations(), 1, "new process does not know old IDs");
});

test("unacknowledged ID capacity applies backpressure without evicting old IDs", async () => {
  const f = fixture({ delivery: async () => ({ ok: false, status: 404 }) });
  for (let i = 0; i < 128; i++) { f.enqueue(`id-${i}`); await idle(f); }
  const beforeOverflow = f.posts.length;
  f.enqueue("overflow"); await idle(f);
  assert.equal(f.mutations(), 128);
  assert.equal(f.read("requestRecords.size"), 128);
  assert.equal(f.posts.length, beforeOverflow + 1, "capacity denial is reported explicitly");
  const rejection = JSON.parse(f.posts.at(-1));
  assert.equal(rejection.id, "overflow");
  assert.equal(rejection.ok, false);
  assert.equal(rejection.notExecuted, true);
  assert.match(rejection.error, /NOT executed/);
  assert.equal(f.read("rejectedRequests.has('overflow')"), true, "rejection is retained");
  f.enqueue("id-0"); await idle(f);
  assert.equal(f.mutations(), 128);
});

test("reserve result memory before executing and never exceed byte budget", async () => {
  const f = fixture();
  // A large synthetic result; no real mailbox or body data.
  vm.runInContext('executeRequest = async () => ({ value: "x".repeat(3 * 1024 * 1024) })', f.context);
  f.enqueue("large-1"); await idle(f);
  f.enqueue("large-2"); await idle(f);
  f.enqueue("large-3"); await idle(f);
  assert.equal(f.read("requestRecords.size"), 2);
  assert.ok(f.read("resultBytes + reservedBytes <= RESULT_BYTE_LIMIT"));
  assert.equal(f.posts.length, 3);
  assert.equal(JSON.parse(f.posts[2]).notExecuted, true, "unadmitted request gets an explicit not-executed error");
});

test("oversized UTF-8 results are bounded and report uncertainty without re-execution", async () => {
  const f = fixture();
  vm.runInContext('let calls = 0; executeRequest = async () => { calls++; return "é".repeat(3 * 1024 * 1024); }', f.context);
  f.enqueue(); await idle(f);
  assert.equal(JSON.parse(f.posts[0]).ok, false);
  assert.match(JSON.parse(f.posts[0]).error, /outcome unknown/);
  f.enqueue(); await idle(f);
  assert.equal(f.read("calls"), 1);
  assert.equal(f.posts[0], f.posts[1]);
  assert.ok(f.read("resultBytes <= RESULT_MAX_BYTES"));
});

test("operation exceptions are cached separately from transport exceptions", async () => {
  const f = fixture({ create: async () => { throw new Error("synthetic API exception"); } });
  f.enqueue(); await idle(f); f.enqueue(); await idle(f);
  assert.equal(f.mutations(), 1);
  assert.equal(JSON.parse(f.posts[0]).error, "synthetic API exception");
  assert.equal(f.posts[0], f.posts[1]);
});

test("pending requests reserve memory and explicitly reject overflow before side effects", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = fixture({ create: () => gate });
  f.enqueue("pending-1"); f.enqueue("pending-2"); f.enqueue("pending-3");
  assert.equal(f.read("requestRecords.size"), 2);
  assert.equal(f.read("reservedBytes"), 8 * 1024 * 1024);
  for (let i = 0; i < 1000; i++) f.enqueue(`overflow-${i}`);
  assert.equal(f.read("requestRecords.size"), 2);
  assert.equal(f.read("rejectedRequests.size"), 256, "retained rejections are bounded");
  assert.ok(f.read("rejectionWorkerRunning"), "rejections use one sequential delivery worker");
  release(); await idle(f);
  assert.equal(f.mutations(), 2);
  assert.equal(f.read("reservedBytes"), 0);
  const rejections = f.posts.map(body => JSON.parse(body)).filter(body => body.notExecuted);
  assert.equal(rejections.length, 256);
  assert.ok(rejections.some(body => body.id === "pending-3"));
  f.enqueue("pending-3"); await idle(f);
  assert.equal(f.mutations(), 2, "a rejected ID never executes later, even after capacity frees");
  assert.equal(JSON.parse(f.posts.at(-1)).id, "pending-3");
  assert.equal(JSON.parse(f.posts.at(-1)).notExecuted, true);
  f.enqueue("pending-4"); await idle(f);
  assert.equal(f.mutations(), 3, "a new ID executes once capacity frees");
});

test("late acknowledgement starts its own five-minute retention window", async () => {
  let online = false;
  const f = fixture({ delivery: async () => ({ ok: online, status: online ? 204 : 404 }) });
  f.enqueue(); await idle(f);
  f.advance(60 * 60 * 1000);
  online = true;
  f.enqueue(); await idle(f);
  f.read("pruneRequestRecords()");
  assert.equal(f.read("requestRecords.size"), 1);
  f.advance(5 * 60 * 1000);
  f.read("pruneRequestRecords()");
  assert.equal(f.read("requestRecords.size"), 0);
});

test("unserializable result reports uncertainty and preserves its one execution", async () => {
  const f = fixture();
  vm.runInContext('let calls = 0; executeRequest = async () => { calls++; const value = {}; value.self = value; return value; }', f.context);
  f.enqueue(); await idle(f); f.enqueue(); await idle(f);
  assert.equal(f.read("calls"), 1);
  assert.match(JSON.parse(f.posts[0]).error, /outcome unknown/);
  assert.equal(f.posts[0], f.posts[1]);
});


test("hung delivery aborts and retries only the immutable result", async () => {
  const f = fixture({ fastTimeout: true, delivery: async (_, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new Error("synthetic timeout")), { once: true });
  }) });
  f.enqueue(); await idle(f);
  assert.equal(f.mutations(), 1);
  assert.equal(f.posts.length, 3);
  assert.ok(f.posts.every(body => body === f.posts[0]));
  assert.equal(f.read("requestRecords.get('id-1').acknowledged"), false);
});

test("operation timeout reports outcome unknown for mutations and keeps the worker alive", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const warnings = [];
  const f = fixture({ create: () => gate });
  f.context.console.warn = message => warnings.push(message);
  vm.runInContext("operationTimeoutMs = () => 5", f.context);
  f.enqueue("slow"); await idle(f);
  const result = JSON.parse(f.posts[0]);
  assert.equal(result.ok, false);
  assert.match(result.error, /outcome unknown/);
  assert.ok(warnings.some(message => /create_folder/.test(message)));
  release();
  f.enqueue("slow"); await idle(f);
  assert.equal(f.posts[1], f.posts[0], "a timed-out ID replays its result and is not re-executed");
  assert.equal(f.mutations(), 1);
  vm.runInContext("operationTimeoutMs = () => 60000", f.context);
  f.enqueue("next", "Next"); await idle(f);
  assert.equal(JSON.parse(f.posts.at(-1)).ok, true, "the worker continues with later requests");
});

test("read timeouts say nothing changed", async () => {
  const f = fixture();
  vm.runInContext("operationTimeoutMs = () => 5; executeRequest = () => new Promise(() => {})", f.context);
  f.context.enqueueRequest({ id: "read-1", op: "search", args: {} }); await idle(f);
  const result = JSON.parse(f.posts[0]);
  assert.equal(result.ok, false);
  assert.match(result.error, /bez zmian/);
  assert.doesNotMatch(result.error, /outcome unknown/);
});

test("operation limits: reads 120 s, mutations longer", () => {
  const f = fixture();
  assert.equal(f.read('operationTimeoutMs("search")'), 120000);
  assert.ok(f.read('operationTimeoutMs("trash")') > 120000);
  assert.ok(f.read('operationTimeoutMs("compact_folder")') >= f.read('operationTimeoutMs("trash")'));
});

test("poll loop pauses after HTTP 204 instead of busy-waiting", async () => {
  let polls = 0;
  const delays = [];
  const context = vm.createContext({
    messenger: { accounts: { list: async () => [] } },
    console: { warn() {}, log() {} },
    AbortController, TextEncoder, Date,
    // Record requested delays without ever firing them, freezing the loop.
    setTimeout: (_, ms) => { delays.push(ms); return 0; }, clearTimeout() {},
    fetch: async url => {
      if (url.includes("/poll?")) { polls++; return { status: 204, ok: true }; }
      return { ok: true, status: 204 };
    },
  });
  vm.runInContext(source, context);
  for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(polls, 1, "a 204 must not immediately trigger another poll");
  assert.deepEqual(delays, [250]);
});
