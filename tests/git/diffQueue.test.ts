import { describe, expect, it, vi } from 'vitest';
import { DiffQueue } from '../../src/git/diffQueue';

describe('diff concurrency', () => {
  it('limits work across tabs and removes cancelled queued requests', async () => {
    const queue = new DiffQueue();
    const releases: Array<() => void> = [];
    let active = 0;
    let peak = 0;
    const work = vi.fn(async () => {
      peak = Math.max(peak, ++active);
      await new Promise<void>(resolve => releases.push(resolve));
      active--;
    });
    const first = queue.run(work);
    const second = queue.run(work);
    const controller = new AbortController();
    const cancelled = queue.run(work, controller.signal);
    const rejection = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    const last = queue.run(work);
    controller.abort();
    await rejection;
    expect(work).toHaveBeenCalledTimes(2);
    releases.shift()!();
    await first;
    expect(work).toHaveBeenCalledTimes(3);
    releases.splice(0).forEach(release => release());
    await Promise.all([second, last]);
    expect(peak).toBe(2);
  });

  it('releases a slot after failure', async () => {
    const queue = new DiffQueue(1);
    const failed = queue.run(async () => { throw new Error('failed'); });
    const next = queue.run(async () => 'next');
    await expect(failed).rejects.toThrow('failed');
    await expect(next).resolves.toBe('next');
  });
});
