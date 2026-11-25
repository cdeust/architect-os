import type { Clock } from '../domain/ports.js';

/**
 * `Clock` over a timer and a time source: `setTimer` is `setTimeout` and `milliseconds` is `Date.now`, or what a
 * scenario gives in their place.
 */
export class TimerClock implements Clock {
  constructor(
    private readonly setTimer: (handler: () => void, milliseconds: number) => unknown,
    private readonly milliseconds: () => number,
  ) {}

  sleep(seconds: number): Promise<void> {
    return new Promise((resolve) => {
      this.setTimer(resolve, seconds * 1000);
    });
  }

  now(): number {
    return Math.floor(this.milliseconds() / 1000);
  }
}
