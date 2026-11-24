import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export type CodexModel = 'gpt-6.2-astra' | 'gpt-6.2-sol';
export interface ProxyBudget {
  requests: number;
  tokens: number;
  bytes: number;
  seconds: number;
}
export interface PipeRequest {
  method: string;
  path: string;
  token: string;
  headers: Record<string, string>;
  body: Buffer;
}
export interface PipeResponse {
  start(status: number, headers: Record<string, string>): Promise<void>;
  write(chunk: Uint8Array): Promise<void>;
}
export interface ResponseReceipt {
  model: CodexModel;
  request: number;
  terminal: 'completed' | 'incomplete' | 'failed' | 'interrupted';
  inputTokens: number;
  outputTokens: number;
}
type AccountAccess = (signal: AbortSignal) => Promise<string>;
const digest = (value: string) => createHash('sha256').update(value).digest();
const destination = 'https://api.openai.com/v1/responses';
// Codex rust-v0.170.0 codex-api/src/sse/responses.rs and safety_buffering.rs.
const responseHeaders = [
  'content-type',
  'openai-model',
  'x-openai-model',
  'x-codex-turn-state',
  'x-models-etag',
  'x-reasoning-included',
  'x-codex-safety-buffering-enabled',
  'x-codex-safety-buffering-faster-model',
  'x-codex-rate-limit-reached-type',
  'retry-after',
] as const;
const requestHeaders = ['x-codex-turn-state'] as const;
function select(headers: Headers, names: readonly string[]) {
  const selected: Record<string, string> = {};
  for (const name of names) {
    const value = headers.get(name);
    if (value !== null) selected[name] = value;
  }
  return selected;
}

// JSON.parse by itself discards duplicate keys, so a validator and the upstream could see different models.
function parseBody(raw: string): unknown {
  let fields = 0;
  const value = JSON.parse(raw, (_key, item) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) fields += Object.keys(item).length;
    return item;
  });
  for (const token of raw.matchAll(/"(?:[^"\\]|\\.)*"\s*(:)?/gu)) if (token[1]) fields--;
  if (fields !== 0) throw Error();
  return value;
}

const localTool = z.object({ type: z.enum(['function', 'custom']) });
const toolsSchema = z.array(
  z.union([localTool, z.object({ type: z.literal('namespace'), tools: z.array(localTool) })]),
);
function admittedBody(bytes: Buffer, model: CodexModel) {
  try {
    const body = z
      .object({
        model: z.literal(model),
        store: z.literal(false),
        stream: z.literal(true),
        tools: toolsSchema.optional(),
        input: z.array(z.unknown()),
      })
      .parse(parseBody(new TextDecoder('utf8', { fatal: true }).decode(bytes)));
    for (const item of body.input) {
      if (item && typeof item === 'object' && 'type' in item && item.type === 'additional_tools')
        z.object({ tools: toolsSchema }).parse(item);
    }
  } catch {
    throw Error('RESPONSES_BODY');
  }
}

const usageSchema = z
  .object({
    input_tokens: z.int().nonnegative(),
    output_tokens: z.int().nonnegative(),
    total_tokens: z.int().nonnegative(),
  })
  .refine((u) => u.input_tokens + u.output_tokens === u.total_tokens);
const statuses = ['completed', 'incomplete', 'failed'] as const;
const terminalSchema = z.object({
  type: z.string(),
  response: z.object({ model: z.string(), status: z.enum(statuses), usage: usageSchema.nullish() }),
});

// SSE dispatch is delimited by an empty line. Keep one event for observation while passing the original chunks on.
class TerminalObserver {
  private decoder = new TextDecoder('utf-8', { fatal: true });
  private line = '';
  private data: string[] = [];
  private lastCR = false;
  terminal?: Omit<ResponseReceipt, 'request' | 'model'>;

  constructor(private readonly model: CodexModel) {}
  feed(chunk?: Uint8Array) {
    const decoded = this.decoder.decode(chunk, { stream: chunk !== undefined });
    for (const segment of decoded.split(/(\r|\n)/u)) {
      if (!segment) continue;
      if (segment === '\r' || segment === '\n') {
        if (segment !== '\n' || !this.lastCR) this.readLine();
        this.lastCR = segment === '\r';
      } else {
        this.lastCR = false;
        this.line += segment;
      }
    }
  }
  private readLine() {
    const line = this.line;
    this.line = '';
    if (line.startsWith('data:')) this.data.push(line.slice(5).replace(/^ /u, ''));
    else if (!line && this.data.length) {
      const data = this.data.join('\n');
      this.data = [];
      if (data === '[DONE]') return;
      const event = JSON.parse(data);
      if (event.type === 'error') throw Error('RESPONSES_STREAM');
      if (!statuses.some((status) => event.type === 'response.' + status)) return;
      const { type, response } = terminalSchema.parse(event);
      if (
        this.terminal ||
        type !== 'response.' + response.status ||
        response.model !== this.model ||
        (!response.usage && response.status === 'completed')
      )
        throw Error('RESPONSES_STREAM');
      this.terminal = {
        terminal: response.status,
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
      };
    }
  }
  finish() {
    this.feed();
    if (this.line || this.data.length || !this.terminal) throw Error('RESPONSES_STREAM');
    return this.terminal;
  }
}

/** One Step owns this capability and its AbortController. It never opens a listening socket. */
export class ResponsesProxy {
  readonly token = randomBytes(32).toString('base64url');
  private readonly tokenHash = digest(this.token);
  private readonly stop = new AbortController();
  private readonly signal: AbortSignal;
  private requests = 0;
  private bytes = 0;
  private tokens = 0;
  private busy = false;
  constructor(
    private readonly model: CodexModel,
    private readonly budget: ProxyBudget,
    private readonly access: AccountAccess,
    private readonly record: (event: ResponseReceipt) => void,
    private readonly upstream: typeof fetch = fetch,
  ) {
    for (const value of [budget.seconds, budget.bytes, budget.tokens, budget.requests])
      if (!Number.isSafeInteger(value) || value <= 0) throw Error('RESPONSES_BUDGET');
    this.signal = AbortSignal.any([this.stop.signal, AbortSignal.timeout(budget.seconds * 1000)]);
  }
  revoke() {
    this.stop.abort();
  }
  async relay(request: PipeRequest, downstream: PipeResponse): Promise<ResponseReceipt> {
    if (this.signal.aborted || !timingSafeEqual(this.tokenHash, digest(request.token)))
      throw Error('RESPONSES_TOKEN');
    if (request.method !== 'POST' || request.path !== '/v1/responses') throw Error('RESPONSES_ROUTE');
    if (
      this.busy ||
      this.requests >= this.budget.requests ||
      this.tokens >= this.budget.tokens ||
      this.bytes + request.body.length > this.budget.bytes
    )
      throw Error('RESPONSES_BUDGET');
    admittedBody(request.body, this.model);
    const headers = select(new Headers(request.headers), requestHeaders);
    this.busy = true;
    this.bytes += request.body.length;
    const receipt: ResponseReceipt = {
      model: this.model,
      request: ++this.requests,
      terminal: 'interrupted',
      inputTokens: 0,
      outputTokens: 0,
    };
    try {
      const access = await this.access(this.signal);
      this.signal.throwIfAborted();
      const response = await this.upstream(destination, {
        method: 'POST',
        redirect: 'error',
        cache: 'no-store',
        signal: this.signal,
        headers: {
          ...headers,
          authorization: 'Bearer ' + access,
          'content-type': 'application/json',
          accept: 'text/event-stream',
          'accept-encoding': 'identity',
        },
        body: new Uint8Array(request.body),
      });
      this.signal.throwIfAborted();
      if (
        response.status !== 200 ||
        response.headers.get('content-type')?.split(';')[0]?.trim() !== 'text/event-stream' ||
        !response.body
      ) {
        await response.body?.cancel();
        throw Error();
      }
      await downstream.start(response.status, select(response.headers, responseHeaders));
      const observer = new TerminalObserver(this.model);
      for await (const chunk of response.body) {
        this.signal.throwIfAborted();
        this.bytes += chunk.length;
        if (this.bytes > this.budget.bytes) throw Error();
        observer.feed(chunk);
        await downstream.write(chunk);
      }
      this.signal.throwIfAborted();
      Object.assign(receipt, observer.finish());
      this.tokens += receipt.inputTokens + receipt.outputTokens;
      if (this.tokens > this.budget.tokens) {
        this.revoke();
        throw Error('RESPONSES_BUDGET');
      }
      if (receipt.terminal !== 'completed') this.revoke();
      return receipt;
    } catch (error) {
      this.revoke();
      throw Error(this.tokens > this.budget.tokens ? 'RESPONSES_BUDGET' : 'RESPONSES_STREAM');
    } finally {
      this.busy = false;
      this.record({ ...receipt });
    }
  }
}
