// The admission policy, as decoded from tools/runtime/admission.json (the decoder is
// src/infrastructure/policy-file.ts). Three named environments, each with two floors in bytes.

/** The environments an installer may name in the marker of a root: exactly these, no default. */
export const ENVIRONMENTS = ['workstation', 'hosted-runner', 'server'] as const;
export type EnvironmentName = (typeof ENVIRONMENTS)[number];

/** The one policy version this code reads. */
export const POLICY_VERSION = 1;

/** The status of a reserve: every reserve is an operating choice until step 4 measures the peaks. */
export type ReserveStatus = 'provisional';

export interface Reserve {
  /** Available bytes on the filesystem of the root must be strictly above this. */
  readonly rootFloorBytes: bigint;
  /** Available bytes on the filesystem of the actual home of the account must be strictly above this. */
  readonly homeFloorBytes: bigint;
  readonly status: ReserveStatus;
  readonly basis: string;
  readonly review: string;
}

export interface AdmissionPolicy {
  readonly version: typeof POLICY_VERSION;
  readonly environments: Readonly<Record<EnvironmentName, Reserve>>;
}

/** The reserve of a name read from a marker; a name outside the closed list has none. */
export function reserveOf(
  policy: AdmissionPolicy,
  name: string,
): { name: EnvironmentName; reserve: Reserve } | undefined {
  const known = ENVIRONMENTS.find((environment) => environment === name);
  return known === undefined ? undefined : { name: known, reserve: policy.environments[known] };
}
