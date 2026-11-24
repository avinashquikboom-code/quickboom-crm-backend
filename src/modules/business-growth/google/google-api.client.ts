import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';

/** Server-side transport. Never log credentials, response bodies, or query strings. */
@Injectable()
export class GoogleApiClient {
  private readonly logger = new Logger(GoogleApiClient.name);

  async request<T>(service: string, url: URL, token: string, init: RequestInit = {}): Promise<T> {
    const correlationId = randomUUID();
    const start = Date.now();
    let status: number | undefined;
    let requestId: string | null = null;
    try {
      const response = await fetch(url, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(30000),
      });
      status = response.status;
      requestId = response.headers.get('request-id') || response.headers.get('x-request-id');
      if (!response.ok) {
        // Provider error bodies may include customer information. Expose only status and request ID.
        throw new BadGatewayException({ message: `${service} request failed`, providerStatus: status, requestId });
      }
      return await response.json() as T;
    } catch (error) {
      if (error instanceof BadGatewayException) throw error;
      throw new BadGatewayException({ message: `${service} request could not be completed`, requestId });
    } finally {
      this.logger.log(JSON.stringify({ correlationId, service, endpoint: `${url.origin}${url.pathname}`, timestamp: new Date().toISOString(), status, requestId, durationMs: Date.now() - start }));
    }
  }
}
