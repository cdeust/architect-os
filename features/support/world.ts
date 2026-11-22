import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setDefaultTimeout, setWorldConstructor, World, type IWorldOptions } from '@cucumber/cucumber';

// setDefaultTimeout, setWorldConstructor, World, IWorldOptions:
// node_modules/@cucumber/cucumber/lib/index.d.ts and lib/support_code_library_builder/world.d.ts.
setDefaultTimeout(30_000);

/** One World per scenario. Steps register what must be released in `cleanups`; the After hook runs them. */
export class ArchitectWorld extends World {
  /** Set by the @postgres Before hook: a fresh, migrated-by-nobody database on the disposable server. */
  databaseUrl = '';
  /** Free-form scenario state, typed by the step files that use it. */
  state: Record<string, unknown> = {};
  readonly cleanups: (() => Promise<void> | void)[] = [];

  /** Start the real launcher in the private runtime root owned by this scenario. */
  admitFixture(root: string): NodeJS.ProcessEnv {
    return JSON.parse(
      execFileSync(
        fileURLToPath(new URL('../../aos', import.meta.url)),
        ['--', process.execPath, '-p', 'JSON.stringify(process.env)'],
        {
          env: { PATH: process.env.PATH, ARCHITECT_OS_RUNTIME_ROOT: root },
          encoding: 'utf8',
        },
      ),
    );
  }

  constructor(options: IWorldOptions) {
    super(options);
  }
}

setWorldConstructor(ArchitectWorld);
