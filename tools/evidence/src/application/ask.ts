import { QuestionSchema, issuesOf, type Question } from '../domain/contract.js';
import type { Clock, Store } from '../domain/ports.js';

export interface AskDependencies {
  readonly store: Store;
  readonly clock: Clock;
  /** The files of the skill, name to content: published in `out` at every `ask`. */
  readonly skill: Readonly<Record<string, string>>;
}

/** A refusal is a value: the question was not asked and nothing was written. */
export type Asked =
  | { ok: true; question: Question }
  | { ok: false; code: 'QUESTION_INVALID' | 'QUESTION_EXISTS'; detail: string };

/** Records a question in the ledger and the desk, then (re)publishes the skill (docs/design/evidence-desk.md §7). */
export function ask(deps: AskDependencies, id: string, text: string): Asked {
  const parsed = QuestionSchema.safeParse({
    id,
    question: text.trim(),
    asked_at: deps.clock().toISOString(),
  });
  if (!parsed.success) return { ok: false, code: 'QUESTION_INVALID', detail: issuesOf(parsed.error) };
  if (deps.store.askedIds().includes(id)) {
    return { ok: false, code: 'QUESTION_EXISTS', detail: `${id} is already in the ledger` };
  }
  deps.store.saveQuestion(parsed.data);
  for (const [name, content] of Object.entries(deps.skill)) deps.store.publish(name, content);
  return { ok: true, question: parsed.data };
}
