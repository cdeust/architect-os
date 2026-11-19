// The admission of a run (docs/design/orchestration-fable-5-2.md §14, « Un seul lieu d'écriture »), in a fixed order so
// that a refusal is reproducible: the setting, the policy, the root, its marker, the environment the marker names, the
// two filesystems, the shared directories as they are found, and only then a write. Every refusal comes before the
// first write but one, a setup that fails once it has begun: it dispatches nothing, and the run this admission
// allocated is removed when it is still the one it made (the port's `discardRun`); no other run, no shared directory.
import { readMarker, type MarkerReading } from '#runtime/domain/marker.js';
import { reserveOf, type AdmissionPolicy } from '#runtime/domain/policy.js';
import type { RuntimeFilesystem } from '#runtime/domain/ports.js';
import { receiptText, type CommandKind } from '#runtime/domain/receipt.js';
import type { RefusalCode } from '#runtime/domain/refusal.js';
import {
  inRun,
  RECEIPT_FILE,
  RUN_DIRECTORIES,
  RUN_EMPTY_FILES,
  SHARED_DIRECTORIES,
  spellingOf,
  type Below,
} from '#runtime/domain/root.js';
import { compare, observe } from '#runtime/domain/space.js';

export interface AdmitDependencies {
  readonly filesystem: RuntimeFilesystem;
  /** The policy of the launcher checkout, or none when its file is unreadable or invalid. */
  readonly policy: AdmissionPolicy | undefined;
  readonly clock: () => Date;
}

export type Admission =
  | { readonly admitted: true; readonly run: string; readonly receipt: string }
  | { readonly admitted: false; readonly code: RefusalCode };

const refuse = (code: RefusalCode): Admission => ({ admitted: false, code });

const MARKER_REFUSAL: Record<Exclude<MarkerReading['kind'], 'environment'>, RefusalCode> = {
  invalid: 'RUNTIME_MARKER_INVALID',
  'no-environment': 'RUNTIME_ENVIRONMENT_UNKNOWN',
};

export function admit(deps: AdmitDependencies, setting: string | undefined, command: CommandKind): Admission {
  const spelling = spellingOf(setting);
  if (spelling === 'required') return refuse('RUNTIME_ROOT_REQUIRED');
  if (spelling === 'unsafe') return refuse('RUNTIME_ROOT_UNSAFE');
  const root = setting as string;
  const policy = deps.policy;
  if (policy === undefined) return refuse('RUNTIME_POLICY_INVALID');
  const { filesystem } = deps;

  const state = filesystem.inspectRoot(root);
  if (state.kind === 'absent') return refuse('RUNTIME_ROOT_UNAVAILABLE');
  if (state.kind === 'unsafe') return refuse('RUNTIME_ROOT_UNSAFE');

  const marker = filesystem.readMarker(root);
  if (marker.kind === 'absent') return refuse('RUNTIME_MARKER_MISSING');
  if (marker.kind === 'unreadable' || marker.device !== state.device) return refuse('RUNTIME_MARKER_INVALID');
  const reading = readMarker(marker.bytes);
  if (reading.kind !== 'environment') return refuse(MARKER_REFUSAL[reading.kind]);
  const selected = reserveOf(policy, reading.name);
  if (selected === undefined) return refuse('RUNTIME_ENVIRONMENT_UNKNOWN');

  const home = filesystem.homeDirectory();
  if (home === undefined) return refuse('RUNTIME_SPACE_UNAVAILABLE');
  const rootSample = filesystem.sample(root);
  const homeSample = filesystem.sample(home);
  // A sample of another directory than the root inspected above measures nothing of it.
  if (rootSample?.device !== state.device || rootSample.inode !== state.inode)
    return refuse('RUNTIME_SPACE_UNAVAILABLE');
  const rootObservation = observe(rootSample);
  const homeObservation = homeSample === undefined ? undefined : observe(homeSample);
  if (rootObservation === undefined || homeObservation === undefined)
    return refuse('RUNTIME_SPACE_UNAVAILABLE');
  const decision = compare(selected.reserve, rootObservation, homeObservation);
  if (decision === 'root-low') return refuse('RUNTIME_ROOT_SPACE_LOW');
  if (decision === 'home-low') return refuse('RUNTIME_HOME_SPACE_LOW');

  // Every shared directory already there is judged before the first one is made.
  for (const below of SHARED_DIRECTORIES) {
    const found = filesystem.findDirectory(root, state.device, below);
    if (found === 'unsafe') return refuse('RUNTIME_ROOT_UNSAFE');
    if (found === 'failed') return refuse('RUNTIME_SETUP_FAILED');
  }
  for (const below of SHARED_DIRECTORIES) {
    const outcome = filesystem.ensureDirectory(root, state.device, below);
    if (outcome === 'unsafe') return refuse('RUNTIME_ROOT_UNSAFE');
    if (outcome === 'failed') return refuse('RUNTIME_SETUP_FAILED');
  }
  const allocation = filesystem.allocateRun(root);
  if (allocation === undefined) return refuse('RUNTIME_SETUP_FAILED');
  // What this admission made in its run, in order: all that a failure removes, and only while the run is still its own.
  const made: Below[] = [];
  const make = (below: Below, create: (path: Below) => boolean): boolean => {
    if (!create(inRun(allocation.name, below))) return false;
    made.push(below);
    return true;
  };
  try {
    const prepared =
      RUN_DIRECTORIES.every((below) => make(below, (path) => filesystem.createDirectory(root, path))) &&
      RUN_EMPTY_FILES.every((below) => make(below, (path) => filesystem.createFile(root, path, '')));
    if (prepared) {
      const receipt = receiptText({
        run: allocation.name,
        admittedAt: deps.clock(),
        command,
        environment: selected.name,
        reserve: selected.reserve,
        root: { ...rootObservation, inode: state.inode },
        home: homeObservation,
      });
      if (make(RECEIPT_FILE, (path) => filesystem.createFile(root, path, receipt)))
        return { admitted: true, run: allocation.name, receipt };
    }
  } catch (error) {
    // Something nobody foresaw once the run is allocated: the run goes, and the error still reaches the entry.
    filesystem.discardRun(root, state, allocation, made);
    throw error;
  }
  filesystem.discardRun(root, state, allocation, made);
  return refuse('RUNTIME_SETUP_FAILED');
}
