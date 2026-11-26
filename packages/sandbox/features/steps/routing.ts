import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ZodError } from 'zod';
import {
  deriveRoute,
  parseRoutingTable,
  RoutingError,
  type AdmittedProvider,
  type Route,
  type RouteRequest,
} from '../../src/routing.js';
import { parseRoutedPolicy } from '../../src/step-file.js';
import { Given, PKG, Then, When, stored, type SandboxWorld } from './helpers.js';

interface Routing {
  text: string;
  tickets?: RouteRequest['tickets'];
  route?: Route;
  error?: unknown;
}
const routing = (world: SandboxWorld) => stored<Routing>(world, 'routing');
const committed = () => readFileSync(join(PKG, 'routing.json'), 'utf8');
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The committed table, changed by `edit` on its parsed value. */
const edited = (edit: (table: Json) => void): string => {
  const table = JSON.parse(committed()) as Json;
  edit(table);
  return JSON.stringify(table);
};
const sonnet = { provider: 'anthropic', model: 'claude-sonnet-5-5', effort: 'medium', limitSeconds: 4800 };
const opus = { provider: 'anthropic', model: 'claude-opus-5-5', effort: 'high', limitSeconds: 1500 };
const sol = { provider: 'openai', model: 'gpt-6.2-sol', effort: 'high', limitSeconds: 7200 };
const gemini = { provider: 'google', limitSeconds: 1500 };

const defects: Record<string, (table: Json) => void> = {
  'a Google build candidate': (t) => (t.roles.build.bands[2].candidates[0] = gemini),
  'an unqualified Terra model': (t) => (t.roles.build.bands[2].candidates[1].model = 'gpt-6.2-terra'),
  'a first band above one point': (t) => (t.roles.build.bands[0].fromPoints = 2),
  'two bands out of order': (t) => (t.roles.build.bands[2].fromPoints = 3),
  'a last band that requires checks': (t) => (t.roles.build.bands[2].requiresChecks = true),
  'a status that claims a measure': (t) => (t.status = 'measured'),
  'an unknown key': (t) => (t.roles.build.advisor = true),
  'a band without candidates': (t) => (t.roles.review.bands[0].candidates = []),
  'a scout band that requires checks': (t) => (t.roles.scout.bands[0].requiresChecks = true),
  'an OpenAI review candidate': (t) => (t.roles.review.bands[0].candidates = [sol]),
  'a model that is not a Claude model': (t) => (t.roles.scout.bands[0].candidates[0].model = 'haiku'),
  'an empty basis': (t) => (t.basis = '  '),
  'a blank description': (t) => (t.description = '  '),
  'a review band that requires checks': (t) => (t.roles.review.bands[0].requiresChecks = true),
  'a Claude model with a prefix': (t) => (t.roles.scout.bands[0].candidates[0].model = 'xclaude-haiku-5-5'),
  'a Claude model with a suffix': (t) => (t.roles.scout.bands[0].candidates[0].model = 'claude-haiku-5-5x'),
};

Given('the committed routing table', function () {
  this.state['routing'] = { text: committed() } satisfies Routing;
});

Given('the routing table where the band of 8 points has only Sol', function () {
  this.state['routing'] = {
    text: edited((t) => (t.roles.build.bands[2].candidates = [sol])),
  } satisfies Routing;
});

Given('the routing table where the band of 3 points has only Sol', function () {
  this.state['routing'] = {
    text: edited((t) => (t.roles.build.bands[1].candidates = [sol])),
  } satisfies Routing;
});

Given(
  'the routing table where reviews go to Gemini, then Opus, and the band of 8 points has only Sol',
  function () {
    this.state['routing'] = {
      text: edited((t) => {
        t.roles.build.bands[2].candidates = [sol];
        t.roles.review.bands[0].candidates = [gemini, opus];
      }),
    } satisfies Routing;
  },
);

Given('the routing table where reviews go only to Opus', function () {
  this.state['routing'] = {
    text: edited((t) => {
      t.roles.build.bands[1].candidates = [sonnet];
      t.roles.review.bands[0].candidates = [opus];
    }),
  } satisfies Routing;
});

When('the routing table is broken by {}', function (defect: string) {
  const edit = defects[defect];
  assert.ok(edit, `unknown defect ${defect}`);
  routing(this).text = edited(edit);
});

Then('the routing table loads, provisional', function () {
  assert.equal(parseRoutingTable(routing(this).text).status, 'provisional');
});

Then('the build bands of the routing table start at {string}', function (starts: string) {
  const table = parseRoutingTable(routing(this).text);
  assert.equal(table.roles.build.bands.map(({ fromPoints }) => fromPoints).join(' '), starts);
});

Then('loading the routing table is refused with {string}', function (reason: string) {
  assert.throws(
    () => parseRoutingTable(routing(this).text),
    (error: unknown) => {
      assert.ok(error instanceof ZodError);
      const said = error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('\n');
      assert.ok(said.includes(reason), said);
      return true;
    },
  );
});

/** `TICKET-001=3 TICKET-002=5<TICKET-001`: an id, its points, and the tickets it depends on, separated by commas. */
Given('the tickets {string}', function (text: string) {
  routing(this).tickets =
    text === ''
      ? undefined
      : text.split(' ').map((entry) => {
          const [id, rest] = entry.split('=') as [string, string];
          const [points, after] = rest.split('<') as [string, string | undefined];
          return {
            id,
            story_points: Number(points),
            depends_on: after === undefined ? [] : after.split(','),
            acceptance_ids: ['AC-1'],
          };
        });
});

When(
  'I derive the route for the ticket {string} with the providers {string}, {int} checks and {int} scouts',
  function (ticket: string, providers: string, checks: number, scouts: number) {
    const r = routing(this);
    delete r.route;
    delete r.error;
    try {
      r.route = deriveRoute(parseRoutingTable(r.text), {
        tickets: r.tickets,
        ticket: ticket === '' ? undefined : ticket,
        providers: providers.split(' ') as AdmittedProvider[],
        checks,
        scouts,
      });
    } catch (error) {
      r.error = error;
    }
  },
);

const route = (world: SandboxWorld): Route => {
  const r = routing(world);
  assert.equal(r.error, undefined);
  return r.route as Route;
};

Then(
  'the route serves {string} at {int} points, starting on {string}',
  function (ticket: string, points: number, start: string) {
    const { ticket: served, points: counted, start: began } = route(this);
    assert.deepEqual({ served, counted, began }, { served: ticket, counted: points, began: start });
  },
);

Then('the ladder of the route is {string}', function (ladder: string) {
  assert.equal(
    route(this)
      .ladder.map(({ band, build }) => `${band} ${build.provider} ${build.model} ${build.effort}`)
      .join('; '),
    ladder,
  );
});

Then('the reviews of the route are {string}', function (reviews: string) {
  assert.equal(
    route(this)
      .ladder.map(({ review }) =>
        review.provider === 'google'
          ? `google${review.waiting ? ' waiting' : ''}`
          : `anthropic ${review.model} ${review.effort}${review.waiting ? ' waiting' : ''}`,
      )
      .join('; '),
    reviews,
  );
});

Then('the scout route is {string}', function (scout: string) {
  const chosen = route(this).scout;
  assert.ok(chosen);
  assert.equal(`${chosen.provider} ${chosen.model} ${chosen.effort}`, scout);
});

Then('the route has no scout route', function () {
  assert.equal(Object.hasOwn(route(this), 'scout'), false);
});

Then('deriving the route fails with {string}', function (code: string) {
  const { error } = routing(this);
  assert.ok(error instanceof RoutingError, String(error));
  assert.equal(error.code, code);
});

Given('the routing table whose candidates carry the efforts and versions of every kind', function () {
  this.state['routing'] = {
    text: edited((t) => {
      t.roles.scout.bands[0].candidates[0] = {
        provider: 'anthropic',
        model: 'claude-haiku-10-15',
        effort: 'xhigh',
        limitSeconds: 300,
      };
      t.roles.build.bands[0].candidates = [
        { provider: 'anthropic', model: 'claude-haiku-5-5', effort: 'max', limitSeconds: 1200 },
        { provider: 'openai', model: 'gpt-6.2-sol', effort: 'low', limitSeconds: 1200 },
      ];
      t.roles.build.bands[1].candidates = [
        { provider: 'openai', model: 'gpt-6.2-astra', effort: 'medium', limitSeconds: 4800 },
        { provider: 'openai', model: 'gpt-6.2-sol', effort: 'xhigh', limitSeconds: 4800 },
      ];
    }),
  } satisfies Routing;
});

Given('the routing table where the band of 3 points requires checks', function () {
  this.state['routing'] = {
    text: edited((t) => (t.roles.build.bands[1].requiresChecks = true)),
  } satisfies Routing;
});

const routedPolicy = (change: string): unknown => {
  const policy: Json = { routing: { providers: ['anthropic'] }, scouts: [{ name: 'files' }] };
  if (change === 'two scouts of the same name') policy['scouts'] = [{ name: 'files' }, { name: 'files' }];
  else if (change.startsWith('the parallel '))
    policy['parallel'] = Number(change.slice('the parallel '.length));
  else if (change !== 'nothing more') throw new Error(`unknown change ${change}`);
  return policy;
};

Then('a routed policy with {} is accepted', function (change: string) {
  assert.doesNotThrow(() => parseRoutedPolicy(routedPolicy(change)));
});

Then('a routed policy with {} is refused with {string}', function (change: string, reason: string) {
  assert.throws(
    () => parseRoutedPolicy(routedPolicy(change)),
    (error: unknown) => {
      assert.ok(error instanceof ZodError);
      const said = error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('\n');
      assert.ok(said.includes(reason), said);
      return true;
    },
  );
});

Given('the routing table where only the band of 3 points requires checks', function () {
  this.state['routing'] = {
    text: edited((t) => {
      delete t.roles.build.bands[0].requiresChecks;
      t.roles.build.bands[1].requiresChecks = true;
    }),
  } satisfies Routing;
});
