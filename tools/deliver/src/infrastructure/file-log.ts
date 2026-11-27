import { StateJournal } from '@architect-os/sandbox/state-journal';
import type { DeliveryEntry, DeliveryLog } from '../domain/ports.js';

/** The entry as one line of JSON, without its line break. */
export function entryLine(entry: DeliveryEntry): string {
  return JSON.stringify(entry);
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
