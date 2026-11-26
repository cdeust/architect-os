// L'adaptateur d'émission du reçu d'admission : le seul fichier de production qui importe l'émetteur de
// `@architect-os/sandbox` (règle `step-admission-issuer-only-from-the-issuing-host`).
import { realpathSync } from 'node:fs';
import { basename, isAbsolute, normalize } from 'node:path';
import {
  issueStepAdmission,
  type AdmissionRequest,
  type IssuedAdmission,
} from '@architect-os/sandbox/step-admission-issuer';
import { insideCheckout } from './publish.js';

export type Issue = (request: AdmissionRequest) => IssuedAdmission;

/**
 * Le dossier de l'étape est hors de tout checkout, comme Plan le matérialise : une session qui écrit un worktree ne
 * peut pas le changer entre l'émission et Step. Lève `ADMIT_FOLDER_INVALID` sinon.
 */
export function admissionFolder(folder: string, step: string): string {
  try {
    if (isAbsolute(folder) && normalize(folder) === folder && basename(folder) === step) {
      // Le chemin réel, liens suivis : un lien vers un worktree ne sort pas le dossier du checkout.
      if (!insideCheckout(realpathSync(folder))) return folder;
    }
  } catch {
    // Absent ou illisible : ce n'est pas un dossier matérialisé.
  }
  throw new Error('ADMIT_FOLDER_INVALID');
}

/** L'émetteur de production, tel que la composition le reçoit. */
export const issueAdmission: Issue = (request) => issueStepAdmission(request);
