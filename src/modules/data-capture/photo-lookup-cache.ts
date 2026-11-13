import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';

type LookupResponse = Pick<AxiosResponse, 'status' | 'data' | 'headers'>;

/** Process-local, bounded cache for JSON photo lookups, never image streams. */
export class PhotoLookupCache {
  private readonly cache = new Map<string, { until: number; response: LookupResponse }>();
  private readonly pending = new Map<string, Promise<LookupResponse>>();
  private limitedUntil = 0;

  async get(url: string, config: AxiosRequestConfig): Promise<LookupResponse> {
    const key = JSON.stringify([url, config.headers, config.params]);
    const now = Date.now();
    const cached = this.cache.get(key);
    if (cached && cached.until > now) return cached.response;
    this.cache.delete(key);
    if (this.limitedUntil > now) {
      return { status: 429, data: {}, headers: {
        'retry-after': String(Math.ceil((this.limitedUntil - now) / 1000)),
      } };
    }
    const pending = this.pending.get(key);
    if (pending) return pending;
    const request = axios.get(url, config).then(response => {
      if (response.status === 429) {
        const raw = response.headers?.['retry-after'];
        const seconds = Number(raw);
        const delay = raw == null ? 60000 : Number.isFinite(seconds)
          ? seconds * 1000 : Date.parse(String(raw)) - Date.now();
        this.limitedUntil = Date.now() + Math.max(1000, Number.isFinite(delay) ? delay : 60000);
      } else if (response.status >= 200 && response.status < 300) {
        if (this.cache.size >= 256) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(key, { until: Date.now() + 60000, response });
      }
      return response;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return request;
  }
}
