import type { Lookup, Registry } from '../domain/ports.js';

export class InMemoryRegistry implements Registry {
  constructor(private readonly known: ReadonlyMap<string, Lookup>) {}

  lookup(doi: string): Promise<Lookup> {
    return Promise.resolve(this.known.get(doi) ?? { kind: 'unknown' });
  }
}
