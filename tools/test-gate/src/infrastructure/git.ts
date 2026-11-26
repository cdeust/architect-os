import { closedGit } from '@architect-os/sandbox/git-closed';
import { visibleNestedMarker } from '@architect-os/sandbox/git-worktree';
import { execFileSync } from 'node:child_process';
import { decodeExactly } from '../domain/diff.js';

/**
 * The environment of every git call of the gate: the variables of the host that git needs, by name, and nothing else.
 * A `GIT_DIR` or a `GIT_CONFIG_COUNT` of the host would make the gate read another repository or a configuration
 * (docs/design/orchestration-fable-5-2.md §14, « Un environnement fermé pour git »). A name that the process does
 * not set is given as `undefined`, which node leaves out of the environment of the child. The global and the system
 * configuration of git are an empty file: with no `HOME` either, the verdict does not depend on the machine.
 */
function closedEnvironment(): NodeJS.ProcessEnv {
  const names = ['PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR'];
  const given: NodeJS.ProcessEnv = {
    ...closedGit().environment,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
  };
  for (const name of names) given[name] = process.env[name];
  return given;
}

/**
 * The options of every git call of the gate, before the subcommand: the closed options every git of the host is given
 * (packages/sandbox/git-closed.json: what a session wrote in the tree or its repository decides nothing of what git
 * does for the host), and the paths of the diff as they are.
 */
function options(): string[] {
  return [...closedGit().options, '-c', 'core.quotePath=false'];
}

/** Runs `git` in `cwd` and returns its standard output, through `gitWithOptions` with what the gate always gives: `options()`. */
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

/**
 * A list of git read as bytes and decoded exactly: a name that is not UTF-8 would come back under another spelling,
 * match no path when given back to git, and leave a changed file without changed lines. It is refused.
 */
function gitList(cwd: string, args: readonly string[]): string {
  return decodeExactly(
    execFileSync('git', [...options(), ...args], { cwd, env: closedEnvironment(), maxBuffer: 1 << 30 }),
  );
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
   * `git diff --raw -z --no-renames --no-abbrev <first parent>`: the paths that differ between the first parent and
   * the working tree (O-2: never a merge-base, never a comparison of a branch to main), NUL-separated, so that no
   * path is quoted and none is left out because git would not show its content.
   */
  changedPaths(firstParent: string): string {
    return gitList(this.root, [
      'diff',
      '--raw',
      '-z',
      '--no-renames',
      '--no-abbrev',
      // On the command line: a `.gitmodules` of the tree overrides the configuration, never this option.
      '--ignore-submodules=all',
      firstParent,
    ]);
  }

  /**
   * `git diff --unified=0 --text --no-textconv <first parent> -- <path>`: the hunks of one path, taken as that path and
   * nothing else (`:(literal)`), its content always read as text: a NUL byte does not make a changed file a file
   * without changed lines.
   */
  patch(firstParent: string, path: string): string {
    return git(this.root, [
      'diff',
      '--unified=0',
      '--no-renames',
      '--no-color',
      '--no-ext-diff',
      '--text',
      '--no-textconv',
      '--ignore-submodules=all',
      firstParent,
      '--',
      `:(literal)${path}`,
    ]);
  }

  /** Files of the index (the whole tree of a root commit). */
  tracked(): string[] {
    return names(gitList(this.root, ['ls-files', '-z']));
  }

  /** Files of the working tree git does not track and does not ignore: they are additions too. */
  untracked(): string[] {
    this.requireNoNested();
    return names(gitList(this.root, ['ls-files', '--others', '--exclude-standard', '-z']));
  }

  requireNoNested(): void {
    const nested = this.nested();
    if (nested !== undefined) throw new Error(`dépôt imbriqué dans l'arbre : ${nested}`);
  }

  /** Refuse recorded gitlinks and visible markers before any Git worktree traversal. */
  nested(): string | undefined {
    const index = gitList(this.root, ['ls-files', '-s', '-z']);
    const head = gitList(this.root, ['ls-tree', '-r', '-z', 'HEAD']);
    const recorded = [...names(index), ...names(head)].find((entry) => entry.startsWith('160000 '));
    if (recorded !== undefined) return recorded.slice(recorded.indexOf('\t') + 1);
    return visibleNestedMarker(this.root, head);
  }

  /** `git ls-tree -r --name-only <rev>`. */
  filesAt(rev: string): string[] {
    return names(gitList(this.root, ['ls-tree', '-r', '--name-only', '-z', rev]));
  }

  /** `git show <rev>:<path>`. */
  show(rev: string, path: string): string {
    return git(this.root, ['show', `${rev}:${path}`]);
  }
}
