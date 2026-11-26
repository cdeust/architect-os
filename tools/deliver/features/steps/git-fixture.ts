import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runToEnd } from '../../src/infrastructure/host-process.js';
import { GitRepository } from '../../src/infrastructure/git-repository.js';
import { hostOf, temporaryDirectory, type RepositoryFixture } from './fixtures.js';
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
  /** Commits everything the worktree holds, on top of the commit it is at. */
  commitEverything(): void;
  /** The witness program of the nested repository has run since it was left, or since the last commit of everything. */
  witnessRan(): boolean;
  /** Who ran the witness: the lines of its current file and of its whole history. */
  witnessReport(): string;
}

const lines = (name: string, count: number): string =>
  Array.from({ length: count }, (_, index) => `${name} ${index + 1}\n`).join('');

/**
 * The environment of the fixture's own git, closed: nothing of the environment of the suite. The adapter does not get it
 * either: it is given a closed environment (`hostOf`). PATH is there to find git. No HOME is given, and
 * GIT_CONFIG_GLOBAL and GIT_CONFIG_SYSTEM are /dev/null, so that no configuration of the machine is read. LC_ALL=C
 * because the output of `rev-parse` is read. The identity is given by `-c` in `git` below; no scenario compares a hash
 * between two repositories, so no date is fixed.
 */
function fixtureEnvironment(): Record<string, string> {
  return {
    PATH: process.env['PATH'] ?? '',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    LC_ALL: 'C',
  };
}

export function gitFixture(world: DeliverWorld): GitFixture {
  const root = temporaryDirectory(world);
  const bare = join(root, 'remote.git');
  const work = join(root, 'work');
  const git = (cwd: string, ...args: string[]): string => {
    const finished = runToEnd(
      'git',
      // No maintenance detached by a commit: it would still run in the repositories of the scenario after its step.
      [
        '-c',
        'maintenance.auto=false',
        '-c',
        'user.name=fixture',
        '-c',
        'user.email=fixture@example.invalid',
        ...args,
      ],
      cwd,
      fixtureEnvironment(),
    );
    assert.ok(finished?.status === 0, `git ${args[0]} did not succeed in the fixture`);
    return finished.out;
  };
  mkdirSync(bare);
  git(bare, 'init', '--quiet', '--bare');
  mkdirSync(work);
  git(work, 'init', '--quiet');
  git(work, 'remote', 'add', 'origin', bare);

  const witness = join(root, 'witness');
  // One line per run of the witness: what ran, its process, its parent and grandparent, its directory and the time.
  const record = (what: string): string =>
    `line="${what} pid=$$ ppid=$PPID cwd=$(pwd) at=$(date +%s) parent=[$(ps -o command= -p $PPID)] ` +
    `grandparent=[$(ps -o command= -p $(ps -o ppid= -p $PPID))]"; ` +
    `printf '%s\\n' "$line" >> '${witness}.ran'; printf '%s\\n' "$line" >> '${witness}.history'`;
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
    repository: new GitRepository(work, 'origin', 'git', hostOf(world)),
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
    // What a session can leave in its worktree: a repository whose own configuration names a witness program as the
    // `clean` filter of a file left racy, and as the program of its fetches; and a `.gitmodules` that asks git to look
    // into it whatever the configuration says, and to fetch inside it.
    nestRepository() {
      // Each run says who started it, in the file a scenario reads and in a history nothing removes.
      writeFileSync(witness, `#!/bin/sh\n${record('filter')}\nexec cat\n`);
      chmodSync(witness, 0o755);
      const nested = join(work, 'sub');
      mkdirSync(nested);
      git(nested, 'init', '--quiet');
      writeFileSync(join(nested, '.gitattributes'), 'f.txt filter=witness\n');
      writeFileSync(join(nested, 'f.txt'), 'inner\n');
      git(nested, 'add', '--all');
      git(nested, 'commit', '--quiet', '--message', 'inner');
      git(nested, 'config', 'filter.witness.clean', witness);
      git(nested, 'config', 'remote.origin.url', bare);
      git(nested, 'config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*');
      git(
        nested,
        'config',
        'remote.origin.uploadpack',
        `sh -c '${record('upload-pack').replaceAll("'", "'\\''")}; exec git-upload-pack "$@"' --`,
      );
      git(nested, 'add', 'f.txt');
      writeFileSync(join(nested, 'f.txt'), 'outer\n');
      write(
        '.gitmodules',
        '[submodule "sub"]\n\tpath = sub\n\turl = ./sub\n\tignore = none\n\tfetchRecurseSubmodules = true\n',
      );
      rmSync(`${witness}.ran`, { force: true });
    },
    commitEverything() {
      git(work, '-c', 'advice.addEmbeddedRepo=false', 'add', '--all');
      git(work, 'commit', '--quiet', '--message', 'everything');
      rmSync(`${witness}.ran`, { force: true });
    },
    witnessRan: () => existsSync(`${witness}.ran`),
    witnessReport: () =>
      [
        ...['ran', 'history'].map((name) => {
          const path = `${witness}.${name}`;
          return name + ': ' + (existsSync(path) ? readFileSync(path, 'utf8') : '(none)');
        }),
      ].join('\n'),
    hashOf,
    deleteFromAnotherClone(branch) {
      const other = join(root, 'other');
      git(root, 'clone', '--quiet', bare, other);
      git(other, 'push', '--quiet', 'origin', `:refs/heads/${branch}`);
    },
  };
}
