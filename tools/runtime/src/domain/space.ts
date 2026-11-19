// The free space of a filesystem and the comparison with the floors of a reserve. Integer arithmetic only: the counts
// are `bigint`, never added across filesystems, and a floor is passed only by strictly more bytes.
import type { Reserve } from '#runtime/domain/policy.js';

/**
 * One sample of a filesystem, as the port reads it: the blocks available to an unprivileged caller, and their unit, with
 * the identity of the directory the port found at the path while it measured (the admission compares it with the root
 * it inspected, and refuses a sample of another directory).
 */
export interface SpaceSample {
  /** The device of the directory sampled. */
  readonly device: bigint;
  /** Its inode. */
  readonly inode: bigint;
  readonly availableBlocks: bigint;
  readonly blockSize: bigint;
}

/** What the admission records of one filesystem at its start. */
export interface Observation {
  readonly device: bigint;
  readonly availableBytes: bigint;
}

/** The bytes of a sample; none when its unit is not positive or its count negative: such a sample proves nothing. */
export function observe(sample: SpaceSample): Observation | undefined {
  if (sample.blockSize <= 0n || sample.availableBlocks < 0n) return undefined;
  return { device: sample.device, availableBytes: sample.availableBlocks * sample.blockSize };
}

export type SpaceDecision = 'enough' | 'root-low' | 'home-low';

/**
 * The root first, then the home, each against its own floor, strictly above. Both apply when the two are on one
 * device: the bytes are not added, and one sample must pass both floors.
 */
export function compare(reserve: Reserve, root: Observation, home: Observation): SpaceDecision {
  if (!(root.availableBytes > reserve.rootFloorBytes)) return 'root-low';
  if (!(home.availableBytes > reserve.homeFloorBytes)) return 'home-low';
  return 'enough';
}
