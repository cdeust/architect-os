// What the setting ARCHITECT_OS_RUNTIME_ROOT must be before any disk is inspected, and the closed layout the admission
// makes under it (docs/design/orchestration-fable-5-2.md §14: `cache` for what is reused, `run/<id>` for what a run
// throws away). The shell entry `aos` derives the same locations from the root and the run identifier.

export type RootSpelling = 'required' | 'unsafe' | 'canonical';

/** One component of a path: not empty, not `.` nor `..`, without a separator or a NUL. */
export const isComponent = (text: string): boolean =>
  text !== '' && text !== '.' && text !== '..' && !text.includes('/') && !text.includes('\0');

/**
 * An absent or empty setting is required; a relative path, `/`, a NUL, an empty, `.` or `..` component, or a final
 * slash is unsafe: a canonical absolute path has none of them. Whether it is also free of links is for the filesystem.
 */
export function spellingOf(setting: string | undefined): RootSpelling {
  if (setting === undefined || setting === '') return 'required';
  if (!setting.startsWith('/')) return 'unsafe';
  return setting.slice(1).split('/').every(isComponent) ? 'canonical' : 'unsafe';
}

/** A path below the root, as its components. */
export type Below = readonly string[];

/** The directories shared by the runs of a root, made in this order, one component at a time, when absent. */
export const SHARED_DIRECTORIES: readonly Below[] = [
  ['run'],
  ['cache'],
  ['cache', 'npm'],
  ['cache', 'xdg'],
  ['cache', 'node'],
];

/** The directories of a run, below `run/<id>`, made in this order once the run is allocated. */
export const RUN_DIRECTORIES: readonly Below[] = [
  ['tmp'],
  ['npm-logs'],
  ['config'],
  ['config', 'npm'],
  ['data'],
  ['state'],
];

/** The files of a run, below `run/<id>`, made empty: the npm configuration of a run reads nothing of the host. */
export const RUN_EMPTY_FILES: readonly Below[] = [
  ['config', 'npm', 'user.npmrc'],
  ['config', 'npm', 'global.npmrc'],
];

/** The receipt of the admission, below `run/<id>`. */
export const RECEIPT_FILE: Below = ['admission.json'];

/** `run/<id>/<below>`. */
export const inRun = (run: string, below: Below): Below => ['run', run, ...below];
