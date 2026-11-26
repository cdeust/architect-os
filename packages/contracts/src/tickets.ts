import { z } from 'zod';

export const acceptanceIdSchema = () => z.string().regex(/^AC-\d{1,9}$/);

// jira-prompts.ts specifies Fibonacci without an upper estimate. Zod's integer schema
// bounds the input to exact JSON numbers; the positive sequence begins with 1, 2.
function fibonacci(points: number): boolean {
  let previous = 1;
  let current = 2;
  while (previous < points) {
    [previous, current] = [current, previous + current];
  }
  return previous === points;
}

function uniqueIds(ids: string[]): boolean {
  return new Set(ids).size === ids.length;
}

// Topological validation consumes a queue of tickets whose prerequisites have been seen.
// Keeping it iterative also allows long dependency chains.
function validateGraph(tickets: readonly { id: string; depends_on: string[] }[], ctx: z.RefinementCtx) {
  const graph = new Map(
    tickets.map(({ id, depends_on }) => [id, { remaining: depends_on.length, successors: [] as string[] }]),
  );
  if (graph.size !== tickets.length) {
    ctx.addIssue({ code: 'custom', message: 'TICKET_ID_DUPLICATE' });
    return;
  }
  const ready: string[] = [];
  for (const { id, depends_on } of tickets) {
    if (depends_on.length === 0) ready.push(id);
    for (const prerequisite of depends_on) {
      const entry = graph.get(prerequisite);
      if (!entry) {
        ctx.addIssue({ code: 'custom', message: 'TICKET_DEPENDENCY_UNKNOWN' });
        return;
      }
      entry.successors.push(id);
    }
  }
  for (const id of ready) {
    for (const successor of graph.get(id)!.successors) {
      const entry = graph.get(successor)!;
      if (--entry.remaining === 0) ready.push(successor);
    }
  }
  if (ready.length !== tickets.length) ctx.addIssue({ code: 'custom', message: 'TICKET_DEPENDENCY_CYCLE' });
}

/** Data shared by the Define handoff, the approved Step file and the host record. */
export function ticketsSchema() {
  // TICKET-001 to TICKET-999: the producer numbers its tickets from 1, so TICKET-000 names none.
  const ticketId = z.string().regex(/^TICKET-(?!000)\d{3}$/);
  return z
    .array(
      z.strictObject({
        id: ticketId,
        story_points: z.int().refine(fibonacci, 'TICKET_POINTS_INVALID'),
        depends_on: z.array(ticketId).refine(uniqueIds, 'TICKET_DEPENDENCY_DUPLICATE'),
        acceptance_ids: z.array(acceptanceIdSchema()).min(1).refine(uniqueIds, 'TICKET_ACCEPTANCE_DUPLICATE'),
      }),
    )
    .min(1)
    .superRefine(validateGraph);
}
