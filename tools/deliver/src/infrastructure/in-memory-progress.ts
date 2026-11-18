import type { Progress, Stage } from '../domain/ports.js';

/** `Progress` that keeps the phases it is told, in order. */
export class InMemoryProgress implements Progress {
  readonly phases: Stage[] = [];

  phase(phase: Stage): void {
    this.phases.push(phase);
  }
}
