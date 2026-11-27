// The title and the body of the pull request a delivery opens (docs/design/exigences-spec.md, §4, « Le corps »): rendered
// by the host from the typed fields of `steps/<name>/record.json` of the delivered commit, and from nothing a session
// wrote. Pure: the record is read and checked by its schema before it reaches here (`ParseRecord`).

/** What the body takes of a Step record (packages/sandbox/src/step-record.ts, `StepRecord`). */
export interface StepRecordView {
  step: string;
  tree: { commit: string; tree: string; clean: boolean };
  inputs: Readonly<Record<string, string>>;
  launcher: Readonly<Record<string, string>>;
  checks: readonly { name: string; passed: boolean; stopped: boolean; durationSeconds: number }[];
  reviews: readonly {
    name: string;
    verdict: string;
    findings: number;
    criteria?: readonly { id: string; status: string }[] | undefined;
  }[];
  outcome: string;
}

/** The record of the bytes of a file, UTF-8 and checked by the schema of the Step record; undefined otherwise. */
export type ParseRecord = (bytes: Uint8Array) => StepRecordView | undefined;

/** What the body names besides the record: where the record is, in the commit that holds it. */
export interface Delivered {
  /** `owner/name`. */
  repository: string;
  hash: string;
  name: string;
}

// The patterns are built inside functions: a literal at module level is evaluated once, when the file loads, and the
// mutation run would replay the whole suite for each of its mutants.
function keywords(): RegExp {
  // The words by which a pull request closes an issue (GitHub, « Linking a pull request to an issue »).
  return /\b(close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved)\b/gi;
}

/**
 * A value made inert as text: no control character (a line break would end a row of a table), no `@` that mentions an
 * account, no `#` that names an issue, no `:` that starts an address, no keyword that closes an issue. A zero-width
 * space is put after each `@`, `#` and `:` and after the first letter of each keyword: what is read stays the same,
 * what GitHub links is gone. `|` would split a cell of a table, and a backtick end a code span: both are replaced.
 */
export function inert(value: string): string {
  return value
    .replace(/\p{Cc}/gu, ' ')
    .replace(/`/g, "'")
    .replace(/\|/g, '¦')
    .replace(/[@#:]/g, (sign) => `${sign}​`)
    .replace(keywords(), (word) => `${word.slice(0, 1)}​${word.slice(1)}`);
}

/** A value, inert, in a code span: GitHub renders no mention, no reference and no emphasis inside one. */
export function code(value: string): string {
  return `\`${inert(value)}\``;
}

/** The title: the template of the descriptive file, its `${name}` replaced by the name, made inert. */
export function pullRequestTitle(template: string, name: string): string {
  return inert(template.replace('${name}', name));
}

function table(header: readonly string[], rows: readonly (readonly string[])[]): string[] {
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ];
}

/** The files and their SHA-256, in the order of the record. */
function digests(title: string, files: Readonly<Record<string, string>>): string[] {
  const rows = Object.entries(files).map(([file, digest]) => [code(file), code(digest)]);
  return ['', `### ${title}`, '', ...(rows.length === 0 ? ['None.'] : table(['File', 'SHA-256'], rows))];
}

function reviews(record: StepRecordView): string[] {
  if (record.reviews.length === 0) return ['', '### Reviews', '', 'No review is recorded.'];
  const lines = [
    '',
    '### Reviews',
    '',
    ...table(
      ['Review', 'Verdict', 'Findings'],
      record.reviews.map((review) => [code(review.name), code(review.verdict), String(review.findings)]),
    ),
  ];
  for (const review of record.reviews) {
    const criteria = review.criteria ?? [];
    if (criteria.length === 0) continue;
    lines.push(
      '',
      `#### Acceptance criteria of ${code(review.name)}`,
      '',
      ...table(
        ['Criterion', 'Status'],
        criteria.map((criterion) => [code(criterion.id), code(criterion.status)]),
      ),
    );
  }
  return lines;
}

function checks(record: StepRecordView): string[] {
  const rows = record.checks.map((check) => [
    code(check.name),
    code(String(check.passed)),
    code(String(check.stopped)),
    String(check.durationSeconds),
  ]);
  return [
    '',
    '### Checks',
    '',
    ...(rows.length === 0
      ? ['No check is recorded.']
      : table(['Check', 'Passed', 'Stopped', 'Seconds'], rows)),
  ];
}

/** Each segment of an address, encoded: a value can neither leave its segment nor start a mention or a fragment. */
function recordAddress(delivered: Delivered): string {
  const segments = [
    ...delivered.repository.split('/'),
    'blob',
    delivered.hash,
    'steps',
    delivered.name,
    'record.json',
  ];
  // `encodeURIComponent` leaves `(`, `)`, `'`, `*` and `!`: a `)` would end the address of the link.
  const encode = (segment: string): string =>
    encodeURIComponent(segment).replace(
      /[!'()*]/g,
      (sign) => `%${sign.charCodeAt(0).toString(16).toUpperCase()}`,
    );
  return `https://github.com/${segments.map(encode).join('/')}`;
}

/**
 * The body: the outcome of the step, the verdict and the findings of every review and the status of each acceptance
 * criterion it gave, the checks, the SHA-256 of the inputs and of the files of the launcher, and the tree the step saw.
 * Every value of the record is in a code span and inert; the fixed text holds no keyword that closes an issue.
 */
export function pullRequestBody(record: StepRecordView, delivered: Delivered): string {
  return [
    `Delivery of the step ${code(record.step)} at the commit ${code(delivered.hash)}. Outcome of the step: ${code(record.outcome)}.`,
    '',
    `Rendered by the host from [${code(`steps/${delivered.name}/record.json`)}](${recordAddress(delivered)}) of this commit alone: no text a session wrote is in it.`,
    ...reviews(record),
    ...checks(record),
    ...digests('Inputs', record.inputs),
    ...digests('Launcher', record.launcher),
    '',
    '### Tree the step saw',
    '',
    ...table(
      ['Commit', 'Tree', 'Clean'],
      [[code(record.tree.commit), code(record.tree.tree), code(String(record.tree.clean))]],
    ),
    '',
  ].join('\n');
}
