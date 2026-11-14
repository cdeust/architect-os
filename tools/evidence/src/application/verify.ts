import { checkSource } from '../domain/check.js';
import { parseAnswer, type Answer, type Parsed, type Rejection, type Verified } from '../domain/contract.js';
import type { Clock, Lookup, Registry, Store } from '../domain/ports.js';

export interface VerifyDependencies {
  readonly store: Store;
  readonly registry: Registry;
  readonly clock: Clock;
  /** Hexadecimal SHA-256 of a text. */
  readonly sha256: (text: string) => string;
}

/** Identifiers, each list sorted (the store lists them sorted and they are taken in that order). */
export interface VerifyReport {
  /** Verified during this run. */
  verified: string[];
  /** Rejected now, whether the rejection is new or unchanged. */
  rejected: string[];
  /** The registry was unreachable: nothing was written, the next run takes them again. */
  deferred: string[];
  /** Asked, not verified, and without an answer file. */
  pending: string[];
}

type Reasons = Rejection['reasons'];
type Reachable = Exclude<Lookup, { kind: 'unavailable' }>;
type Found = Extract<Lookup, { kind: 'found' }>;

const MISSING = 'not a plain file of 1 MiB at most';

/**
 * Every answer of the desk whose question is not verified yet, in the order of the store (docs/design/evidence-desk.md
 * §5 and §7). One lookup per DOI for the whole run, made one after the other.
 */
export async function verify(deps: VerifyDependencies): Promise<VerifyReport> {
  const { store, registry, clock, sha256 } = deps;
  const alreadyVerified = new Set(store.verifiedIds());
  const answered = store.answerIds();
  const lookups = new Map<string, Lookup>();
  const verified: string[] = [];
  const rejected: string[] = [];
  const deferred: string[] = [];

  const reject = (id: string, fingerprint: string, reasons: Reasons): void => {
    store.saveRejection({
      id,
      rejected_at: clock().toISOString(),
      answer_sha256: fingerprint,
      reasons,
    });
    rejected.push(id);
  };

  for (const id of answered.filter((answerId) => !alreadyVerified.has(answerId))) {
    const raw = store.answer(id);
    const parsed: Parsed<Answer> = raw === undefined ? { ok: false, issues: MISSING } : parseAnswer(raw);
    // The texts an answer cites belong to its fingerprint: a rejection repaired by replacing a text alone, the answer
    // untouched, is looked at again.
    const cited = parsed.ok
      ? parsed.value.claims.flatMap((claim) => claim.sources).map(({ text }) => store.sourceText(text))
      : [];
    const fingerprint = sha256([raw ?? '', ...cited.map((text) => sha256(text ?? ''))].join('\n'));
    if (store.rejection(id)?.answer_sha256 === fingerprint) {
      rejected.push(id);
      continue;
    }

    const question = store.question(id);
    if (!parsed.ok || parsed.value.id !== id || question === undefined) {
      const reasons: Reasons = [];
      const whole = (code: Reasons[number]['code'], detail: string): void => {
        reasons.push({ code, claim: null, source: null, detail });
      };
      if (!parsed.ok) whole('ANSWER_INVALID', parsed.issues);
      else if (parsed.value.id !== id) whole('ANSWER_ID_MISMATCH', `the answer is for ${parsed.value.id}`);
      if (question === undefined) whole('QUESTION_UNKNOWN', `${id} was never asked`);
      reject(id, fingerprint, reasons);
      continue;
    }

    const { claims, not_found } = parsed.value;
    const sources = claims.flatMap((claim) => claim.sources);
    for (const { doi } of sources) {
      if (!lookups.has(doi)) lookups.set(doi, await registry.lookup(doi));
    }
    const lookupOf = (doi: string): Lookup => lookups.get(doi) as Lookup;
    if (sources.some(({ doi }) => lookupOf(doi).kind === 'unavailable')) {
      deferred.push(id);
      continue;
    }

    const texts = cited.values();
    const checked = claims.map((claim, claimRank) => ({
      statement: claim.statement,
      sources: claim.sources.map((source, sourceRank) => ({
        source,
        claimRank,
        sourceRank,
        lookup: lookupOf(source.doi) as Reachable,
        text: texts.next().value,
      })),
    }));
    const flat = checked.flatMap((claim) => claim.sources);
    const reasons: Reasons = flat.flatMap(({ source, claimRank, sourceRank, lookup, text }) =>
      checkSource(source, lookup, text).map(({ code, detail }) => ({
        code,
        claim: claimRank,
        source: sourceRank,
        detail,
      })),
    );
    if (reasons.length > 0) {
      reject(id, fingerprint, reasons);
      continue;
    }

    // No reason: every lookup is a `found` and every text is present.
    const proofs = new Map<string, string>();
    const record: Verified = {
      id,
      question: question.question,
      verified_at: clock().toISOString(),
      level: 'quote_in_supplied_text',
      claims: checked.map((claim) => ({
        statement: claim.statement,
        sources: claim.sources.map(({ source, lookup, text }) => {
          const { title, year } = lookup as Found;
          const sha = sha256(text as string);
          proofs.set(sha, text as string);
          return { doi: source.doi, title, year, quote: source.quote, text_sha256: sha };
        }),
      })),
      not_found,
    };
    store.saveVerified(record, proofs);
    verified.push(id);
  }

  const pending = store.askedIds().filter((id) => !alreadyVerified.has(id) && !answered.includes(id));
  return { verified, rejected, deferred, pending };
}
