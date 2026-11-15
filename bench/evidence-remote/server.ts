// Essai, hors production (bench/) : le guichet des preuves servi en MCP sur HTTP, pour un connecteur « Remote » de
// Claude Science derrière un tunnel HTTPS. Le serveur tourne sur l'hôte, hors du bac à sable de Science : il lit le
// registre et le guichet, et vérifie chaque réponse au dépôt (tools/evidence) avant de répondre à l'outil.
// Usage : node --import tsx bench/evidence-remote/server.ts <registre> <guichet> <port> <fichier du jeton>
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { constants, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { EvidenceAnswerSchema } from '@architect-os/contracts';
import { verify } from '../../tools/evidence/src/application/verify.js';
import { DoiOrgRegistry } from '../../tools/evidence/src/infrastructure/doi-org.js';
import { openFsStore, type FsStore } from '../../tools/evidence/src/infrastructure/fs-store.js';

const [ledger, desk, portText, tokenFile] = process.argv.slice(2) as [string, string, string, string];
if (!existsSync(tokenFile)) writeFileSync(tokenFile, randomBytes(32).toString('hex'), { mode: 0o600 });
const token = readFileSync(tokenFile, 'utf8').trim();
const skill = readFileSync(fileURLToPath(new URL('../../tools/evidence/skill/SKILL.md', import.meta.url)), 'utf8');
const log = (line: string): void => void process.stderr.write(`${new Date().toISOString()} ${line}\n`);

function store(): FsStore {
  const opened = openFsStore(ledger, desk, process.getuid!(), constants);
  if (!opened.ok) throw new Error(`${opened.refusal.code} ${opened.refusal.folder}: ${opened.refusal.detail}`);
  return opened.store;
}

/** La première question posée, non vérifiée, sans réponse ou dont la réponse est refusée. */
function pending(): { id: string; question: string; rejected: unknown } | undefined {
  const current = store();
  const verified = new Set(current.verifiedIds());
  const answered = new Set(current.answerIds());
  for (const id of current.askedIds()) {
    if (verified.has(id)) continue;
    const rejection = current.rejection(id);
    if (answered.has(id) && rejection === undefined) continue; // déposée, pas encore jugée
    return { id, question: current.question(id)!.question, rejected: rejection?.reasons ?? null };
  }
  return undefined;
}

const INSTRUCTIONS = `You are the librarian of an architect-os evidence desk, reached through this connector.

How the connector changes the skill below:
- Get work with the tool next_question. It waits for a question when none is pending; when it says nothing is pending, call it again.
- Send your answer with the tool submit_answer, not by writing in/<id>.answer.json. The verifier runs at once and the tool returns its verdict: verified, or the reasons of refusal, which you repair before submitting again.
- You still save the full text of each cited paper as a plain-text file in the folder ${join(desk, 'in')} (ask for read and write access to that folder), and "text" in the answer is that file's bare name.
- After a verdict, call next_question again, until the user stops you.

The skill:

${skill}`;

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 1) }] });

function mcp(): McpServer {
  const server = new McpServer({ name: 'architect-os-evidence-desk', version: '0.0.1' }, { instructions: INSTRUCTIONS });
  server.registerTool(
    'desk_instructions',
    { description: 'How to work this evidence desk. Call it first, once.', inputSchema: {} },
    () => ({ content: [{ type: 'text' as const, text: INSTRUCTIONS }] }),
  );
  server.registerTool(
    'next_question',
    {
      description:
        'The next question waiting for evidence from the published literature, with the reasons of refusal of your last answer to it if there was one. When nothing is pending it waits up to wait_seconds for a question to arrive.',
      inputSchema: { wait_seconds: z.number().int().min(0).max(900).default(50) },
    },
    async ({ wait_seconds }) => {
      const started = Date.now();
      for (;;) {
        const found = pending();
        if (found !== undefined) {
          log(`next_question -> ${found.id}`);
          return text({ pending: true, ...found });
        }
        if (Date.now() - started >= wait_seconds * 1000) break;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      const waited = Math.round((Date.now() - started) / 1000);
      log(`next_question -> nothing after ${waited} s`);
      return text({ pending: false, waited_seconds: waited, then: 'call next_question again' });
    },
  );
  server.registerTool(
    'submit_answer',
    {
      description:
        'Submits your answer to a question (the shape of answer.schema.json). The verifier runs at once: the result is verified, or rejected with the reasons to repair, or deferred when the DOI registry cannot be reached.',
      inputSchema: { answer: EvidenceAnswerSchema },
    },
    async ({ answer }) => {
      const file = join(desk, 'in', `${answer.id}.answer.json`);
      writeFileSync(`${file}.tmp`, `${JSON.stringify(answer, null, 2)}\n`, { mode: 0o600 });
      renameSync(`${file}.tmp`, file);
      const report = await verify({
        store: store(),
        registry: new DoiOrgRegistry(fetch, (ms) => AbortSignal.timeout(ms)),
        clock: () => new Date(),
        sha256: (content) => createHash('sha256').update(content).digest('hex'),
      });
      const current = store();
      const outcome = report.verified.includes(answer.id)
        ? { verdict: 'verified', record: current.verified(answer.id) }
        : report.deferred.includes(answer.id)
          ? { verdict: 'deferred', detail: 'the DOI registry could not be reached; submit again later' }
          : { verdict: 'rejected', reasons: current.rejection(answer.id)?.reasons ?? [] };
      log(`submit_answer ${answer.id} -> ${outcome.verdict}`);
      return text(outcome);
    },
  );
  return server;
}

const same = (given: string): boolean => {
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
};

async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 2 * 1024 * 1024) throw new Error('too large');
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw === '' ? undefined : JSON.parse(raw);
}

createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/healthz') return void res.writeHead(200).end('ok');
    const bearer = /^Bearer (.+)$/i.exec(req.headers.authorization ?? '')?.[1];
    const inPath = /^\/mcp\/([0-9a-f]+)$/.exec(url.pathname)?.[1];
    const authorised =
      (url.pathname === '/mcp' && bearer !== undefined && same(bearer)) || (inPath !== undefined && same(inPath));
    if (!authorised) {
      log(`refused ${req.method} ${url.pathname.replace(/\/mcp\/.*/, '/mcp/<…>')}`);
      return void res.writeHead(401).end();
    }
    if (req.method !== 'POST') return void res.writeHead(405, { allow: 'POST' }).end();
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    const server = mcp();
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, await body(req));
  })().catch((error: unknown) => {
    log(`error ${String(error)}`);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
}).listen(Number(portText), '127.0.0.1', () => log(`evidence desk on 127.0.0.1:${portText}`));
