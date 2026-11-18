import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Clock, DeliveryEntry, DeliveryLog, Gate, Repository } from '../../src/domain/ports.js';
import type { DeliverWorld } from './support.js';

// What a contract scenario needs to put the world of a port in a state (a history, a remote, a verdict), which no port
// can do. Each adapter comes with a fixture; the contracts of ports.feature run on them.

/** Commits are named by the scenario; their hashes are the adapter's. */
export interface RepositoryFixture {
  repository: Repository;
  /** `removal`: the lines the commit removed from a file, relative to its parent. */
  commit(label: string, parent: string | undefined, removal?: { path: string; lines: number }): void;
  checkout(label: string): void;
  setRemote(branch: string, label: string): void;
  touchWorktree(): void;
  hashOf(label: string): string;
}

export interface GateFixture {
  gate: Gate;
  /** What the gate leaves, and how it exits, when it runs. */
  willLeave(verdict: string | undefined, code: number): void;
}

export interface ClockFixture {
  clock: Clock;
}

export interface LogFixture {
  log: DeliveryLog;
  /** What the log holds, in order. */
  entries(): DeliveryEntry[];
}

/** A directory that the scenario removes when it ends. */
export function temporaryDirectory(world: DeliverWorld): string {
  const directory = mkdtempSync(join(tmpdir(), 'deliver-'));
  world.cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
