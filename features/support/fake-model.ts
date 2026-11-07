import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/** One turn of the scripted model: a call of a tool, a text that ends the turn, or an HTTP error of the API. */
export type ModelTurn =
  | { readonly tool: string; readonly input: unknown }
  | { readonly text: string }
  | { readonly status: number };

/** A request the fake model received: its path and its JSON body. */
export interface ModelRequest {
  readonly path: string;
  readonly apiKey: string | undefined;
  readonly body: { tools?: { name: string }[]; system?: unknown; messages?: unknown[]; model?: string };
}

/** A local fake of the Anthropic Messages API, scripted turn by turn; no real call, no real key. */
export interface FakeModel {
  readonly url: string;
  readonly port: number;
  readonly requests: ModelRequest[];
  close(): Promise<void>;
}

type Event = [string, unknown];

const usage = { input_tokens: 10, output_tokens: 5 };

/** The server-sent events of one turn (https://docs.anthropic.com/en/api/messages-streaming), as bench T-41 sent them. */
function events(turn: Exclude<ModelTurn, { status: number }>, id: number): Event[] {
  const start: Event = [
    'message_start',
    {
      type: 'message_start',
      message: {
        id: `msg_${id}`,
        type: 'message',
        role: 'assistant',
        model: 'fake',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: usage.input_tokens, output_tokens: 1 },
      },
    },
  ];
  const block =
    'tool' in turn
      ? [
          { type: 'tool_use', id: `toolu_${id}`, name: turn.tool, input: {} },
          { type: 'input_json_delta', partial_json: JSON.stringify(turn.input) },
        ]
      : [
          { type: 'text', text: '' },
          { type: 'text_delta', text: turn.text },
        ];
  return [
    start,
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: block[0] }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: block[1] }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    [
      'message_delta',
      {
        type: 'message_delta',
        delta: { stop_reason: 'tool' in turn ? 'tool_use' : 'end_turn', stop_sequence: null },
        usage: { output_tokens: usage.output_tokens },
      },
    ],
    ['message_stop', { type: 'message_stop' }],
  ];
}

/**
 * Starts the fake model on 127.0.0.1: each POST /v1/messages answers the next turn of the script, then a text "end"
 * once the script is spent, unless it cycles; count_tokens answers 1; anything else 404.
 */
export async function startFakeModel(
  script: readonly ModelTurn[],
  options: { readonly cycle?: boolean } = {},
): Promise<FakeModel> {
  const requests: ModelRequest[] = [];
  let next = 0;
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const path = (req.url ?? '').split('?')[0] ?? '';
      const raw = Buffer.concat(chunks).toString('utf8');
      const key = req.headers['x-api-key'];
      requests.push({
        path,
        apiKey: Array.isArray(key) ? key[0] : key,
        body: raw === '' ? {} : (JSON.parse(raw) as ModelRequest['body']),
      });
      if (req.method === 'POST' && path === '/v1/messages/count_tokens') {
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"input_tokens":1}');
        return;
      }
      if (req.method !== 'POST' || path !== '/v1/messages') {
        res.writeHead(404).end();
        return;
      }
      // A cycling script plays again from its first turn: one script per call, for several calls of one platform.
      const turn = (options.cycle === true ? script[next % script.length] : script[next]) ?? { text: 'end' };
      next += 1;
      if ('status' in turn) {
        const error = { type: 'error', error: { type: 'invalid_request_error', message: 'scripted error' } };
        res.writeHead(turn.status, { 'content-type': 'application/json' }).end(JSON.stringify(error));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const [name, data] of events(turn, next))
        res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
