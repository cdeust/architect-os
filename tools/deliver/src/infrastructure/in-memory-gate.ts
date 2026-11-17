import type { Gate } from '../domain/ports.js';
import type { Journal } from './in-memory-journal.js';

/** `Gate` over a verdict file that a run replaces by what the scenario says it leaves. */
export class InMemoryGate implements Gate {
  /** The hash the verdict file names now. */
  verdict: string | undefined;
  /** What the file names once the gate has run. */
  afterRun: string | undefined;
  code = 0;

  constructor(private readonly journal: Journal) {}

  verdictHash(): string | undefined {
    this.journal.record('verdict');
    return this.verdict;
  }

  async run(): Promise<number> {
    this.journal.record('gate');
    this.verdict = this.afterRun;
    return this.code;
  }
}
