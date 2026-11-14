import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { EvidenceAnswerSchema } from '@architect-os/contracts';
import { REASON_CODES } from '../../src/domain/contract.js';
import { Then, When } from './support.js';

const SKILL = new URL('../../skill/', import.meta.url);
const read = (name: string): string => readFileSync(join(SKILL.pathname, name), 'utf8');

type Json = Record<string, any>;

const generated = (): unknown => z.toJSONSchema(EvidenceAnswerSchema, { target: 'draft-07' });

/** Front matter then body, as Claude Science reads a skill (docs/design/evidence-desk.md §1). */
const FrontMatter = z.looseObject({
  name: z.literal('evidence-desk'),
  description: z.string().min(1).max(1024),
  license: z.literal('MIT'),
});

/** The codes of the first column of the table under "Reasons of refusal", in order. */
function reasonCodes(body: string): string[] {
  const section = body.split(/^## Reasons of refusal$/m)[1] ?? '';
  return [...section.matchAll(/^\| `([A-Z_]+)`/gm)].map((match) => match[1] as string);
}

function checkSkill(text: string): void {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  assert.ok(match !== null, 'expected YAML front matter and a body');
  assert.notEqual((match[2] ?? '').trim(), '', 'the body is empty');
  FrontMatter.parse(parse(match[1] ?? ''));
  assert.deepEqual(reasonCodes(match[2] ?? ''), [...REASON_CODES]);
}

const SCHEMA_CHANGES: Record<string, (schema: Json) => void> = {
  'a changed maximum': (s) =>
    (s['properties']['claims']['items']['properties']['statement']['maxLength'] = 601),
  'a key that is not required': (s) => (s['required'] = ['id', 'claims']),
  'an open top level': (s) => delete s['additionalProperties'],
  'an empty object': (s) => Object.keys(s).forEach((key) => delete s[key]),
};

const bodyLine = (text: string, code: string): string =>
  text
    .split('\n')
    .filter((line) => !line.startsWith(`| \`${code}\``))
    .join('\n');

const SKILL_DEFECTS: Record<string, (text: string) => string> = {
  'no front matter': (text) => text.replace(/^---\n[\s\S]*?\n---\n/, ''),
  'an empty body': (text) => `${/^---\n[\s\S]*?\n---\n/.exec(text)?.[0] as string}\n`,
  'another name': (text) => text.replace('name: evidence-desk', 'name: evidence'),
  'no description': (text) => text.replace(/^description: .*\n/m, ''),
  'a description of 1025 characters': (text) =>
    text.replace(/^description: .*$/m, `description: ${'d'.repeat(1025)}`),
  'a description of 1024 characters': (text) =>
    text.replace(/^description: .*$/m, `description: ${'d'.repeat(1024)}`),
  'another license': (text) => text.replace('license: MIT', 'license: GPL'),
  'no license': (text) => text.replace(/^license: .*\n/m, ''),
  'a code missing': (text) => bodyLine(text, 'QUOTE_ABSENT'),
  'an unknown code added': (text) =>
    text.replace('| `QUOTE_ABSENT`', '| `QUOTE_UNSUPPORTED` | x | y |\n| `QUOTE_ABSENT`'),
  'two codes swapped': (text) =>
    text
      .replace('`DOI_UNKNOWN`', '`TMP`')
      .replace('`TITLE_MISMATCH`', '`DOI_UNKNOWN`')
      .replace('`TMP`', '`TITLE_MISMATCH`'),
  'no table of reasons': (text) => text.replace('## Reasons of refusal', '## Refusals'),
};

When('I read the committed evidence answer schema', function () {
  this.state['evidenceSchema'] = JSON.parse(read('answer.schema.json')) as Json;
});

When('I change a copy of the evidence answer schema with {string}', function (change: string) {
  const copy = structuredClone(this.state['evidenceSchema']) as Json;
  (SCHEMA_CHANGES[change] as (schema: Json) => void)(copy);
  this.state['evidenceSchemaCopy'] = copy;
});

Then('the evidence answer schema is the one generated from the zod contract', function () {
  assert.deepEqual(this.state['evidenceSchema'], generated());
  assert.equal((this.state['evidenceSchema'] as Json)['$schema'], 'http://json-schema.org/draft-07/schema#');
});

Then('the evidence answer schema copy differs from the generated one', function () {
  assert.notDeepEqual(this.state['evidenceSchemaCopy'], generated());
});

When('I read the committed evidence skill', function () {
  this.state['evidenceSkill'] = read('SKILL.md');
});

When('I break a copy of the evidence skill with {string}', function (defect: string) {
  const text = this.state['evidenceSkill'] as string;
  const broken = (SKILL_DEFECTS[defect] as (text: string) => string)(text);
  assert.notEqual(broken, text, `the defect "${defect}" changed nothing`);
  this.state['evidenceSkill'] = broken;
});

Then('the evidence skill checks pass', function () {
  checkSkill(this.state['evidenceSkill'] as string);
});

Then('the evidence skill checks fail', function () {
  assert.throws(() => checkSkill(this.state['evidenceSkill'] as string));
});
