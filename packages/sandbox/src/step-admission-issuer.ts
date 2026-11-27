// L'émetteur de production du reçu d'admission de Step (docs/design/orchestration-fable-5-2.md, §15, décision 7 ;
// journal, §123). Il atteste ce que `requireStepAdmission` revalidera : le Plan approuvé, les octets du dossier de
// l'étape, l'arbre propre du worktree, les octets du lanceur, les deux revues indépendantes et les spécimens de chaque
// rôle. Il est distinct de ses consommateurs : seul l'adaptateur d'émission de Plan l'importe (règle
// `step-admission-issuer-only-from-the-issuing-host` de `.dependency-cruiser.cjs`) ; `npm run step` ne l'appelle
// jamais. Il n'écrit qu'un fichier, nouveau, jamais un autre.
import {
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { basename, isAbsolute, join, relative, sep } from 'node:path';
import { PKG } from './code-tool.js';
import {
  parseSpecimens,
  requireStepAdmission,
  sealStepAdmission,
  specimensAttest,
  stepAdmissionAuthority,
  type ReviewIndependence,
  type Specimens,
  type StepAdmissionSubject,
} from './step-admission.js';
import { parseStepFile, type StepFile } from './step-file.js';
import { isStepName, sha256 } from './step-record.js';
import { launcherFiles } from './step-tool.js';
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
  /** Le répertoire d'autorité, celui où `readStepAdmission` cherche le reçu. */
  readonly authority: () => string;
  readonly uid: () => number | undefined;
}

export function productionAdmissionHost(): AdmissionHost {
  return {
    readLauncher: (file) => readFileSync(join(PKG, file), 'utf8'),
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
 * Un fichier du dossier comme Step le lit : un fichier ordinaire, de l'UTF-8 valide, une marque d'ordre des octets en
 * tête gardée ; `undefined` sinon.
 */
function folderText(path: string): string | undefined {
  let text: string | undefined;
  try {
    // Ni un répertoire ni un tube : lire un tube nommé bloquerait l'émetteur.
    if (statSync(path).isFile())
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(readFileSync(path));
  } catch {
    // Absent, illisible ou pas de l'UTF-8 : pas le fichier approuvé.
  }
  return text;
}

/** Les entrées de l'étape, comme `runStep` les compose : le brief, `step.json`, la question de chaque éclaireur. */
function folderInputs(folder: string): { step: StepFile; inputs: Record<string, string> } {
  const raw = folderText(join(folder, 'step.json'));
  const brief = folderText(join(folder, 'brief.md'));
  let step: StepFile | undefined;
  try {
    step = parseStepFile(JSON.parse(raw!));
  } catch {
    // Absent, illisible ou refusé : le dossier ne tient pas le `step.json` approuvé.
  }
  if (!step || brief === undefined) return refuse('ADMIT_INPUTS_MISMATCH');
  const inputs: Record<string, string> = { 'brief.md': brief, 'step.json': raw! };
  for (const { name } of step.scouts) {
    const file = `scout.${name}.md`;
    const question = folderText(join(folder, file));
    if (question === undefined) return refuse('ADMIT_INPUTS_MISMATCH');
    inputs[file] = question;
  }
  return { step, inputs };
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

/** Crée le reçu, 0600, sans suivre de lien et sans jamais remplacer un fichier ; un échec d'écriture n'en laisse rien. */
function writeNew(path: string, text: string): void {
  let descriptor: number;
  try {
    descriptor = openSync(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
  } catch (error) {
    return refuse(
      (error as NodeJS.ErrnoException).code === 'EEXIST' ? 'ADMIT_RECEIPT_EXISTS' : 'ADMIT_AUTHORITY_UNSAFE',
    );
  }
  try {
    const bytes = Buffer.from(text);
    for (let offset = 0; offset < bytes.length;)
      offset += writeSync(descriptor, bytes, offset, bytes.length - offset);
    // Stryker disable next-line CallExpression: équivalent: fsync ne change que la durabilité du reçu après une coupure de l'hôte, qu'aucun processus vivant ne peut observer
    fsyncSync(descriptor);
  } catch {
    unlinkSync(path);
    refuse('ADMIT_RECEIPT_WRITE_FAILED');
  } finally {
    closeSync(descriptor);
  }
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
  let receipt: ReturnType<typeof sealStepAdmission> | undefined;
  try {
    receipt = sealStepAdmission({
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
