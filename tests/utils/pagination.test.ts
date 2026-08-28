import { describe, expect, it, vi } from 'vitest';

import { paginate } from '../../src/utils/pagination.js';

describe('paginate', () => {
  it('visits all pages and forwards page tokens', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ items: [1, 2], nextPageToken: 'page-2' })
      .mockResolvedValueOnce({ items: [3] });
    const values: number[] = [];

    for await (const value of paginate<number>(fetchPage)) values.push(value);

    expect(values).toEqual([1, 2, 3]);
    expect(fetchPage).toHaveBeenNthCalledWith(1, undefined);
    expect(fetchPage).toHaveBeenNthCalledWith(2, 'page-2');
  });

  it('stops repeated tokens to avoid an infinite loop', async () => {
    const fetchPage = vi.fn().mockResolvedValue({ items: [], nextPageToken: 'same' });

    const consume = async () => {
      for await (const value of paginate(fetchPage)) {
        void value;
      }
    };

    await expect(consume()).rejects.toThrow('repeated page token');
  });
});
