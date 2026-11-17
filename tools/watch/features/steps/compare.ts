import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  compareChangelog,
  compareIndex,
  comparePage,
  comparePin,
  exitCode,
  render,
  renderUnreadable,
  type Finding,
  type Unreadable,
} from '../../src/domain/compare.js';
import { observe, type Seen } from '../../src/domain/observe.js';
import type { Source } from '../../src/domain/register.js';
import { Given, Then, unescape, When, type WatchWorld } from './support.js';

interface Scene {
  source: Source;
  /** What the manifests of a pin pin. */
  pins: { path: string; version: string }[];
  /** The committed addresses of an index; undefined when its list is absent. */
  committed: string[] | undefined;
  finding?: Finding | Unreadable;
  lines?: string[];
}
const scene = (world: WatchWorld): Scene => world.state['compare'] as Scene;
const list = (text: string): string[] => (text === '' ? [] : text.split(', '));
const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const HOST = 'https://code.claude.com';

Given('a watch pin of {string} whose manifests pin {string}', function (name: string, versions: string) {
  const pins = list(versions).map((version, index) => ({ path: `m${index}/package.json`, version }));
  this.state['compare'] = {
    source: { id: 'p', kind: 'pin', package: name, manifests: pins.map((pin) => pin.path) },
    pins,
    committed: undefined,
  } satisfies Scene;
});

Given('a watch changelog read {string}', function (read: string) {
  const [version, on] = read.split(' on ') as [string, string];
  this.state['compare'] = {
    source: {
      id: 'c',
      kind: 'changelog',
      url: 'https://raw.githubusercontent.com/x/y/main/CHANGELOG.md',
      ...(read === 'never' ? {} : { read: { version, on } }),
    },
    pins: [],
    committed: undefined,
  } satisfies Scene;
});

Given('a watch page of the mechanisms {string} read {string}', function (mechanisms: string, read: string) {
  const [text, on] = read.split(' on ') as [string, string];
  this.state['compare'] = {
    source: {
      id: 'g',
      kind: 'page',
      url: `${HOST}/docs/en/g.md`,
      mechanisms: list(mechanisms),
      relies: 'x',
      ...(read === 'never' ? {} : { read: { sha256: sha256(text), on } }),
    },
    pins: [],
    committed: undefined,
  } satisfies Scene;
});

Given('a watch index committing {string}', function (committed: string) {
  this.state['compare'] = {
    source: { id: 'i', kind: 'index', url: `${HOST}/docs/llms.txt`, pages: 'i.txt' },
    pins: [],
    committed: list(committed),
  } satisfies Scene;
});

Given('a watch index never read', function () {
  this.state['compare'] = {
    source: { id: 'i', kind: 'index', url: `${HOST}/docs/llms.txt`, pages: 'i.txt' },
    pins: [],
    committed: undefined,
  } satisfies Scene;
});

When('the watch source is compared with the published version {string}', function (version: string) {
  const current = scene(this);
  compared(current, JSON.stringify({ version }));
});

When('the watch source is compared with the raw text {string}', function (text: string) {
  compared(scene(this), text);
});

When('the watch source is compared with the text {string}', function (text: string) {
  compared(scene(this), unescape(text));
});

function compareSeen(seen: Seen, current: Scene): Finding {
  switch (seen.kind) {
    case 'pin':
      return comparePin(seen, current.pins);
    case 'changelog':
      return compareChangelog(seen);
    case 'page':
      return comparePage(seen);
    case 'index':
      return compareIndex(seen, current.committed);
  }
}

function compared(current: Scene, text: string): void {
  const seen = observe(current.source, text);
  if (seen === undefined) {
    current.finding = { state: 'unreadable', reason: 'contenu refusé' };
    current.lines = renderUnreadable(current.source.id, 'contenu refusé');
  } else {
    const finding = compareSeen(seen, current);
    current.finding = finding;
    current.lines = render(current.source.id, finding, false);
  }
}

Then('the watch verdict is the line {string}', function (line: string) {
  assert.deepEqual(scene(this).lines, [line]);
});

Then('the watch verdict is:', function (expected: string) {
  assert.deepEqual(scene(this).lines, expected.split('\n'));
});

Then('the watch verdict exits with {int}', function (code: number) {
  assert.equal(exitCode([scene(this).finding as Finding | Unreadable]), code);
});

Then('the watch verdict lets the text be kept', function () {
  const finding = scene(this).finding as Finding | Unreadable;
  assert.ok(finding.state === 'behind' && finding.keepable);
});

Then('the watch verdict does not let the text be kept', function () {
  const finding = scene(this).finding as Finding | Unreadable;
  assert.ok(finding.state !== 'behind' || !finding.keepable);
});
