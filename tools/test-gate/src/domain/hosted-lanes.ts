// How many hosted lanes a perimeter is worth (docs/design/platform-v3-srt.md §7, « Lots hébergés »). Every lane starts
// with a dry run of the whole suite before its first mutant: measured on 96 lanes of six runs of gate.yml (45739094567,
// 45744632805, 45743125948, 45767197864, 45770810106, 45771449037), 265.5 s in median. Sixteen lanes for an empty
// perimeter spent about 105 of the 125 job-minutes of a run on those dry runs.

/** The numbers of tools/test-gate/hosted-lanes.json the planner reads; all in milliseconds but the count. */
export interface LanePolicy {
  /** What a mutant that runs at module load is estimated to cost: the measured mean, not the whole suite it may run. */
  readonly loadTimeMutantMs: number;
  /** The estimated mutation a lane must take off the others to be worth the dry run it adds. */
  readonly laneTargetMs: number;
  readonly maxLanes: number;
}

/**
 * The rule that opens a lane: with `n` lanes each holds about `cost / n`, so one more lane is worth its dry run only
 * while `cost / (n + 1)` is at least `laneTargetMs`. Hence the whole part of `cost / laneTargetMs`, never fewer than
 * the one lane that runs the canary, never more than `maxLanes`.
 */
export function lanesWorth(cost: number, policy: LanePolicy): number {
  return Math.max(1, Math.min(policy.maxLanes, Math.floor(cost / policy.laneTargetMs)));
}
