export interface ScopedPageLike {
  goto(url: string): Promise<unknown>;
  fetch(url: string): Promise<unknown>;
  websocket(url: string): Promise<unknown>;
  download(url: string): Promise<unknown>;
}

export interface BrowserHandleLike {
  page(): Promise<ScopedPageLike>;
  close(): Promise<void>;
}

export interface BrowserLauncher {
  launch(options?: unknown): Promise<BrowserHandleLike>;
}

export interface BrowserObservation {
  operation: 'navigate' | 'fetch' | 'websocket' | 'download';
  url: string;
  allowed: boolean;
  at: string;
}

export class ScopedBrowserService {
  private handle?: BrowserHandleLike;
  private history: BrowserObservation[] = [];
  private closed = false;

  constructor(private readonly launcher: BrowserLauncher, private readonly scope: string) {}

  private assertOpen(): void {
    if (this.closed) throw new Error('browser closed');
  }

  private check(url: string, operation: BrowserObservation['operation']): true {
    const allowed = url.startsWith(this.scope + '/') || url === this.scope;
    this.history.push({ operation, url, allowed, at: new Date().toISOString() });
    if (!allowed) throw new Error(`cross-scope ${operation} rejected: ${url}`);
    return true;
  }

  private async page(): Promise<ScopedPageLike> {
    this.assertOpen();
    if (!this.handle) this.handle = await this.launcher.launch({ headless: true });
    return this.handle.page();
  }

  async navigate(url: string): Promise<unknown> {
    this.check(url, 'navigate');
    return (await this.page()).goto(url);
  }

  async fetch(url: string): Promise<unknown> {
    this.check(url, 'fetch');
    return (await this.page()).fetch(url);
  }

  async websocket(url: string): Promise<unknown> {
    this.check(url, 'websocket');
    return (await this.page()).websocket(url);
  }

  async download(url: string): Promise<unknown> {
    this.check(url, 'download');
    return (await this.page()).download(url);
  }

  observations(): readonly BrowserObservation[] { return this.history; }

  async destroy(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.handle?.close();
    this.handle = undefined;
    this.history = [];
  }

  isDestroyed(): boolean { return this.closed; }
}

// Optional adapter for a real Playwright Chromium installation.
export async function createPlaywrightLauncherIfAvailable(): Promise<BrowserLauncher | undefined> {
  try {
    const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;
    const mod = await dynamicImport('playwright');
    return {
      async launch(options) {
        const browser = await mod.chromium.launch({ headless: true, ...(options as object | undefined) });
        return {
          async page() {
            const page = await browser.newPage();
            return {
              goto: url => page.goto(url),
              fetch: async url => (await fetch(url)).text(),
              websocket: async url => { new mod.WebSocket(url); return undefined; },
              download: async url => (await fetch(url)).arrayBuffer()
            };
          },
          close: () => browser.close()
        };
      }
    };
  } catch {
    return undefined;
  }
}
