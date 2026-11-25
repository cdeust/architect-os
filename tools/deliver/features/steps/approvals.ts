import assert from 'node:assert/strict';
import {
  chmodSync,
  closeSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { decideApproval, type ApprovalKind, type ApprovalRecord } from '../../src/domain/approval.js';
import type { Approvals } from '../../src/domain/ports.js';
import { FileApprovals } from '../../src/infrastructure/file-approvals.js';
import { InMemoryApprovals } from '../../src/infrastructure/in-memory-approvals.js';
import { Journal } from '../../src/infrastructure/in-memory-journal.js';
import { runToEnd } from '../../src/infrastructure/host-process.js';
import { temporaryDirectory } from './fixtures.js';
import { Given, Then, type DeliverWorld } from './support.js';

// The contract of `Approvals` (ports.feature, rule « Approvals ») and the decision on a record
// (approval-decisions.feature).

interface ApprovalsFixture {
  approvals: Approvals;
  write(kind: ApprovalKind, record: Record<string, unknown>): void;
  /** The file adapter only: the directory and the file of each kind. */
  directory?: string;
}

function inMemoryApprovals(): ApprovalsFixture {
  const approvals = new InMemoryApprovals(new Journal());
  return {
    approvals,
    write(kind, record) {
      approvals.records.set(kind, {
        state: 'present',
        repository: record['repository'] as string,
        commit: record['commit'] as string,
        approvedAt: record['approvedAt'] as number,
        expiresAt: record['expiresAt'] as number,
      });
    },
  };
}

function fileApprovals(world: DeliverWorld, missing = false): ApprovalsFixture {
  const directory = join(temporaryDirectory(world), 'owner');
  if (!missing) mkdirSync(directory, { mode: 0o700 });
  return {
    approvals: new FileApprovals(directory, process.getuid!()),
    directory,
    write(kind, record) {
      writeFileSync(join(directory, `delivery-${kind}.json`), JSON.stringify(record), { mode: 0o644 });
    },
  };
}

const fixtureOf = (world: DeliverWorld): ApprovalsFixture => world.state['portApprovals'] as ApprovalsFixture;

Given('a delivery approvals of the {word} adapter', function (name: string) {
  const fixtures: Record<string, (world: DeliverWorld) => ApprovalsFixture> = {
    'in-memory': inMemoryApprovals,
    file: (world) => fileApprovals(world),
  };
  const build = fixtures[name];
  assert.ok(build !== undefined, `no fixture for the adapter ${name}`);
  this.state['portApprovals'] = build(this);
});

Given('a delivery approvals of the file adapter over a directory that does not exist', function () {
  this.state['portApprovals'] = fileApprovals(this, true);
});

Given(
  'the delivery approvals hold a {word} record of {string} in {string} from {int} to {int}',
  function (kind: ApprovalKind, commit: string, repository: string, approvedAt: number, expiresAt: number) {
    fixtureOf(this).write(kind, {
      kind,
      repository,
      commit,
      approvedAt,
      expiresAt,
      ...(kind === 'maintenance' ? { intent: 'Require the reviewed job' } : {}),
    });
  },
);

/** `<field> <JSON>` sets a field, `without <field>` removes it; the other changes alter the file or its directory. */
Given('the approval file of {word} is altered: {}', function (kind: ApprovalKind, change: string) {
  const { directory } = fixtureOf(this);
  assert.ok(directory !== undefined);
  const file = join(directory, `delivery-${kind}.json`);
  const elsewhere = join(directory, '..', 'elsewhere');
  const text = readFileSync(file, 'utf8');
  switch (change) {
    case 'the file group writable':
      return chmodSync(file, 0o664);
    case 'the file world writable':
      return chmodSync(file, 0o646);
    case 'the file of another owner':
      // Same bytes and modes; the adapter is told another uid is the owner, which no file can be given without root.
      this.state['portApprovals'] = {
        ...fixtureOf(this),
        approvals: new FileApprovals(directory, process.getuid!() + 1),
      };
      return;
    case 'the directory group writable':
      return chmodSync(directory, 0o770);
    case 'the directory world writable':
      return chmodSync(directory, 0o707);
    case 'the directory a link': {
      renameSync(directory, elsewhere);
      symlinkSync(elsewhere, directory);
      return;
    }
    case 'the file a link':
      renameSync(file, elsewhere);
      symlinkSync(elsewhere, file);
      return;
    case 'the file a second link':
      linkSync(file, elsewhere);
      return;
    case 'the file a directory':
      unlinkSync(file);
      mkdirSync(file);
      return;
    case 'the file a named pipe': {
      unlinkSync(file);
      const made = runToEnd('/usr/bin/mkfifo', [file], directory, { PATH: '/usr/bin:/bin' });
      assert.equal(made?.status, 0);
      return;
    }
    case 'the file of exactly 4096 bytes': {
      const record = JSON.stringify(JSON.parse(text) as Record<string, unknown>);
      return writeFileSync(file, record + ' '.repeat(4096 - Buffer.byteLength(record)));
    }
    case 'the file over 4096 bytes': {
      const record = JSON.parse(text) as Record<string, unknown>;
      // Still a valid record but for its length: the bound alone refuses it.
      return writeFileSync(file, JSON.stringify(record) + ' '.repeat(4096));
    }
    case 'the file not JSON':
      return writeFileSync(file, text.slice(0, -2));
  }
  const record = JSON.parse(text) as Record<string, unknown>;
  const without = /^without (\w+)$/.exec(change);
  if (without) delete record[without[1]!];
  else {
    const at = change.indexOf(' ');
    record[change.slice(0, at)] = JSON.parse(change.slice(at + 1));
  }
  writeFileSync(file, JSON.stringify(record));
});

Then(
  'the delivery approvals read for {word} the record of {string} in {string} from {int} to {int}',
  function (kind: ApprovalKind, commit: string, repository: string, approvedAt: number, expiresAt: number) {
    assert.deepEqual(fixtureOf(this).approvals.read(kind), {
      state: 'present',
      repository,
      commit,
      approvedAt,
      expiresAt,
    });
  },
);

Then('the delivery approvals read for {word} nothing', function (kind: ApprovalKind) {
  assert.deepEqual(fixtureOf(this).approvals.read(kind), { state: 'absent' });
});

Then('the delivery approvals read for {word} an untrusted record', function (kind: ApprovalKind) {
  assert.deepEqual(fixtureOf(this).approvals.read(kind), { state: 'untrusted' });
});

/** On one synchronous call stack the system gives back the lowest free descriptor: a leak would move it. */
function lowestFreeDescriptor(): number {
  const fd = openSync('/dev/null', 'r');
  closeSync(fd);
  return fd;
}

Then(
  'the delivery approvals reader leaves no descriptor open, on a record read and on one refused',
  function () {
    const { approvals, directory } = fixtureOf(this);
    const before = lowestFreeDescriptor();
    assert.equal(approvals.read('publication').state, 'present');
    assert.equal(lowestFreeDescriptor(), before, 'a record read leaked its descriptor');
    chmodSync(join(directory!, 'delivery-publication.json'), 0o666);
    assert.equal(approvals.read('publication').state, 'untrusted');
    assert.equal(lowestFreeDescriptor(), before, 'a record refused leaked its descriptor');
    rmSync(join(directory!, 'delivery-publication.json'));
  },
);

// The decision on a record (approval-decisions.feature): a record, the commit and repository asked, the time.

const COMMIT = '0123456789abcdef0123456789abcdef01234567';

Then(
  'for {word} a record {string} decides {string}',
  function (kind: ApprovalKind, description: string, expected: string) {
    // `<state>` alone, or `present <repository> <commit> <approvedAt> <expiresAt>`, the times relative to now (1000).
    const [state, repository, commit, approvedAt, expiresAt] = description.split(' ');
    const record: ApprovalRecord =
      state === 'present'
        ? {
            state,
            repository: repository!,
            commit: commit!.replace('HASH', COMMIT),
            approvedAt: 1000 + Number(approvedAt),
            expiresAt: 1000 + Number(expiresAt),
          }
        : { state: state as 'absent' | 'untrusted' };
    const decision = decideApproval(kind, record, {
      repository: 'cdeust/architect-os',
      commit: COMMIT,
      now: 1000,
      maxSeconds: 3600,
    });
    assert.deepEqual(
      decision,
      expected === 'approved' && record.state === 'present'
        ? { approved: { approvedAt: record.approvedAt, expiresAt: record.expiresAt } }
        : { reason: expected },
    );
  },
);
