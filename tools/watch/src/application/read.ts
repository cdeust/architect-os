// `read` (docs/design/anthropic-watch.md §3): records in the register that sources were read. All the sources are read
// first; nothing is written unless every one is readable.
import { renderUnreadable } from '../domain/compare.js';
import { observeReadable, type Readable } from '../domain/observe.js';
import type { Files, Sources } from '../domain/ports.js';
import { canonical, type Register, type Source } from '../domain/register.js';
import { registerPath } from './load.js';

export interface ReadDependencies {
  readonly sources: Sources;
  readonly repository: Files;
  readonly keep: Files | undefined;
  /** Today, UTC, as YYYY-MM-DD. */
  readonly today: string;
}

export type ReadOutcome = { refusal: string } | { code: 0 | 3; lines: string[] };

export async function readSources(
  deps: ReadDependencies,
  register: Register,
  requested: readonly string[],
): Promise<ReadOutcome> {
  if (requested.length === 0) return { refusal: 'aucune source nommée' };
  const named: Readable[] = [];
  for (const id of new Set(requested)) {
    const source = register.sources.find((candidate) => candidate.id === id);
    if (source === undefined) return { refusal: `source inconnue : ${id}` };
    if (source.kind === 'pin') return { refusal: `${id} : une épingle se déplace dans son manifeste` };
    named.push(source);
  }

  const read = new Map<string, Source>();
  const files: { path: string; text: string }[] = [];
  const kept: { name: string; text: string }[] = [];
  const unreadable: string[] = [];
  for (const source of named) {
    const reading = await deps.sources.fetch(source.url);
    if (reading.kind === 'unreadable') {
      unreadable.push(...renderUnreadable(source.id, reading.reason));
      continue;
    }
    const seen = observeReadable(source, reading.text);
    if (seen === undefined) {
      unreadable.push(...renderUnreadable(source.id, 'contenu refusé'));
      continue;
    }
    switch (seen.kind) {
      case 'changelog':
        read.set(source.id, { ...seen.source, read: { version: seen.latest, on: deps.today } });
        break;
      case 'page':
        read.set(source.id, { ...seen.source, read: { sha256: seen.sha256, on: deps.today } });
        break;
      case 'index':
        files.push({ path: seen.source.pages, text: `${seen.addresses.join('\n')}\n` });
        break;
    }
    kept.push({ name: `${source.id}.txt`, text: reading.text });
  }
  if (unreadable.length > 0) return { code: 3, lines: unreadable };

  for (const file of files) deps.repository.write(file.path, file.text);
  for (const file of kept) deps.keep?.write(file.name, file.text);
  const sources = register.sources.map((source) => read.get(source.id) ?? source);
  deps.repository.write(registerPath(), canonical({ sources }));
  return { code: 0, lines: named.map((source) => `lu : ${source.id}`) };
}
