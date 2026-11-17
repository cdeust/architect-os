// What is taken from the text of a source (docs/design/anthropic-watch.md §5, T and E): never the text itself, only a
// version that matched the version expression, an address that matched the address expression, or a hash. A source and
// what was seen of it travel together, so that nothing compares a page to the versions of a changelog.
import { createHash } from 'node:crypto';
import {
  isVersion,
  jsonAt,
  type ChangelogSource,
  type IndexSource,
  type PageSource,
  type PinSource,
  type Source,
} from './register.js';

/** A source whose reading the register records: every kind but a pin, whose state is its manifests. */
export type Readable = ChangelogSource | PageSource | IndexSource;

export type SeenPin = { kind: 'pin'; source: PinSource; published: string };
export type SeenChangelog = {
  kind: 'changelog';
  source: ChangelogSource;
  latest: string;
  versions: string[];
};
export type SeenPage = { kind: 'page'; source: PageSource; sha256: string };
export type SeenIndex = { kind: 'index'; source: IndexSource; addresses: string[] };
export type SeenReadable = SeenChangelog | SeenPage | SeenIndex;
export type Seen = SeenPin | SeenReadable;

/** The addresses of a text that are on the host `host` and end in `.md`, deduplicated and sorted. */
export function addressesOf(host: string, text: string): string[] {
  const escaped = host.replaceAll('.', '\\.');
  const expression = new RegExp(
    `(?<![A-Za-z0-9])https://${escaped}/[A-Za-z0-9._~/-]+\\.md(?![A-Za-z0-9._~/%-])`,
    'g',
  );
  return [...new Set(text.match(expression) ?? [])].sort();
}

/** The version the npm registry publishes, or undefined when its answer is refused. */
function seePin(source: PinSource, text: string): SeenPin | undefined {
  const published = jsonAt(text, 'version');
  return isVersion(published) ? { kind: 'pin', source, published } : undefined;
}

/** What the text of a source the register records says, or undefined when the text is refused (`contenu refusé`). */
export function observeReadable(source: Readable, text: string): SeenReadable | undefined {
  switch (source.kind) {
    case 'changelog': {
      const versions = [...text.matchAll(/^## (\d+\.\d+\.\d+)\b/gm)].map((match) => match[1] as string);
      const [latest] = versions;
      return latest === undefined ? undefined : { kind: 'changelog', source, latest, versions };
    }
    case 'page':
      return { kind: 'page', source, sha256: createHash('sha256').update(text).digest('hex') };
    case 'index': {
      const addresses = addressesOf(new URL(source.url).hostname, text);
      return addresses.length === 0 ? undefined : { kind: 'index', source, addresses };
    }
  }
}

/** What the text of a source says, or undefined when the text is refused (`contenu refusé`). */
export function observe(source: Source, text: string): Seen | undefined {
  return source.kind === 'pin' ? seePin(source, text) : observeReadable(source, text);
}
