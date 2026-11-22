import {
  closeSync,
  constants,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { tmpdir, userInfo } from 'node:os';
import { parseTool } from './tool.js';
import { sha256 as admissionDigest } from './step-record.js';
import type { StepFile } from './step-file.js';
import type { TreeFingerprint } from './tree-fingerprint.js';

// Use the native provider output bound in tools/plan/src/infrastructure/plan-cli.ts.
const MAX_ADMISSION_BYTES = 1024 * 1024;
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const actor = z.strictObject({
  provider: z.enum(['anthropic', 'openai', 'google']),
  model: z.string().min(1),
});
const independence = z
  .strictObject({
    drafter: actor,
    reviewer: actor,
    status: z.literal('clear'),
  })
  .refine(
    ({ drafter, reviewer }) => drafter.provider !== reviewer.provider && drafter.model !== reviewer.model,
  );

const outcome = z.strictObject({ verdict: z.enum(['pass', 'refuse']), findings: z.array(z.string()) });
const specimen = z.strictObject({
  id: z.string().min(1),
  input_sha256: sha,
  expected: outcome,
  observed: outcome,
});
const promptProof = z.strictObject({
  role: z.string().min(1),
  model: actor,
  prompt_sha256: sha,
  oracle_sha256: sha,
  cases_sha256: sha,
  results: z.array(specimen).min(1),
});
const manifest = z.strictObject({
  version: z.literal(1),
  run_id: z.string(),
  step: z.string(),
  source_sha256: z.strictObject({ define: sha, proposal: sha, reviewed_plan: sha, policy: sha }),
  files_sha256: z.record(z.string(), sha),
});
const payload = z.strictObject({
  step: z.string(),
  worktree: z.strictObject({ root: z.string(), commit: z.string(), tree: z.string(), clean: z.boolean() }),
  manifest,
  approval: z.strictObject({ version: z.literal(1), decision: z.literal('approve'), approval_sha256: sha }),
  inputs_sha256: z.record(z.string(), sha),
  launcher_sha256: sha,
  define: z.strictObject({ sha256: sha, review: independence }),
  plan: z.strictObject({ sha256: sha, define_sha256: sha, raw_receipt_sha256: sha, review: independence }),
  specimens: z.array(promptProof).min(1),
});
const authority = z.strictObject({
  version: z.literal(1),
  approved_sha256: sha,
  payload,
});

function digestFiles(files: Readonly<Record<string, string>>) {
  return Object.fromEntries(
    Object.keys(files)
      .sort()
      .map((name) => [name, admissionDigest(files[name]!)]),
  );
}

export interface StepAdmissionSubject {
  readonly name: string;
  readonly worktree: string;
  readonly approval_sha256?: string;
  readonly tree: TreeFingerprint;
  readonly inputs: Readonly<Record<string, string>>;
  readonly step: StepFile;
  readonly launcher: Readonly<Record<string, string>>;
  readonly define_sha256?: string;
  readonly proposal_sha256?: string;
  readonly reviewed_plan_sha256?: string;
  readonly define_review?: z.infer<typeof independence>;
  readonly plan_review?: z.infer<typeof independence>;
}

function promptSubjects(subject: StepAdmissionSubject) {
  const promptSha = (tool: string) => {
    const definition = parseTool(JSON.parse(subject.launcher[tool]!));
    return admissionDigest(subject.launcher[definition.launcherPromptFile]!);
  };
  const required = [
    { role: 'build', model: subject.step.build.model, prompt_sha256: promptSha('code.json') },
  ];
  for (const [group, roles, tool] of [
    ['scout', subject.step.scouts, 'scout.json'],
    ['review', subject.step.reviews, 'review.json'],
  ] as const) {
    if (roles.length === 0) continue;
    const prompt_sha256 = promptSha(tool);
    for (const role of roles)
      required.push({ role: group + ':' + role.name, model: role.model, prompt_sha256 });
  }
  return required;
}

function successfulReplays(proof: z.infer<typeof promptProof>) {
  const cases = proof.results.map(({ id, input_sha256, expected }) => ({ id, input_sha256, expected }));
  return (
    new Set(cases.map(({ id }) => id)).size === cases.length &&
    admissionDigest(JSON.stringify(cases)) === proof.cases_sha256 &&
    proof.results.every(
      ({ expected, observed }) =>
        expected.verdict === observed.verdict &&
        JSON.stringify(expected.findings) === JSON.stringify(observed.findings),
    )
  );
}

/** Revalidates exact planning, approval and specimen evidence before an implementation side effect. */
export function requireStepAdmission(value: unknown, subject: StepAdmissionSubject): string {
  const { approved_sha256, payload: proof } = authority.parse(value);
  const hashes = digestFiles(subject.inputs);
  const required = promptSubjects(subject);
  if (
    approved_sha256 !== admissionDigest(JSON.stringify(proof)) ||
    proof.step !== subject.name ||
    proof.worktree.root !== subject.worktree ||
    proof.manifest.step !== subject.name ||
    proof.approval.approval_sha256 !== admissionDigest(JSON.stringify(proof.manifest)) ||
    (subject.approval_sha256 && subject.approval_sha256 !== proof.approval.approval_sha256) ||
    JSON.stringify(digestEntryOrder(proof.manifest.files_sha256)) !== JSON.stringify(hashes) ||
    proof.manifest.source_sha256.define !== proof.define.sha256 ||
    proof.manifest.source_sha256.proposal !== proof.plan.sha256 ||
    proof.manifest.source_sha256.reviewed_plan !== proof.plan.raw_receipt_sha256 ||
    subject.tree.clean !== proof.worktree.clean ||
    subject.tree.commit !== proof.worktree.commit ||
    subject.tree.tree !== proof.worktree.tree ||
    JSON.stringify(digestEntryOrder(proof.inputs_sha256)) !== JSON.stringify(hashes) ||
    proof.launcher_sha256 !== admissionDigest(JSON.stringify(digestFiles(subject.launcher))) ||
    proof.plan.define_sha256 !== proof.define.sha256 ||
    (subject.define_sha256 && subject.define_sha256 !== proof.define.sha256) ||
    (subject.proposal_sha256 && subject.proposal_sha256 !== proof.plan.sha256) ||
    (subject.reviewed_plan_sha256 && subject.reviewed_plan_sha256 !== proof.plan.raw_receipt_sha256) ||
    (subject.define_review &&
      JSON.stringify(subject.define_review) !== JSON.stringify(proof.define.review)) ||
    (subject.plan_review && JSON.stringify(subject.plan_review) !== JSON.stringify(proof.plan.review)) ||
    proof.specimens.length !== required.length
  )
    throw new Error('STEP_ADMISSION_EVIDENCE_MISMATCH');
  const byRole = new Map(proof.specimens.map((item) => [item.role, item]));
  for (const route of required) {
    const evaluated = byRole.get(route.role);
    // The shipped Step native adapter currently uses Claude Code.
    if (
      !evaluated ||
      evaluated.model.provider !== 'anthropic' ||
      evaluated.model.model !== route.model ||
      evaluated.prompt_sha256 !== route.prompt_sha256 ||
      !successfulReplays(evaluated)
    ) {
      throw new Error('STEP_ADMISSION_SPECIMENS_REQUIRED');
    }
  }
  return approved_sha256;
}

function digestEntryOrder(hashes: Readonly<Record<string, string>>) {
  return Object.fromEntries(
    Object.keys(hashes)
      .sort()
      .map((name) => [name, hashes[name]]),
  );
}

export function stepAdmissionAuthority(): string {
  return join(realpathSync(userInfo().homedir), '.config', 'architect-os', 'step-admission');
}

/** Only the designated host authority may supply a receipt. The CLI cannot override its root. */
export function readStepAdmission(
  path: string | undefined,
  worktree: string,
  authorityRoot = stepAdmissionAuthority(),
): unknown {
  if (
    !path ||
    !isAbsolute(path) ||
    dirname(path) !== authorityRoot ||
    realpathSync(authorityRoot) !== authorityRoot ||
    realpathSync(path) !== path
  )
    throw new Error('STEP_ADMISSION_REQUIRED');
  const fromWorktree = relative(realpathSync(worktree), path);
  if (!fromWorktree.startsWith('..' + sep)) throw new Error('STEP_ADMISSION_REQUIRED');
  const uid = process.getuid?.();
  const parent = statSync(dirname(path));
  if (uid === undefined || parent.uid !== uid || !parent.isDirectory() || (parent.mode & 0o077) !== 0) {
    throw new Error('STEP_ADMISSION_REQUIRED');
  }
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.uid !== uid ||
      (stat.mode & 0o077) !== 0 ||
      stat.size > MAX_ADMISSION_BYTES
    )
      throw new Error('STEP_ADMISSION_REQUIRED');
    const buffer = Buffer.alloc(stat.size + 1);
    let offset = 0;
    for (;;) {
      const count = readSync(fd, buffer, offset, buffer.length - offset, null);
      if (count === 0) break;
      offset += count;
      if (offset === buffer.length) throw new Error('STEP_ADMISSION_REQUIRED');
    }
    if (offset !== stat.size) throw new Error('STEP_ADMISSION_REQUIRED');
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, offset)),
    ) as unknown;
  } finally {
    closeSync(fd);
  }
}

/** Copies exactly the admitted prompt, profile and tool bytes for use by all native ports. */
export function freezeStepLauncher(files: Readonly<Record<string, string>>, worktree: string) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'aos-launcher-')));
  const dispose = () => rmSync(dir, { recursive: true, force: true });
  try {
    if (!relative(realpathSync(worktree), dir).startsWith('..' + sep))
      throw new Error('STEP_ADMISSION_REQUIRED');
    for (const [name, text] of Object.entries(files)) {
      const file = resolve(dir, name);
      if (!file.startsWith(dir + sep) || relative(dir, file) !== name)
        throw new Error('STEP_ADMISSION_REQUIRED');
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      writeFileSync(file, text, { mode: 0o400, flag: 'wx' });
    }
    return { dir, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
