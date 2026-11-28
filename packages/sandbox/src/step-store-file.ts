// L'adaptateur des fichiers du port `StepStore` : l'état d'une étape tel que `npm run step` l'écrit depuis O.1, sous
// `$ARCHITECT_OS_RUNTIME_ROOT/state/steps/<run>/<étape>/`, réservé avec le répertoire des flux bruts de l'étape par
// `reserveStepOutputs` (répertoires 0700, création exclusive, retour en arrière d'une réservation vide). Chaque artefact
// est un fichier 0600 créé exclusivement (`wx`) ; les événements, des lignes JSON ajoutées à `events.jsonl` (O_APPEND,
// sans suivre de lien). Les refus du système de fichiers (`EEXIST`, `ELOOP`) passent tels quels.
import { appendFileSync, closeSync, constants, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  artifactFile,
  checkArtifact,
  checkEvent,
  checkStepName,
  StepStoreError,
  type RecordedStepEvent,
  type StepArtifactKind,
  type StepEvent,
  type StepPlace,
  type StepRecorder,
  type StepStore,
} from './step-store.js';
import { reserveStepOutputs, type StepOutputs } from './step-outputs.js';

/** Le fichier des événements, dans le répertoire de l'étape : aucun nom d'artefact ne finit en `.jsonl`. */
export const EVENTS_FILE = 'events.jsonl';

/** La lecture d'un fichier absent est `undefined` ; toute autre erreur passe. */
function readIfPresent(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export class FileStepStore implements StepStore {
  private readonly outputs = new Map<string, StepOutputs>();

  /** `reserve` crée, une fois, les deux répertoires de l'étape, ou lève. */
  constructor(private readonly reserveOutputs: (step: string, place: StepPlace) => StepOutputs) {}

  reserve(step: string, place: StepPlace): StepRecorder {
    checkStepName(step);
    const outputs = this.reserveOutputs(step, place);
    this.outputs.set(step, outputs);
    return new FileStepRecorder(outputs.retained);
  }

  /** Le répertoire des flux bruts d'une étape réservée par ce store : ils ne sont pas de l'état, le port ne les écrit pas. */
  streams(step: string): string {
    const outputs = this.outputs.get(step);
    if (outputs === undefined) throw new StepStoreError('STEP_NOT_RESERVED', `étape non réservée : ${step}`);
    return outputs.streams;
  }
}

class FileStepRecorder implements StepRecorder {
  private seq = 0;

  constructor(private readonly directory: string) {}

  record(kind: StepArtifactKind, name: string | undefined, text: string): void {
    checkArtifact(kind, name, text);
    writeFileSync(join(this.directory, artifactFile(kind, name)), text, { flag: 'wx', mode: 0o600 });
  }

  appendEvent(event: StepEvent): void {
    checkEvent(event);
    const line = `${JSON.stringify({ seq: this.seq, type: event.type, phase: event.phase })}\n`;
    const descriptor = openSync(
      join(this.directory, EVENTS_FILE),
      constants.O_APPEND | constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      appendFileSync(descriptor, line);
    } finally {
      closeSync(descriptor);
    }
    this.seq += 1;
  }

  read(kind: StepArtifactKind, name: string | undefined): string | undefined {
    return readIfPresent(join(this.directory, artifactFile(kind, name)));
  }

  events(): RecordedStepEvent[] {
    const text = readIfPresent(join(this.directory, EVENTS_FILE)) ?? '';
    return text
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as RecordedStepEvent);
  }
}

/** L'adaptateur des fichiers sous la racine et le run admis de `env` : celui que compose `npm run step`. */
export const fileStepStore = (env: NodeJS.ProcessEnv): FileStepStore =>
  new FileStepStore((step, place) => reserveStepOutputs(env, step, place.intake, place.worktree));
