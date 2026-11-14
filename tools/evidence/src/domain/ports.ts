import type { Question, Rejection, Verified } from './contract.js';

/** A `found` always carries a title holding at least one letter or digit. */
export type Lookup =
  | { kind: 'found'; title: string; year: number | null; retracted: boolean }
  | { kind: 'unknown' }
  | { kind: 'unavailable'; detail: string };

/** The time of an event, injected. */
export type Clock = () => Date;

export interface Registry {
  lookup(doi: string): Promise<Lookup>;
}

/** A file the host publishes in `out`: a bare name, neither `.` nor `..`. */
export const PUBLISHED_NAME = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,120}$/;

/** Layout of docs/design/evidence-desk.md §3: the ledger is the host's and authoritative; `out` and `in` are the desk. */
export interface Store {
  /** Ledger asked/<id>.json and out/<id>.question.json. */
  saveQuestion(question: Question): void;
  /** From the ledger only. */
  question(id: string): Question | undefined;
  /** Sorted. */
  askedIds(): string[];
  /** In `in`: <id>.answer.json whose <id> is a valid identifier, sorted. */
  answerIds(): string[];
  /** The raw text of in/<id>.answer.json. */
  answer(id: string): string | undefined;
  /** A file of `in` named like the `text` of a source: a regular file of 5 MiB at most, else undefined. */
  sourceText(name: string): string | undefined;
  /** out/<id>.rejected.json; a file that does not parse against the contract reads as absent. */
  rejection(id: string): Rejection | undefined;
  /** out/<id>.rejected.json. */
  saveRejection(rejection: Rejection): void;
  /** Ledger verified/<id>.json and sources/<sha256>.txt (texts by sha256), then removes out/<id>.rejected.json. */
  saveVerified(record: Verified, texts: ReadonlyMap<string, string>): void;
  /** From the ledger only. */
  verified(id: string): Verified | undefined;
  /** Sorted. */
  verifiedIds(): string[];
  /** A file of `out`; `name` matches PUBLISHED_NAME, else the call throws. */
  publish(name: string, content: string): void;
}
