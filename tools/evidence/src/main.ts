// The composition root of `npm run evidence` (docs/design/evidence-desk.md §7): the one place that builds objects. The
// entry `cli.ts` only hands it the process.
import { createHash } from 'node:crypto';
import { constants, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { text } from 'node:stream/consumers';
import { fileURLToPath } from 'node:url';
import { ask } from './application/ask.js';
import { verify } from './application/verify.js';
import { DoiOrgRegistry } from './infrastructure/doi-org.js';
import { openFsStore, type FsStore, type OpenConstants } from './infrastructure/fs-store.js';

/** The files of the skill folder that `ask` copies into `out`. */
const SKILL_FILES = ['SKILL.md', 'answer.schema.json'];
const USAGE = 'usage: evidence ask <ledger> <desk> <id> < question.txt | evidence verify <ledger> <desk>';

/** What the command needs from its process; every one of them is injected. */
export interface EvidenceDependencies {
  /** The arguments after the script: the command and its operands. */
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly readStdin: () => Promise<string>;
  readonly stdout: { write(text: string): unknown };
  readonly stderr: { write(text: string): unknown };
  readonly uid: number;
  readonly fetch: typeof fetch;
  readonly clock: () => Date;
  readonly constants: OpenConstants;
  /** The folder holding the skill's files, resolved from the module by the real process. */
  readonly skillFolder: string;
}

type Outcome<T> = { ok: true; value: T } | { ok: false; reason: string };

/** The folder made absolute, its parent canonical (`/tmp` is a link on macOS); the folder itself is left to the store. */
function canonical(deps: EvidenceDependencies, folder: string): Outcome<string> {
  const absolute = resolve(deps.cwd, folder);
  try {
    return { ok: true, value: join(realpathSync(dirname(absolute)), basename(absolute)) };
  } catch {
    return { ok: false, reason: `the parent of ${absolute} cannot be resolved` };
  }
}

function openStore(deps: EvidenceDependencies, ledger: string, desk: string): Outcome<FsStore> {
  const ledgerPath = canonical(deps, ledger);
  if (!ledgerPath.ok) return ledgerPath;
  const deskPath = canonical(deps, desk);
  if (!deskPath.ok) return deskPath;
  const opened = openFsStore(ledgerPath.value, deskPath.value, deps.uid, deps.constants);
  if (opened.ok) return { ok: true, value: opened.store };
  const { code, folder, detail } = opened.refusal;
  return { ok: false, reason: `${code} ${folder}: ${detail}` };
}

function readSkill(deps: EvidenceDependencies): Outcome<Record<string, string>> {
  const skill: Record<string, string> = {};
  for (const name of SKILL_FILES) {
    const file = join(deps.skillFolder, name);
    try {
      skill[name] = readFileSync(file).toString();
    } catch {
      return { ok: false, reason: `the skill file ${file} cannot be read` };
    }
  }
  return { ok: true, value: skill };
}

/**
 * The command; its exit code is 0, 1 (`verify` left a rejection or a deferral), 2 (a refusal, one line on stderr) or 3
 * (an error nobody foresaw, one line on stderr): a caller that reads the code alone tells a crash from a rejection.
 */
export async function runEvidence(deps: EvidenceDependencies): Promise<number> {
  try {
    return await command(deps);
  } catch (error) {
    deps.stderr.write(`architect-os evidence: unexpected: ${String(error)}\n`);
    return 3;
  }
}

async function command(deps: EvidenceDependencies): Promise<number> {
  const refuse = (reason: string): number => {
    deps.stderr.write(`architect-os evidence: ${reason.replaceAll('\n', '; ')}\n`);
    return 2;
  };
  const [command, ...operands] = deps.argv;

  if (command === 'ask' && operands.length === 3) {
    const [ledger, desk, id] = operands as [string, string, string];
    const skill = readSkill(deps);
    if (!skill.ok) return refuse(skill.reason);
    const question = await deps.readStdin();
    const store = openStore(deps, ledger, desk);
    if (!store.ok) return refuse(store.reason);
    const asked = ask({ store: store.value, clock: deps.clock, skill: skill.value }, id, question);
    if (!asked.ok) return refuse(`${asked.code}: ${asked.detail}`);
    deps.stdout.write(
      `${JSON.stringify({ asked: id, question: join(store.value.out, `${id}.question.json`) })}\n`,
    );
    return 0;
  }

  if (command === 'verify' && operands.length === 2) {
    const [ledger, desk] = operands as [string, string];
    const store = openStore(deps, ledger, desk);
    if (!store.ok) return refuse(store.reason);
    const report = await verify({
      store: store.value,
      registry: new DoiOrgRegistry(deps.fetch, (ms) => AbortSignal.timeout(ms)),
      clock: deps.clock,
      sha256: (content) => createHash('sha256').update(content).digest('hex'),
    });
    deps.stdout.write(`${JSON.stringify(report)}\n`);
    return report.rejected.length === 0 && report.deferred.length === 0 ? 0 : 1;
  }

  return refuse(USAGE);
}

/** The process, as far as the command reads it. */
export interface EvidenceProcess {
  readonly argv: readonly string[];
  readonly stdin: AsyncIterable<Buffer | string>;
  readonly stdout: { write(text: string): unknown };
  readonly stderr: { write(text: string): unknown };
  cwd(): string;
  readonly getuid?: () => number;
}

/** The real dependencies: the streams of the process, `fetch`, the clock, `node:fs` constants, the skill beside the module. */
export function evidenceDependencies(proc: EvidenceProcess): EvidenceDependencies {
  return {
    argv: proc.argv.slice(2),
    cwd: proc.cwd(),
    readStdin: () => text(proc.stdin),
    stdout: proc.stdout,
    stderr: proc.stderr,
    uid: (proc.getuid as () => number).call(proc),
    fetch,
    clock: () => new Date(),
    constants,
    skillFolder: fileURLToPath(new URL('../skill/', import.meta.url)),
  };
}
