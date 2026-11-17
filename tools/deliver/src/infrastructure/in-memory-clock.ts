import type { Clock } from '../domain/ports.js';
import type { Journal } from './in-memory-journal.js';

/** `Clock` that counts the seconds slept and never waits. */
export class InMemoryClock implements Clock {
  slept = 0;

  constructor(private readonly journal: Journal) {}

  async sleep(seconds: number): Promise<void> {
    this.journal.record('sleep', seconds);
    this.slept += seconds;
  }
}
