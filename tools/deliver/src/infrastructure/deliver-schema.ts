// The strict zod schema of `tools/deliver/deliver.json` (docs/design/orchestration-fable-5-2.md §14). zod lives in
// infrastructure, like in the other tools: the domain holds the type and the port `ParseConfig`.
import { z } from 'zod';
import type { DeliverConfig, ParseConfig } from '../domain/config.js';

function configSchema(): z.ZodType<DeliverConfig> {
  const refName = z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/)
    .refine((value) => !value.includes('..'), 'a name holds no ..');
  const label = z
    .string()
    .regex(/^\P{Cc}{1,64}$/u, 'a label is 1 to 64 characters, none a control character');
  const path = z
    .string()
    .min(1)
    .refine(
      (value) => !value.startsWith('/') && !value.includes('\\') && !value.includes('..'),
      'a repository path is relative and has no .. nor backslash',
    );
  const different = (values: string[]): boolean => new Set(values).size === values.length;
  const count = (max: number): z.ZodNumber => z.number().int().min(1).max(max);

  const object = z.strictObject({
    description: z.string().min(1),
    remote: refName,
    repository: z
      .string()
      .regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/)
      .refine(
        (value) => value.split('/').every((segment) => segment !== '.' && segment !== '..'),
        'a segment of the repository is neither . nor ..',
      ),
    branches: z.array(refName).min(1).max(4).refine(different, 'the branches are all different'),
    trialPrefix: refName.refine((value) => /[-/]$/.test(value), 'a prefix ends with - or /'),
    workflow: label,
    requiredJobs: z.array(label).min(1).max(8).refine(different, 'the jobs are all different'),
    appendOnly: z.array(path).max(8),
    gateVerdict: path,
    ciAttempts: count(10),
    pollSeconds: count(300),
    ciPolls: count(600),
    ruleSuitePolls: count(60),
  });
  return object.refine(
    (config) => config.branches.every((branch) => !branch.startsWith(config.trialPrefix)),
    { path: ['trialPrefix'], message: 'a trial branch is never a branch to publish' },
  );
}

export const parseDeliverConfig: ParseConfig = (raw) => {
  const parsed = configSchema().safeParse(raw);
  if (parsed.success) return { ok: true, config: parsed.data };
  const reason = parsed.error.issues.map((issue) => `$.${issue.path.join('.')} ${issue.message}`).join('; ');
  return { ok: false, reason };
};
