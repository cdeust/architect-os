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
    GIT_ATTR_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
  };
  for (const name of names) given[name] = process.env[name];
  return given;
}

/** The tree with no entry (SHA-1): the source of attributes of every git call of the gate. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/**
 * The options of every git call of the gate, before the subcommand. What a session wrote in the tree decides nothing
 * of what git does for the host (docs/design/orchestration-fable-5-2.md §14, « Un environnement fermé pour git »):
 * no file monitor and no hook, so that git starts no program of its own; the attributes read from the empty tree, so
 * that no `.gitattributes` of the working tree hides a change (`-diff`, `binary`) nor makes git call clean a file whose
 * bytes are not those of the commit (`ident`, `eol`, a filter); no descent into a repository nested in the tree, whose
 * own configuration would name programs (a `filter`) that git would start. The paths of the diff as they are.
 */
function options(): string[] {
  return [
    `--attr-source=${EMPTY_TREE}`,
    ...[
      'core.quotePath=false',
      'core.fsmonitor=false',
      'core.hooksPath=/dev/null',
      'diff.ignoreSubmodules=all',
    ].flatMap((option) => ['-c', option]),
  ];
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
    return names(gitList(this.root, ['ls-files', '--others', '--exclude-standard', '-z']));
  }

  /**
   * A repository nested in the tree, if there is one: recorded in the index or in the head (an entry of mode
   * 160000), or not tracked (git lists it as a directory, a name that ends with `/`). The gate judges files: git would
   * enter that repository and read its configuration, and no option keeps every command out of it. No listing here
   * enters it.
   */
  nested(): string | undefined {
    const recorded = [
      ...names(gitList(this.root, ['ls-files', '-s', '-z'])),
      ...names(gitList(this.root, ['ls-tree', '-r', '-z', 'HEAD'])),
    ].find((entry) => entry.startsWith('160000 '));
    if (recorded !== undefined) return recorded.slice(recorded.indexOf('\t') + 1);
    return this.untracked().find((name) => name.endsWith('/'));
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
