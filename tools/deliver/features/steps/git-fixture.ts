import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runToEnd } from '../../src/infrastructure/host-process.js';
import { GitRepository } from '../../src/infrastructure/git-repository.js';
import { temporaryDirectory, type RepositoryFixture } from './fixtures.js';
import type { DeliverWorld } from './support.js';

/** What a commit of the fixture writes, besides the file that names it. */
export interface CommitOptions {
  removal?: { path: string; lines: number };
  /** A text file of that many lines. */
  lines?: { path: string; count: number };
  /** A binary file whose content is not the one of the parent. */
  binary?: string;
}

/** The throwaway repositories of the `git` row: a bare remote, a clone as the delivery worktree. */
export interface GitFixture extends RepositoryFixture {
  /** The directory the scenario owns: the remote, the worktree and the other clone live in it. */
  root: string;
  work: string;
  bare: string;
  commitWith(label: string, parent: string | undefined, options: CommitOptions): void;
  /** The fixture's own git, in `cwd`. */
  git(cwd: string, ...args: string[]): string;
  /** Another clone of the remote, which deletes `branch` from it. */
  deleteFromAnotherClone(branch: string): void;
}

const lines = (name: string, count: number): string =>
  Array.from({ length: count }, (_, index) => `${name} ${index + 1}\n`).join('');

/** The environment variables set for the scenario, restored when it ends. */
function setEnvironment(world: DeliverWorld, values: Record<string, string>): void {
  const saved = Object.keys(values).map((name) => [name, process.env[name]] as const);
  Object.assign(process.env, values);
  world.cleanups.push(() => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
}

export function gitFixture(world: DeliverWorld): GitFixture {
  // No configuration of the machine is read, by the fixture or by the adapter, which inherits the environment.
  setEnvironment(world, { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' });
  const root = temporaryDirectory(world);
  const bare = join(root, 'remote.git');
  const work = join(root, 'work');
  const git = (cwd: string, ...args: string[]): string => {
    const finished = runToEnd(
      'git',
      ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', ...args],
      cwd,
      {},
    );
    assert.ok(finished?.status === 0, `git ${args[0]} did not succeed in the fixture`);
    return finished.out;
  };
  mkdirSync(bare);
  git(bare, 'init', '--quiet', '--bare');
  mkdirSync(work);
  git(work, 'init', '--quiet');
  git(work, 'remote', 'add', 'origin', bare);

  const hashes = new Map<string, string>();
  const hashOf = (label: string): string => hashes.get(label) as string;
  const write = (path: string, content: string | Buffer): void => {
    mkdirSync(dirname(join(work, path)), { recursive: true });
    writeFileSync(join(work, path), content);
  };

  const commitWith: GitFixture['commitWith'] = (label, parent, options) => {
    if (parent === undefined) {
      git(work, 'switch', '--quiet', '--orphan', `root-${hashes.size}`);
      write('a.md', lines('a', 10));
      write('b.md', lines('b', 10));
    } else git(work, 'checkout', '--quiet', '--detach', hashOf(parent));
    write(`${label}.txt`, `${label}\n`);
    if (options.removal !== undefined) {
      const kept = readFileSync(join(work, options.removal.path), 'utf8').split('\n').slice(0, -1);
      write(options.removal.path, kept.slice(0, kept.length - options.removal.lines).join('\n') + '\n');
    }
    if (options.lines !== undefined)
      write(options.lines.path, lines(options.lines.path, options.lines.count));
    if (options.binary !== undefined) write(options.binary, Buffer.from([0, hashes.size]));
    git(work, 'add', '--all');
    git(work, 'commit', '--quiet', '--message', label);
    hashes.set(label, git(work, 'rev-parse', 'HEAD').trim());
  };

  return {
    repository: new GitRepository(work, 'origin'),
    root,
    work,
    bare,
    git,
    commitWith,
    commit: (label, parent, removal) => commitWith(label, parent, removal === undefined ? {} : { removal }),
    checkout: (label) => void git(work, 'checkout', '--quiet', '--detach', hashOf(label)),
    setRemote: (branch, label) =>
      void git(work, 'push', '--quiet', 'origin', `${hashOf(label)}:refs/heads/${branch}`),
    touchWorktree: () => write('a.md', lines('a', 11)),
    hashOf,
    deleteFromAnotherClone(branch) {
      const other = join(root, 'other');
      git(root, 'clone', '--quiet', bare, other);
      git(other, 'push', '--quiet', 'origin', `:refs/heads/${branch}`);
    },
  };
}
