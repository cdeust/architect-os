import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
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

/**
 * `DeliveryLog` in a file of JSON lines. `template` starts with `${home}/` (the schema checks it); `${home}` alone is
 * resolved, as `modules/broker` does for its key file. A path that is not absolute once resolved is refused when the
 * log is built: written as it is, it would land in the working directory, which is the worktree to deliver.
 */
export class FileLog implements DeliveryLog {
  private readonly path: string;

  constructor(template: string, home: string) {
    const path = template.replace('${home}', () => home);
    if (!isAbsolute(path)) throw new Error('the delivery log is not an absolute path');
    this.path = path;
  }

  append(entry: DeliveryEntry): void {
    const line = `${entryLine(entry)}\n`;
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    appendFileSync(this.path, line, { mode: 0o600 });
  }
}
