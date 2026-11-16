// What the stack of compose.yaml answers once it is up (the workflow compose.yml): through the proxy, the one published
// port. Prints one line per question; exits 1 when the stack does not answer as its design says.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const [base, token] = process.argv.slice(2);
const failures = [];
const check = (label, ok, seen) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} | ${label} | ${seen}`);
  if (!ok) failures.push(label);
};

const health = await fetch(`${base}/healthz`);
check('the proxy answers /healthz', health.status === 200, `${health.status} ${await health.text()}`);

const other = await fetch(`${base}/anything-else`);
check('the proxy answers nothing else', other.status === 404, String(other.status));

// The catalogue of this realisation is public: listing asks for no token, a call does (gateway/features/mcp-server.feature).
const anonymous = new Client({ name: 'compose-smoke', version: '0.0.0' });
await anonymous.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
const unauthorised = await anonymous.callTool({ name: 'recall', arguments: { query: 'smoke' } });
const refusal = JSON.stringify(unauthorised.structuredContent ?? unauthorised.content);
check(
  'a call without a token is refused as UNAUTHORIZED',
  refusal.includes('UNAUTHORIZED'),
  refusal.slice(0, 200),
);
await anonymous.close();

const client = new Client({ name: 'compose-smoke', version: '0.0.0' });
await client.connect(
  new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  }),
);
const { tools } = await client.listTools();
const names = tools.map((tool) => tool.name).sort();
check(
  'a client with a token lists the tools of the catalogue',
  names.join(',') === 'recall,remember',
  names.join(','),
);

// This stack runs no agent: the image of memory holds no Docker client to launch a worker with, and no broker is part
// of the stack. What a call that needs a worker gives is asserted as it is, a failure of the contract by its name, so
// that the day the stack can run one, this line says so.
const result = await client.callTool({ name: 'recall', arguments: { query: 'smoke' } });
const structured = result.structuredContent ?? {};
check(
  'a call with a token crosses the proxy, the gateway and memory, and fails by name where a worker would start',
  structured.status === 'failed' && structured.error?.code === 'WORKER_UNAVAILABLE',
  JSON.stringify(structured).slice(0, 400),
);
await client.close();
process.exit(failures.length === 0 ? 0 : 1);
