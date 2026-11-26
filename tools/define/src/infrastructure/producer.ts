import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import {
  pinnedTreeDigest,
  readPinnedTree,
  stagePinnedTree,
  type PinnedTreeRule,
} from '@architect-os/sandbox/pinned-tree';

export const PRODUCER_ENTRY = 'mcp-server/index.js';
export const PRODUCER_SKILL_CONFIG = 'packages/skill/skill-config.json';
/** Bounds on what one launch reads into memory: the installed producer is about 900 files and 20 MB. */
export const PRODUCER_MAX_FILES = 20_000;
export const PRODUCER_MAX_BYTES = 256 * 1024 * 1024;

export interface ProducerLimits {
  readonly files: number;
  readonly bytes: number;
}

const LIMITS: ProducerLimits = { files: PRODUCER_MAX_FILES, bytes: PRODUCER_MAX_BYTES };

/**
 * What the host pins of the producer: every file the server can load or read relative to its own root. The bundle
 * and the dependencies installed beside it (`mcp-server/`, the native module included), and the skill files the
 * server reads from its plugin root (`packages/skill/`). npm writes links into `mcp-server/node_modules/.bin` for
 * commands; Node never resolves a module through them, so that one directory is neither pinned nor copied.
 */
const rule = (limits: ProducerLimits): PinnedTreeRule => ({
  include: ['mcp-server', 'packages/skill'],
  skip: ['mcp-server/node_modules/.bin'],
  required: [PRODUCER_ENTRY, PRODUCER_SKILL_CONFIG],
  maxFiles: limits.files,
  maxBytes: limits.bytes,
});

/** The refusals of the pinned tree, named for the producer: `PINNED_TREE_LINK` is `SPEC_PRODUCER_LINK`. */
function read(root: string, limits: ProducerLimits) {
  try {
    return readPinnedTree(root, rule(limits));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('PINNED_TREE_'))
      throw Error(error.message.replace('PINNED_TREE_', 'SPEC_PRODUCER_'));
    throw error;
  }
}

/** The digest of the producer installed under `root`, for the operator to pin once it is provisioned. */
export function producerDigest(root: string, limits: ProducerLimits = LIMITS): string {
  return pinnedTreeDigest(read(root, limits));
}

export interface StagedProducer {
  /** The private copy of the host that holds the pinned bytes and nothing else. */
  readonly root: string;
  readonly entry: string;
  readonly skillConfig: string;
  dispose(): void;
}

/**
 * Copy the pinned producer to a private directory of the host, from the bytes that were hashed. What the host
 * launches is that copy: a change to the plugin root after the check reaches nothing that runs.
 */
export function stageProducer(
  root: string,
  expected: string,
  parent: string = tmpdir(),
  limits: ProducerLimits = LIMITS,
): StagedProducer {
  const files = read(root, limits);
  if (pinnedTreeDigest(files) !== expected) throw Error('SPEC_PRODUCER_MISMATCH');
  const staged = stagePinnedTree(files, parent, 'aos-producer-');
  return {
    root: staged.root,
    entry: join(staged.root, PRODUCER_ENTRY),
    skillConfig: join(staged.root, PRODUCER_SKILL_CONFIG),
    dispose: staged.dispose,
  };
}

/**
 * The Node arguments that run the copy under the permission model (node --help: --permission, --allow-fs-read,
 * --allow-fs-write). The server reads only its copy and the given directories and writes only the writable ones. It
 * gets no child process, worker, network, inspector, and no native addon: an addon runs outside the model, and a
 * writable directory would let the server write one and load it. The producer then runs without its sqlite caches.
 * No writable directory may hold the copy, nor lie inside it: `SPEC_PRODUCER_COPY_WRITABLE`.
 */
export function producerArguments(staged: StagedProducer, writable: readonly string[]) {
  const overlaps = (a: string, b: string) => !relative(a, b).startsWith('..');
  if (writable.some((path) => overlaps(path, staged.root) || overlaps(staged.root, path)))
    throw Error('SPEC_PRODUCER_COPY_WRITABLE');
  return [
    '--permission',
    `--allow-fs-read=${staged.root}`,
    ...writable.flatMap((path) => [`--allow-fs-read=${path}`, `--allow-fs-write=${path}`]),
    staged.entry,
  ];
}
