// L'émetteur de production du reçu d'admission de Step (docs/design/orchestration-fable-5-2.md, §15, décision 7 ;
// journal, §125). Il atteste ce que `requireStepAdmission` revalidera : le Plan approuvé, les octets du dossier de
// l'étape, l'arbre propre du worktree, les octets du lanceur, les deux revues indépendantes et les spécimens de chaque
// rôle. Il est distinct de ses consommateurs : seul l'adaptateur d'émission de Plan l'importe (règle
// `step-admission-issuer-only-from-the-issuing-host` de `.dependency-cruiser.cjs`) ; `npm run step` ne l'appelle
// jamais. Il n'écrit qu'un fichier, nouveau, jamais un autre.
import {
  closeSync,
  constants,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { PKG } from './code-tool.js';
import {
  parseSpecimens,
  requireStepAdmission,
  parseStepAdmissionPayload,
  specimensAttest,
  stepAdmissionAuthority,
  type ReviewIndependence,
  type StepAdmissionAuthority,
  type Specimens,
  type StepAdmissionSubject,
} from './step-admission.js';
import type { StepFile } from './step-file.js';
import { isStepName, sha256 } from './step-record.js';
import { launcherFiles, readStepFolder, readStepFolderFile } from './step-tool.js';
import { fingerprintTree, type TreeFingerprint } from './tree-fingerprint.js';
import { resolveWorktree } from './worktree.js';

/** Ce que Plan a re-dérivé de ses trois sources et que la décision de l'opérateur approuve. */
export interface ApprovedPlan {
  readonly manifest: {
    readonly version: 1;
    readonly run_id: string;
    readonly step: string;
    readonly source_sha256: {
      readonly define: string;
      readonly proposal: string;
      readonly reviewed_plan: string;
      readonly policy: string;
    };
    readonly files_sha256: Readonly<Record<string, string>>;
  };
  readonly approval_sha256: string;
  readonly define: { readonly sha256: string; readonly review: ReviewIndependence };
  readonly plan: {
    readonly sha256: string;
    readonly define_sha256: string;
    readonly raw_receipt_sha256: string;
    readonly review: ReviewIndependence;
  };
}

export interface AdmissionRequest {
  readonly plan: ApprovedPlan;
  /** La preuve de spécimens, telle que lue de son fichier ; sa forme est celle du reçu. */
  readonly specimens: unknown;
  /** Le dossier de l'étape, chemin absolu, tel que l'opérateur le passera à `npm run step`. */
  readonly folder: string;
  /** La racine du worktree lié où l'étape tournera, chemin canonique. */
  readonly worktree: string;
}

/** Ce que l'émetteur lit de l'hôte. */
export interface AdmissionHost {
  /** Le texte d'un fichier du lanceur, chemin relatif à `packages/sandbox` : celui que Step lira. */
  readonly readLauncher: (file: string) => string;
  readonly fingerprint: (worktree: string) => TreeFingerprint;
  /** La racine du lanceur, celle dont `readLauncher` lit : jamais sous le worktree que le reçu admet. */
  readonly launcherRoot: string;
  /** Le répertoire d'autorité, celui où `readStepAdmission` cherche le reçu. */
  readonly authority: () => string;
  readonly uid: () => number | undefined;
}

export function productionAdmissionHost(): AdmissionHost {
  return {
    readLauncher: (file) => readFileSync(join(PKG, file), 'utf8'),
    launcherRoot: PKG,
    fingerprint: (worktree) => fingerprintTree(worktree),
    authority: stepAdmissionAuthority,
    uid: () => process.getuid?.(),
  };
}

/** Un refus nommé de l'émetteur : son message est le code. */
export class AdmissionRefusal extends Error {}

const refuse = (code: string): never => {
  throw new AdmissionRefusal(code);
};

/** Ce que l'émetteur a écrit. */
export interface IssuedAdmission {
  readonly path: string;
  readonly approved_sha256: string;
}

/**
 * Les entrées de l'étape, lues par la fonction même de Step avant ses sessions (`readStepFolder`, avec son lecteur de
 * fichiers) et composées comme `runStep` les compose. Un dossier que Step refuserait (brief ou question vide,
 * `STEP_CORRECTNESS_PROVIDER`, `step.json` absent ou refusé, UTF-8 mal formé) n'est pas attesté.
 */
function folderInputs(folder: string): { step: StepFile; inputs: Record<string, string> } {
  let read: ReturnType<typeof readStepFolder> | undefined;
  try {
    read = readStepFolder(readStepFolderFile, folder);
  } catch {
    // Le refus de Step lui-même : son message reste à Step.
  }
  if (!read) return refuse('ADMIT_STEP_REFUSED');
  const { step, raw, brief, questions } = read;
  return {
    step,
    inputs: {
      'brief.md': brief,
      'step.json': raw,
      ...Object.fromEntries(step.scouts.map(({ name }, index) => [`scout.${name}.md`, questions[index]!])),
    },
  };
}

const digests = (files: Readonly<Record<string, string>>) =>
  Object.fromEntries(
    Object.keys(files)
      .sort()
      .map((name) => [name, sha256(files[name]!)]),
  );

/** Les octets du dossier sont ceux que le manifeste approuvé nomme, ni plus ni moins de fichiers. */
function sameDigests(approved: Readonly<Record<string, string>>, actual: Readonly<Record<string, string>>) {
  const names = Object.keys(approved).sort();
  return (
    JSON.stringify(names) === JSON.stringify(Object.keys(actual)) &&
    names.every((name) => approved[name] === actual[name])
  );
}

/** La racine canonique du worktree lié et son empreinte, propre. */
function cleanWorktree(worktree: string, host: AdmissionHost): { root: string; tree: TreeFingerprint } {
  let tree: TreeFingerprint | undefined;
  try {
    // `resolveWorktree` rend un chemin réel absolu : un chemin relatif ou non canonique n'est jamais égal.
    if (resolveWorktree(worktree).worktree === worktree) tree = host.fingerprint(worktree);
  } catch {
    // Pas la racine d'un worktree lié, ou git a échoué : rien n'est attesté.
  }
  if (!tree) return refuse('ADMIT_WORKTREE_INVALID');
  if (!tree.clean) refuse('ADMIT_TREE_DIRTY');
  return { root: worktree, tree };
}

/** Le répertoire d'autorité : privé, au propriétaire effectif, canonique, hors du worktree ; créé 0700 s'il manque. */
function privateAuthority(host: AdmissionHost, worktree: string): string {
  const uid = host.uid();
  try {
    const root = host.authority();
    // Sans identité effective, aucun propriétaire ne peut être comparé : `found.uid === uid` refuse.
    if (isAbsolute(root) && relative(worktree, root).startsWith('..' + sep)) {
      mkdirSync(root, { recursive: true, mode: 0o700 });
      const found = lstatSync(root);
      if (
        found.isDirectory() &&
        found.uid === uid &&
        (found.mode & 0o077) === 0 &&
        realpathSync(root) === root
      )
        return root;
    }
  } catch {
    // Le répertoire ne peut pas être créé ou lu : il n'est pas une autorité.
  }
  return refuse('ADMIT_AUTHORITY_UNSAFE');
}

/**
 * Crée le reçu, 0600, sans suivre de lien et sans jamais remplacer un fichier. Les octets sont écrits sous un nom
 * temporaire du même répertoire, puis liés au nom final, qui n'apparaît qu'entier (`link` refuse un nom pris) ; le nom
 * temporaire est ensuite retiré. Un échec ne laisse jamais le nom final : au pis, un fichier temporaire que Step ne lit
 * pas.
 */
function writeNew(path: string, text: string): void {
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  let descriptor: number;
  try {
    descriptor = openSync(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
  } catch {
    return refuse('ADMIT_AUTHORITY_UNSAFE');
  }
  let failure: string | undefined;
  try {
    const bytes = Buffer.from(text);
    for (let offset = 0; offset < bytes.length;)
      offset += writeSync(descriptor, bytes, offset, bytes.length - offset);
    // Stryker disable next-line CallExpression: équivalent: fsync ne change que la durabilité du reçu après une coupure de l'hôte, qu'aucun processus vivant ne peut observer
    fsyncSync(descriptor);
  } catch {
    failure = 'ADMIT_RECEIPT_WRITE_FAILED';
  } finally {
    closeSync(descriptor);
  }
  if (!failure) {
    try {
      linkSync(temporary, path);
    } catch (error) {
      failure =
        (error as NodeJS.ErrnoException).code === 'EEXIST'
          ? 'ADMIT_RECEIPT_EXISTS'
          : 'ADMIT_RECEIPT_WRITE_FAILED';
    }
  }
  try {
    unlinkSync(temporary);
  } catch {
    // Le nom temporaire reste : Step ne le lit pas. Lié, le nom final aurait deux liens, que Step refuse ; il est retiré.
    if (!failure) {
      unlinkSync(path);
      failure = 'ADMIT_RECEIPT_WRITE_FAILED';
    }
  }
  if (failure) refuse(failure);
}

/**
 * Scelle un reçu : la charge est lue par le schéma même que Step applique, et l'empreinte approuvée est prise sur ce que
 * Step relira. Le reçu n'est pas signé : seul ce module le scelle, et les profils srt refusent aux sessions le
 * répertoire d'autorité (journal, §125).
 */
function seal(value: unknown): StepAdmissionAuthority {
  const sealed = parseStepAdmissionPayload(value);
  return { version: 1, approved_sha256: sha256(JSON.stringify(sealed)), payload: sealed };
}

/**
 * Émet le reçu d'admission d'une étape dans le répertoire d'autorité, après avoir vérifié tout ce qu'il atteste.
 * Lève un `AdmissionRefusal` nommé, et n'écrit rien, au premier écart.
 */
export function issueStepAdmission(
  request: AdmissionRequest,
  host: AdmissionHost = productionAdmissionHost(),
): IssuedAdmission {
  let specimens: Specimens | undefined;
  try {
    specimens = parseSpecimens(request.specimens);
  } catch {
    // Absente ou sans la forme du reçu : aucune preuve de spécimens.
  }
  if (!specimens) return refuse('ADMIT_SPECIMENS_REQUIRED');
  const { plan } = request;
  const name = plan.manifest.step;
  // Le nom entre dans le nom du reçu : seul un nom que Step accepte, celui du dossier, y entre.
  if (!isStepName(name) || !isAbsolute(request.folder) || basename(request.folder) !== name)
    refuse('ADMIT_FOLDER_INVALID');
  const { step, inputs } = folderInputs(request.folder);
  if (!sameDigests(plan.manifest.files_sha256, digests(inputs))) refuse('ADMIT_INPUTS_MISMATCH');
  const { root, tree } = cleanWorktree(request.worktree, host);
  // Un lanceur sous le worktree serait écrit par la session même qu'il lance : son empreinte n'atteste rien.
  if (!relative(root, realpathSync(host.launcherRoot)).startsWith('..' + sep))
    refuse('ADMIT_LAUNCHER_INSIDE_WORKTREE');
  let launcher: Record<string, string> | undefined;
  try {
    launcher = launcherFiles(host.readLauncher, step);
  } catch {
    // Un fichier du lanceur manque : Step refuserait aussi.
  }
  if (!launcher) return refuse('ADMIT_LAUNCHER_UNREADABLE');
  const subject: StepAdmissionSubject = {
    name,
    worktree: root,
    approval_sha256: plan.approval_sha256,
    tree,
    inputs,
    step,
    launcher,
    define_sha256: plan.define.sha256,
    proposal_sha256: plan.plan.sha256,
    reviewed_plan_sha256: plan.plan.raw_receipt_sha256,
    define_review: plan.define.review,
    plan_review: plan.plan.review,
  };
  if (!specimensAttest(specimens, subject)) refuse('ADMIT_SPECIMENS_REQUIRED');
  let receipt: StepAdmissionAuthority | undefined;
  try {
    receipt = seal({
      step: name,
      worktree: { root, commit: tree.commit, tree: tree.tree, clean: tree.clean },
      manifest: plan.manifest,
      approval: { version: 1, decision: 'approve', approval_sha256: plan.approval_sha256 },
      inputs_sha256: digests(inputs),
      launcher_sha256: sha256(JSON.stringify(digests(launcher))),
      define: plan.define,
      plan: plan.plan,
      specimens,
    });
    // Le jugement même de Step, avant toute écriture : un reçu qu'il refuserait n'est pas émis.
    requireStepAdmission(receipt, subject);
  } catch {
    receipt = undefined;
  }
  if (!receipt) return refuse('ADMIT_EVIDENCE_MISMATCH');
  const path = join(privateAuthority(host, root), `${name}-${receipt.approved_sha256}.json`);
  writeNew(path, `${JSON.stringify(receipt)}\n`);
  return { path, approved_sha256: receipt.approved_sha256 };
}
