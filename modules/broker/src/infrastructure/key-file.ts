import { readFileSync, statSync } from 'node:fs';

/**
 * The API key, read from its file, which only its owner may read or write (0600 or stricter): the broker is the only
 * holder of the key (§2, Broker ; R-3, R-8). Read at each request, so that a key changed on disk takes effect and a
 * file whose mode was opened stops the spending. An error names the file and the rule, never its content.
 */
export function readKeyFile(path: string): string {
  const stat = statSync(path);
  if (!stat.isFile()) throw new Error(`key file is not a regular file: ${path}`);
  if ((stat.mode & 0o077) !== 0)
    throw new Error(`key file must be readable by its owner only (0600): ${path}`);
  const key = readFileSync(path, 'utf8').trim();
  if (!/^\S+$/.test(key)) throw new Error(`key file holds no key: ${path}`);
  return key;
}
