import { parsePlanPolicy } from '@architect-os/contracts';
import { isStepName, parseStepPolicy } from '@architect-os/sandbox';
import type { StepInputs } from '../application/prepare.js';

export { isStepName };

export function readStepInputs(text: string): StepInputs {
  const policy = parsePlanPolicy(JSON.parse(text));
  const step = parseStepPolicy(policy.step);
  const questions = policy.scout_questions;
  if (
    Object.keys(questions).length !== step.scouts.length ||
    step.scouts.some(({ name }) => !Object.hasOwn(questions, name))
  ) {
    throw new Error('PLAN_SCOUT_QUESTIONS_INVALID');
  }
  return {
    step,
    questions: Object.fromEntries(step.scouts.map(({ name }) => [`scout.${name}.md`, questions[name]!])),
  };
}
