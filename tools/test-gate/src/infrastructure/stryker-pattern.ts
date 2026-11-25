import { resolve } from 'node:path';
import { escape } from 'minimatch';
import { requireLiteralMutationPath } from '../domain/mutate-pattern.js';

/** FileMatcher resolves before minimatch and normalizes backslashes. Use character classes for literal metacharacters. */
export function literalStrykerPattern(root: string, file: string): string {
  const absolute = resolve(root, file);
  requireLiteralMutationPath(absolute);
  const options = { windowsPathsNoEscape: true };
  if (escape(root, options) !== root) return escape(absolute, options);
  const relative = escape(file, options);
  return relative.startsWith('!') ? './' + relative : relative;
}
