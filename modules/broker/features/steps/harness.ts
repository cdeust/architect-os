import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, type Readable, type Writable } from 'node:stream';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { LoggingMessageNotificationSchema, type JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { start, type StartedBroker } from '../../src/main.js';
import { loadBrokerConfig, type BrokerConfig } from '../../src/infrastructure/config.js';
import { stdioTransport } from '../../src/presentation/mcp-server.js';

/** The committed descriptive file of the broker. */
export const BROKER_JSON = new URL('../../broker.json', import.meta.url).pathname;

/** The client side of a stdio pair: what the gateway does on the broker's stdin and stdout, over streams. */
export class StreamClientTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  private readonly buffer = new ReadBuffer();

  constructor(
    private readonly input: Readable,
    private readonly output: Writable,
  ) {}

  async start(): Promise<void> {
    this.input.on('data', (chunk: Buffer) => {
      this.buffer.append(chunk);
      for (let message = this.buffer.readMessage(); message !== null; message = this.buffer.readMessage())
        this.onmessage?.(message);
    });
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (this.output.writableEnded) throw new Error('stdin of the broker already ended');
    this.output.write(serializeMessage(message));
  }

  async close(): Promise<void> {
    this.output.end();
    this.onclose?.();
  }
}

/** A pair of streams: the broker's stdin and stdout, and the gateway's ends of them. */
export const stdioPair = () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  return { stdin, stdout, client: new StreamClientTransport(stdout, stdin) };
};

/** An MCP client playing the gateway, collecting the usage notifications it gets. */
export async function gatewayClient(transport: Transport): Promise<{ client: Client; usage: unknown[] }> {
  const client = new Client({ name: 'test-gateway', version: '0.0.0' });
  const usage: unknown[] = [];
  client.setNotificationHandler(LoggingMessageNotificationSchema, (notification) => {
    if (notification.params.logger === 'usage') usage.push(notification.params.data);
  });
  await client.connect(transport);
  return { client, usage };
}

/** A key file in a fresh directory, with a mode. */
export function keyFile(key: string, mode = 0o600): { file: string; remove: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'aos-broker-key-'));
  const file = join(dir, 'anthropic-key');
  writeFileSync(file, key);
  chmodSync(file, mode);
  return { file, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

/** A request the fake upstream received. */
export interface UpstreamRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

/** What the fake upstream answers: a JSON message, an SSE stream, or an API error. */
export type UpstreamAnswer = 'json' | 'sse' | 'error';

const ANSWERS: Record<UpstreamAnswer, { status: number; type: string; body: string }> = {
  json: {
    status: 200,
    type: 'application/json',
    body: JSON.stringify({
      model: 'claude-test',
      content: [{ type: 'text', text: 'SECRET-CONTENT' }],
      usage: {
        input_tokens: 12,
        output_tokens: 7,
        cache_read_input_tokens: 3,
        cache_creation_input_tokens: 2,
      },
    }),
  },
  sse: {
    status: 200,
    type: 'text/event-stream',
    body: [
      `data: ${JSON.stringify({ type: 'message_start', message: { model: 'claude-test', usage: { input_tokens: 5 } } })}`,
      `data: ${JSON.stringify({ type: 'content_block_delta', delta: { text: 'SECRET-CONTENT' } })}`,
      `data: ${JSON.stringify({ type: 'message_delta', usage: { output_tokens: 4 } })}`,
      '',
    ].join('\n'),
  },
  error: {
    status: 400,
    type: 'application/json',
    body: JSON.stringify({
      type: 'error',
      error: { type: 'invalid_request_error', message: 'SECRET-CONTENT' },
    }),
  },
};

/** A local HTTP upstream that records every request and answers as told. */
export async function fakeUpstream(): Promise<{
  url: string;
  requests: UpstreamRequest[];
  answer: (kind: UpstreamAnswer) => void;
  close: () => Promise<void>;
}> {
  const requests: UpstreamRequest[] = [];
  let kind: UpstreamAnswer = 'json';
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
    req.on('end', () => {
      requests.push({ method: String(req.method), url: String(req.url), headers: req.headers, body });
      const answer = ANSWERS[kind];
      res.writeHead(answer.status, { 'content-type': answer.type }).end(answer.body);
    });
  });
  await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests,
    answer: (next) => (kind = next),
    close: () =>
      new Promise<void>((closed) => {
        server.closeAllConnections();
        server.close(() => closed());
      }),
  };
}

/** The committed broker.json, over another upstream and key file (the schema wants https: the fake upstream is http). */
export const testConfig = (upstream: string, file: string): BrokerConfig => ({
  ...loadBrokerConfig(BROKER_JSON),
  upstream,
  keyFile: file,
});

/** A broker started in-process on a free port, its MCP server served to a test gateway over a pair of streams. */
export async function startTestBroker(config: BrokerConfig, port = 0) {
  const pair = stdioPair();
  const started: Promise<StartedBroker> = start(config, stdioTransport(pair.stdin, pair.stdout), port);
  const gateway = await gatewayClient(pair.client);
  return { broker: await started, ...gateway };
}

/** An answer of the broker's listener: status, headers and body. */
export interface Answer {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

/** Sends one request to the broker's listener. */
export const send = (
  port: number,
  method: string,
  path: string,
  headers: Record<string, string>,
  body = '',
) =>
  new Promise<Answer>((done, failed) => {
    // A connection of its own: a pooled one would outlive a broker that closed, and read as a reset, not a refusal.
    const req = request({ host: '127.0.0.1', port, method, path, headers, agent: false }, (res) => {
      let text = '';
      res.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')));
      res.on('end', () => done({ status: res.statusCode ?? 0, headers: res.headers, body: text }));
    });
    req.on('error', failed);
    req.end(body);
  });
