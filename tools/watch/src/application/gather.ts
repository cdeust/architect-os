// Reading one source: its address, and what the repository holds of it.
import { addressesOf } from '../domain/observe.js';
import type { Files } from '../domain/ports.js';
import { pinnedVersion, type IndexSource, type PinSource, type Source } from '../domain/register.js';

/** The address read for a source: the published version of a pin is at the npm registry. */
export const addressOf = (source: Source): string =>
  source.kind === 'pin' ? `https://registry.npmjs.org/${source.package}/latest` : source.url;

/** The version each manifest of a pin holds, undefined where it pins none. */
export const pinsOf = (
  source: PinSource,
  repository: Files,
): { path: string; version: string | undefined }[] =>
  source.manifests.map((path) => ({ path, version: pinnedVersion(repository.read(path), source.package) }));

/** The committed addresses of an index: undefined when its list is absent, which is an index never read. */
export function committedOf(source: IndexSource, repository: Files): string[] | undefined {
  const text = repository.read(source.pages);
  return text === undefined ? undefined : addressesOf(new URL(source.url).hostname, text);
}
