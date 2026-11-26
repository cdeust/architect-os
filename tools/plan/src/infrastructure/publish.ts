import { lstatSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, normalize } from 'node:path';

export function insideCheckout(directory: string): boolean {
  // A primary checkout has a directory here and a linked worktree has a file.
  if (lstatSync(join(directory, '.git'), { throwIfNoEntry: false })) return true;
  const ancestor = dirname(directory);
  return ancestor !== directory && insideCheckout(ancestor);
}

export function publishStepInputs(
  folder: string,
  step: string,
  files: Readonly<Record<string, string>>,
): void {
  const path = normalize(folder);
  if (!isAbsolute(path) || basename(path) !== step) throw new Error('PLAN_DESTINATION_INVALID');
  const parent = realpathSync(dirname(path));
  if (insideCheckout(parent)) throw new Error('PLAN_DESTINATION_RESERVED');
  const destination = join(parent, basename(path));
  // Claim a fresh destination. A pre-existing directory or symlink is never touched.
  mkdirSync(destination, { mode: 0o700 });
  try {
    // The host policy appears last. The Step reader refuses until step.json exists.
    for (const [name, text] of Object.entries(files))
      writeFileSync(join(destination, name), text, { flag: 'wx' });
  } catch (error) {
    rmSync(destination, { recursive: true });
    throw error;
  }
}
