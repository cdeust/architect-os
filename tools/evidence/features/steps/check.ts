import assert from 'node:assert/strict';
import { checkSource } from '../../src/domain/check.js';
import type { Source } from '../../src/domain/contract.js';
import type { Lookup } from '../../src/domain/ports.js';
import { Given, Then, When } from './support.js';

interface Subject {
  source: Source;
  lookup: Exclude<Lookup, { kind: 'unavailable' }>;
  text: string | undefined;
}

const subject = (state: Record<string, unknown>): Subject => (state['subject'] ??= {}) as Subject;

Given('an evidence source titled {string} quoting {string}', function (title: string, quote: string) {
  subject(this.state).source = { doi: '10.1234/abc', title, quote, text: 'a.txt' };
});

Given('the evidence registry knows it as {string}', function (title: string) {
  subject(this.state).lookup = { kind: 'found', title, year: 2024, retracted: false };
});

Given('the evidence registry knows it as {string}, retracted', function (title: string) {
  subject(this.state).lookup = { kind: 'found', title, year: 2024, retracted: true };
});

Given('the evidence registry does not know it', function () {
  subject(this.state).lookup = { kind: 'unknown' };
});

Given('the evidence source text is {string}', function (text: string) {
  subject(this.state).text = text;
});

Given('the evidence source text is missing', function () {
  subject(this.state).text = undefined;
});

When('the evidence source is checked', function () {
  const { source, lookup, text } = subject(this.state);
  this.state['reasons'] = checkSource(source, lookup, text);
});

Then('the evidence reasons are:', function (table: { hashes(): { code: string; detail: string }[] }) {
  assert.deepEqual(this.state['reasons'], table.hashes());
});

Then('the evidence source has no reason', function () {
  assert.deepEqual(this.state['reasons'], []);
});
