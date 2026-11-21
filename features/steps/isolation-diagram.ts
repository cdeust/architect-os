import assert from 'node:assert/strict';
import { join, relative } from 'node:path';
import type { ProfileTemplate } from '@architect-os/sandbox';
import { Given, ROOT, Then, When, stored } from './helpers.js';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
  FONT,
  IMAGE_FILE,
  ITEM_MAX,
  LINE_MAX,
  PROFILES_DIR,
  TEXTS,
  TEXT_KINDS,
  escapeXml,
  fit,
  type ImageTexts,
  loadProfiles,
  profilesImage,
  room,
  writeProfilesImage,
  type TextKind,
} from '../support/isolation-rows.js';
import type { ArchitectWorld } from '../support/world.js';

// The scenarios of features/arch/isolation-diagram.feature. Two files, two guarantees: docs/diagrams/isolation-profiles.svg
// is the image that features/support/isolation-rows.ts produces from the five profile files, and the whole file must
// equal it; docs/diagrams/architecture.svg is drawn by hand, and only a tripwire reads it. The text of the file under test
// is the one the step "the text of the committed file" stores under `sourceText`.

type ListName = 'writes' | 'closes' | 'reaches';

const REGENERATE = 'npm run diagram:isolation';

Then(
  'the README embeds just the architecture and links to the profile diagram',
  function (this: ArchitectWorld) {
    const readme = stored<string>(this, 'sourceText');
    const architecture = 'docs/diagrams/architecture.svg';
    const images = [...readme.matchAll(/!\[[^\]\n]*\]\(([^)\n]+)\)/g)].map((match) => match[1]);
    assert.deepEqual(images, [architecture]);
    assert.doesNotMatch(readme, /<\s*(?:img|picture|svg|object|iframe|embed)\b|!\[[^\]\n]*\](?:[ \t]*\[|:)/i);
    assert.match(readme, /(?<!!)\[[^\]\n]+\]\(docs\/diagrams\/isolation-profiles\.svg\)/);
    assert(statSync(join(ROOT, architecture)).isFile());
    assert(statSync(join(ROOT, IMAGE_FILE)).isFile());
  },
);

function listOf(template: ProfileTemplate, list: ListName): string[] {
  const { filesystem, network } = template.srt;
  switch (list) {
    case 'writes':
      return filesystem.allowWrite;
    case 'closes':
      return filesystem.denyWrite;
    case 'reaches':
      return network.allowedDomains;
  }
}

function templates(world: ArchitectWorld): Record<string, ProfileTemplate> {
  return stored<Record<string, ProfileTemplate>>(world, 'profileTemplates');
}

/** The image the profiles give, or the reason it cannot be drawn. */
function produced(profiles: Record<string, ProfileTemplate>, texts?: ImageTexts): string {
  try {
    return profilesImage(profiles, texts);
  } catch (error) {
    return (error as Error).message;
  }
}

/** The reason the generated file is refused: it is not, byte for byte, what the profiles give. None when it is. */
function compareImage(svg: string, profiles: Record<string, ProfileTemplate>): string[] {
  const expected = profilesImage(profiles);
  if (svg === expected) return [];
  const a = svg.split('\n');
  const b = expected.split('\n');
  let line = 0;
  while (line < a.length && line < b.length && a[line] === b[line]) line++;
  return [
    `the file is not what the profiles give, first difference at line ${line + 1}; regenerate with: ${REGENERATE}`,
  ];
}

/** The tripwire of the hand-drawn picture: a template string (`${`), a network list host (port left out), any case. */
function tripwire(svg: string, profiles: Record<string, ProfileTemplate>): string[] {
  const findings: string[] = [];
  for (const template of svg.matchAll(/[^\s<>"]*\$\{[^\s<>"]*/g))
    findings.push(`a template string: ${template[0]}`);
  const lower = svg.toLowerCase();
  const hosts = new Set(
    Object.values(profiles)
      .flatMap((template) => listOf(template, 'reaches'))
      .map((host) => host.replace(/:.*$/, '')),
  );
  for (const host of hosts)
    if (lower.includes(host.toLowerCase())) findings.push(`a host of a network list: ${host}`);
  return findings;
}

Given('the five committed profile files of packages\\/sandbox', function () {
  this.state['profileTemplates'] = loadProfiles(join(ROOT, 'packages', 'sandbox', 'profiles'));
});

When(
  'the profile {string} gains {string} in its {string} list',
  function (name: string, item: string, list: ListName | 'token') {
    const template = templates(this)[name] as ProfileTemplate;
    if (list === 'token') template.env.set[item] = '${sessionToken}';
    else listOf(template, list).push(item);
  },
);

Then('the generated image is what the five profiles give', function () {
  assert.deepEqual(compareImage(stored<string>(this, 'sourceText'), templates(this)), []);
});

Then('the generated image is refused for exactly', function (table: { raw(): string[][] }) {
  assert.deepEqual(
    compareImage(stored<string>(this, 'sourceText'), templates(this)),
    table.raw().map((row) => row[0] as string),
  );
});

Then('the hand-drawn picture passes its tripwire', function () {
  assert.deepEqual(tripwire(stored<string>(this, 'sourceText'), templates(this)), []);
});

Then(
  'the hand-drawn picture is stopped by its tripwire for exactly',
  function (table: { raw(): string[][] }) {
    assert.deepEqual(
      tripwire(stored<string>(this, 'sourceText'), templates(this)),
      table.raw().map((row) => row[0] as string),
    );
  },
);

Then('the image produced a second time from the same files is the same bytes', function () {
  assert.equal(profilesImage(templates(this)), profilesImage(templates(this)));
});

Then('the image written for the profiles says {string}', function (text: string) {
  assert.ok(profilesImage(templates(this)).includes(text), `the image does not hold ${text}`);
});

Then('the image written for the profiles does not say {string}', function (text: string) {
  assert.ok(!profilesImage(templates(this)).includes(text), `the image holds ${text}`);
});

/** The text of every line of a list of an image. */
const listLines = (svg: string): string[] =>
  [...svg.matchAll(/<tspan [^>]*>([^<]*)<\/tspan>/g)].map((line) => line[1] as string);

Then('no line of a list of the image written is longer than the room of a line', function () {
  const lines = listLines(profilesImage(templates(this)));
  assert.ok(lines.length > 0);
  for (const line of lines) assert.ok(line.length <= LINE_MAX, `a line of ${line.length} characters`);
});

Then('the item is drawn on a line of its own', function () {
  const item = stored<string>(this, 'longItem');
  assert.equal(item.length, ITEM_MAX);
  assert.equal(listLines(profilesImage(templates(this))).filter((line) => line === item).length, 1);
});

Then(
  'the image is refused because an item is longer than the longest item, the one character over',
  function () {
    const refused = pathOf(ITEM_MAX + 1);
    assert.equal(refused.length, ITEM_MAX + 1);
    assert.equal(
      produced(templates(this)),
      `an item of a list is longer than the longest item (${ITEM_MAX + 1} characters, ${ITEM_MAX} at most): ${refused}`,
    );
  },
);

Then('the image is refused because the sentence of the denied reads does not fit its line', function () {
  assert.match(
    produced(templates(this)),
    /^a text of kind denied does not fit its line \(\d+ characters, 121 at most at 11 px\): builder \d+, reviewer \d+, checker \d+, worker \d+, module \d+: the five lists differ; read in srt\.filesystem\.denyRead$/,
  );
});

/** A write path of `length` characters. */
const pathOf = (length: number): string => `\${tmp}/${'x'.repeat(length - 7)}`;

When('the profile {string} gains a write path as long as the longest item', function (name: string) {
  this.state['longItem'] = pathOf(ITEM_MAX);
  listOf(templates(this)[name] as ProfileTemplate, 'writes').push(pathOf(ITEM_MAX));
});

When('the profile {string} gains a write path one character over the longest item', function (name: string) {
  listOf(templates(this)[name] as ProfileTemplate, 'writes').push(pathOf(ITEM_MAX + 1));
});

When('the profile {string} gains {int} write paths', function (name: string, count: number) {
  const writes = listOf(templates(this)[name] as ProfileTemplate, 'writes');
  for (let i = 0; i < count; i++) writes.push(`\${tmp}/path-number-${i}`);
});

When('each of the five profiles gains {int} paths denied for reading', function (count: number) {
  for (const [name, template] of Object.entries(templates(this)))
    for (let i = 0; i < count; i++) template.srt.filesystem.denyRead.push(`/denied-${name}-${i}`);
});

/** A text of `length` characters. */
const text = (length: number): string => 'x'.repeat(length);

function drawn(kind: TextKind, length: number): string {
  try {
    return fit(text(length), kind);
  } catch (error) {
    return (error as Error).message;
  }
}

Then('a text of kind {word} of {int} characters is drawn whole', function (kind: TextKind, length: number) {
  assert.ok(TEXT_KINDS.includes(kind), `no such kind: ${kind}`);
  assert.equal(drawn(kind, length), text(length));
});

Then(
  'a text of kind {word} of {int} characters is refused saying {string}',
  function (kind: TextKind, length: number, said: string) {
    assert.ok(TEXT_KINDS.includes(kind), `no such kind: ${kind}`);
    assert.equal(drawn(kind, length), `${said}: ${text(length)}`);
  },
);

type ImageKind = 'title' | 'subtitle' | 'header' | 'role';

/** The constants of the image with one of the four given a text of `length` characters. */
function textsWith(kind: ImageKind, length: number): ImageTexts {
  const long = text(length);
  if (kind === 'role') return { ...TEXTS, roles: { ...TEXTS.roles, builder: long } };
  return { ...TEXTS, [kind]: long };
}

Then(
  'the image with a {word} of {int} characters is produced and holds it whole',
  function (kind: ImageKind, length: number) {
    const svg = produced(templates(this), textsWith(kind, length));
    assert.ok(svg.startsWith('<svg'), svg);
    assert.ok(svg.includes(`>${text(length)}</`), 'the text is not in the image');
  },
);

Then(
  'the image with a {word} of {int} characters is refused saying {string}',
  function (kind: ImageKind, length: number, said: string) {
    assert.equal(produced(templates(this), textsWith(kind, length)), `${said}: ${text(length)}`);
  },
);

/**
 * Everything under `dir`, by its path relative to `root`: a directory ends with "/" and is listed as such, a file with
 * what identifies a write (its size, its inode, the nanosecond of its last modification and of its last change) and its
 * content, so that a file rewritten with the same bytes is not the same entry, by its times. The time of a directory
 * is left out: the first file written in it moves it.
 */
function snapshot(root: string, dir = root): Map<string, string> {
  const entries = new Map<string, string>();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    const name = relative(root, path);
    if (entry.isDirectory()) {
      entries.set(`${name}/`, 'directory');
      for (const [k, v] of snapshot(root, path)) entries.set(k, v);
    } else {
      const stat = statSync(path, { bigint: true });
      entries.set(
        name,
        `file ${stat.size} ${stat.ino} ${stat.mtimeNs} ${stat.ctimeNs} ${readFileSync(path, 'utf8')}`,
      );
    }
  }
  return entries;
}

Given('a temporary copy of the repository holding the five profiles and a folder of diagrams', function () {
  const root = mkdtempSync(join(tmpdir(), 'aos-isolation-diagram-'));
  this.cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'packages', 'sandbox'), { recursive: true });
  cpSync(join(ROOT, PROFILES_DIR), join(root, PROFILES_DIR), { recursive: true });
  mkdirSync(join(root, 'docs', 'diagrams'), { recursive: true });
  writeFileSync(join(root, 'docs', 'diagrams', 'architecture.svg'), 'hand-drawn');
  this.state['copyRoot'] = root;
  this.state['snapshots'] = [snapshot(root)];
});

When('the function of the script is run on the copy', function () {
  const root = stored<string>(this, 'copyRoot');
  this.state['wrote'] = [...((this.state['wrote'] as boolean[] | undefined) ?? []), writeProfilesImage(root)];
  (this.state['snapshots'] as Map<string, string>[]).push(snapshot(root));
});

Then('the copy listed before the runs holds exactly', function (table: { raw(): string[][] }) {
  assert.deepEqual(
    [...(stored<Map<string, string>[]>(this, 'snapshots')[0] as Map<string, string>).keys()].sort(),
    table.raw().map((row) => row[0] as string),
  );
});

Then('the first run wrote exactly one file, {string}', function (file: string) {
  const [before, first] = stored<Map<string, string>[]>(this, 'snapshots') as [
    Map<string, string>,
    Map<string, string>,
  ];
  const changed = [...first.keys()].filter((path) => before.get(path) !== first.get(path));
  assert.deepEqual(changed, [file]);
  assert.deepEqual(
    [...before.keys()].filter((path) => !first.has(path)),
    [],
  );
  assert.equal(
    readFileSync(join(stored<string>(this, 'copyRoot'), file), 'utf8'),
    profilesImage(templates(this)),
  );
});

Then('the second run changed nothing in the copy', function () {
  const [, first, second] = stored<Map<string, string>[]>(this, 'snapshots') as [
    Map<string, string>,
    Map<string, string>,
    Map<string, string>,
  ];
  assert.deepEqual([...second], [...first]);
});

Then('the runs wrote {string}', function (expected: string) {
  assert.deepEqual(stored<boolean[]>(this, 'wrote').map(String).join(', '), expected);
});

/** The text elements of an image: their attributes and what they hold. */
function textElements(svg: string): { attributes: string; inner: string }[] {
  return [...svg.matchAll(/<text( [^>]*)?>(.*?)<\/text>/g)].map((m) => ({
    attributes: m[1] ?? '',
    inner: m[2] as string,
  }));
}

/**
 * What the check of the family and of the size refuses in an image: a root family other than `FONT`, no text, a text
 * without a size or with its own family, and a tspan with its own family or size.
 */
function familyFindings(svg: string): string[] {
  const findings: string[] = [];
  const root = /^<svg [^>]*? font-family="([^"]*)"/.exec(svg);
  if (root?.[1] !== FONT) findings.push('the family of the image is not the one the measure assumes');
  const elements = textElements(svg);
  if (elements.length === 0) findings.push('no text element');
  for (const { attributes, inner } of elements) {
    if (!/ font-size="\d+(\.\d+)?"/.test(attributes)) findings.push(`no size: ${inner}`);
    if (/font-family/.test(attributes)) findings.push(`another family: ${inner}`);
  }
  for (const tspan of svg.matchAll(/<tspan( [^>]*)?>/g))
    if (/font-(family|size)/.test(tspan[1] ?? ''))
      findings.push(`a family or a size on a tspan: ${tspan[0]}`);
  return findings;
}

Then(
  'every text element of the image written carries a size and the family the measure assumes',
  function () {
    assert.match(FONT, /, monospace$/);
    assert.deepEqual(familyFindings(profilesImage(templates(this))), []);
  },
);

/** A copy of the produced markup with `attribute` added to its first tspan. */
function withTspanAttribute(svg: string, attribute: string): string {
  const marked = svg.replace('<tspan ', `<tspan ${attribute} `);
  assert.notEqual(marked, svg, 'the image has no tspan');
  return marked;
}

for (const [attribute, said] of [
  ['font-family', 'font-family="serif"'],
  ['font-size', 'font-size="30"'],
] as const)
  Then(`the produced image with a ${attribute} on one of its tspan is refused`, function () {
    const svg = profilesImage(templates(this));
    assert.deepEqual(familyFindings(svg), []);
    const findings = familyFindings(withTspanAttribute(svg, said));
    assert.equal(findings.length, 1);
    assert.match(findings[0] as string, new RegExp(`^a family or a size on a tspan: <tspan ${said} `));
  });

/** The texts of a kind in the image: those the scenario knows of by what they say. */
function textsOfKind(kind: TextKind, profiles: Record<string, ProfileTemplate>): string[] {
  switch (kind) {
    case 'title':
      return [TEXTS.title];
    case 'subtitle':
      return [TEXTS.subtitle];
    case 'header':
      return [TEXTS.header];
    case 'role':
      return Object.values(TEXTS.roles);
    case 'name':
      return ['Profile', 'denied reads', ...Object.keys(TEXTS.roles)];
    case 'label':
      return ['writes', 'closes', 'reaches', 'token in'];
    case 'line':
      return [];
    case 'denied':
      return [
        profilesImage(profiles).match(/<text [^>]*>((?:\d+ paths|builder \d+,)[^<]*)<\/text>/)?.[1] ?? '',
      ];
  }
}

Then(
  'every text of kind {word} of the image written is drawn at the size its measure says',
  function (kind: TextKind) {
    assert.ok(TEXT_KINDS.includes(kind), `no such kind: ${kind}`);
    const measured = /at (\S+) px\)/.exec(drawn(kind, room(kind) + 1))?.[1];
    assert.ok(measured, 'the measure does not say its size');
    const profiles = templates(this);
    const elements = textElements(profilesImage(profiles));
    const wanted = new Set(textsOfKind(kind, profiles).map((t) => escapeXml(t)));
    const found = elements.filter(({ inner }) =>
      kind === 'line' ? inner.startsWith('<tspan ') : wanted.has(inner),
    );
    assert.ok(found.length > 0, `no text of kind ${kind} found in the image`);
    if (kind !== 'line') assert.ok(found.length >= wanted.size, `a text of kind ${kind} is missing`);
    for (const { attributes, inner } of found)
      assert.match(attributes, new RegExp(` font-size="${measured.replace('.', '\\.')}"`), inner);
  },
);
