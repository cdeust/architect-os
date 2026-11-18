import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DeliveryEntry, DeliveryLog } from '../domain/ports.js';

/**
 * `DeliveryLog` in a file of JSON lines. `template` starts with `${home}/` (the schema checks it); `${home}` alone is
 * resolved, as `modules/broker` does for its key file.
 */
export class FileLog implements DeliveryLog {
  private readonly path: string;

  constructor(template: string, home: string) {
    this.path = template.replace('${home}', () => home);
  }

  append(entry: DeliveryEntry): void {
    const { ruleSuites, ...rest } = entry;
    // Written by hand: an object would put a key such as "10" before the others, not in the order of the Map.
    const suites = [...ruleSuites].map(
      ([branch, suite]) => `${JSON.stringify(branch)}:${JSON.stringify(suite)}`,
    );
    const line = `${JSON.stringify(rest).slice(0, -1)},"ruleSuites":{${suites.join(',')}}}\n`;
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    appendFileSync(this.path, line, { mode: 0o600 });
  }
}
