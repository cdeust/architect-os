import { parseDefinePlanningReply, type DefineHandoff } from '@architect-os/contracts';
import type { DefineSource } from '../domain/source.js';

type Outcome =
  | { readonly handoff: DefineHandoff }
  | { readonly error: 'DEFINE_REFUSED' | 'DEFINE_REPLY_INVALID' | 'DEFINE_RUN_MISMATCH' };

/** Read only. The producer keeps the decision, and the host retains all execution authority. */
export async function readDefine(runId: string, source: DefineSource): Promise<Outcome> {
  const reply = await source.getHandoff(runId);
  if (reply.isError) return { error: 'DEFINE_REFUSED' };
  try {
    const result = parseDefinePlanningReply(reply.content);
    return result.handoff.run_id === runId ? result : { error: 'DEFINE_RUN_MISMATCH' };
  } catch {
    return { error: 'DEFINE_REPLY_INVALID' };
  }
}
