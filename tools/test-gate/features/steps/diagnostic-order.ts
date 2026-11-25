import assert from 'node:assert/strict';
import { command } from './hosted.js';
import { Then, repository } from './repository.js';

const NATIVE = 'reports/mutation-shards/1/mutation/native.json';
const STATIC = /marquage statique absent pour un mutant actif/;
const CANARY = /canari de mutation refusé dans le lot 1/;

Then(
  'the hosted collector names the missing static metadata of a lane before the verdict of its canary',
  async function () {
    const repo = repository(this);
    const original = repo.read(NATIVE);
    const collect = async (edit: (mutant: Record<string, unknown>) => void) => {
      const report = JSON.parse(original);
      edit(report.files['zz/probe.mjs'].mutants[0]);
      repo.write(NATIVE, JSON.stringify(report));
      return command(repo, 'collect');
    };
    try {
      // The control: with its static metadata kept, a contradicted canary is what the collector names.
      const contradicted = await collect((mutant) => (mutant['status'] = 'Killed'));
      assert.equal(contradicted.status, 1, contradicted.output);
      assert.match(contradicted.output, CANARY);
      const unmarked = await collect((mutant) => {
        mutant['status'] = 'Killed';
        delete mutant['static'];
      });
      assert.equal(unmarked.status, 1, unmarked.output);
      assert.match(unmarked.output, STATIC);
      assert.doesNotMatch(unmarked.output, CANARY);
    } finally {
      repo.write(NATIVE, original);
    }
  },
);
