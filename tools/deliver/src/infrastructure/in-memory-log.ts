import type { DeliveryEntry, DeliveryLog } from '../domain/ports.js';
import type { Journal } from './in-memory-journal.js';

/** `DeliveryLog` that keeps the entries it is given. */
export class InMemoryLog implements DeliveryLog {
  readonly entries: DeliveryEntry[] = [];

  constructor(private readonly journal: Journal) {}

  append(entry: DeliveryEntry): void {
    this.journal.record('log', entry.outcome);
    this.entries.push(entry);
  }
}
