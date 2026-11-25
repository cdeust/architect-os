import type { Clock } from '../domain/ports.js';
import type { Journal } from './in-memory-journal.js';

/** `Clock` that counts the seconds slept and never waits; its time moves only by what is slept. */
export class InMemoryClock implements Clock {
  slept = 0;

  /** `start` is the time, in whole seconds since the epoch, before anything is slept. */
  constructor(
    private readonly journal: Journal,
    private readonly start = 0,
  ) {}

  async sleep(seconds: number): Promise<void> {
    this.journal.record('sleep', seconds);
    this.slept += seconds;
  }

  now(): number {
    return this.start + this.slept;
  }
}
