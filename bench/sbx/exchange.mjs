// Match the 1 MiB per-stream bound of the bench's execFile calls, including newlines.
const pipeLimit = 1024 * 1024;
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function parseFrame(bytes) {
  const raw = utf8.decode(bytes);
  let fields = 0;
  const frame = JSON.parse(raw, (_key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) fields += Object.keys(value).length;
    return value;
  });
  // JSON.parse keeps only the last duplicate member. In valid JSON only member names
  // have a colon after the string token. Every such token must survive decoding.
  for (const token of raw.matchAll(/"(?:[^"\\]|\\.)*"\s*(:)?/gu)) {
    if (token[1]) fields--;
  }
  if (fields !== 0) throw Error();
  return frame;
}

/** A single guest request and a final receipt on a pre-scoped SBX child. */
export function exchangeFrames(child, initialObject, onRequest, limitMs) {
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

    function fail(reason) {
      if (failure) return;
      failure = new Error('SBX_EXCHANGE_' + reason);
      controller.abort();
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
          if (
            reply?.kind !== 'response' ||
            Object.keys(reply).length !== 2 ||
            typeof reply.body !== 'string' ||
            reply.body.length > pipeLimit
          ) {
            throw Error();
          }
          writeFrame({ kind: 'response', body: reply.body }, true);
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
          processFrame(parseFrame(buffer.subarray(frameStart, newline)));
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
      if (!failure && (code !== 0 || phase !== 'done' || frameStart !== stdoutBytes)) fail('INCOMPLETE');
      if (failure) reject(failure);
      else resolve(receipt);
    });
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
