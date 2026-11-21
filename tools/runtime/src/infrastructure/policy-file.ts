// The strict decoder of tools/runtime/admission.json. Built-ins only, because it runs before any install: no schema
// library. Every key is required and no other is accepted; a floor is a canonical positive decimal string of bytes
// (no sign, no zero, no leading zero, no fraction, no exponent, no space), read as a bigint. A refusal names the first
// offending field, as a path from the top of the file.
import { ENVIRONMENTS, POLICY_VERSION, type AdmissionPolicy, type Reserve } from '#runtime/domain/policy.js';

/** A refusal carries no policy, so that its reader takes `policy` from either without a test of its own. */
export type DecodedPolicy =
  | { readonly ok: true; readonly policy: AdmissionPolicy }
  | { readonly ok: false; readonly field: string; readonly policy?: undefined };

const CANONICAL_BYTES = /^[1-9][0-9]*$/;
const TOP_KEYS = ['description', 'version', 'environments'];
const RESERVE_KEYS = ['rootFloorBytes', 'homeFloorBytes', 'status', 'basis', 'review'];

/** The one thing this decoder throws, caught in `decodePolicy` alone: the path of the offending field. */
class Offending extends Error {
  readonly field: string;
  constructor(field: string) {
    super(field);
    this.field = field;
  }
}

function record(value: unknown, field: string, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Offending(field);
  const object = value as Record<string, unknown>;
  const extra = Object.keys(object).find((key) => !keys.includes(key));
  if (extra !== undefined) throw new Offending(`${field}.${extra}`);
  const missing = keys.find((key) => !Object.hasOwn(object, key));
  if (missing !== undefined) throw new Offending(`${field}.${missing}`);
  return object;
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Offending(field);
  return value;
}

function bytes(value: unknown, field: string): bigint {
  if (typeof value !== 'string' || !CANONICAL_BYTES.test(value)) throw new Offending(field);
  return BigInt(value);
}

function reserve(value: unknown, field: string): Reserve {
  const row = record(value, field, RESERVE_KEYS);
  const rootFloorBytes = bytes(row['rootFloorBytes'], `${field}.rootFloorBytes`);
  const homeFloorBytes = bytes(row['homeFloorBytes'], `${field}.homeFloorBytes`);
  if (row['status'] !== 'provisional') throw new Offending(`${field}.status`);
  const basis = text(row['basis'], `${field}.basis`);
  const review = text(row['review'], `${field}.review`);
  return { rootFloorBytes, homeFloorBytes, status: 'provisional', basis, review };
}

function policyOf(value: unknown): AdmissionPolicy {
  const top = record(value, '$', TOP_KEYS);
  text(top['description'], '$.description');
  if (top['version'] !== POLICY_VERSION) throw new Offending('$.version');
  const rows = record(top['environments'], '$.environments', ENVIRONMENTS);
  const [workstation, hostedRunner, server] = ENVIRONMENTS;
  return {
    version: POLICY_VERSION,
    environments: {
      [workstation]: reserve(rows[workstation], `$.environments.${workstation}`),
      [hostedRunner]: reserve(rows[hostedRunner], `$.environments.${hostedRunner}`),
      [server]: reserve(rows[server], `$.environments.${server}`),
    },
  };
}

/**
 * The policy of a text, or the first field that breaks the schema (`$` when the text is not JSON at all). No text (a
 * file that cannot be read) is refused as `$` too: `String(undefined)` is the text `undefined`, which is not JSON.
 */
export function decodePolicy(source: string | undefined): DecodedPolicy {
  try {
    return { ok: true, policy: policyOf(JSON.parse(String(source))) };
  } catch (error) {
    // JSON.parse throws a SyntaxError, which has no field: the whole text is refused.
    return { ok: false, field: (error as Partial<Offending>).field ?? '$' };
  }
}
