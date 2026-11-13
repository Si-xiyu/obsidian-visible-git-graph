/**
 * In-memory cache for commit details.
 *
 * A click on an already-visited commit must not spawn git again, so the loaded
 * `CommitDetails` are kept per hash. The cache is a plain Map wrapper with no
 * expiry: the owner (`Root.vue`) clears it on refresh / repository change,
 * which is exactly when the commit list itself is replaced.
 */
import type { CommitDetails } from '../git/detail';

export class DetailCache {
  private readonly entries = new Map<string, CommitDetails>();

  get(hash: string): CommitDetails | undefined {
    return this.entries.get(hash);
  }

  set(hash: string, details: CommitDetails): void {
    this.entries.set(hash, details);
  }

  clear(): void {
    this.entries.clear();
  }
}
