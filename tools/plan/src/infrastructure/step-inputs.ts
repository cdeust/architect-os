import { parsePlanPolicy } from '@architect-os/contracts';
import {
  isStepName,
  parseRoutedPolicy,
  parseRoutingTable,
  parseStepPolicy,
  routedStep,
} from '@architect-os/sandbox';
import type { StepInputs } from '../application/prepare.js';

export { isStepName };

/** The scout questions of the policy, one per named scout, by the file name the Step reads. */
function scoutQuestions(names: readonly string[], questions: Readonly<Record<string, string>>) {
  if (
    Object.keys(questions).length !== names.length ||
    names.some((name) => !Object.hasOwn(questions, name))
  ) {
    throw new Error('PLAN_SCOUT_QUESTIONS_INVALID');
  }
  return Object.fromEntries(names.map((name) => [`scout.${name}.md`, questions[name]!]));
}

/**
 * The Step inputs of an operator policy. A policy whose step carries `routing` names no model: its sessions are derived
 * from the routing table of the launcher and the ticket the Step serves, once the Define tickets are read. The table is
 * read only for such a policy.
 */
export function readStepInputs(text: string, routingTable?: () => string): StepInputs {
  const policy = parsePlanPolicy(JSON.parse(text));
  if (Object.hasOwn(Object(policy.step), 'routing')) {
    const routed = parseRoutedPolicy(policy.step);
    if (!routingTable) throw new Error('PLAN_ROUTING_TABLE_REQUIRED');
    const text = routingTable();
    const table = parseRoutingTable(text);
    return {
      step: (tickets) => routedStep(routed, table, text, tickets),
      questions: scoutQuestions(
        routed.scouts.map(({ name }) => name),
        policy.scout_questions,
      ),
    };
  }
  const step = parseStepPolicy(policy.step);
  return {
    step,
    questions: scoutQuestions(
      step.scouts.map(({ name }) => name),
      policy.scout_questions,
    ),
  };
}
