import { describe, it, expect } from 'vitest';
import { acquirePageLock } from '../../src/browser/context.js';

describe('acquirePageLock', () => {
  it('serializes two concurrent acquires', async () => {
    const order: string[] = [];

    const first = (async () => {
      const release = await acquirePageLock();
      order.push('a-start');
      await new Promise(r => setTimeout(r, 30));
      order.push('a-end');
      release();
    })();

    const second = (async () => {
      const release = await acquirePageLock();
      order.push('b-start');
      order.push('b-end');
      release();
    })();

    await Promise.all([first, second]);
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });

  it('lets a later acquire proceed after release', async () => {
    const release = await acquirePageLock();
    let acquired = false;
    const waiter = acquirePageLock().then(r => {
      acquired = true;
      r();
    });
    await new Promise(r => setTimeout(r, 10));
    expect(acquired).toBe(false);
    release();
    await waiter;
    expect(acquired).toBe(true);
  });
});
