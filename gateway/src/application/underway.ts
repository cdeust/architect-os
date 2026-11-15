/** Work under way, so that a shutdown can wait for it: a promise is kept until it settles, whatever it gives. */
export class Underway {
  private readonly works = new Set<Promise<unknown>>();

  track<T>(work: Promise<T>): Promise<T> {
    this.works.add(work);
    const done = (): void => void this.works.delete(work);
    work.then(done, done);
    return work;
  }

  /** Resolves once nothing is under way, the work started meanwhile included. */
  async settled(): Promise<void> {
    while (this.works.size > 0) await Promise.allSettled([...this.works]);
  }
}
