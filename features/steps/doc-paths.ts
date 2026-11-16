import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Given, ROOT, Then, When, stored } from './helpers.js';

// CLAUDE.md and docs/ describe the tree as it is. Two commits removed the first realisation and Docker and left
// their paths in these documents, and the gate was green (journal, §68): nothing read the paths. These steps do.

/** A token with one of these is a pattern or a placeholder, not a path: `services/<name>/worker`, `data/sql/*.sql`. */
const NOT_LITERAL = /[<>*{}$|()[\]=]/;

/** Directories a build or a run writes: what they hold depends on the host, so a path into them is not checked. */
const GENERATED = new Set(['dist', 'node_modules', 'reports', '.stryker-tmp', '.git']);

/**
 * The paths of the repository a document cites and that do not exist. A citation is a token between backticks,
 * without a space, whose first segment is an entry of the root; its anchor (`#...`) and its line (`:12`) are not
 * part of the path.
 */
function missingPaths(text: string, roots: ReadonlySet<string>, exists: (path: string) => boolean): string[] {
  const cited = [...text.matchAll(/`([^`\s]+)`/g)].map((match) => match[1] as string);
  const paths = cited
    .filter((token) => token.includes('/') && !NOT_LITERAL.test(token))
    .map((token) => token.split(/[#:]/)[0] as string)
    .filter((path) => {
      const segments = path.split('/');
      return roots.has(segments[0] as string) && !segments.some((segment) => GENERATED.has(segment));
    });
  return [...new Set(paths)].filter((path) => !exists(path));
}

const missingIn = (text: string): string[] =>
  missingPaths(text, new Set(readdirSync(ROOT)), (path) => existsSync(join(ROOT, path)));

Given('the committed document {string}', function (name: string) {
  this.state['document'] = readFileSync(join(ROOT, name), 'utf8');
});

Then('every path of the repository it cites exists', function () {
  assert.deepEqual(missingIn(stored<string>(this, 'document')), []);
});

When(
  'a copy of the committed document {string} also cites {string}',
  function (name: string, citation: string) {
    this.state['document'] = `${readFileSync(join(ROOT, name), 'utf8')}\nSee ${citation}.\n`;
  },
);

Then('that copy of the document is refused for the path {string}', function (path: string) {
  assert.deepEqual(missingIn(stored<string>(this, 'document')), [path]);
});

Then('that copy of the document is accepted', function () {
  assert.deepEqual(missingIn(stored<string>(this, 'document')), []);
});
