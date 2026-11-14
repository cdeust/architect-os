// Sonde du lancement --bare de l'outil de code (journal, §21) : `npm --prefix bench run bench:bare`.
// Lance le Claude Code de l'hôte avec la commande de packages/sandbox/code.json et le settings.json du profil builder,
// contre un faux amont local, sans srt et sans aucune clé réelle. Vérifie quatre faits et sort en 1 si l'un manque :
// le jeton de session part en x-api-key et aucun Authorization ; le prompt du lanceur (code.json) est dans le prompt système ;
// la règle `Bash(git push *)` refuse l'appel ; la liste des outils déclarés au modèle (relevée, pas imposée).
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SANDBOX = join(ROOT, 'packages', 'sandbox');
const TOKEN = 'bare-probe-session-token';

const sse = (res, events) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const event of events) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  res.end();
};
const start = {
  type: 'message_start',
  message: { id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], usage: { input_tokens: 1, output_tokens: 1 } },
};
const block = (content, delta, stop) => [
  start,
  { type: 'content_block_start', index: 0, content_block: content },
  { type: 'content_block_delta', index: 0, delta },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 1 } },
  { type: 'message_stop' },
];

const tool = JSON.parse(readFileSync(join(SANDBOX, 'code.json'), 'utf8'));
const promptFile = join(SANDBOX, tool.launcherPromptFile);
// The marker: the first line of the launcher prompt, read from the file itself.
const MARKER = readFileSync(promptFile, 'utf8').split('\n')[0];

const seen = [];
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    if (!String(req.url).startsWith('/v1/messages') || String(req.url).includes('count_tokens')) {
      res.writeHead(404);
      return res.end('{}');
    }
    const parsed = JSON.parse(body);
    const last = parsed.messages.at(-1)?.content;
    const result = Array.isArray(last) ? last.find((part) => part?.type === 'tool_result') : undefined;
    seen.push({
      apiKey: req.headers['x-api-key'] === TOKEN,
      authorization: req.headers['authorization'] !== undefined,
      marker: JSON.stringify(parsed.system ?? '').includes(MARKER),
      tools: (parsed.tools ?? []).map((tool) => tool.name),
      result: result === undefined ? null : JSON.stringify(result.content),
    });
    if (result !== undefined) return sse(res, block({ type: 'text', text: '' }, { type: 'text_delta', text: 'done' }, 'end_turn'));
    sse(
      res,
      block(
        { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: {} },
        { type: 'input_json_delta', partial_json: '{"command":"git push origin probe","description":"probe"}' },
        'tool_use',
      ),
    );
  });
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const port = server.address().port;

const dir = mkdtempSync(join(tmpdir(), 'aos-bare-probe-'));
const work = join(dir, 'work');
const config = join(dir, 'config');
mkdirSync(work);
mkdirSync(config);
const profile = JSON.parse(readFileSync(join(SANDBOX, 'profiles', 'builder.json'), 'utf8'));
const vars = { home: homedir(), repo: work, config };
const resolveVars = (text) => text.replace(/\$\{([A-Za-z]+)\}/g, (_, key) => vars[key] ?? `\${${key}}`);
writeFileSync(join(config, 'settings.json'), resolveVars(JSON.stringify(profile.files['${config}/settings.json'])));
const [command, ...args] = tool.command.map(resolveVars);
// Asynchronous: the fake upstream answers from this same process, a synchronous spawn would block it.
const child = spawn(
  command,
  [...args, '--append-system-prompt-file', promptFile, '-p', 'probe'],
  {
    cwd: work,
    stdio: 'ignore',
    timeout: 120_000,
    env: {
      HOME: homedir(),
      PATH: process.env['PATH'],
      TERM: 'dumb',
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
      ANTHROPIC_API_KEY: TOKEN,
      CLAUDE_CONFIG_DIR: config,
      CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1',
    },
  },
);
const run = { status: await new Promise((ok) => child.on('close', ok)) };
server.close();
rmSync(dir, { recursive: true, force: true });

const version = spawnSync(command, ['--version'], { encoding: 'utf8' }).stdout.trim();
const facts = {
  claude: version,
  exit: run.status,
  requests: seen.length,
  sessionTokenInApiKey: seen.length > 0 && seen.every((s) => s.apiKey && !s.authorization),
  systemPromptFromLauncher: seen.length > 0 && seen.every((s) => s.marker),
  gitPushDenied: seen.some((s) => s.result?.includes('git push origin probe has been denied') === true),
  tools: seen[0]?.tools ?? [],
};
process.stdout.write(`${JSON.stringify(facts, null, 2)}\n`);
process.exitCode = facts.exit === 0 && facts.sessionTokenInApiKey && facts.systemPromptFromLauncher && facts.gitPushDenied ? 0 : 1;
