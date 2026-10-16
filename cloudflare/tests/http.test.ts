import { strict as assert } from "node:assert";
import { test } from "node:test";
import { allowedWebSocketOrigin, closeCode, containerRequest, unavailable } from "../http.ts";

test("proxy preserves a POST body and cookie while replacing forged forwarding headers", async () => {
  const incoming = new Request("https://mahjong.example/room/riichi/1?nickname=Alex", {
    method: "POST",
    body: "test=1",
    headers: {
      cookie: "session=abc",
      "cf-connecting-ip": "2001:db8::1",
      "x-riichi-client-ip": "spoofed",
      "x-forwarded-host": "attacker.example",
      "x-forwarded-proto": "http",
      forwarded: "host=attacker.example",
    },
  });
  const forwarded = containerRequest(incoming);
  assert.equal(forwarded.url, "http://mahjong.example/room/riichi/1?nickname=Alex");
  assert.equal(await forwarded.text(), "test=1");
  assert.equal(forwarded.headers.get("cookie"), "session=abc");
  assert.equal(forwarded.headers.get("host"), "mahjong.example");
  assert.equal(forwarded.headers.get("x-forwarded-proto"), "https");
  assert.equal(forwarded.headers.get("x-forwarded-port"), "443");
  assert.equal(forwarded.headers.get("x-riichi-client-ip"), "2001:db8::1");
  assert.equal(forwarded.headers.get("forwarded"), null);
});

test("a WebSocket must use the public page origin, including on custom domains", () => {
  for (const host of ["mahjong.example", "riichi-advanced.user.workers.dev"]) {
    assert.equal(allowedWebSocketOrigin(new Request(`https://${host}/live/websocket`, {
      headers: { upgrade: "websocket", origin: `https://${host}` },
    })), true);
    assert.equal(allowedWebSocketOrigin(new Request(`https://${host}/live/websocket`, {
      headers: { upgrade: "websocket", origin: "https://attacker.example" },
    })), false);
  }
});

test("cold-start pages keep the current URL and do not leak request values into HTML", async () => {
  const response = unavailable(new Request("https://mahjong.example/?nickname=%3Cscript%3E", {
    headers: { accept: "text/html" },
  }));
  const body = await response.text();
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.ok(body.includes('http-equiv="refresh"'));
  assert.ok(!body.includes("nickname="));
  assert.equal(unavailable(new Request("https://mahjong.example/live/websocket")).headers.get("content-type"), "application/json");
});

test("abnormal WebSocket close events map to a transmissible close code", () => {
  assert.equal(closeCode(1006), 1011);
  assert.equal(closeCode(1015), 1011);
  assert.equal(closeCode(1000), 1000);
  assert.equal(closeCode(1001), 1001);
});
