import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DeliveryEntry, RuleSuite } from '../../src/domain/ports.js';
import { FileLog } from '../../src/infrastructure/file-log.js';
import { ProcessGate } from '../../src/infrastructure/process-gate.js';
import { TimerClock } from '../../src/infrastructure/timer-clock.js';
import { temporaryDirectory, type ClockFixture, type GateFixture, type LogFixture } from './fixtures.js';
import { REPOSITORY, type DeliverWorld } from './support.js';

const FAKE_GATE = `${REPOSITORY}tools/deliver/fixtures/fake-gate.mjs`;
const VERDICT = 'reports/gate-base.json';
const GATE_LOG = 'reports/deliver-gate.log';

/** The gate of the `process` row: the script of `fixtures/` in a directory of its own, as the delivery worktree. */
export interface ProcessGateFixture extends GateFixture {
  /** The delivery worktree. */
  worktree: string;
  /** The gate leaves this text as its verdict file (`undefined`: none), writes on both outputs when `noisy`. */
  leaves(text: string | undefined, code: number, mode: 'quiet' | 'noisy' | 'signal'): void;
  /** The gate command is this argv instead of the script. */
  commandIs(argv: string[]): void;
  logPath: string;
  log(): string;
}

export function processGate(world: DeliverWorld): ProcessGateFixture {
  const worktree = temporaryDirectory(world);
  let command: string[] = [];
  const fixture: ProcessGateFixture = {
    worktree,
    logPath: join(worktree, GATE_LOG),
    get gate() {
      return new ProcessGate(worktree, command, GATE_LOG, VERDICT);
    },
    willLeave(verdict, code) {
      fixture.leaves(
        verdict === undefined ? undefined : JSON.stringify({ sha: verdict, scenarios: [{ name: 'a' }] }),
        code,
        'quiet',
      );
    },
    leaves(text, code, mode) {
      command = [process.execPath, FAKE_GATE, mode, VERDICT, text ?? 'none', String(code)];
    },
    commandIs(argv) {
      command = argv;
    },
    log: () => readFileSync(join(worktree, GATE_LOG), 'utf8'),
  };
  return fixture;
}

/** The clock of the `timer` row: a timer that fires at once and records the milliseconds it was asked. */
export interface TimerClockFixture extends ClockFixture {
  asked: number[];
}

export function timerClock(): TimerClockFixture {
  const asked: number[] = [];
  const clock = new TimerClock((handler, milliseconds) => {
    asked.push(milliseconds);
    handler();
  });
  return { clock, asked };
}

/** The log of the `file` row, under a home of its own. */
export interface FileLogFixture extends LogFixture {
  directory: string;
  path: string;
  text(): string;
  /** An entry, back from one line of the file. */
  parse(line: string): DeliveryEntry;
  /** Writes `text` as the content of the file before anything is appended. */
  prepare(text: string): void;
}

export function fileLog(world: DeliverWorld): FileLogFixture {
  const home = temporaryDirectory(world);
  const path = join(home, '.local/state/architect-os/deliveries.jsonl');
  const text = (): string => readFileSync(path, 'utf8');
  const parse = (line: string): DeliveryEntry => {
    const read = JSON.parse(line) as Omit<DeliveryEntry, 'ruleSuites'> & {
      ruleSuites: Record<string, RuleSuite>;
    };
    return { ...read, ruleSuites: new Map(Object.entries(read.ruleSuites)) };
  };
  return {
    log: new FileLog('${home}/.local/state/architect-os/deliveries.jsonl', home),
    directory: dirname(path),
    path,
    text,
    prepare(content) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    },
    parse,
    entries: () => text().split('\n').slice(0, -1).map(parse),
  };
}

/** The permission bits of a file or a directory, as an octal string. */
export const modeOf = (path: string): string => (statSync(path).mode & 0o777).toString(8);
