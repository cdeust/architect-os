import { StateJournal } from '@architect-os/sandbox/state-journal';
import type { DeliveryEntry, DeliveryLog } from '../domain/ports.js';

/** The entry as one line of JSON, without its line break; the rule suites are an object in the order of the Map. */
export function entryLine(entry: DeliveryEntry): string {
  const { ruleSuites, ...rest } = entry;
  // Written by hand: an object would put a key such as "10" before the others, not in the order of the Map.
  const suites = [...ruleSuites].map(
    ([branch, suite]) => `${JSON.stringify(branch)}:${JSON.stringify(suite)}`,
  );
  return `${JSON.stringify(rest).slice(0, -1)},"ruleSuites":{${suites.join(',')}}}`;
}

/** Persistent delivery records, retained in the host state of the admitted root. */
export class FileLog implements DeliveryLog {
  private readonly journal: StateJournal;

  constructor(template: string, runtimeRoot: string | undefined) {
    this.journal = new StateJournal(runtimeRoot, template);
  }

  append(entry: DeliveryEntry): void {
    this.journal.append(entryLine(entry) + '\n');
  }
}
