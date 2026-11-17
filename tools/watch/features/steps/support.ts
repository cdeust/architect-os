import { Given as CucumberGiven, Then as CucumberThen, When as CucumberWhen } from '@cucumber/cucumber';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Structural view of the root World (features/support/world.ts); a component cannot import across projects. */
export interface WatchWorld {
  state: Record<string, unknown>;
  cleanups: (() => Promise<void> | void)[];
}

// Instantiation expressions: IDefineStep is generic in the World type
// (node_modules/@cucumber/cucumber/lib/support_code_library_builder/types.d.ts).
export const Given = CucumberGiven<WatchWorld>;
export const When = CucumberWhen<WatchWorld>;
export const Then = CucumberThen<WatchWorld>;

/** The root of this repository. */
export const REPOSITORY = fileURLToPath(new URL('../../../../', import.meta.url));

export function throwawayRoot(world: WatchWorld): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'watch-')));
  world.cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

/** A step argument that may hold JSON escapes such as \u001b or \n, which a feature file cannot carry as itself. */
export const unescape = (text: string): string => JSON.parse(`"${text.replaceAll('\n', '\\n')}"`) as string;

/** What a scenario makes a source answer. */
export interface Answer {
  status?: number;
  body?: string;
  location?: string;
  /** The answer never comes; the request ends when its signal aborts. */
  hang?: boolean;
  /** The request fails with an error that carries a text. */
  fails?: string;
  /** The body is this many bytes. */
  bytes?: number;
  /** The body is made of bytes that are not UTF-8. */
  invalid?: boolean;
  /** The response has no body at all (`response.body` is null). */
  noBody?: boolean;
}

export interface Request {
  url: string;
  init: RequestInit;
}

/** A `fetch` that answers from a table, and records its requests. Nothing here touches the network. */
export function fakeFetch(answers: ReadonlyMap<string, Answer>, requests: Request[]): typeof fetch {
  return ((input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    requests.push({ url, init });
    const answer = answers.get(url) ?? { status: 404 };
    if (answer.fails !== undefined) return Promise.reject(new TypeError(answer.fails));
    if (answer.hang === true) {
      return new Promise<Response>((_, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    }
    const headers: Record<string, string> =
      answer.location === undefined ? {} : { location: answer.location };
    const body =
      answer.noBody === true
        ? null
        : answer.invalid === true
          ? new Uint8Array([0xff, 0xfe, 0x41])
          : answer.bytes === undefined
            ? (answer.body ?? '')
            : 'x'.repeat(answer.bytes);
    return Promise.resolve(new Response(body, { status: answer.status ?? 200, headers }));
  }) as typeof fetch;
}
