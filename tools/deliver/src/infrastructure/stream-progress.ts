import type { Progress, Stage } from '../domain/ports.js';

/** `Progress` over a stream: one line per phase, the name of the phase, written when it starts. */
export class StreamProgress implements Progress {
  constructor(private readonly stream: { write(text: string): unknown }) {}

  phase(phase: Stage): void {
    this.stream.write(`${phase}\n`);
  }
}
