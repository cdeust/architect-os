import type { Gate, GateVerdict } from '../domain/ports.js';
import type { Journal } from './in-memory-journal.js';

/** `Gate` over a receipt that a run replaces by what the scenario says it leaves. */
export class InMemoryGate implements Gate {
  /** The verdict the receipt holds now. */
  held: GateVerdict | undefined;
  /** What the receipt holds once the gate has run. */
  afterRun: GateVerdict | undefined;
  code = 0;

  constructor(private readonly journal: Journal) {}

  verdict(): GateVerdict | undefined {
    this.journal.record('verdict');
    return this.held;
  }

  async run(): Promise<number> {
    this.journal.record('gate');
    this.held = this.afterRun;
    return this.code;
  }
}
