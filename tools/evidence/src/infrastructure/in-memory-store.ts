import type { Question, Rejection, Verified } from '../domain/contract.js';
import { PUBLISHED_NAME, type Store } from '../domain/ports.js';

const sorted = (keys: Iterable<string>): string[] => [...keys].sort();

/** Same observable behaviour as FsStore; the desk is seeded by `putAnswer` and `putSource`, as Science would. */
export class InMemoryStore implements Store {
  private readonly asked = new Map<string, Question>();
  private readonly verifiedRecords = new Map<string, Verified>();
  private readonly answers = new Map<string, string>();
  private readonly sources = new Map<string, string>();
  private readonly rejections = new Map<string, Rejection>();
  private readonly ledgerSources = new Map<string, string>();
  private readonly published = new Map<string, string>();

  saveQuestion(question: Question): void {
    this.asked.set(question.id, question);
  }
  question(id: string): Question | undefined {
    return this.asked.get(id);
  }
  askedIds(): string[] {
    return sorted(this.asked.keys());
  }
  answerIds(): string[] {
    return sorted(this.answers.keys());
  }
  answer(id: string): string | undefined {
    return this.answers.get(id);
  }
  sourceText(name: string): string | undefined {
    return this.sources.get(name);
  }
  rejection(id: string): Rejection | undefined {
    return this.rejections.get(id);
  }
  saveRejection(rejection: Rejection): void {
    this.rejections.set(rejection.id, rejection);
  }
  saveVerified(record: Verified, texts: ReadonlyMap<string, string>): void {
    for (const [sha256, text] of texts) this.ledgerSources.set(sha256, text);
    this.verifiedRecords.set(record.id, record);
    this.rejections.delete(record.id);
  }
  verified(id: string): Verified | undefined {
    return this.verifiedRecords.get(id);
  }
  verifiedIds(): string[] {
    return sorted(this.verifiedRecords.keys());
  }
  publish(name: string, content: string): void {
    if (!PUBLISHED_NAME.test(name)) throw new Error(`not a name of a published file: ${name}`);
    this.published.set(name, content);
  }

  putAnswer(id: string, raw: string): void {
    this.answers.set(id, raw);
  }
  putSource(name: string, text: string): void {
    this.sources.set(name, text);
  }
  /** The text kept in the ledger under its hash. */
  ledgerSource(sha256: string): string | undefined {
    return this.ledgerSources.get(sha256);
  }
  /** What the host published in `out`. */
  publishedFile(name: string): string | undefined {
    return this.published.get(name);
  }
}
