import { describe, expect, it } from 'vitest';
import { ScopedBrowserService, type BrowserHandleLike, type BrowserLauncher, type ScopedPageLike } from '../../packages/browser/src/index.js';

class FakePage implements ScopedPageLike {
  calls: string[] = [];
  async goto(url: string) { this.calls.push(`goto:${url}`); return url; }
  async fetch(url: string) { this.calls.push(`fetch:${url}`); return 'ok'; }
  async websocket(url: string) { this.calls.push(`websocket:${url}`); return 'open'; }
  async download(url: string) { this.calls.push(`download:${url}`); return 'bytes'; }
}

class FakeLauncher implements BrowserLauncher {
  closed = false;
  readonly page = new FakePage();
  async launch(): Promise<BrowserHandleLike> {
    return { page: async () => this.page, close: async () => { this.closed = true; } };
  }
}

describe('scoped challenge browser', () => {
  it('allows all four operations only inside scope and records observations', async () => {
    const launcher = new FakeLauncher();
    const browser = new ScopedBrowserService(launcher, 'http://127.0.0.1:8123');
    await browser.navigate('http://127.0.0.1:8123/index');
    await browser.fetch('http://127.0.0.1:8123/api');
    await browser.websocket('http://127.0.0.1:8123/ws');
    await browser.download('http://127.0.0.1:8123/file');
    expect(browser.observations()).toHaveLength(4);
    expect(launcher.page.calls).toEqual([
      'goto:http://127.0.0.1:8123/index',
      'fetch:http://127.0.0.1:8123/api',
      'websocket:http://127.0.0.1:8123/ws',
      'download:http://127.0.0.1:8123/file'
    ]);
  });

  it('rejects cross-scope access and tears down the entire browser', async () => {
    const launcher = new FakeLauncher();
    const browser = new ScopedBrowserService(launcher, 'http://127.0.0.1:8123');
    await expect(browser.navigate('http://example.test/')).rejects.toThrow(/cross-scope/);
    await expect(browser.fetch('http://example.test/')).rejects.toThrow(/cross-scope/);
    await expect(browser.websocket('http://example.test/')).rejects.toThrow(/cross-scope/);
    await expect(browser.download('http://example.test/')).rejects.toThrow(/cross-scope/);
    await browser.navigate('http://127.0.0.1:8123/');
    await browser.destroy();
    expect(launcher.closed).toBe(true);
    expect(browser.isDestroyed()).toBe(true);
    await expect(browser.navigate('http://127.0.0.1:8123/')).rejects.toThrow(/closed/);
  });
});
