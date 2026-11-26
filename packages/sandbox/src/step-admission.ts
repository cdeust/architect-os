import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { tmpdir, userInfo } from 'node:os';
import { readPrivateText } from './private-text.js';
import { parseTool } from './tool.js';
import { sha256 as admissionDigest } from './step-record.js';
import type { StepFile } from './step-file.js';
import type { TreeFingerprint } from './tree-fingerprint.js';

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

// `criteria` : le statut attendu, puis observé, de chaque critère d'acceptation du spécimen (R2). Facultatif pour les
// rôles qui ne rendent pas de critères ; une preuve de prompt de revue en exige au moins un cas (`attestsCriteria`).
const outcome = z.strictObject({
  verdict: z.enum(['pass', 'refuse']),
  findings: z.array(z.string()),
  criteria: z
    .array(
      z.strictObject({
        id: z.string().regex(/^AC-\d{1,9}$/),
        status: z.enum(['met', 'unmet', 'not_established']),
      }),
    )
    .min(1)
    .optional(),
});
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
        JSON.stringify(expected.findings) === JSON.stringify(observed.findings) &&
        JSON.stringify(expected.criteria) === JSON.stringify(observed.criteria),
    )
  );
}

/** Une preuve du prompt de revue a au moins un cas qui attend un statut par critère : sans lui, rien ne montre que le prompt rend ces statuts. */
function attestsCriteria(role: string, proof: z.infer<typeof promptProof>) {
  return !role.startsWith('review:') || proof.results.some(({ expected }) => expected.criteria !== undefined);
}

type AdmissionPayload = z.infer<typeof payload>;

function fileDigestsMatch(
  recorded: Readonly<Record<string, string>>,
  actual: Readonly<Record<string, string>>,
) {
  return JSON.stringify(digestEntryOrder(recorded)) === JSON.stringify(actual);
}

function manifestApprovesStep(
  proof: AdmissionPayload,
  subject: StepAdmissionSubject,
  inputHashes: Readonly<Record<string, string>>,
) {
  const { manifest, approval, define, plan } = proof;
  return (
    manifest.step === subject.name &&
    approval.approval_sha256 === admissionDigest(JSON.stringify(manifest)) &&
    (!subject.approval_sha256 || subject.approval_sha256 === approval.approval_sha256) &&
    fileDigestsMatch(manifest.files_sha256, inputHashes) &&
    manifest.source_sha256.define === define.sha256 &&
    manifest.source_sha256.proposal === plan.sha256 &&
    manifest.source_sha256.reviewed_plan === plan.raw_receipt_sha256
  );
}

function executionMatchesReceipt(
  proof: AdmissionPayload,
  subject: StepAdmissionSubject,
  inputHashes: Readonly<Record<string, string>>,
) {
  return (
    subject.tree.clean === proof.worktree.clean &&
    subject.tree.commit === proof.worktree.commit &&
    subject.tree.tree === proof.worktree.tree &&
    fileDigestsMatch(proof.inputs_sha256, inputHashes) &&
    proof.launcher_sha256 === admissionDigest(JSON.stringify(digestFiles(subject.launcher)))
  );
}

function planningMatchesReceipt(proof: AdmissionPayload, subject: StepAdmissionSubject) {
  const { define, plan } = proof;
  return (
    plan.define_sha256 === define.sha256 &&
    (!subject.define_sha256 || subject.define_sha256 === define.sha256) &&
    (!subject.proposal_sha256 || subject.proposal_sha256 === plan.sha256) &&
    (!subject.reviewed_plan_sha256 || subject.reviewed_plan_sha256 === plan.raw_receipt_sha256) &&
    (!subject.define_review || JSON.stringify(subject.define_review) === JSON.stringify(define.review)) &&
    (!subject.plan_review || JSON.stringify(subject.plan_review) === JSON.stringify(plan.review))
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
    !manifestApprovesStep(proof, subject, hashes) ||
    !executionMatchesReceipt(proof, subject, hashes) ||
    !planningMatchesReceipt(proof, subject) ||
    proof.specimens.length !== required.length
  )
    throw new Error('STEP_ADMISSION_EVIDENCE_MISMATCH');
  const byRole = new Map(proof.specimens.map((item) => [item.role, item]));
  for (const route of required) {
    const evaluated = byRole.get(route.role);

    if (
      !evaluated ||
      evaluated.model.provider !==
        (route.role === 'build' ? (subject.step.build.provider ?? 'anthropic') : 'anthropic') ||
      evaluated.model.model !== route.model ||
      evaluated.prompt_sha256 !== route.prompt_sha256 ||
      !successfulReplays(evaluated) ||
      !attestsCriteria(route.role, evaluated)
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
  if (uid === undefined) throw new Error('STEP_ADMISSION_REQUIRED');
  const parent = statSync(dirname(path));
  if (parent.uid !== uid || !parent.isDirectory() || (parent.mode & 0o077) !== 0) {
    throw new Error('STEP_ADMISSION_REQUIRED');
  }
  return JSON.parse(readPrivateText(path, uid, 'STEP_ADMISSION_REQUIRED')) as unknown;
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
