// The real `Sources` adapter, over the `fetch` the composition root gives (docs/design/anthropic-watch.md §5): HTTPS on
// the closed list of hosts, redirects followed by hand, a time limit and a size limit per source. It sends no header of its
// own but `accept`: no token, nothing that names this repository or its owner.
import { refusal } from '../domain/hosts.js';
import type { Reading, Reason, Sources } from '../domain/ports.js';

export interface Limits {
  readonly timeoutMs: number;
  readonly maxBytes: number;
}

/** 30 seconds and 8 MiB per source. */
export function defaultLimits(): Limits {
  return { timeoutMs: 30_000, maxBytes: 8 * 1024 * 1024 };
}

const MAX_REDIRECTS = 3;

const isRedirect = (status: number): boolean => [301, 302, 303, 307, 308].includes(status);

const unreadable = (reason: Reason): Reading => ({ kind: 'unreadable', reason });

export class FetchSources implements Sources {
  constructor(
    private readonly fetchFn: typeof fetch,
    private readonly limits: Limits,
  ) {}

  async fetch(url: string): Promise<Reading> {
    const signal = AbortSignal.timeout(this.limits.timeoutMs);
    try {
      return await this.follow(url, signal);
    } catch {
      return unreadable(signal.aborted ? 'délai dépassé' : 'réseau');
    }
  }

  private async follow(first: string, signal: AbortSignal): Promise<Reading> {
    let current = first;
    for (let redirects = 0; ; redirects++) {
      const refused = refusal(current);
      if (refused !== undefined) return unreadable(redirects === 0 ? refused : 'redirection refusée');
      const response = await this.fetchFn(current, {
        redirect: 'manual',
        headers: { accept: 'text/plain, text/markdown, application/json' },
        signal,
      });
      if (isRedirect(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel().catch(() => undefined);
        if (location === null || redirects >= MAX_REDIRECTS) return unreadable('redirection refusée');
        try {
          current = new URL(location, current).href;
        } catch {
          return unreadable('redirection refusée');
        }
        continue;
      }
      if (response.status !== 200) {
        await response.body?.cancel().catch(() => undefined);
        return unreadable(`statut ${response.status}`);
      }
      return await this.body(response);
    }
  }

  private async body(response: Response): Promise<Reading> {
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body?.getReader();
    while (reader !== undefined) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > this.limits.maxBytes) {
        await reader.cancel().catch(() => undefined);
        return unreadable('trop volumineux');
      }
      chunks.push(value);
    }
    try {
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks));
      return { kind: 'text', text };
    } catch {
      return unreadable('contenu refusé');
    }
  }
}
