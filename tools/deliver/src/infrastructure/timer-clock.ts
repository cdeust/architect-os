import type { Clock } from '../domain/ports.js';

/** `Clock` over a timer: `setTimer` is `setTimeout`, or what a scenario gives in its place. */
export class TimerClock implements Clock {
  constructor(private readonly setTimer: (handler: () => void, milliseconds: number) => unknown) {}

  sleep(seconds: number): Promise<void> {
    return new Promise((resolve) => {
      this.setTimer(resolve, seconds * 1000);
    });
  }
}
