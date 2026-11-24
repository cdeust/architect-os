// Only the offline CLI scenario imports this module. Step has no environment switch for a fake provider.
import os from 'node:os';
import childProcess from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { SignJWT } from 'jose';

if (['step.ts', 'sbx-sign-in.ts'].includes(process.argv[1]?.split('/').at(-1))) {
  const root = process.env.ARCHITECT_OS_RUNTIME_ROOT;
  const nativeUser = os.userInfo();
  os.userInfo = () => ({ ...nativeUser, homedir: join(root, 'fixture-home') });
  const realExec = childProcess.execFile;
  const offlineExec = function (program, ...args) {
    if (program === '/usr/bin/security') {
      args.at(-1)(null, JSON.stringify({ claudeAiOauth: { accessToken: randomBytes(32).toString('hex') } }));
      return;
    }
    return realExec.call(childProcess, program, ...args);
  };
  const nativeAsync = promisify(realExec);
  offlineExec[promisify.custom] = (program, ...args) =>
    program === '/usr/bin/security'
      ? Promise.resolve({
          stdout: JSON.stringify({ claudeAiOauth: { accessToken: randomBytes(32).toString('hex') } }),
          stderr: '',
        })
      : nativeAsync(program, ...args);
  childProcess.execFile = offlineExec;
  syncBuiltinESMExports();
  const localFetch = globalThis.fetch;
  const issuer = 'https://auth.openai.com',
    api = 'https://api.openai.com/v1',
    id = 'oaiapp_offline';
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const bearer = 'fixture-access-' + randomBytes(32).toString('hex');
  let nonce = '',
    calls = 0;
  const write = process.stderr.write.bind(process.stderr);
  process.stderr.write = (bytes, ...args) => {
    const text = String(bytes);
    if (!text.startsWith('Continue with ChatGPT: ')) return write(bytes, ...args);
    if (!process.argv[1].endsWith('/sbx-sign-in.ts')) throw Error('FIXTURE_UNEXPECTED_CONSENT');
    const page = text.trim().split(' ').at(-1);
    if (new URL(page).hostname !== '127.0.0.1') throw Error('FIXTURE_CALLBACK');
    void (async () => {
      const redirect = await localFetch(page, { redirect: 'manual' });
      const auth = new URL(redirect.headers.get('location'));
      nonce = auth.searchParams.get('nonce');
      const callback = new URL(auth.searchParams.get('redirect_uri'));
      if (callback.origin !== new URL(page).origin) throw Error('FIXTURE_CALLBACK');
      callback.search = new URLSearchParams({
        code: 'synthetic',
        state: auth.searchParams.get('state'),
        client_id: id,
      }).toString();
      await localFetch(callback, { redirect: 'error' });
    })().catch(() => {
      process.exitCode = 1;
    });
    return true;
  };
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === issuer + '/.well-known/jwks.json')
      return Response.json({
        keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'offline', alg: 'RS256' }],
      });
    if (url === issuer + '/api/accounts/oauth/token') {
      const token = await new SignJWT({ nonce })
        .setIssuedAt()
        .setSubject('test-user')
        .setIssuer(issuer)
        .setAudience(id)
        .setExpirationTime('5m')
        .setProtectedHeader({ alg: 'RS256', kid: 'offline' })
        .sign(privateKey);
      return Response.json({
        id_token: token,
        token_type: 'bearer',
        access_token: bearer,
        refresh_token: randomBytes(32).toString('hex'),
        expires_in: 300,
        scope: 'offline_access resource.invoke chatgpt.tokens.use.direct',
      });
    }
    if (!/^Bearer fixture-access-[a-f0-9]{64}$/.test(init?.headers?.authorization))
      throw Error('FIXTURE_AUTHORITY');
    const model = process.env.AOS_FIXTURE_MODEL;
    if (url === api + '/models') return Response.json({ models: [{ visibility: 'list', slug: model }] });
    if (url !== api + '/responses') throw Error('FIXTURE_ORIGIN');
    const request = JSON.parse(Buffer.from(init.body).toString());
    if (
      request.model !== model ||
      request.reasoning?.effort !== 'medium' ||
      request.store !== false ||
      request.stream !== true
    )
      throw Error('FIXTURE_MODEL');
    calls++;
    const reply = request.input.find((i) => i.type === 'function_call_output' && i.call_id === 'step-write');
    if (calls > 2 || (calls === 2 && !reply)) throw Error('FIXTURE_TOOL');
    const item =
      calls === 1
        ? {
            type: 'function_call',
            name: 'exec_command',
            call_id: 'step-write',
            id: 'fc_1',
            arguments: JSON.stringify({
              cmd: 'test -z "\$DBUS_SESSION_BUS_ADDRESS" && test ! -e /run/user/65534/bus && test ! -d "\$HOME/Library/Keychains" && printf \'native step patch\' > result.txt',
            }),
          }
        : {
            type: 'message',
            role: 'assistant',
            id: 'msg_1',
            content: [{ type: 'output_text', text: 'Done.', annotations: [] }],
          };
    const response = { id: 'resp_' + calls, object: 'response', model };
    const events = [
      { type: 'response.created', response: { ...response, status: 'in_progress' } },
      { type: 'response.fixture_extension', response_id: response.id },
      { type: 'response.output_item.done', output_index: 0, item },
      {
        type: 'response.completed',
        response: {
          ...response,
          status: 'completed',
          output: [item],
          usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 },
        },
      },
    ];
    return new Response(
      events.map((e) => 'event: ' + e.type + '\ndata: ' + JSON.stringify(e) + '\n\n').join(''),
      { headers: { 'content-type': 'text/event-stream' } },
    );
  };
}
