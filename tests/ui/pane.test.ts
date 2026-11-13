// @vitest-environment jsdom
import { createApp, h, nextTick, type Component } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import GraphHeader from '../../src/ui/GraphHeader.vue';
import Icon from '../../src/ui/Icon.vue';
import RefBadge from '../../src/ui/RefBadge.vue';
import type { GraphRefBadge } from '../../src/ui/types';

interface Mounted {
  host: HTMLElement;
  app: ReturnType<typeof createApp>;
}

function mount(component: Component, props: Record<string, unknown>): Mounted {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp({ render: () => h(component, props) });
  app.mount(host);
  return { host, app };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('pane header', () => {
  it('shows the repository and branch, and reports filter and search changes', async () => {
    const refresh = vi.fn();
    const refFilter = vi.fn();
    const filterText = vi.fn();
    const { host, app } = mount(GraphHeader, {
      repoName: 'vault',
      branch: 'main',
      refFilter: 'local',
      filterText: '',
      loading: false,
      onRefresh: refresh,
      'onUpdate:refFilter': refFilter,
      'onUpdate:filterText': filterText,
    });
    await nextTick();

    expect(host.querySelector('.dsh-gg-repo')?.textContent).toBe('vault');
    expect(host.querySelector('.dsh-gg-branch')?.textContent).toBe('main');

    const select = host.querySelector('select') as HTMLSelectElement;
    select.value = 'all';
    select.dispatchEvent(new Event('change'));
    expect(refFilter).toHaveBeenCalledWith('all');

    const input = host.querySelector('input') as HTMLInputElement;
    input.value = 'fix';
    input.dispatchEvent(new Event('input'));
    expect(filterText).toHaveBeenCalledWith('fix');

    (host.querySelector('button') as HTMLButtonElement).dispatchEvent(new MouseEvent('click'));
    expect(refresh).toHaveBeenCalledTimes(1);

    app.unmount();
  });
});

describe('ref capsule', () => {
  const tag: GraphRefBadge = { key: 'k', name: 'v1.0.0', type: 'tag', colour: '#fff' };

  it('exposes the ref kind for styling and the name in the tooltip', async () => {
    const { host, app } = mount(RefBadge, { badge: tag });
    await nextTick();

    const capsule = host.querySelector('.dsh-gg-ref') as HTMLElement;
    expect(capsule.dataset.kind).toBe('tag');
    expect(capsule.title).toBe('Tag v1.0.0');
    expect(capsule.querySelector('.dsh-gg-ref-name')?.textContent).toBe('v1.0.0');

    app.unmount();
  });
});

describe('header glyphs', () => {
  it('draws the graph glyph from paths and circles', async () => {
    const { host, app } = mount(Icon, { name: 'git-graph' });
    await nextTick();

    expect(host.querySelector('svg')).not.toBeNull();
    expect(host.querySelectorAll('path').length).toBe(1);
    expect(host.querySelectorAll('circle').length).toBe(3);

    app.unmount();
  });
});
