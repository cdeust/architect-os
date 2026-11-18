import { execFileSync } from 'node:child_process';

/**
 * The environment of every git call of the gate: the variables of the host that git needs, by name, and nothing else.
 * A `GIT_DIR` or a `GIT_CONFIG_COUNT` of the host would make the gate read another repository or a configuration
 * (docs/design/orchestration-fable-5-2.md §14, « Un environnement fermé pour git »). A name that the process does
 * not set is given as `undefined`, which node leaves out of the environment of the child. The global and the system
 * configuration of git are an empty file: with no `HOME` either, the verdict does not depend on the machine.
 */
function closedEnvironment(): NodeJS.ProcessEnv {
  const names = ['PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR'];
  const given: NodeJS.ProcessEnv = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
  for (const name of names) given[name] = process.env[name];
  return given;
}

/**
 * The options of every git call of the gate, before the subcommand: no file monitor and no hook, so that git starts no
 * program of its own (docs/design/orchestration-fable-5-2.md §14, « Un environnement fermé pour git »), the same as the
 * fingerprint of the tree; and the paths of the diff as they are.
 */
function options(): string[] {
  return ['core.quotePath=false', 'core.fsmonitor=false', 'core.hooksPath=/dev/null'].flatMap((option) => [
    '-c',
    option,
  ]);
}

/**
 * Runs `git` in `cwd` and returns its standard output, through `gitWithOptions` with the two options that the gate
 * always gives: no file monitor and no hook, in `options()`.
 */
export function git(cwd: string, args: readonly string[]): string {
  return gitWithOptions(cwd, options(), args);
}

/**
 * `git` with the options given before the subcommand. The only process launch of tools/test-gate: named exception of
 * the rule child-process-only-in-sandbox in .dependency-cruiser.cjs. The gate has no network code and no token.
 * The gate always gives `options()`, through `git`; the scenarios give none, to show that the options are what keeps
 * the program of the configuration from running.
 */
export function gitWithOptions(cwd: string, before: readonly string[], args: readonly string[]): string {
  return execFileSync('git', [...before, ...args], {
    cwd,
    env: closedEnvironment(),
    encoding: 'utf8',
    maxBuffer: 1 << 30,
  });
}

function names(output: string): string[] {
  return output.split('\0').filter((name) => name !== '');
}

/** What the gate reads from git: the head, its first parent, the diff against it and the tree of the first parent. */
export class GitRepository {
  constructor(private readonly root: string) {}

  /** HEAD and its first parent (`HEAD^1`), null for a root commit. */
  commits(): { head: string; firstParent: string | null } {
    const [head, firstParent] = git(this.root, ['rev-list', '--parents', '-n', '1', 'HEAD'])
      .trim()
      .split(' ') as [string, string?];
    return { head, firstParent: firstParent ?? null };
  }

  /**
   * `git diff --unified=0 --no-renames <first parent>`: the first parent against the working tree (O-2: never a
   * merge-base, never a comparison of a branch to main).
   */
  diff(firstParent: string): string {
    return git(this.root, [
      'diff',
      '--unified=0',
      '--no-renames',
      '--no-color',
      '--no-ext-diff',
      firstParent,
    ]);
  }

  /** Files of the index (the whole tree of a root commit). */
  tracked(): string[] {
    return names(git(this.root, ['ls-files', '-z']));
  }

  /** Files of the working tree git does not track and does not ignore: they are additions too. */
  untracked(): string[] {
    return names(git(this.root, ['ls-files', '--others', '--exclude-standard', '-z']));
  }

  /** `git ls-tree -r --name-only <rev>`. */
  filesAt(rev: string): string[] {
    return names(git(this.root, ['ls-tree', '-r', '--name-only', '-z', rev]));
  }

  /** `git show <rev>:<path>`. */
  show(rev: string, path: string): string {
    return git(this.root, ['show', `${rev}:${path}`]);
  }
}
