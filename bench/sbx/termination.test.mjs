import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

for (const mode of ['SIGHUP', 'deadline']) {
  test('an idle owner without IPC releases its workspace on ' + mode, { timeout: 5000 }, async (t) => {
    const workspace = await mkdtemp(join(tmpdir(), 'sbx-idle-'));
    t.after(() => rm(workspace, { recursive: true, force: true }));
    const program = `
      import {withProbeSignals,runOfflineProbe,useUntilInterrupted} from ${JSON.stringify(new URL('./lifecycle.mjs', import.meta.url).href)};
      const [workspace,mode] = process.argv.slice(1);
      try {
        await withProbeSignals(signal=>runOfflineProbe({
          name:'idle',workspace,signal,stop:async()=>{},
          run:()=>useUntilInterrupted(signal,100,()=>{
            if (mode==='SIGHUP') process.kill(process.pid,'SIGHUP');
            return new Promise(()=>{});
          }),
        }));
        process.exitCode=1;
      } catch(error) {
        const expected=mode==='SIGHUP' ? 'SBX_HOST_INTERRUPTED_SIGHUP' : 'SBX_USE_TIMEOUT';
        if(error.message!==expected) process.exitCode=1;
      }
    `;
    const child = spawn(process.execPath, ['--input-type=module', '-e', program, workspace, mode], {
      stdio: 'ignore',
    });
    t.after(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    });
    assert.deepEqual(await once(child, 'close'), [0, null]);
    await assert.rejects(access(workspace), { code: 'ENOENT' });
  });
}

// Separate process groups exercise the signals a terminal sends. The test process keeps
// its normal handlers and the mock guest, like the SBX CLI, runs outside the host group.
const owner = `
  import {spawn} from 'node:child_process';
  import {once} from 'node:events';
  import {withProbeSignals, runOfflineProbe} from ${JSON.stringify(new URL('./lifecycle.mjs', import.meta.url).href)};
  import {exchangeFrames} from ${JSON.stringify(new URL('./exchange.mjs', import.meta.url).href)};
  const [workspace, mode]=process.argv.slice(1);
  const events=[];
  const signals=['SIGTERM','SIGHUP','SIGINT'];
  const counts=()=>signals.map(s=>process.listenerCount(s));
  const original=counts();
  try {
    await withProbeSignals(signal=>runOfflineProbe({
      name:'mock-vm',workspace,signal,
      async run() {
        const child=spawn(process.execPath,['-e',
          "process.stdin.once('data',()=>console.log(JSON.stringify({kind:'request',model:'fixture'})));process.stdin.resume();"
        ],{detached:true,stdio:'pipe'});
        return exchangeFrames(child,{model:'fixture',prompt:'fixture'},(_frame, pending)=>{
          events.push('requested');
          pending.addEventListener('abort',()=>events.push('cancelled'),{once:true});
          process.send('requested');
          return new Promise(()=>{});
        },5000,signal);
      },
      async stop() {
        events.push('stopping');
        const resumed=once(process,'message');
        process.once('SIGTERM',()=>process.send('second-signal'));
        process.send('stopping');
        await resumed;
        if(mode==='retain') throw Error('unconfirmed');
        events.push('stopped');
      },
      verify(){events.push('verified');}
    }));
  } catch(error) {
    process.send({failure:error.message,causes:error.errors?.map(e=>e.message),events,original,restored:counts()});
    process.exitCode=1;
  } finally {process.disconnect();}
`;

for (const [signal, mode] of [
  ['SIGINT', 'remove'],
  ['SIGTERM', 'remove'],
  ['SIGHUP', 'remove'],
  ['SIGTERM', 'retain'],
]) {
  test(
    'interrupted host handles ' + signal + ' with workspace disposition ' + mode,
    { timeout: 10_000 },
    async (t) => {
      const workspace = await mkdtemp(join(tmpdir(), 'sbx-interrupt-'));
      t.after(() => rm(workspace, { recursive: true, force: true }));
      const child = spawn(process.execPath, ['--input-type=module', '-e', owner, workspace, mode], {
        detached: true,
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      });
      t.after(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      });
      const closed = once(child, 'close');
      let outcome;
      child.on('message', (message) => {
        if (message === 'requested') process.kill(-child.pid, signal);
        else if (message === 'stopping') process.kill(-child.pid, 'SIGTERM');
        else if (message === 'second-signal') child.send('finish stop');
        else outcome = message;
      });
      assert.deepEqual(await closed, [1, null]);
      assert.deepEqual(outcome.restored, outcome.original);
      if (mode === 'retain') {
        assert.deepEqual(outcome.events, ['requested', 'cancelled', 'stopping']);
        assert.deepEqual(outcome.causes, ['SBX_HOST_INTERRUPTED_' + signal, 'unconfirmed']);
        assert.ok(outcome.failure.includes(workspace));
        await access(workspace);
      } else {
        assert.deepEqual(outcome.events, ['requested', 'cancelled', 'stopping', 'stopped']);
        assert.equal(outcome.failure, 'SBX_HOST_INTERRUPTED_' + signal);
        await assert.rejects(access(workspace), { code: 'ENOENT' });
      }
    },
  );
}
