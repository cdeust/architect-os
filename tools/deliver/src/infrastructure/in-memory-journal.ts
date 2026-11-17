/** The calls of every double of a scenario, in order: `<name> <arguments>`, so that a scenario asserts the sequence of acts. */
export class Journal {
  readonly calls: string[] = [];

  record(name: string, ...args: (string | number)[]): void {
    this.calls.push([name, ...args].join(' '));
  }
}
