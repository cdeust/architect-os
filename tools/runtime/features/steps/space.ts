import assert from 'node:assert/strict';
import type { Reserve } from '../../src/domain/policy.js';
import { compare, observe, type Observation } from '../../src/domain/space.js';
import { Given, kept, Then, When } from './support.js';

const DEVICE = 41n;

Given(
  'a runtime reserve with a root floor of {string} bytes and a home floor of {string} bytes',
  function (root: string, home: string) {
    const reserve: Reserve = {
      rootFloorBytes: BigInt(root),
      homeFloorBytes: BigInt(home),
      status: 'provisional',
      basis: 'a reserve of these scenarios',
      review: 'step 4',
    };
    this.state['reserve'] = reserve;
  },
);

When(
  'a runtime space sample of {string} blocks of {string} bytes is observed',
  function (blocks: string, unit: string) {
    this.state['observation'] =
      observe({ device: DEVICE, inode: 3n, availableBlocks: BigInt(blocks), blockSize: BigInt(unit) }) ??
      'none';
  },
);

Then('the runtime space observation holds {string} available bytes on its device', function (bytes: string) {
  assert.deepEqual(kept<Observation>(this, 'observation'), { device: DEVICE, availableBytes: BigInt(bytes) });
});

Then('the runtime space observation is none', function () {
  assert.equal(kept(this, 'observation'), 'none');
});

When(
  'the runtime root holds {string} available bytes and the runtime home {string}',
  function (root: string, home: string) {
    this.state['decision'] = compare(
      kept<Reserve>(this, 'reserve'),
      { device: DEVICE, availableBytes: BigInt(root) },
      { device: DEVICE, availableBytes: BigInt(home) },
    );
  },
);

Then('the runtime space decision is {string}', function (decision: string) {
  assert.equal(kept(this, 'decision'), decision);
});
