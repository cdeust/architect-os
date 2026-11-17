// The descriptive file `tools/deliver/deliver.json` (docs/design/orchestration-fable-5-2.md §14, « Étape 1, la commande
// de livraison »). Its strict schema is in infrastructure (`deliver-schema.ts`), behind `ParseConfig`.

export interface DeliverConfig {
  description: string;
  remote: string;
  repository: string;
  /** The branches to publish, in the order they are pushed. */
  branches: string[];
  trialPrefix: string;
  workflow: string;
  requiredJobs: string[];
  /** Files that may only grow between the parent and the commit. */
  appendOnly: string[];
  gateVerdict: string;
  ciAttempts: number;
  pollSeconds: number;
  ciPolls: number;
  ruleSuitePolls: number;
}

/** Checks a parsed JSON value against the schema of the file; the reason is one line naming each fault. */
export type ParseConfig = (
  raw: unknown,
) => { ok: true; config: DeliverConfig } | { ok: false; reason: string };
