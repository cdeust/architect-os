import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  CiJob,
  CiRun,
  Clock,
  DeliveryEntry,
  DeliveryLog,
  Forge,
  Gate,
  Progress,
  Repository,
} from '../../src/domain/ports.js';
import type { HostEnvironment } from '../../src/infrastructure/host-process.js';
import { REPOSITORY, type DeliverWorld } from './support.js';

/** The branch every run of a contract scenario was started by the push to. */
export const TRIAL = 'sentinel/gate-1a-step';
/** The base of every pull request of a contract scenario. */
export const DESTINATION = 'main';

// What a contract scenario needs to put the world of a port in a state (a history, a remote, a verdict), which no port
// can do. Each adapter comes with a fixture; the contracts of ports.feature run on them.

/** Commits are named by the scenario; their hashes are the adapter's. */
export interface RepositoryFixture {
  repository: Repository;
  /** `removal`: the lines the commit removed from a file, relative to its parent. */
  commit(label: string, parent: string | undefined, removal?: { path: string; lines: number }): void;
  /** A commit that records the text at the path, besides what the commit of `commit` records. */
  commitFile(label: string, parent: string | undefined, path: string, text: string): void;
  checkout(label: string): void;
  setRemote(branch: string, label: string): void;
  touchWorktree(): void;
  /** Leaves in the tree a repository of its own, as a session can. */
  nestRepository(): void;
  /**
   * Leaves a repository in a directory that a tracked ignore file ignores, then changes that file without committing
   * it: its rules are no longer applied, and the marker is found.
   */
  changeIgnoreFileOverIgnoredRepository(): void;
  hashOf(label: string): string;
}

export interface ForgeFixture {
  forge: Forge;
  /** The run started by the push of the commit to `TRIAL`. */
  hasRun(hash: string, run: CiRun): void;
  /** A completed run of the push to `TRIAL`, whose attempts executed these jobs, first attempt first. */
  hasAttempts(hash: string, id: number, attempts: CiJob[][]): void;
  /** The forge sees the branch at the commit. */
  hasBranch(branch: string, hash: string): void;
  /** The forge does not see the branch, whatever it sees of others. */
  lacksBranch(branch: string): void;
  /** The forge sees the head at the commit, and a pull request opened as a draft from it to `DESTINATION`. */
  hasDraft(head: string, hash: string): void;
  /** The forge refuses every new pull request. */
  refusesPullRequests(): void;
  /** The reruns asked, as `rerun <id>`, in order. */
  reruns(): string[];
}

export interface ProgressFixture {
  progress: Progress;
  /** What the adapter was told, in order, as the adapter shows it. */
  phases(): string[];
}

export interface GateFixture {
  gate: Gate;
  /** What the gate leaves, and how it exits, when it runs. */
  /** What the gate leaves, how it exits, and the destination commit its report names (`none`: it names none). */
  willLeave(verdict: string | undefined, code: number, destination: string): void;
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

/** The names of the host variables that the committed descriptive file gives to git and to the client of the forge. */
export function committedNames(): string[] {
  const committed = JSON.parse(readFileSync(`${REPOSITORY}tools/deliver/deliver.json`, 'utf8')) as {
    environment: string[];
  };
  return committed.environment;
}

/**
 * The host of an adapter in a scenario: the committed names, taken from this process, with a HOME and an
 * XDG_CONFIG_HOME that are an empty temporary directory, so that no configuration of the machine is read.
 */
export function hostOf(world: DeliverWorld): HostEnvironment {
  const names = committedNames();
  const home = temporaryDirectory(world);
  const taken = Object.fromEntries(
    names.flatMap((name) => (process.env[name] === undefined ? [] : [[name, process.env[name]]])),
  );
  return { names, env: { ...taken, HOME: home, XDG_CONFIG_HOME: home } };
}
