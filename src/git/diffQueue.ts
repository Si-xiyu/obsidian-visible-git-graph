/** Bound patch capture and parsing across all open diff tabs. */
export class DiffQueue {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly limit = 2) {}

  async run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const start = (): void => {
        signal?.removeEventListener('abort', abort);
        this.active++;
        resolve();
      };
      const abort = (): void => {
        const index = this.waiting.indexOf(start);
        if (index >= 0) this.waiting.splice(index, 1);
        reject(signal?.reason);
      };
      if (this.active < this.limit) start();
      else {
        this.waiting.push(start);
        signal?.addEventListener('abort', abort, { once: true });
      }
    });
    try {
      signal?.throwIfAborted();
      return await task();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}

export const diffQueue = new DiffQueue();
