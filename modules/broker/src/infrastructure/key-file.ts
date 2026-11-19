import { readFileSync, statSync } from 'node:fs';

/**
 * The API key, read from its file, giving no permission to its group nor to others (0600 for example): the broker is
 * the only holder of the key (§2, Broker ; R-3, R-8). Read at each request, so that a key changed on disk takes
 * effect and a file whose mode was opened stops the spending. An error names the file and the rule,
 * never its content.
 */
export function readKeyFile(path: string): string {
  const stat = statSync(path);
  if (!stat.isFile()) throw new Error(`key file is not a regular file: ${path}`);
  if ((stat.mode & 0o077) !== 0)
    throw new Error(
      `key file must give no permission to its group nor to others (0600 for example): ${path}`,
    );
  const key = readFileSync(path, 'utf8').trim();
  if (!/^\S+$/.test(key)) throw new Error(`key file holds no key: ${path}`);
  return key;
}
