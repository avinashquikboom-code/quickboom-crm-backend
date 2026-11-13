import axios from 'axios';
import { PhotoLookupCache } from './photo-lookup-cache';

jest.mock('axios');
const get = axios.get as jest.Mock;

describe('photo lookup request protection', () => {
  beforeEach(() => { jest.resetAllMocks(); jest.useFakeTimers(); });
  afterEach(() => jest.useRealTimers());

  it('shares concurrent lookups and expires successful results', async () => {
    const cache = new PhotoLookupCache();
    get.mockResolvedValue({ status: 200, data: { photos: ['photo'] } });
    await Promise.all([cache.get('place', {}), cache.get('place', {})]);
    await cache.get('place', {});
    expect(get).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(60001);
    await cache.get('place', {});
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('honors rate limits across places and retries after cooldown', async () => {
    const cache = new PhotoLookupCache();
    get.mockResolvedValueOnce({ status: 429, headers: { 'retry-after': '120' } })
      .mockResolvedValue({ status: 200, data: {} });
    await cache.get('first', {});
    expect((await cache.get('second', {})).status).toBe(429);
    expect(get).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(120001);
    expect((await cache.get('second', {})).status).toBe(200);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('releases failed requests so transport errors can recover', async () => {
    const cache = new PhotoLookupCache();
    get.mockRejectedValueOnce(new Error('network')).mockResolvedValue({ status: 200 });
    await expect(cache.get('place', {})).rejects.toThrow('network');
    expect((await cache.get('place', {})).status).toBe(200);
  });
});
