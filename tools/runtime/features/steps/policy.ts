import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ENVIRONMENTS, type AdmissionPolicy } from '../../src/domain/policy.js';
import { decodePolicy, type DecodedPolicy } from '../../src/infrastructure/policy-file.js';
import { Given, kept, POLICY_PATH, Then, When, type RuntimeWorld } from './support.js';

const decoded = (world: RuntimeWorld): DecodedPolicy => kept<DecodedPolicy>(world, 'decodedPolicy');

function accepted(world: RuntimeWorld): AdmissionPolicy {
  const result = decoded(world);
  assert.ok(result.ok, `the policy was rejected at ${result.ok ? '' : result.field}`);
  return result.policy;
}

/** The object holding the last key of a dotted path, and that key. */
function parentOf(copy: Record<string, unknown>, path: string): [Record<string, unknown>, string] {
  const keys = path.split('.');
  const last = keys.pop() as string;
  const parent = keys.reduce((node, key) => node[key] as Record<string, unknown>, copy);
  return [parent, last];
}

When('the committed runtime admission policy is decoded', function () {
  this.state['decodedPolicy'] = decodePolicy(readFileSync(POLICY_PATH, 'utf8'));
});

Then('the runtime admission policy is accepted with version {int}', function (version: number) {
  assert.equal(accepted(this).version, version);
});

Then(
  'the runtime reserve of {string} has a root floor of {string} bytes and a home floor of {string} bytes',
  function (name: string, root: string, home: string) {
    const reserve = accepted(this).environments[name as (typeof ENVIRONMENTS)[number]];
    assert.equal(reserve.rootFloorBytes, BigInt(root));
    assert.equal(reserve.homeFloorBytes, BigInt(home));
  },
);

Then('every runtime reserve is provisional, with a basis, and a review that names step 4', function () {
  const policy = accepted(this);
  assert.deepEqual(Object.keys(policy.environments), [...ENVIRONMENTS]);
  for (const name of ENVIRONMENTS) {
    const reserve = policy.environments[name];
    assert.equal(reserve.status, 'provisional', name);
    assert.ok(reserve.basis.length > 40, `${name}: the basis says why`);
    assert.match(reserve.review, /^step 4: /, name);
  }
});

Given('a copy of the committed runtime admission policy', function () {
  this.state['policyCopy'] = JSON.parse(readFileSync(POLICY_PATH, 'utf8')) as Record<string, unknown>;
});

When('the runtime policy copy has {word} set to {}', function (path: string, value: string) {
  const [parent, key] = parentOf(kept(this, 'policyCopy'), path);
  parent[key] = JSON.parse(value) as unknown;
  this.state['decodedPolicy'] = decodePolicy(JSON.stringify(kept(this, 'policyCopy')));
});

When('the runtime policy copy has no {word}', function (path: string) {
  const [parent, key] = parentOf(kept(this, 'policyCopy'), path);
  assert.ok(Object.hasOwn(parent, key), `the committed policy has ${path}`);
  delete parent[key];
  this.state['decodedPolicy'] = decodePolicy(JSON.stringify(kept(this, 'policyCopy')));
});

When('the runtime policy text {string} is decoded', function (text: string) {
  this.state['decodedPolicy'] = decodePolicy(text);
});

Then('the runtime policy copy is rejected at {string}', function (field: string) {
  assert.deepEqual(decoded(this), { ok: false, field });
});

Then(
  'the runtime admission policy copy is accepted, with the server floors {int} and {int} bytes',
  function (root: number, home: number) {
    const reserve = accepted(this).environments.server;
    assert.equal(reserve.rootFloorBytes, BigInt(root));
    assert.equal(reserve.homeFloorBytes, BigInt(home));
  },
);

Then(
  'the runtime admission policy copy is accepted, with the workstation root floor {word} bytes',
  function (floor: string) {
    assert.equal(accepted(this).environments.workstation.rootFloorBytes, BigInt(floor));
  },
);
