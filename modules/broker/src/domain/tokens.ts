/** What a task token is worth: the task it spends for, and the call that granted it. */
export interface TaskGrant {
  readonly task: string;
  readonly parent?: string;
}

/** The refusal of the token table: a token granted twice. */
export class TokenTaken extends Error {
  constructor() {
    super('token already granted');
  }
}

/**
 * The task tokens the broker honours. A lookup in a map is not constant-time: a native process of the same uid reads
 * the tokens anyway (R-3), and a token is 32 random characters at least, which a timing probe over loopback does not
 * reach before the end of its task.
 */
export class TokenTable {
  private readonly grants = new Map<string, TaskGrant>();

  /** A token is granted once: a second grant would move the cost of a task to another. */
  grant(token: string, grant: TaskGrant): void {
    if (this.grants.has(token)) throw new TokenTaken();
    this.grants.set(token, grant);
  }

  /** Whether the token was granted; afterwards it is worth nothing. */
  revoke(token: string): boolean {
    return this.grants.delete(token);
  }

  resolve(token: string): TaskGrant | null {
    return this.grants.get(token) ?? null;
  }
}
