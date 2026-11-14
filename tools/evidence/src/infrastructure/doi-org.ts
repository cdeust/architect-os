import { z } from 'zod';
import type { Lookup, Registry } from '../domain/ports.js';

// The shape of the CSL JSON of doi.org, recorded in fixtures/doi-org/ (docs/design/evidence-desk.md §5).
const TITLE = z.string().regex(/[\p{L}\p{N}]/u);
const ISSUED = z.object({ 'date-parts': z.tuple([z.tuple([z.int()], z.unknown())], z.unknown()) });
const RETRACTION = z.looseObject({ type: z.literal('retraction') });
const TIMEOUT_MS = 20_000;
const MAX_BODY_BYTES = 1024 * 1024;

/** Every character outside the unreserved set and `/`, as the percent-encoded bytes of its UTF-8 form. */
function encodeDoi(doi: string): string {
  return doi.replace(/[^A-Za-z0-9._~/-]/gu, (character) =>
    [...Buffer.from(character)]
      .map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, '0')}`)
      .join(''),
  );
}

/** The whole body, or undefined as soon as it passes MAX_BODY_BYTES (the stream is then cancelled). */
async function readLimited(body: ReadableStream<Uint8Array> | null): Promise<Buffer | undefined> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of body ?? []) {
    size += chunk.byteLength;
    if (size > MAX_BODY_BYTES) return undefined;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export class DoiOrgRegistry implements Registry {
  /** `timeout` is `AbortSignal.timeout`, injected so that the limit can be seen. */
  constructor(
    private readonly fetchUrl: typeof fetch,
    private readonly timeout: (ms: number) => AbortSignal,
  ) {}

  async lookup(doi: string): Promise<Lookup> {
    let response: Response;
    try {
      response = await this.fetchUrl(`https://doi.org/${encodeDoi(doi)}`, {
        method: 'GET',
        headers: {
          Accept: 'application/vnd.citationstyles.csl+json',
          'User-Agent': 'architect-os-evidence/0.1',
        },
        signal: this.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      return { kind: 'unavailable', detail: `fetch failed: ${String(error)}` };
    }
    if (response.status === 404) return { kind: 'unknown' };
    if (response.status !== 200) return { kind: 'unavailable', detail: `status ${response.status}` };
    const bytes = await readLimited(response.body);
    if (bytes === undefined) return { kind: 'unavailable', detail: 'body is larger than 1 MiB' };
    let body: unknown;
    try {
      body = JSON.parse(bytes.toString('utf8'));
    } catch {
      return { kind: 'unavailable', detail: 'body is not JSON' };
    }
    const record = z.looseObject({}).safeParse(body);
    const fields: Record<string, unknown> = record.success ? record.data : {};
    const title = TITLE.safeParse(fields['title']);
    if (!title.success)
      return { kind: 'unavailable', detail: 'title is missing or holds no letter or digit' };
    const issued = ISSUED.safeParse(fields['issued']);
    const updatedBy = fields['updated-by'];
    return {
      kind: 'found',
      title: title.data,
      year: issued.success ? issued.data['date-parts'][0][0] : null,
      retracted: Array.isArray(updatedBy) && updatedBy.some((entry) => RETRACTION.safeParse(entry).success),
    };
  }
}
