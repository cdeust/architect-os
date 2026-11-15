import assert from 'node:assert/strict';
import { GatewayError, type GatewayErrorCode } from '../../src/domain/errors.js';
import type { ServiceResponse } from '../../src/domain/ports.js';
import { RouterServices } from '../../src/infrastructure/router-services.js';
import { Given, Then, When, attempt, refusedWith, required, slot, type Attempt } from './helpers.js';
import type { GatewayWorld } from './helpers.js';

const answer: ServiceResponse = { structured: { status: 'ok' }, text: '{}', isError: false };

/** A router that records what it was asked and refuses on demand; its tasks are numbered from 1. */
class RouterDouble {
  readonly log: string[] = [];
  callRefusal: GatewayErrorCode | undefined;
  completeRefusal: GatewayErrorCode | undefined;
  private opened = 0;

  async open(client: string, profile: string): Promise<{ task: string; token: string }> {
    this.opened += 1;
    this.log.push(`open:${client}/${profile}`);
    return { task: `task-${this.opened}`, token: `token-${this.opened}` };
  }
  async call(caller: { task: string } | { call: string }, address: string, args: Record<string, unknown>) {
    this.log.push(`call:${'task' in caller ? caller.task : caller.call} ${address} ${JSON.stringify(args)}`);
    if (this.callRefusal !== undefined) throw new GatewayError(this.callRefusal, 'refused');
    return answer;
  }
  async complete(task: string): Promise<void> {
    this.log.push(`complete:${task}`);
    if (this.completeRefusal !== undefined) throw new GatewayError(this.completeRefusal, 'refused');
  }
}

class Scene {
  readonly router = new RouterDouble();
  services: RouterServices | undefined;
  outcome: Attempt | undefined;
}

const scene = (world: GatewayWorld) => slot(world, 'router-services', () => new Scene());

Given('a router double and the services of the profile {string}', function (profile: string) {
  const s = scene(this);
  s.services = new RouterServices(s.router, profile);
});

Given(
  'the router refuses the call with {string} and refuses to complete with {string}',
  function (call: string, complete: string) {
    scene(this).router.callRefusal = call as GatewayErrorCode;
    scene(this).router.completeRefusal = complete as GatewayErrorCode;
  },
);

Given('the router refuses to complete with {string}', function (complete: string) {
  scene(this).router.completeRefusal = complete as GatewayErrorCode;
});

When(
  'the services invoke {string} tool {string} with arguments {string} for the subject {string}',
  async function (service: string, tool: string, args: string, subject: string) {
    const s = scene(this);
    const services = required(s.services, 'the services');
    s.outcome = await attempt(() => services.invoke(service, tool, JSON.parse(args), { subject }));
  },
);

Then('the router calls were {string}', function (expected: string) {
  assert.deepEqual(scene(this).router.log, expected.split(', '));
});

Then('the services answered with the answer of the router', function () {
  const { outcome } = scene(this);
  assert.ok(outcome && !outcome.failed, 'the invocation must have succeeded');
  assert.equal(outcome.value, answer);
});

Then('the invocation is refused with code {string}', function (code: string) {
  refusedWith(scene(this).outcome, code);
});
