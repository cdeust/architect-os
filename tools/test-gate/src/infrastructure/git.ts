import { visibleNestedMarker } from '@architect-os/sandbox/git-worktree';
import { execFileSync } from 'node:child_process';
import { destinationMessage, judgedParent, type DestinationFacts } from '../domain/destination.js';
import type { JudgedDestination } from '../domain/verdict.js';
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

  /**
   * What `judgedParent` needs to choose the first parent: the head, its first parent, the commit the destination
   * reference names (absent when `rev-parse` does not resolve it), the commits on each side, the tree of the head, and
   * on demand the tree `merge-tree --write-tree` builds for the merge of the destination and the head (`conflict` when
   * it exits 1). No reference is written and the working tree is not touched.
   */
  destinationFacts(reference: string): DestinationFacts {
    const { head, firstParent } = this.commits();
    // The reference is a remote-tracking name by the schema of gate.json, so it never reads as an option.
    let destination: string | undefined;
    try {
      destination = git(this.root, ['rev-parse', '--verify', `${reference}^{commit}`]).trim();
    } catch {
      // rev-parse --verify exits non-zero on a reference that does not name a commit: no destination.
    }
    const headTree = git(this.root, ['rev-parse', '--verify', `${head}^{tree}`]).trim();
    return {
      head,
      parent: firstParent,
      destination,
      counts: () => {
        // `rev-list --left-right --count` prints the two counts separated by one tab, then a line end (Number skips it).
        const [behind, ahead] = git(this.root, [
          'rev-list',
          '--left-right',
          '--count',
          `${destination as string}...${head}`,
        ]).split('\t');
        return { behind: Number(behind), ahead: Number(ahead) };
      },
      headTree,
      merged: () => {
        try {
          return git(this.root, [
            'merge-tree',
            '--write-tree',
            '--no-messages',
            destination as string,
            head,
          ]).split('\n', 1)[0] as string;
        } catch (error) {
          if ((error as { status?: number }).status === 1) return 'conflict';
          throw error;
        }
      },
    };
  }

  /**
   * The head and the first parent the gate judges it against (src/domain/destination.ts), with the destination taken;
   * a destination that does not let the gate judge the merge GitHub would build throws its named refusal.
   */
  judged(reference: string): { head: string; firstParent: string | null; destination: JudgedDestination } {
    const facts = this.destinationFacts(reference);
    const judged = judgedParent(facts);
    if ('refusal' in judged) throw new Error(destinationMessage(judged.refusal, reference));
    return {
      head: facts.head,
      firstParent: judged.firstParent,
      destination: { reference, commit: judged.destination, commits: judged.commits },
    };
  }

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
