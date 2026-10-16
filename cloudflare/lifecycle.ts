export const IDLE_MS = 10 * 60 * 1000;

export interface ApplicationPort {
  fetch(request: Request | string, init?: RequestInit): Promise<Response>;
}

export interface ApplicationContainer {
  running: boolean;
  start(options: { env: Record<string, string>; enableInternet: boolean }): void;
  setInactivityTimeout(duration: number): Promise<void>;
  getTcpPort(port: number): ApplicationPort;
}

export class ServerLifecycle {
  private starting: Promise<void> | undefined;
  private ready = false;
  private readonly container: ApplicationContainer;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly attempts: number;

  constructor(
    container: ApplicationContainer,
    sleep: (ms: number) => Promise<void>,
    attempts = 20,
  ) {
    this.container = container;
    this.sleep = sleep;
    this.attempts = attempts;
  }

  invalidate(): void { this.ready = false; }

  ensureReady(host: string, secret: string): Promise<void> {
    if (this.starting) return this.starting;
    if (this.ready && this.container.running) return Promise.resolve();
    this.starting = this.startAndCheck(host, secret).finally(() => { this.starting = undefined; });
    return this.starting;
  }

  private async startAndCheck(host: string, secret: string): Promise<void> {
    this.ready = false;
    if (!this.container.running) {
      this.container.start({
        enableInternet: false,
        env: { SECRET_KEY_BASE: secret, PHX_HOST: host, PORT: "4000" },
      });
    }
    await this.container.setInactivityTimeout(IDLE_MS);
    const port = this.container.getTcpPort(4000);
    let lastError: unknown;
    for (let attempt = 0; attempt < this.attempts; attempt++) {
      try {
        const response = await port.fetch("http://localhost/health", {
          headers: { "x-forwarded-proto": "https", "x-forwarded-port": "443", "x-riichi-client-ip": "127.0.0.1" },
          signal: AbortSignal.timeout(1000),
          redirect: "manual",
        });
        await response.body?.cancel();
        if (response.status !== 200) throw new Error(`Application health check returned ${response.status}`);
        this.ready = true;
        return;
      } catch (error) { lastError = error; }
      if (attempt + 1 < this.attempts) await this.sleep(200);
    }
    throw new Error("Riichi Advanced did not become ready", { cause: lastError });
  }
}
