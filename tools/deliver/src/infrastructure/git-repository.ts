import { closedGitOptions, hostConfiguredGitEnvironment } from '@architect-os/sandbox/git-closed';
import { checkoutIsClean, visibleNestedMarker } from '@architect-os/sandbox/git-worktree';
import type { Repository } from '../domain/ports.js';
import { runToEnd, type HostEnvironment } from './host-process.js';

/**
 * `Repository` over git, in the delivery worktree: admission checks and fixed argv started without a shell,
 * with a closed environment: the variables of the descriptive file that the host sets, and `GIT_TERMINAL_PROMPT=0`. Nothing git prints is returned or shown: a method
 * gives the fact its port names, and a failure the port does not name throws a fixed message with the exit code.
 */
export class GitRepository implements Repository {
  constructor(
    private readonly worktree: string,
    private readonly remote: string,
    private readonly git: string,
    private readonly host: HostEnvironment,
  ) {}

  holdsNestedRepository(): boolean {
    // Neither listing enters a nested repository, whatever the tree says of it.
    const index = this.run(['ls-files', '-s', '-z']).out;
    const head = this.run(['ls-tree', '-r', '-z', 'HEAD']).out;
    if ([index, head].some((list) => list.split('\0').some((entry) => entry.startsWith('160000 '))))
      return true;
    // A marker found only because a tracked ignore file is no longer the recorded one is not reported here: that
    // tree is not clean, and `isClean` refuses it under its true name (the guard refuses the marker there too).
    const marker = visibleNestedMarker(this.worktree, head);
    return marker !== undefined && marker.changedIgnoreFile === undefined;
  }

  isClean(): boolean {
    return checkoutIsClean(this.worktree);
  }

  head(): string {
    return this.run(['rev-parse', '--verify', 'HEAD^{commit}']).out.trim();
  }

  fetch(): void {
    // A `.gitmodules` of the tree can ask git to fetch inside a nested repository, with its own configuration.
    this.run(['fetch', '--quiet', '--prune', '--recurse-submodules=no', this.remote]);
  }

  remoteHead(branch: string): string | undefined {
    const { status, out } = this.run(
      ['rev-parse', '--verify', '--quiet', `refs/remotes/${this.remote}/${branch}^{commit}`],
      1,
    );
    return status === 0 ? out.trim() : undefined;
  }

  isAncestor(ancestor: string, descendant: string): boolean {
    return this.run(['merge-base', '--is-ancestor', ancestor, descendant], 1).status === 0;
  }

  deletedLines(from: string, to: string, path: string): number {
    const { out } = this.run(['diff', '--numstat', '--ignore-submodules=all', from, to, '--', path]);
    if (out === '') return 0;
    const deleted = out.split('\t')[1];
    return deleted === '-' ? 1 : Number(deleted);
  }

  push(hash: string, branch: string): 'pushed' | 'refused' {
    const { status } = this.start([
      'push',
      '--quiet',
      '--recurse-submodules=no',
      this.remote,
      `${hash}:refs/heads/${branch}`,
    ]);
    return status === 0 ? 'pushed' : 'refused';
  }

  deleteRemoteBranch(branch: string): void {
    this.run(['push', '--quiet', '--recurse-submodules=no', this.remote, `:refs/heads/${branch}`]);
  }

  /** Runs git; an exit code other than 0 and the ones `allowed` throws. */
  private run(args: string[], ...allowed: number[]): { status: number; out: string } {
    const result = this.start(args);
    if (result.status !== 0 && !allowed.includes(result.status))
      throw new Error(`git ${args[0]} exited with code ${result.status}`);
    return result;
  }

  /** Runs git and gives its exit code; throws only when git did not run to its end (not found, or a signal). */
  private start(args: string[]): { status: number; out: string } {
    const finished = runToEnd(
      this.git,
      // The delivery pushes with the rights of the owner: what precedes its subcommands and its whole environment
      // are those every git of the host is given (packages/sandbox/src/git-closed.ts), with the names of deliver.json.
      [...closedGitOptions(), ...args],
      this.worktree,
      hostConfiguredGitEnvironment(this.host, { GIT_TERMINAL_PROMPT: '0' }),
    );
    if (finished === undefined) throw new Error('git could not be run to its end');
    return finished;
  }
}
