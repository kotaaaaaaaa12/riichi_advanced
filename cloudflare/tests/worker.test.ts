import { strict as assert } from "node:assert";
import { registerHooks } from "node:module";
import { test } from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") {
      return { shortCircuit: true, url: "data:text/javascript,export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }" };
    }
    return nextResolve(specifier, context);
  },
});
const { default: worker, RiichiServer } = await import("../worker.ts");

async function fixture(store = new Map()) {
  let initialized;
  let starts = 0;
  const pending = [];
  const proxied = [];
  const ctx = {
    storage: { async get(key) { return store.get(key); }, async put(key, value) { store.set(key, value); } },
    container: {
      running: false,
      start() { starts++; this.running = true; },
      async setInactivityTimeout() {},
      getTcpPort() {
        return { async fetch(input, init) {
          if (typeof input === "string") return new Response("OK");
          proxied.push(input);
          return new Response("game", { headers: { "set-cookie": "session=abc; Secure; HttpOnly" } });
        } };
      },
    },
    blockConcurrencyWhile(fn) { initialized = fn(); return initialized; },
    waitUntil(promise) { pending.push(promise); },
  };
  const instance = new RiichiServer(ctx, {});
  await initialized;
  return { instance, proxied, store, ctx, pending, get starts() { return starts; } };
}

test("the edge health endpoint never allocates or wakes a game instance", async () => {
  const response = await worker.fetch(new Request("https://mahjong.example/_cf/health"), {
    RIICHI_SERVER: new Proxy({}, { get() { throw new Error("The namespace must not be accessed"); } }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
});

test("all game paths and hosts share the same Durable Object name and APAC hint", async () => {
  const seen = [];
  const env = { RIICHI_SERVER: {
    idFromName(name) { seen.push(name); return "same-id"; },
    get(id, options) { assert.equal(id, "same-id"); assert.equal(options.locationHint, "apac"); return { fetch: async () => new Response("OK") }; },
  } };
  await worker.fetch(new Request("https://mahjong.example/lobby/riichi"), env);
  await worker.fetch(new Request("https://riichi.user.workers.dev/live/websocket"), env);
  assert.equal(seen[0], seen[1]);
});

test("a signing key survives Durable Object recreation and cookies pass through", async () => {
  const f = await fixture();
  const secret = f.store.get("phoenix-secret-v1");
  assert.equal(secret.length, 128);
  const response = await f.instance.fetch(new Request("https://mahjong.example/"));
  assert.equal(await response.text(), "game");
  assert.equal(response.headers.get("set-cookie"), "session=abc; Secure; HttpOnly");
  assert.equal(f.proxied[0].headers.get("host"), "mahjong.example");
  const next = await fixture(f.store);
  assert.equal(next.store.get("phoenix-secret-v1"), secret);
});

test("cross-site sockets are rejected before the container starts", async () => {
  const f = await fixture();
  const response = await f.instance.fetch(new Request("https://mahjong.example/live/websocket", {
    headers: { upgrade: "websocket", origin: "https://attacker.example" },
  }));
  assert.equal(response.status, 403);
  assert.equal(f.starts, 0);
});

test("the WebSocket relay forwards both ways and closes both endpoints", async () => {
  const OriginalResponse = globalThis.Response;
  const OriginalPair = globalThis.WebSocketPair;
  class FakeSocket extends EventTarget {
    sent = [];
    accepted = false;
    closed = false;
    accept() { this.accepted = true; }
    send(data) { this.sent.push(data); }
    close() { this.closed = true; }
    receive(data) { this.dispatchEvent(new MessageEvent("message", { data })); }
  }
  let pair;
  globalThis.WebSocketPair = class {
    constructor() { this[0] = new FakeSocket(); this[1] = new FakeSocket(); pair = this; }
  };
  globalThis.Response = class extends OriginalResponse {
    constructor(body, init) {
      super(body, init?.status === 101 ? { ...init, status: 200 } : init);
      if (init?.status === 101) { Object.defineProperty(this, "status", { value: 101 }); this.webSocket = init.webSocket; }
    }
  };
  try {
    const f = await fixture();
    const upstream = new FakeSocket();
    const result = f.instance.relayWebSocket({ webSocket: upstream, headers: new Headers({ "sec-websocket-accept": "upstream-only", "sec-websocket-extensions": "permessage-deflate" }) });
    assert.equal(result.status, 101);
    assert.equal(result.headers.get("sec-websocket-accept"), null);
    assert.equal(result.headers.get("sec-websocket-extensions"), null);
    assert.ok(upstream.accepted && pair[1].accepted);
    pair[1].receive("discard");
    upstream.receive("state-update");
    assert.deepEqual(upstream.sent, ["discard"]);
    assert.deepEqual(pair[1].sent, ["state-update"]);
    upstream.dispatchEvent(new Event("error"));
    assert.ok(pair[1].closed && upstream.closed);
  } finally {
    globalThis.Response = OriginalResponse;
    globalThis.WebSocketPair = OriginalPair;
  }
});
