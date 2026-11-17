import assert from 'node:assert/strict';
import type { Files } from '../../src/domain/ports.js';
import { FsFiles } from '../../src/infrastructure/fs-files.js';
import { InMemoryFiles } from '../../src/infrastructure/in-memory-files.js';
import { Given, Then, throwawayRoot, unescape, When, type WatchWorld } from './support.js';

const folder = (world: WatchWorld): Files => world.state['files'] as Files;

Given('a watch files folder of the {word} adapter', function (adapter: string) {
  this.state['files'] = adapter === 'in-memory' ? new InMemoryFiles() : new FsFiles(throwawayRoot(this));
});

When('I write the watch file {string} with {string}', function (path: string, text: string) {
  folder(this).write(path, unescape(text));
});

Then('the watch file {string} reads {string}', function (path: string, text: string) {
  assert.equal(folder(this).read(path), unescape(text));
});

Then('the watch file {string} reads nothing', function (path: string) {
  assert.equal(folder(this).read(path), undefined);
});

Then('the watch file {string} exists', function (path: string) {
  assert.equal(folder(this).exists(path), true);
});

Then('the watch file {string} does not exist', function (path: string) {
  assert.equal(folder(this).exists(path), false);
});
