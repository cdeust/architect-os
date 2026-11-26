import type { Repository } from '../domain/ports.js';
import type { Journal } from './in-memory-journal.js';

/**
 * `Repository` over a small history (the parents of each commit, never a cycle), the files each commit records as the
 * scenario gives them, a remote, the remote as last fetched and a local head. A push moves a remote branch
 * only to a descendant, like git without force.
 */
export class InMemoryRepository implements Repository {
  clean = true;
  /** The tree holds a repository of its own. */
  nested = false;
  /** The branches of the remote itself. */
  readonly remotes = new Map<string, string>();
  /** Fault injection: the branches whose push is refused whatever the history says. */
  readonly refusing = new Set<string>();
  /** Branches the remote moves, from the second fetch on. */
  readonly moved = new Map<string, string>();
  /** Branches the remote loses, from the second fetch on. */
  readonly deleted = new Set<string>();
  /** The branches of the remote, as last fetched. */
  private fetched = new Map<string, string>();
  /** The parents of a commit. */
  private readonly parents = new Map<string, Set<string>>();
  /** `<hash> <path>` to the bytes of the regular file the commit records there. */
  readonly files = new Map<string, Uint8Array>();
  private fetches = 0;

  /** `hash` is the local head. */
  constructor(
    private readonly journal: Journal,
    public hash: string,
  ) {}

  /** Makes `parent` a parent of `child`. */
  link(parent: string, child: string): void {
    this.parents.set(child, this.parentsOf(child).add(parent));
  }

  /** A file of the worktree changes. */
  touch(): void {
    this.clean = false;
  }

  holdsNestedRepository(): boolean {
    this.journal.record('holdsNestedRepository');
    return this.nested;
  }

  isClean(): boolean {
    this.journal.record('isClean');
    return this.clean;
  }

  head(): string {
    this.journal.record('head');
    return this.hash;
  }

  fetch(): void {
    this.journal.record('fetch');
    this.fetches++;
    if (this.fetches >= 2) {
      for (const branch of this.deleted) this.remotes.delete(branch);
      for (const [branch, hash] of this.moved) this.remotes.set(branch, hash);
    }
    this.fetched = new Map(this.remotes);
  }

  remoteHead(branch: string): string | undefined {
    this.journal.record('remoteHead', branch);
    return this.fetched.get(branch);
  }

  isAncestor(ancestor: string, descendant: string): boolean {
    this.journal.record('isAncestor', ancestor, descendant);
    return this.reaches(ancestor, descendant);
  }

  push(hash: string, branch: string): 'pushed' | 'refused' {
    this.journal.record('push', hash, branch);
    const current = this.remotes.get(branch);
    if (this.refusing.has(branch) || (current !== undefined && !this.reaches(current, hash)))
      return 'refused';
    this.remotes.set(branch, hash);
    return 'pushed';
  }

  committedFile(hash: string, path: string): Uint8Array | undefined {
    this.journal.record('committedFile', hash, path);
    return this.files.get(`${hash} ${path}`);
  }

  deleteRemoteBranch(branch: string): void {
    this.journal.record('delete', branch);
    this.remotes.delete(branch);
  }

  /** Whether `ancestor` is `descendant` or one of its ancestors. */
  private reaches(ancestor: string, descendant: string): boolean {
    if (ancestor === descendant) return true;
    for (const parent of this.parentsOf(descendant)) if (this.reaches(ancestor, parent)) return true;
    return false;
  }

  /** The parents of `hash`; a commit the history does not know has none. */
  private parentsOf(hash: string): Set<string> {
    return this.parents.get(hash) ?? new Set<string>();
  }
}
