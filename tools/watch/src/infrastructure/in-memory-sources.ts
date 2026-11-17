import { refusal } from '../domain/hosts.js';
import type { Reading, Sources } from '../domain/ports.js';

/** `Sources` over a table of answers; an address that is not in it answers `statut 404`, like a missing page. */
export class InMemorySources implements Sources {
  constructor(private readonly answers: ReadonlyMap<string, Reading>) {}

  async fetch(url: string): Promise<Reading> {
    const refused = refusal(url);
    if (refused !== undefined) return { kind: 'unreadable', reason: refused };
    return this.answers.get(url) ?? { kind: 'unreadable', reason: 'statut 404' };
  }
}
