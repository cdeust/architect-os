import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Then } from '@cucumber/cucumber';

async function observe(refusal: boolean) {
  const { measure } = await import(new URL('../../baseline/planning.mjs', import.meta.url).href);
  const root = mkdtempSync(join(tmpdir(), 'planning-usage-'));
  try {
    const path = join(root, 'attempt');
    const launch = () =>
      measure([path, 'prepare'], {
        execPath: refusal ? process.execPath : join(root, 'missing-node'),
        stdout: process.stdout,
      });
    if (refusal) assert.equal(await launch(), 2);
    else await assert.rejects(launch);
    const bytes = readFileSync(path, 'utf8');
    const events = bytes
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      events.map((e) => e.event),
      ['started', refusal ? 'finished' : 'measurement_failed'],
    );
    assert.equal(events[0].attempt_id, events[1].attempt_id);
    assert.equal(events[1].producer_usage, null);
    assert.ok(events[1].duration_ms >= 0);
    if (refusal) assert.equal(events[1].exit_code, 2);
    await assert.rejects(launch, { code: 'EEXIST' });
    assert.equal(readFileSync(path, 'utf8'), bytes);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
Then('a measured Plan refusal records its exit and preserves its journal on retry', () => observe(true));
Then('a planning measurement records its launch failure without a cost', () => observe(false));
