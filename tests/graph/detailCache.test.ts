import { describe, expect, it } from 'vitest';

import type { CommitDetails } from '../../src/git/detail';
import { DetailCache } from '../../src/graph/detailCache';

/** Minimal fixed details payload; the cache never inspects its contents. */
function makeDetails(hash: string, message = 'subject'): CommitDetails {
  return {
    meta: {
      hash,
      parents: [],
      author: 'Test User',
      email: 'test@example.com',
      authorDate: 1_700_000_000,
      committer: 'Test User',
      committerEmail: 'test@example.com',
      committerDate: 1_700_000_060,
      message,
    },
    files: [
      {
        path: 'a.txt',
        status: 'M',
        additions: 1,
        deletions: 0,
        binary: false,
      },
    ],
  };
}

describe('DetailCache', () => {
  it('returns undefined for a hash that was never cached', () => {
    const cache = new DetailCache();
    expect(cache.get('deadbeef')).toBeUndefined();
  });

  it('returns the exact object that was set', () => {
    const cache = new DetailCache();
    const details = makeDetails('abc123');
    cache.set('abc123', details);
    expect(cache.get('abc123')).toBe(details);
  });

  it('keeps entries for different hashes isolated', () => {
    const cache = new DetailCache();
    const first = makeDetails('aaa111', 'first');
    const second = makeDetails('bbb222', 'second');
    cache.set('aaa111', first);
    cache.set('bbb222', second);
    expect(cache.get('aaa111')).toBe(first);
    expect(cache.get('bbb222')).toBe(second);
  });

  it('replaces an existing entry on set', () => {
    const cache = new DetailCache();
    cache.set('abc123', makeDetails('abc123', 'old'));
    const replacement = makeDetails('abc123', 'new');
    cache.set('abc123', replacement);
    expect(cache.get('abc123')).toBe(replacement);
    expect(cache.get('abc123')?.meta.message).toBe('new');
  });

  it('clear removes every entry and leaves the cache usable', () => {
    const cache = new DetailCache();
    cache.set('aaa111', makeDetails('aaa111'));
    cache.set('bbb222', makeDetails('bbb222'));

    cache.clear();

    expect(cache.get('aaa111')).toBeUndefined();
    expect(cache.get('bbb222')).toBeUndefined();

    const again = makeDetails('aaa111', 'again');
    cache.set('aaa111', again);
    expect(cache.get('aaa111')).toBe(again);
  });
});
