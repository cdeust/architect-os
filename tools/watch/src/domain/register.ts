// The register `tools/watch/watch.json` (docs/design/anthropic-watch.md §2): what the platform holds of Anthropic, and what
// has been read of it. Its strict schema is in infrastructure (`register-schema.ts`), behind `ParseRegister`.

/** Whether a value is a version of the form x.y.z: a string first, since a regular expression turns an array into one. */
export function isVersion(value: unknown): value is string {
  return typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value);
}

export interface PinSource {
  id: string;
  kind: 'pin';
  package: string;
  manifests: string[];
}
export interface ChangelogSource {
  id: string;
  kind: 'changelog';
  url: string;
  read?: { version: string; on: string };
}
export interface PageSource {
  id: string;
  kind: 'page';
  url: string;
  mechanisms: string[];
  relies: string;
  read?: { sha256: string; on: string };
}
export interface IndexSource {
  id: string;
  kind: 'index';
  url: string;
  pages: string;
}
export type Source = PinSource | ChangelogSource | PageSource | IndexSource;
export interface Register {
  sources: Source[];
}

/**
 * The register as the tool writes it: `read` rewrites the whole file, so the committed one is kept in this form and a
 * reading changes only the `read` of its sources. The keys of a source are in the order of the schema.
 */
export function canonical(register: Register): string {
  return `${JSON.stringify(register, null, 2)}\n`;
}

/** Checks a parsed JSON value against the schema of the register; the reason is one line naming the first fault. */
export type ParseRegister = (
  raw: unknown,
) => { ok: true; register: Register } | { ok: false; reason: string };

/** The value at `keys` in the JSON `text`; undefined when the text is not JSON or a step of the way is not there. */
export function jsonAt(text: string | undefined, ...keys: string[]): unknown {
  let value: unknown;
  try {
    // An absent file (undefined) is the text "undefined", which is not JSON.
    value = JSON.parse(String(text));
  } catch {
    // Not JSON: the value stays undefined, and so does every step of the walk below.
  }
  for (const key of keys) value = (value as Record<string, unknown> | null | undefined)?.[key];
  return value;
}

/** The version a manifest pins a package to, when it is an exact one; `manifest` is undefined when the file is absent. */
export function pinnedVersion(manifest: string | undefined, name: string): string | undefined {
  const pinned = jsonAt(manifest, 'dependencies', name);
  return isVersion(pinned) ? pinned : undefined;
}
