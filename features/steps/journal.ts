import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Given, ROOT, Then, When, stored } from './helpers.js';

// docs/design/journal.md is the dated record of the design: other documents, and people outside the repository, cite
// its sections by number. Once, a commit rewrote the file with its new section alone and the gate was green (journal,
// §58): nothing read the file. These steps do.

const TITLE = '# Journal de conception, plateforme v3 sous srt';

/** What is wrong with a journal, or null: its title first, then its sections numbered from 1 without a gap. */
function defectOf(text: string): string | null {
  if (!text.startsWith(`${TITLE}\n`)) return 'it does not start with its title';
  const numbers = [...text.matchAll(/^## (\d+)\. /gm)].map((match) => Number(match[1]));
  if (numbers.length === 0) return 'it has no numbered section';
  const wrong = numbers.findIndex((number, index) => number !== index + 1);
  return wrong === -1 ? null : `its section in position ${wrong + 1} is numbered ${numbers[wrong]}`;
}

const committed = (): string => readFileSync(join(ROOT, 'docs', 'design', 'journal.md'), 'utf8');

/** The text of a journal from its first section numbered `from` on. */
const from = (text: string, number: number): string => text.slice(text.indexOf(`\n## ${number}. `) + 1);

const BROKEN: Record<string, (text: string) => string> = {
  'only its last two sections': (text) => {
    const last = [...text.matchAll(/^## (\d+)\. /gm)].length;
    return `\n${from(text, last - 1)}`;
  },
  'its title, then its sections from the second on': (text) => `${TITLE}\n\n${from(text, 2)}`,
  'its third section missing': (text) => text.slice(0, text.indexOf('\n## 3. ') + 1) + from(text, 4),
  'its second section twice': (text) => text.slice(0, text.indexOf('\n## 3. ') + 1) + from(text, 2),
  'no section at all': () => `${TITLE}\n\nNothing yet.\n`,
  'another title': (text) => text.replace(TITLE, '# Journal'),
};

Given('the committed journal of the design', function () {
  this.state['journal'] = committed();
});

Then('the journal starts with its title, and its sections are numbered from 1 without a gap', function () {
  assert.equal(defectOf(stored<string>(this, 'journal')), null);
});

When('a copy of the committed journal is read with {}', function (defect: string) {
  const breakIt = BROKEN[defect];
  assert.ok(breakIt, `no defect named "${defect}"`);
  const copy = breakIt(committed());
  assert.notEqual(copy, committed(), 'the copy is the journal itself');
  this.state['journal-defect'] = defectOf(copy);
});

Then('that copy of the journal is refused, because {string}', function (reason: string) {
  assert.equal(this.state['journal-defect'], reason);
});
