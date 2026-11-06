import type { DataOpName } from '@architect-os/contracts';

/** An answer of the gateway, forwarded to the caller of the module untouched. */
export interface Answer {
  readonly text: string;
  readonly structured?: Record<string, unknown> | undefined;
  readonly isError: boolean;
}

/**
 * Port: the callback of the gateway (docs/design/platform-v3-srt.md, §2, Identifiant d'appel). The module presents the
 * identifier of the call it serves; the gateway derives the task and the caller from it. Rejects when the gateway
 * cannot be reached; a refusal of the gateway is an answer.
 */
export interface Callback {
  operate(call: string, op: DataOpName, args: Record<string, unknown>): Promise<Answer>;
}
