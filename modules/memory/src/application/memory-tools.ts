import { INTERNAL_TOOLS } from '@architect-os/contracts';
import type { Answer, Callback } from '../domain/ports.js';

/**
 * The tools of the module memory (topology/catalog.json): each is a view of one data operation (INTERNAL_TOOLS), its
 * input checked by its schema, the same as modules/memory/schemas/<tool>.in.json.
 */
export const MEMORY_TOOLS = {
  search: INTERNAL_TOOLS.memory_search,
  insert: INTERNAL_TOOLS.memory_insert,
} as const;
export type MemoryToolName = keyof typeof MEMORY_TOOLS;

/** What the module answers without a call identifier: it serves no call, so it calls nothing back. */
export const NO_CALL: Answer = {
  text: JSON.stringify({
    code: 'UNAUTHORIZED',
    message: 'a call of the module carries its call identifier in _meta',
  }),
  isError: true,
};

/** One call of a tool of the module: its data operation, called back under the identifier of the call. */
export function callTool(
  callback: Callback,
  tool: MemoryToolName,
  args: Record<string, unknown>,
  call: unknown,
): Promise<Answer> {
  if (typeof call !== 'string') return Promise.resolve(NO_CALL);
  return callback.operate(call, MEMORY_TOOLS[tool].op, args);
}

/** The port the presentation is given, re-exported so that presentation depends on application only. */
export type { Callback } from '../domain/ports.js';
