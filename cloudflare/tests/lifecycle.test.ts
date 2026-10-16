import { strict as assert } from "node:assert";
import { test } from "node:test";
import { IDLE_MS, ServerLifecycle, type ApplicationContainer } from "../lifecycle.ts";

function fixture(health: () => Promise<Response>) {
  const starts: unknown[] = [];
  const timeouts: number[] = [];
  const requests: Request[] = [];
  const container: ApplicationContainer = {
    running: false,
    start(options) { starts.push(options); this.running = true; },
    async setInactivityTimeout(ms) { timeouts.push(ms); },
    getTcpPort(port) {
      assert.equal(port, 4000);
      return { async fetch(input, init) { requests.push(new Request(input, init)); return health(); } };
    },
  };
  return { container, starts, timeouts, requests };
}

test("concurrent first requests share startup and retry until Phoenix is ready", async () => {
  let calls = 0;
  const f = fixture(async () => new Response("", { status: ++calls === 1 ? 503 : 200 }));
  const lifecycle = new ServerLifecycle(f.container, async () => {}, 3);
  await Promise.all([lifecycle.ensureReady("mahjong.example", "secret"), lifecycle.ensureReady("mahjong.example", "secret")]);
  assert.equal(f.starts.length, 1);
  assert.equal(calls, 2);
  assert.deepEqual(f.timeouts, [IDLE_MS]);
  assert.equal(f.requests[0].headers.get("x-forwarded-proto"), "https");
  assert.equal(f.requests[0].redirect, "manual");
  assert.deepEqual(f.starts[0], { enableInternet: false, env: { PHX_HOST: "mahjong.example", SECRET_KEY_BASE: "secret", PORT: "4000" } });
});

test("a readiness failure can recover on the next request without duplicating a running process", async () => {
  let healthy = false;
  const f = fixture(async () => new Response("", { status: healthy ? 200 : 500 }));
  const lifecycle = new ServerLifecycle(f.container, async () => {}, 2);
  await assert.rejects(lifecycle.ensureReady("mahjong.example", "secret"), /did not become ready/);
  healthy = true;
  await lifecycle.ensureReady("mahjong.example", "secret");
  assert.equal(f.starts.length, 1);
});

test("a platform-stopped container starts again using the same signing secret", async () => {
  const f = fixture(async () => new Response("OK"));
  const lifecycle = new ServerLifecycle(f.container, async () => {}, 2);
  await lifecycle.ensureReady("mahjong.example", "same-secret");
  f.container.running = false;
  await lifecycle.ensureReady("mahjong.example", "same-secret");
  assert.equal(f.starts.length, 2);
  assert.deepEqual(f.starts[0], f.starts[1]);
});
