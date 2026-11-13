// @vitest-environment jsdom
import { createApp, nextTick } from 'vue';
import { describe, expect, it } from 'vitest';
import manifest from '../manifest.json';
import Root from '../src/ui/Root.vue';

describe('scaffold', () => {
  it('manifest declares the expected plugin identity', () => {
    expect(manifest.id).toBe('dsh-git-graph');
    expect(manifest.version).toBe('0.1.1');
    expect(manifest.isDesktopOnly).toBe(true);
  });

  it('Root.vue renders the loading row', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const app = createApp(Root);
    app.mount(host);
    await nextTick();

    const loading = host.querySelector('.dsh-git-graph-loading');
    expect(loading).not.toBeNull();
    expect(loading?.textContent).toContain('loading…');

    app.unmount();
    host.remove();
  });
});
