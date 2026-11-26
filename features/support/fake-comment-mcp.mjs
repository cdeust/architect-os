// A stand-in for the comment servers of anthropics/claude-code-action (src/mcp/github-comment-server.ts and
// github-inline-comment-server.ts): an MCP server on stdio (newline-delimited JSON-RPC 2.0,
// https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#stdio) that serves one tool, named by
// FAKE_TOOL, taking `body` like the real ones, and appends each call it receives to the file FAKE_CALLS. It reaches
// no host: a call that arrives here is a call that GitHub would have received.
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const tool = process.env.FAKE_TOOL;
const calls = process.env.FAKE_CALLS;
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');

createInterface({ input: process.stdin }).on('line', (line) => {
  if (line.trim() === '') return;
  const request = JSON.parse(line);
  if (request.id === undefined) return; // a notification
  if (request.method === 'initialize') {
    send({
      id: request.id,
      result: {
        protocolVersion: request.params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'fake-comment', version: '0.0.0' },
      },
    });
  } else if (request.method === 'tools/list') {
    send({
      id: request.id,
      result: {
        tools: [
          {
            name: tool,
            description: 'Post a comment on the pull request (a fake: it records the call).',
            inputSchema: {
              type: 'object',
              properties: {
                body: { type: 'string' },
                path: { type: 'string' },
                line: { type: 'number' },
                confirmed: { type: 'boolean' },
              },
              required: ['body'],
            },
          },
        ],
      },
    });
  } else if (request.method === 'tools/call') {
    appendFileSync(
      calls,
      JSON.stringify({ tool: request.params?.name, input: request.params?.arguments }) + '\n',
    );
    send({ id: request.id, result: { content: [{ type: 'text', text: 'posted' }] } });
  } else {
    send({ id: request.id, error: { code: -32601, message: 'method not found' } });
  }
});
