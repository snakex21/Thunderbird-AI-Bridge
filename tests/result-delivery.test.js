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
    setTimeout: (fn, ms) => setTimeout(fn, ms === 5000 && !fastTimeout ? ms : 0), clearTimeout,
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
    if (!f.read("requestWorkerRunning")) return;
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
  assert.equal(f.posts.length, beforeOverflow, "capacity denial cannot become an unretained terminal result");
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
  assert.equal(f.posts.length, 2, "unadmitted request has no terminal result");
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

test("pending requests reserve memory and reject overflow before side effects", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = fixture({ create: () => gate });
  f.enqueue("pending-1"); f.enqueue("pending-2"); f.enqueue("pending-3");
  assert.equal(f.read("requestRecords.size"), 2);
  assert.equal(f.read("reservedBytes"), 8 * 1024 * 1024);
  for (let i = 0; i < 1000; i++) f.enqueue(`overflow-${i}`);
  assert.equal(f.read("requestRecords.size"), 2);
  assert.equal(f.posts.length, 0, "overflow cannot spawn untracked result-delivery tasks");
  release(); await idle(f);
  assert.equal(f.mutations(), 2);
  assert.equal(f.read("reservedBytes"), 0);
  assert.equal(f.posts.some(body => JSON.parse(body).id === "pending-3"), false);
  f.enqueue("pending-3"); await idle(f);
  assert.equal(f.mutations(), 3, "previously unadmitted ID executes for the first time after capacity frees");
  f.enqueue("pending-3"); await idle(f);
  assert.equal(f.mutations(), 3);
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
