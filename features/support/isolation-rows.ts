import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTemplate, type ProfileTemplate } from '@architect-os/sandbox';

// docs/diagrams/isolation-profiles.svg is produced here whole, from the five profile files of packages/sandbox/profiles
// (`npm run diagram:isolation` writes it). features/arch/isolation-diagram.feature requires the whole file to equal what
// this produces. No part of that file is written by hand.

export const PROFILES = ['builder', 'reviewer', 'checker', 'worker', 'module'] as const;

/** What a row says a session is: the role of the profile, not a list of its file. */
const ROLE: Record<(typeof PROFILES)[number], string> = {
  builder: 'a build session. The host owns Git metadata and checks recorded ignore files.',
  reviewer: 'a review session',
  checker: 'a check of a step: a command, no model',
  worker: 'the agent worker of one task',
  module: 'a platform module, MCP on its stdio',
};

/** The table starts here; its right edge is at `BORDER`, inside the frame of the image (`WIDTH`). */
const TABLE_TOP = 98;
const WIDTH = 980;
const BORDER = 960;
/**
 * Every text of the image is declared in one list of monospace families (`FONT`), so that the width of a text can be
 * taken as its count of characters times a factor of its size, with no renderer to ask. What was measured, by one
 * render (rsvg-convert on macOS, 2026-11-19), on a line of 100 characters at 11 px: the family Menlo, named alone,
 * 662 px (0.602 of the size for a character; the same at 12, 12.5 and 17 px, in regular and in bold); the generic
 * family `monospace`, named alone, which that render resolved to Menlo (662 px); the whole list of `FONT`, which that
 * render also resolved to Menlo (662 px). Courier New, not in the list, gave 0.600. NOT measured: ui-monospace, the
 * first family of the list, and SF Mono, Consolas and DejaVu Sans Mono: named alone, none of the four exists in that
 * render, which drew a proportional fallback (916 px), so what any of them gives where it is installed is unknown
 * (Consolas is said to be narrower and DejaVu Sans Mono wider than Menlo; neither is measured). A family wider than
 * 0.62 draws past the room, and no scenario can say it.
 * `ADVANCE` is 0.62, taken above the measure of Menlo, in thousandths so that the room is computed on integers.
 */
export const FONT = "ui-monospace, 'SF Mono', Menlo, Consolas, 'DejaVu Sans Mono', monospace";
const ADVANCE = 620;

/**
 * Where each kind of text is drawn: its x, its font size in px, and the x its room ends at (the column that follows,
 * or the right border).
 */
const PLACE = {
  title: { x: 24, size: 17, end: BORDER },
  subtitle: { x: 24, size: 12.5, end: BORDER },
  header: { x: 132, size: 12, end: BORDER },
  role: { x: 132, size: 12, end: BORDER },
  /** A line of a list: one item or more, and a trailing " ·" when the list goes on at the next line. */
  line: { x: 190, size: 11, end: BORDER },
  denied: { x: 132, size: 11, end: BORDER },
  /** The name of a profile, the first column header and the label of the last row: the column ends at 132. */
  name: { x: 32, size: 12, end: 132 },
  /** The label of a list: the column ends at 190. */
  label: { x: 132, size: 11, end: 190 },
} as const;
export type TextKind = keyof typeof PLACE;
export const TEXT_KINDS = Object.keys(PLACE) as TextKind[];

const LINE_STEP = 14;
/** The longest text of a kind, in characters: the x its room ends at is not passed. */
export const room = (kind: TextKind): number =>
  Math.floor(((PLACE[kind].end - PLACE[kind].x) * 1000) / (PLACE[kind].size * ADVANCE));
/** The room of a line of a list, its trailing " ·" included when it has one. */
export const LINE_MAX = room('line');
/**
 * The longest item: the room of a line less the two characters of the separator " ·" that may follow it; an item that
 * long is always on a line of its own.
 */
export const ITEM_MAX = LINE_MAX - 2;

export const escapeXml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/** A text of a kind, escaped; refused if it does not fit the room of its line at the size it is drawn at. */
export function fit(text: string, kind: TextKind): string {
  if (text.length > room(kind))
    throw new Error(
      `a text of kind ${kind} does not fit its line (${text.length} characters, ${room(kind)} at most at ${PLACE[kind].size} px): ${text}`,
    );
  return escapeXml(text);
}

/** What a value of `env.set` holds when it carries the token of a session or of a task, given by the launcher. */
const TOKEN_VALUE = /\$\{(sessionToken|taskToken)\}/;

/** The four lists of a row, in the words of the profile file: its token variables are named, not their values. */
function listsOf(template: ProfileTemplate): [string, string[]][] {
  const { filesystem, network } = template.srt;
  return [
    ['writes', filesystem.allowWrite],
    ['closes', filesystem.denyWrite],
    ['reaches', network.allowedDomains],
    [
      'token in',
      Object.entries(template.env.set)
        .filter(([, value]) => TOKEN_VALUE.test(value))
        .map(([name]) => name),
    ],
  ];
}

/**
 * The lines of a list: items joined by " · ", cut between two items so that no line passes `LINE_MAX` (the room of a line); "none" if empty.
 * An item longer than `ITEM_MAX` is refused: with the " ·" that may follow it, its line would pass its room.
 */
export function wrap(items: readonly string[]): string[] {
  if (items.length === 0) return ['none'];
  const lines: string[] = [];
  let line = '';
  for (const item of items) {
    if (item.length > ITEM_MAX)
      throw new Error(
        `an item of a list is longer than the longest item (${item.length} characters, ${ITEM_MAX} at most): ${item}`,
      );
    const next = line === '' ? item : `${line} · ${item}`;
    if (line !== '' && next.length + 2 > LINE_MAX) {
      lines.push(`${line} ·`);
      line = item;
    } else line = next;
  }
  lines.push(line);
  return lines;
}

function row(
  name: (typeof PROFILES)[number],
  role: string,
  template: ProfileTemplate,
  top: number,
): { markup: string; end: number } {
  const first = top + 16;
  const out = [
    `    <g id="profile-${name}">`,
    `      <text x="${PLACE.name.x}" y="${first}" font-size="${PLACE.name.size}" fill="#1f2328">${fit(name, 'name')}</text><text x="${PLACE.role.x}" y="${first}" font-size="${PLACE.role.size}" fill="#57606a">${fit(role, 'role')}</text>`,
  ];
  let y = first + 16;
  for (const [label, items] of listsOf(template)) {
    const lines = wrap(items);
    const spans = lines
      .map((text, i) => `<tspan x="${PLACE.line.x}" y="${y + i * LINE_STEP}">${fit(text, 'line')}</tspan>`)
      .join('');
    out.push(
      `      <text x="${PLACE.label.x}" y="${y}" font-size="${PLACE.label.size}" fill="#57606a">${fit(label, 'label')}</text>`,
      `      <text font-size="${PLACE.line.size}" fill="#1f2328">${spans}</text>`,
    );
    y += lines.length * LINE_STEP;
  }
  const end = y - LINE_STEP + 10;
  out.push('    </g>');
  return {
    markup: [
      `    <rect x="20" y="${top}" width="940" height="${end - top}" fill="#ffffff" stroke="#d0d7de"/>`,
      ...out,
    ].join('\n'),
    end,
  };
}

/** What the five files say of the paths denied for reading: one count when the lists are the same, else one per file. */
function deniedSentence(profiles: Record<string, ProfileTemplate>): string {
  const lists = PROFILES.map((name) => (profiles[name] as ProfileTemplate).srt.filesystem.denyRead);
  const same = lists.every(
    (list) => list.length === lists[0]?.length && list.every((p, i) => p === lists[0]?.[i]),
  );
  const where = 'read in srt.filesystem.denyRead';
  if (same) return `${String(lists[0]?.length)} paths, the same list in the five profiles; ${where}`;
  return `${PROFILES.map((name, i) => `${name} ${String(lists[i]?.length)}`).join(', ')}: the five lists differ; ${where}`;
}

/** The texts of the image that are constants; a parameter of `profilesImage` so that a scenario can give a longer one. */
export interface ImageTexts {
  title: string;
  subtitle: string;
  header: string;
  roles: Record<(typeof PROFILES)[number], string>;
}
export const TEXTS: ImageTexts = {
  title: 'What each profile opens: the five profiles of the isolation',
  subtitle:
    'packages/sandbox/profiles, one row per file; produced by npm run diagram:isolation, never edited by hand',
  header:
    'Role; then writes (allowWrite) · closes (denyWrite) · reaches (allowedDomains) · token in (names in env.set)',
  roles: ROLE,
};
const DESCRIPTION =
  'One row for each of the five profiles of the isolation, builder, reviewer, checker, worker and module: its role, the paths it opens for writing, the paths it closes for writing, the hosts its network list allows, and the variables of its environment that hold a token. A last row counts the paths denied for reading: one count when the five lists are the same, else one per profile. The image is produced from the five files of packages/sandbox/profiles by one function, and the gate requires the file to equal what it produces.';

/**
 * The whole image: its title and description, the five rows, then the row that counts the paths denied for reading.
 * Refused if a text does not fit the room of its line.
 */
export function profilesImage(profiles: Record<string, ProfileTemplate>, texts: ImageTexts = TEXTS): string {
  const parts: string[] = [];
  let top = TABLE_TOP;
  for (const name of PROFILES) {
    const made = row(name, texts.roles[name], profiles[name] as ProfileTemplate, top);
    parts.push(made.markup);
    top = made.end;
  }
  const denied = fit(deniedSentence(profiles), 'denied');
  const end = top + 28;
  const height = end + 16;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${height}" width="${WIDTH}" height="${height}" role="img" aria-labelledby="t d" font-family="${FONT}">`,
    `  <title id="t">${escapeXml(texts.title)}</title>`,
    `  <desc id="d">${escapeXml(DESCRIPTION)}</desc>`,
    `  <rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${height - 1}" rx="10" fill="#ffffff" stroke="#d0d7de"/>`,
    `  <text x="${PLACE.title.x}" y="34" font-size="${PLACE.title.size}" font-weight="600" fill="#1f2328">${fit(texts.title, 'title')}</text>`,
    `  <text x="${PLACE.subtitle.x}" y="54" font-size="${PLACE.subtitle.size}" fill="#57606a">${fit(texts.subtitle, 'subtitle')}</text>`,
    '  <g>',
    `    <rect x="20" y="72" width="940" height="26" fill="#f6f8fa" stroke="#d0d7de"/>`,
    `    <text x="${PLACE.name.x}" y="90" font-size="${PLACE.name.size}" font-weight="600" fill="#1f2328">${fit('Profile', 'name')}</text><text x="${PLACE.header.x}" y="90" font-size="${PLACE.header.size}" font-weight="600" fill="#1f2328">${fit(texts.header, 'header')}</text>`,
    ...parts,
    `    <rect x="20" y="${top}" width="940" height="28" fill="#ffffff" stroke="#d0d7de"/>`,
    '    <g id="denied-read">',
    `      <text x="${PLACE.name.x}" y="${top + 18}" font-size="${PLACE.name.size}" fill="#cf222e">${fit('denied reads', 'name')}</text><text x="${PLACE.denied.x}" y="${top + 18}" font-size="${PLACE.denied.size}" fill="#1f2328">${denied}</text>`,
    '    </g>',
    '  </g>',
    '</svg>',
    '',
  ].join('\n');
}

/** The five profiles of a directory of profile files. */
export function loadProfiles(dir: string): Record<string, ProfileTemplate> {
  const loaded: Record<string, ProfileTemplate> = {};
  for (const name of PROFILES) loaded[name] = structuredClone(loadTemplate(dir, name));
  return loaded;
}

/** The file the image is written to, and the directory of the profile files, under a root of the repository. */
export const IMAGE_FILE = join('docs', 'diagrams', 'isolation-profiles.svg');
export const PROFILES_DIR = join('packages', 'sandbox', 'profiles');

/**
 * What `npm run diagram:isolation` does, under `root`: writes IMAGE_FILE whole from the five profile files, only if it
 * differs, and returns whether it wrote. It starts no process and writes no other file.
 */
export function writeProfilesImage(root: string): boolean {
  const file = join(root, IMAGE_FILE);
  const next = profilesImage(loadProfiles(join(root, PROFILES_DIR)));
  let current: string | undefined;
  try {
    current = readFileSync(file, 'utf8');
  } catch {
    current = undefined;
  }
  if (next === current) return false;
  writeFileSync(file, next);
  return true;
}
