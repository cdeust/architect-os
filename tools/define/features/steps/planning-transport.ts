import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Then } from '@cucumber/cucumber';
import { specPlanningConfig } from '@architect-os/contracts';
import { withPlanningSpec } from '../../src/infrastructure/prd-gen.js';
import { runSpecPlanning, type SubscriptionModelDispatcher } from '../../src/planning.js';

function plugin() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'spec-transport-')));
  const home = join(root, 'journal');
  const temporary = join(root, 'temporary');
  mkdirSync(home);
  mkdirSync(temporary);
  mkdirSync(join(root, 'mcp-server'));
  const bundle = join(root, 'mcp-server/index.js');
  copyFileSync(new URL('../fixtures/planning-server.cjs', import.meta.url), bundle);
  const account = (provider: string, model: string) => ({
    route: { provider, model },
    account: provider,
    quota: 1,
    billing: 'subscription',
  });
  const config = specPlanningConfig.parse({
    bundle_sha256: createHash('sha256').update(readFileSync(bundle)).digest('hex'),
    feature_description: 'Test a native planning turn',
    plan_step: 'delivery',
    drafter: account('openai', 'fixture-author'),
    reviewer: account('google', 'fixture-reviewer'),
  });
  return {
    root,
    home,
    temporary,
    bundle,
    config,
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}

Then('the pinned planning server sees the intended request {string}', async (panel: string) => {
  const p = plugin();
  try {
    if (panel === 'with panel')
      p.config.panel_reviewer = {
        ...p.config.reviewer,
        route: { provider: 'anthropic', model: 'fixture-panel' },
      };
    await withPlanningSpec(process.execPath, p.root, p.home, p.temporary, p.config, async (call) => {
      for (const sequence of [1, 2]) {
        const args = { sequence };
        assert.deepEqual(JSON.parse(await call('inspect', args)), {
          client: { name: 'architect-os-planning', version: '0.1.0' },
          method: 'tools/call',
          name: 'inspect',
          args,
          cwd: p.home,
          home: p.home,
          profile: p.home,
          tmp: [p.temporary, p.temporary, p.temporary],
          skill: join(p.root, 'packages/skill/skill-config.json'),
          drafter: 'openai/fixture-author',
          reviewer: 'google/fixture-reviewer',
          ...(panel === 'with panel' ? { panel: 'anthropic/fixture-panel' } : {}),
        });
      }
    });
    assert.equal(readFileSync(join(p.home, 'transport-closed'), 'utf8'), 'closed\n');
  } finally {
    p.dispose();
  }
});

Then('the planning transport refuses the {string} response', async (reply: string) => {
  const p = plugin();
  try {
    await assert.rejects(
      withPlanningSpec(process.execPath, p.root, p.home, p.temporary, p.config, (call) => call(reply, {})),
      { message: 'SPEC_TOOL_REFUSED: ' + reply },
    );
    assert.equal(readFileSync(join(p.home, 'transport-closed'), 'utf8'), 'closed\n');
  } finally {
    p.dispose();
  }
});

Then('the planning transport refuses a {string} bundle before running it', async (bundle: string) => {
  const p = plugin();
  try {
    if (bundle === 'substituted') p.config.bundle_sha256 = '0'.repeat(64);
    else {
      renameSync(p.bundle, join(p.root, 'other.js'));
      symlinkSync(join(p.root, 'other.js'), p.bundle);
    }
    await assert.rejects(
      withPlanningSpec(process.execPath, p.root, p.home, p.temporary, p.config, (call) =>
        call('inspect', {}),
      ),
      { message: 'SPEC_BUNDLE_MISMATCH' },
    );
    assert.equal(
      await withPlanningSpec(process.execPath, p.root, p.home, p.temporary, p.config, async () => 'offline'),
      'offline',
    );
  } finally {
    p.dispose();
  }
});

Then(
  'native planning validates admission, routes the subscription turn and releases the session',
  async function () {
    const ctx = this.state['runtime fixture'] as { root: string; env: Record<string, string> };
    mkdirSync(join(ctx.root, 'state'), { mode: 0o700 });
    const prior = process.env;
    const p = plugin();
    const calls: string[] = [];
    const model: SubscriptionModelDispatcher = {
      async authorize(account) {
        assert.deepEqual(account, p.config.drafter);
        calls.push('authorize');
        return true;
      },
      async invoke(inv, account) {
        assert.deepEqual(account, p.config.drafter);
        assert.equal(inv.prompt, 'Write a proposal');
        calls.push('invoke');
        return { account: account.account, billing: account.billing, route: account.route, text: 'checked' };
      },
    };
    const session = 'A1_test-2';
    const run = (id: string, resume = false, answer?: unknown) =>
      runSpecPlanning(process.execPath, p.root, id, p.config, model, resume, answer);
    try {
      process.env = { ...prior, ...ctx.env, ARCHITECT_OS_ADMISSION_BINDING: '' };
      await assert.rejects(run(session), { message: 'RUNTIME_ENTRY_REQUIRED' });
      process.env = { ...prior, ...ctx.env };
      for (const id of ['!valid', 'valid!', '_initial', 'A/../B'])
        await assert.rejects(run(id), { message: 'SPEC_SESSION_INVALID' });
      await assert.rejects(run(session, false, null), { name: 'ZodError' });
      const directory = join(ctx.root, 'state/spec-planning', session);
      assert.equal(existsSync(directory), false);
      await assert.doesNotReject(async () => {
        assert.deepEqual(await run(session), {
          status: 'needs_attention',
          run_id: 'run_fixture_native',
          action: {
            kind: 'done',
            summary: '',
            outcome: { status: 'needs_attention', reasons: ['fixture complete'] },
          },
        });
      });
      assert.deepEqual(calls, ['authorize', 'invoke']);
      const result = JSON.parse(readFileSync(join(directory, 'submitted.ndjson'), 'utf8'));
      assert.deepEqual(result.responses, [
        { invocation_id: 'first', raw_text: 'checked', model_receipt: p.config.drafter.route },
      ]);
      assert.ok(existsSync(join(directory, '.lease-1.done')));
      await assert.rejects(run(session), { message: 'SPEC_RUN_JOURNAL_MISMATCH' });
      assert.ok(existsSync(join(directory, '.lease-2.done')));
    } finally {
      process.env = prior;
      p.dispose();
    }
  },
);

Then('the planning transport starts a pinned bundle that exits and reports no tool answer', async () => {
  const p = plugin();
  try {
    writeFileSync(
      p.bundle,
      `require('node:fs').writeFileSync(${JSON.stringify(join(p.root, 'started'))}, 'started\\n');\nprocess.exit(1);\n`,
    );
    p.config.bundle_sha256 = createHash('sha256').update(readFileSync(p.bundle)).digest('hex');
    await assert.rejects(
      withPlanningSpec(process.execPath, p.root, p.home, p.temporary, p.config, (call) =>
        call('inspect', {}),
      ),
      (error: unknown) => error instanceof Error && !error.message.startsWith('SPEC_'),
    );
    assert.equal(readFileSync(join(p.root, 'started'), 'utf8'), 'started\n');
  } finally {
    p.dispose();
  }
});
