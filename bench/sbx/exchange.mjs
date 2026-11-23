import { frameByteLimit as pipeLimit, parseUniqueJson } from './json-frame.mjs';

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function hostReplyFrame(reply) {
  if (!reply || Object.getPrototypeOf(reply) !== Object.prototype) throw Error();
  const fields = Object.getOwnPropertyDescriptors(reply);
  const keys = Reflect.ownKeys(fields);
  if (keys.some((key) => !fields[key].enumerable || !Object.hasOwn(fields[key], 'value'))) throw Error();
  const kind = fields.kind?.value;
  if (kind === 'withheld' && keys.length === 1) return { kind: 'withheld' };
  const body = fields.body?.value;
  if (kind !== 'response' || typeof body !== 'string' || body.length > pipeLimit) throw Error();
  if (keys.length === 2) return { kind, body };
  if (keys.length === 3 && fields.reasoning_included?.value === true)
    return { kind, body, reasoning_included: true };
  throw Error();
}

/** A single guest request and a final receipt on a pre-scoped SBX child. */
export function exchangeFrames(child, initialObject, onRequest, limitMs, signal) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const buffer = Buffer.allocUnsafe(pipeLimit);
    let frameStart = 0;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdinBytes = 0;
    let phase = 'request';
    let receipt;
    let failure;
    let expectedModel;
    const deadline = setTimeout(() => fail('TIMEOUT'), limitMs);
    const interrupt = () => fail('INTERRUPTED', signal.reason);

    function fail(reason, error = new Error('SBX_EXCHANGE_' + reason)) {
      if (failure) return;
      failure = error;
      controller.abort(error);
      child.kill('SIGKILL');
      // A descendant can retain a pipe after the CLI exits. Do not wait for its EOF.
      for (const stream of child.stdio) stream.destroy();
    }

    function writeFrame(frame, end) {
      const line = JSON.stringify(frame) + '\n';
      stdinBytes += Buffer.byteLength(line);
      if (stdinBytes > pipeLimit) throw Error();
      if (end) child.stdin.end(line);
      else child.stdin.write(line);
    }

    function processFrame(frame) {
      if (phase === 'receipt' && frame?.kind === 'receipt') {
        receipt = frame;
        phase = 'done';
        return;
      }
      if (
        phase !== 'request' ||
        frame?.kind !== 'request' ||
        Object.keys(frame).length !== 2 ||
        frame.model !== expectedModel
      ) {
        fail('PROTOCOL');
        return;
      }
      phase = 'reply';
      // Check the rest of this chunk before dispatching a host request.
      Promise.resolve()
        .then(async () => {
          if (failure) return;
          const reply = await onRequest(frame, controller.signal);
          if (failure) return;
          writeFrame(hostReplyFrame(reply), true);
          phase = 'receipt';
        })
        .catch(() => fail('REPLY'));
    }

    child.stdout.on('data', (chunk) => {
      if (failure) return;
      const previous = stdoutBytes;
      stdoutBytes += chunk.length;
      if (stdoutBytes > pipeLimit) return fail('OUTPUT_LIMIT');
      chunk.copy(buffer, previous);
      let offset = previous;
      while (offset < stdoutBytes && !failure) {
        if (phase === 'reply' || phase === 'done') return fail('PROTOCOL');
        const end = chunk.indexOf(10, offset - previous);
        if (end < 0) break;
        const newline = previous + end;
        try {
          processFrame(parseUniqueJson(utf8.decode(buffer.subarray(frameStart, newline))));
        } catch {
          return fail('PROTOCOL');
        }
        offset = frameStart = newline + 1;
      }
    });
    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > pipeLimit) fail('OUTPUT_LIMIT');
    });
    child.stdout.once('end', () => {
      if (phase !== 'done' || frameStart !== stdoutBytes) fail('INCOMPLETE');
    });
    for (const stream of child.stdio) stream.on('error', () => fail('IO'));
    child.once('error', () => fail('PROCESS'));
    child.once('exit', (code) => {
      if (code !== 0 || phase === 'request' || phase === 'reply') fail('EXIT');
    });
    child.once('close', (code) => {
      clearTimeout(deadline);
      signal?.removeEventListener('abort', interrupt);
      if (!failure && (code !== 0 || phase !== 'done' || frameStart !== stdoutBytes)) fail('INCOMPLETE');
      if (failure) reject(failure);
      else resolve(receipt);
    });
    if (signal?.aborted) return interrupt();
    signal?.addEventListener('abort', interrupt, { once: true });
    try {
      if (
        typeof initialObject?.model !== 'string' ||
        !initialObject.model ||
        typeof initialObject.prompt !== 'string' ||
        !initialObject.prompt ||
        Object.keys(initialObject).length !== 2 ||
        typeof onRequest !== 'function'
      ) {
        throw Error();
      }
      expectedModel = initialObject.model;
      writeFrame({ model: expectedModel, prompt: initialObject.prompt }, false);
    } catch {
      fail('INITIAL');
    }
  });
}
