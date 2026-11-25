import { matchesGlob } from 'node:path';

/** The descriptive part of tools/test-gate/gate.json the rules need: which files are what. */
export interface Layout {
  readonly production: FileSet;
  readonly features: FileSet;
}

export interface FileSet {
  readonly include: readonly string[];
  readonly exclude: readonly string[];
}

export interface Job {
  readonly name: string;
  /** Scope of the job: the static set and the executed set are both restricted to these globs. */
  readonly features: readonly string[];
  readonly mutation: boolean;
}

// path.matchesGlob: node_modules/@types/node/path.d.ts.
export function matchesAny(path: string, globs: readonly string[]): boolean {
  return globs.some((glob) => matchesGlob(path, glob));
}

export function inFileSet(path: string, set: FileSet): boolean {
  return matchesAny(path, set.include) && !matchesAny(path, set.exclude);
}

export function isProduction(layout: Layout, path: string): boolean {
  return inFileSet(path, layout.production);
}

/**
 * Whether `directory` can hold a production file: some include glob matches it segment by segment as a directory (its
 * last segment names files) or reaches a `**` first. Excludes are not read: they narrow files, and a link is refused
 * wherever an included file could be. Names compare without case or Unicode normalization: macOS volumes are
 * insensitive to both, and a link `Src` there serves the files of `src/`.
 */
export function mayHoldProduction(layout: Layout, directory: string): boolean {
  const fold = (text: string) => text.normalize('NFC').toLowerCase();
  const names = fold(directory).split('/');
  return layout.production.include.some((glob) => {
    const segments = fold(glob).split('/');
    for (const [index, name] of names.entries()) {
      const segment = segments[index] as string;
      if (segment === '**') return true;
      if (index === segments.length - 1 || !matchesGlob(name, segment)) return false;
    }
    return true;
  });
}

export function isJobFeature(layout: Layout, job: Job, path: string): boolean {
  return inFileSet(path, layout.features) && matchesAny(path, job.features);
}
