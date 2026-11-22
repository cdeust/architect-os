import { hasAdmittedRun } from '@architect-os/sandbox/runtime-context';
import { privateStateDirectory } from '@architect-os/sandbox/state-journal';
import { specHostAnswer, specPlanningConfig } from '@architect-os/contracts';
import { driveSpec, type SpecHost } from './application/drive-spec.js';
import { openPlanningJournal } from './infrastructure/planning-journal.js';
import { withPlanningSpec } from './infrastructure/prd-gen.js';

export type SubscriptionModelDispatcher = Pick<SpecHost, 'authorize' | 'invoke'>;

export async function runSpecPlanning(
  node: string,
  specRoot: string,
  session: string,
  request: unknown,
  model: SubscriptionModelDispatcher,
  resume: boolean,
  operatorAnswer?: unknown,
) {
  if (!hasAdmittedRun(process.env)) throw Error('RUNTIME_ENTRY_REQUIRED');
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(session)) throw Error('SPEC_SESSION_INVALID');
  const config = specPlanningConfig.parse(request);
  const answer = operatorAnswer === undefined ? undefined : specHostAnswer.parse(operatorAnswer);
  const journal = openPlanningJournal(
    privateStateDirectory(process.env.ARCHITECT_OS_RUNTIME_ROOT!, ['spec-planning', session]),
  );
  try {
    return await withPlanningSpec(node, specRoot, journal.home, process.env.TMPDIR!, config, (call) =>
      driveSpec(
        {
          ...journal,
          call,
          authorize: (account) => model.authorize(account),
          invoke: (invocation, account) => model.invoke(invocation, account),
        },
        config,
        resume,
        answer,
      ),
    );
  } finally {
    journal.release();
  }
}
