import { isStateLogTemplate } from '@architect-os/sandbox/state-journal';
// The strict zod schema of `tools/deliver/deliver.json` (docs/design/orchestration-fable-5-2.md §14). zod lives in
// infrastructure, like in the other tools: the domain holds the type and the port `ParseConfig`.
import { z } from 'zod';
import type { DeliverConfig, ParseConfig } from '../domain/config.js';

/**
 * The closed set of the names of the host that the delivery may give to git and to the client of the forge: the
 * descriptive file chooses a part of it; adding a name is a change of code (docs/design/orchestration-fable-5-2.md
 * §14, « Un environnement fermé pour git »).
 */
function hostVariables() {
  return [
    'PATH',
    'HOME',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'TMPDIR',
    'SSH_AUTH_SOCK',
    'XDG_CONFIG_HOME',
    'GH_TOKEN',
    'GITHUB_TOKEN',
  ] as const;
}

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
  const word = z
    .string()
    .regex(/^\P{Cc}{1,200}$/u, 'a word of the command is 1 to 200 characters, none a control character');
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
    jobDependencies: z
      .record(
        label,
        z.strictObject({
          producers: z.array(label).min(1).refine(different, 'the producers are all different'),
          admissionStep: label,
        }),
      )
      .optional(),
    appendOnly: z.array(path).max(8),
    gateVerdict: path,
    gateCommand: z.array(word).min(1).max(16),
    gateLog: path,
    log: z
      .string()
      .startsWith('${state}/', 'the log path starts with ${state}/')
      .refine(isStateLogTemplate, 'the log path has only ordinary components'),
    environment: z.array(z.enum(hostVariables())).min(1).refine(different, 'the variables are all different'),
    ciAttempts: count(10),
    pollSeconds: count(300),
    ciPolls: count(600),
    ruleSuitePolls: count(60),
  });
  return object
    .refine(
      ({ requiredJobs, jobDependencies = {} }) =>
        Object.entries(jobDependencies).every(
          ([name, group]) =>
            requiredJobs.includes(name) &&
            group.producers.every((job) => !Object.hasOwn(jobDependencies, job)),
        ),
      {
        path: ['jobDependencies'],
        message: 'an aggregate must be required and its producers must be leaf jobs',
      },
    )
    .refine((config) => config.branches.every((branch) => !branch.startsWith(config.trialPrefix)), {
      path: ['trialPrefix'],
      message: 'a trial branch is never a branch to publish',
    });
}

export const parseDeliverConfig: ParseConfig = (raw) => {
  const parsed = configSchema().safeParse(raw);
  if (parsed.success) return { ok: true, config: parsed.data };
  const reason = parsed.error.issues.map((issue) => `$.${issue.path.join('.')} ${issue.message}`).join('; ');
  return { ok: false, reason };
};
