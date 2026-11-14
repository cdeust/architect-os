import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sandboxesParent } from '../../src/srt-runner.js';
import { Given, Then, When, stored, type SandboxWorld } from './helpers.js';
import { useSrt } from './runner.js';

// Over a throwaway temporary root: the functions are called directly and no srt runs.

function throwawayRoot(world: SandboxWorld, base: string = tmpdir(), prefix = 'aos-root-'): string {
  const root = realpathSync(mkdtempSync(join(base, prefix)));
  world.cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  world.state['tmpRoot'] = root;
  return root;
}

Given('a throwaway temporary root', function () {
  throwawayRoot(this);
});

Given('a throwaway temporary root that is a file', function () {
  const root = throwawayRoot(this);
  const file = join(root, 'file');
  writeFileSync(file, '');
  this.state['tmpRoot'] = file;
});

Given('a throwaway temporary root whose aos-sb is a symbolic link to a folder of mode 700', function () {
  const root = throwawayRoot(this);
  mkdirSync(join(root, 'elsewhere'), { mode: 0o700 });
  symlinkSync(join(root, 'elsewhere'), join(root, 'aos-sb'));
});

Given('a throwaway temporary root whose aos-sb is a folder of mode {string}', function (mode: string) {
  const root = throwawayRoot(this);
  mkdirSync(join(root, 'aos-sb'));
  // chmod, not the mode of mkdir: the umask of the process does not apply.
  chmodSync(join(root, 'aos-sb'), parseInt(mode, 8));
});

/** Runs `action` and keeps what it returned, or the error it threw. */
function attemptParent(world: SandboxWorld, action: () => string): void {
  world.state['parent'] = null;
  world.state['parentError'] = null;
  try {
    world.state['parent'] = action();
  } catch (error) {
    world.state['parentError'] = error;
  }
}

When('I ask for the sandboxes parent of the root', function () {
  attemptParent(this, () => sandboxesParent(stored<string>(this, 'tmpRoot')));
});

When('I ask for the sandboxes parent of the root twice', function () {
  attemptParent(this, () => {
    sandboxesParent(stored<string>(this, 'tmpRoot'));
    return sandboxesParent(stored<string>(this, 'tmpRoot'));
  });
});

// The owner check takes a folder of a second user: the uid it compares with is passed, the folder is ours.
When('I ask for the sandboxes parent of the root, the current user being another one', function () {
  attemptParent(this, () => sandboxesParent(stored<string>(this, 'tmpRoot'), (process.getuid?.() ?? 0) + 1));
});

Then('the parent returned is the folder {string} of the root', function (name: string) {
  assert.equal(stored<Error | null>(this, 'parentError'), null);
  assert.equal(stored<string>(this, 'parent'), join(stored<string>(this, 'tmpRoot'), name));
});

Then('the parent is refused with the exact message', function () {
  const error = stored<Error | null>(this, 'parentError');
  assert.ok(error !== null, 'the parent was accepted');
  assert.equal(
    error.message,
    `ISOLATION_UNAVAILABLE: dossier parent des sandboxes non sûr : ${join(stored<string>(this, 'tmpRoot'), 'aos-sb')} doit être un dossier (pas un lien), de l'utilisateur courant, de mode 0700`,
  );
});

Then('the creation of the parent failed with ENOTDIR', function () {
  const error = stored<NodeJS.ErrnoException | null>(this, 'parentError');
  assert.ok(error !== null, 'the parent was accepted');
  assert.equal(error.code, 'ENOTDIR');
  assert.match(error.message, /mkdir/);
});

// --- the socket budget: the start is refused before srt runs; the canary of the 79 case is stopped by a node that
// prints nothing, so no srt runs there either ---

/** `<root>/aos-sb/s-XXXXXX/tmp` is 20 characters longer than the root. */
const FOLDER_OVERHEAD = 20;

Given(
  'an srt runner over a throwaway temporary root such that the tmp folder of a sandbox is {int} characters long',
  function (length: number) {
    // `/tmp` is short on both systems (`/private/tmp` once resolved); the system temporary folder is too long on macOS.
    // Where `/tmp` cannot be written (the build sandbox), the scenario fails, it is never skipped: the host runs it.
    const base = throwawayRoot(this, '/tmp', 'aos-b-');
    const pad = length - FOLDER_OVERHEAD - base.length - 1;
    assert.ok(pad > 0, `no room to pad ${base} to ${length}`);
    const root = join(base, 'p'.repeat(pad));
    mkdirSync(root);
    this.state['tmpRoot'] = root;
    useSrt(this, () => ({ tmpRoot: root, node: '/usr/bin/false' }));
  },
);

Then('it is refused because the tmp folder is {int} characters long', function (length: number) {
  const error = stored<Error | null>(this, 'refusal');
  assert.ok(error !== null, 'the start was not refused');
  const root = stored<string>(this, 'tmpRoot').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(
    error.message,
    new RegExp(
      `^ISOLATION_UNAVAILABLE: dossier temporaire trop long pour un socket Unix : ${root}/aos-sb/s-[A-Za-z0-9]{6}/tmp, ${length} caractères, 79 au plus$`,
    ),
  );
});

Then('no folder is left in the sandboxes parent of the root', function () {
  assert.deepEqual(readdirSync(join(stored<string>(this, 'tmpRoot'), 'aos-sb')), []);
});
