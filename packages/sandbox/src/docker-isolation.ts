import { CGROUP_FILES, type ProbeTargets } from './container-probe.js';

/**
 * The judgement of the check at start of the Docker adapter (docker-process-runner.ts): what the daemon says of itself,
 * and what the probe of the canary container reports. Nothing here runs a process.
 */

/** The first line of a text: what a refusal quotes of an output. */
export const firstLine = (text: string): string => text.split('\n')[0] as string;

/** What a text is as JSON; undefined when it is not JSON. */
function json(text: string): unknown {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    // Not JSON: no value.
  }
  return value;
}

/** The entries of `docker info --format '{{json .SecurityOptions}}'`, or null when the output is not a JSON array of strings. */
export function securityOptions(output: string): string[] | null {
  const parsed = json(output);
  return Array.isArray(parsed) && parsed.every((entry) => typeof entry === 'string') ? parsed : null;
}

/** The daemon is rootless when one entry is `name=rootless`, with options or without. */
export const isRootless = (entries: readonly string[]): boolean =>
  entries.some((entry) => entry === 'name=rootless' || entry.startsWith('name=rootless,'));

/** What the adapter expects of the container it starts, to judge the report of the probe against. */
export interface Expected {
  readonly value: string;
  readonly uid: number;
  readonly targets: ProbeTargets;
  readonly memory: number;
  readonly pids: number;
}

const at = (value: unknown, ...keys: string[]): unknown =>
  keys.reduce(
    (found, key) =>
      typeof found === 'object' && found !== null ? (found as Record<string, unknown>)[key] : undefined,
    value,
  );

const show = (value: unknown): string => JSON.stringify(value) ?? 'nothing';

/**
 * The first condition the report does not meet, with what was read and what was expected; null when it meets all.
 * A report that is not a JSON object meets none.
 */
export function firstUnmet(line: string, expected: Expected): string | null {
  const report = json(line);
  if (typeof report !== 'object' || report === null)
    return `the probe printed ${show(firstLine(line))}, not a JSON object`;
  const t = expected.targets;
  const written = { content: 'written' };
  const readOnly = { error: 'EROFS' };
  const bounds = {
    'memory.max': String(expected.memory),
    'memory.swap.max': '0',
    'pids.max': String(expected.pids),
  };
  const conditions: [string, unknown, unknown][] = [
    [`value read through 127.0.0.1:${t.port}`, at(report, 'read'), { content: expected.value }],
    ['uid', at(report, 'uid'), expected.uid],
    ['network interfaces', at(report, 'interfaces'), ['lo']],
    [`connection to ${t.outside.host}:${t.outside.port}`, at(report, 'outside'), { error: 'ENETUNREACH' }],
    ...t.unwritable.map((path): [string, unknown, unknown] => [
      `write in ${path}`,
      at(report, 'writes', path),
      readOnly,
    ]),
    ...t.writable.map((path): [string, unknown, unknown] => [
      `write in ${path}`,
      at(report, 'writes', path),
      written,
    ]),
    ...CGROUP_FILES.map((name): [string, unknown, unknown] => [
      name,
      at(report, 'cgroup', name),
      { content: bounds[name] },
    ]),
  ];
  const unmet = conditions.find(([, read, wanted]) => show(read) !== show(wanted));
  return unmet === undefined ? null : `${unmet[0]}: read ${show(unmet[1])}, expected ${show(unmet[2])}`;
}
