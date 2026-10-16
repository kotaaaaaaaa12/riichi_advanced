import { DurableObject } from "cloudflare:workers";
import { allowedWebSocketOrigin, closeCode, containerRequest, RELEASE, SINGLETON, unavailable } from "./http.ts";
import { IDLE_MS, ServerLifecycle } from "./lifecycle.ts";

interface Env {
  RIICHI_SERVER: DurableObjectNamespace<RiichiServer>;
}

export class RiichiServer extends DurableObject<Env> {
  private secret = "";
  private readonly lifecycle: ServerLifecycle;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const container = ctx.container;
    if (!container) throw new Error("The RiichiServer container binding is missing");
    this.lifecycle = new ServerLifecycle(container, (ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    void ctx.blockConcurrencyWhile(async () => {
      this.secret = await ctx.storage.get<string>("phoenix-secret-v1") || "";
      if (!this.secret) {
        const bytes = crypto.getRandomValues(new Uint8Array(64));
        this.secret = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
        await ctx.storage.put("phoenix-secret-v1", this.secret);
      }
      // Reapply the timeout after a Durable Object restart or Worker deployment.
      if (container.running) await container.setInactivityTimeout(IDLE_MS);
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (!allowedWebSocketOrigin(request)) return new Response("Forbidden origin", { status: 403 });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const ready = this.lifecycle.ensureReady(url.hostname, this.secret);
      // Continue startup while the browser receives a short, automatically retried page.
      this.ctx.waitUntil(ready.catch((error) => console.error("Application startup failed", error)));
      const done = await Promise.race([
        ready.then(() => true),
        new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), 1500); }),
      ]);
      if (!done) return unavailable(request);
      if (url.pathname === "/_cf/ready") {
        return Response.json({ ready: true, release: RELEASE }, { headers: { "cache-control": "no-store" } });
      }
      const response = await this.ctx.container!.getTcpPort(4000).fetch(containerRequest(request));
      if (response.status === 101 && response.webSocket) return this.relayWebSocket(response);
      // Return the original response to preserve cookies, redirects and streams.
      return response;
    } catch (error) {
      this.lifecycle.invalidate();
      console.error("Riichi Advanced request failed", error);
      return unavailable(request);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private relayWebSocket(response: Response): Response {
    const upstream = response.webSocket!;
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    // Accepted, non-hibernating sockets keep this Durable Object active while people are connected.
    // After the last socket closes and requests stop, the platform applies the ten-minute timeout.
    upstream.accept();
    server.accept();
    const finish = (code = 1000) => {
      try { server.close(closeCode(code), "Connection closed"); } catch { /* Already closed. */ }
      try { upstream.close(closeCode(code), "Connection closed"); } catch { /* Already closed. */ }
    };
    server.addEventListener("message", (event) => { try { upstream.send(event.data); } catch { finish(1011); } });
    upstream.addEventListener("message", (event) => { try { server.send(event.data); } catch { finish(1011); } });
    server.addEventListener("close", (event) => finish(event.code));
    upstream.addEventListener("close", (event) => finish(event.code));
    server.addEventListener("error", () => finish(1011));
    upstream.addEventListener("error", () => finish(1011));
    // The new WebSocketPair has its own handshake and does not inherit upstream compression.
    const headers = new Headers(response.headers);
    for (const name of ["connection", "upgrade", "sec-websocket-accept", "sec-websocket-extensions"]) headers.delete(name);
    return new Response(null, { status: 101, webSocket: client, headers });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.protocol === "http:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
      url.protocol = "https:";
      return Response.redirect(url.toString(), 308);
    }
    if (url.pathname === "/_cf/health") {
      // This checks the edge only and deliberately does not wake the game server.
      return Response.json({ ok: true, release: RELEASE }, { headers: { "cache-control": "no-store" } });
    }
    if (!allowedWebSocketOrigin(request)) return new Response("Forbidden origin", { status: 403 });
    const id = env.RIICHI_SERVER.idFromName(SINGLETON);
    return env.RIICHI_SERVER.get(id, { locationHint: "apac" }).fetch(request);
  },
} satisfies ExportedHandler<Env>;
