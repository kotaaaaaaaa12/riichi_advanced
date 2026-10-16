export const RELEASE = "cf-apac-20261016-v1";
export const SINGLETON = "riichi-advanced-apac-v1";

export function allowedWebSocketOrigin(request: Request): boolean {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return true;
  const origin = request.headers.get("origin");
  return origin === null || origin === new URL(request.url).origin;
}

export function containerRequest(request: Request): Request {
  const external = new URL(request.url);
  const internal = new URL(request.url);
  internal.protocol = "http:";
  const headers = new Headers(request.headers);
  // The port binding selects the destination; preserve the public host for Phoenix.
  headers.set("host", external.host);
  headers.set("x-forwarded-host", external.host);
  headers.set("x-forwarded-proto", external.protocol.slice(0, -1));
  headers.set("x-forwarded-port", external.port || (external.protocol === "https:" ? "443" : "80"));
  headers.set("x-riichi-client-ip", request.headers.get("cf-connecting-ip") || "127.0.0.1");
  headers.delete("forwarded");
  return new Request(internal, new Request(request, { headers }));
}

export function unavailable(request: Request): Response {
  const headers = {
    "cache-control": "no-store",
    "retry-after": "3",
    "x-riichi-release": RELEASE,
    "x-content-type-options": "nosniff",
  };
  if (request.method === "GET" && request.headers.get("accept")?.includes("text/html")) {
    return new Response(`<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="4"><title>Starting Riichi Advanced</title>
<style>html{color-scheme:dark}body{margin:0;min-height:100svh;display:grid;place-items:center;background:#0b1720;color:#e8f1f1;font:16px system-ui,sans-serif}main{max-width:32rem;padding:2rem}h1{font-size:1.65rem}p{line-height:1.6;color:#b7c8ce}a{color:#8de0c3}</style>
<main><h1>Starting Riichi Advanced</h1><p>The server is starting or temporarily unavailable. This page will retry automatically.</p><p>If this takes longer than a few minutes, the server administrator can check the deployment logs.</p><a href="">Try again</a></main></html>`, {
      status: 503,
      headers: { ...headers, "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'" },
    });
  }
  return Response.json({ error: "The server is starting or temporarily unavailable.", release: RELEASE }, { status: 503, headers });
}

export function closeCode(code: number): number {
  return code >= 1000 && code < 5000 && ![1004, 1005, 1006, 1015].includes(code) ? code : 1011;
}
