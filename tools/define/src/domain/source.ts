/** A read against the producer. Connecting and closing a session belong to the adapter. */
export interface DefineSource {
  getHandoff(runId: string): Promise<{ readonly isError?: boolean; readonly content: readonly unknown[] }>;
}
