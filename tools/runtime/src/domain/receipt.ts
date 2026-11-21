// The receipt of an admission, written exclusively at `run/<id>/admission.json` before the command is dispatched. It is
// the starting sample of step 4's measure, not a peak. It holds no environment variable, no argument, nothing of
// stdin, no credential and no path: the kind of the command, the name of the environment, the policy, the floors and
// the two observations.
import { POLICY_VERSION, type EnvironmentName, type Reserve } from '#runtime/domain/policy.js';
import type { Observation } from '#runtime/domain/space.js';

export const RECEIPT_SCHEMA = 'architect-os-runtime-receipt/v1';

/**
 * The kind of the command a run is admitted for, as the shell entry `aos` classifies its PROGRAM: `npm`, `npx` or `node`
 * when PROGRAM is that word exactly, `other` for any other name or any path. A closed list: neither the name nor the
 * path of PROGRAM, nor any argument, reaches the admission.
 */
export const COMMAND_KINDS = ['npm', 'npx', 'node', 'other'] as const;
export type CommandKind = (typeof COMMAND_KINDS)[number];

/** The kind a text names, or none when it is not one of the closed list. */
export const commandKindOf = (text: string | undefined): CommandKind | undefined =>
  COMMAND_KINDS.find((kind) => kind === text);

export interface Receipt {
  readonly run: string;
  readonly admittedAt: Date;
  readonly command: CommandKind;
  readonly environment: EnvironmentName;
  readonly reserve: Reserve;
  readonly root: Observation & { readonly inode: bigint };
  readonly home: Observation;
}

/** The text of the receipt: JSON, every count a decimal string, one final line end. */
export function receiptText(receipt: Receipt): string {
  const body = {
    schema: RECEIPT_SCHEMA,
    run: receipt.run,
    admittedAt: receipt.admittedAt.toISOString(),
    command: receipt.command,
    environment: receipt.environment,
    policy: { version: POLICY_VERSION, status: receipt.reserve.status },
    floors: {
      rootBytes: receipt.reserve.rootFloorBytes.toString(),
      homeBytes: receipt.reserve.homeFloorBytes.toString(),
    },
    observations: {
      root: {
        device: receipt.root.device.toString(),
        inode: receipt.root.inode.toString(),
        availableBytes: receipt.root.availableBytes.toString(),
      },
      home: {
        device: receipt.home.device.toString(),
        availableBytes: receipt.home.availableBytes.toString(),
      },
    },
  };
  return `${JSON.stringify(body, null, 2)}\n`;
}
