/**
 * The timeline viewport gate's verdict, kept apart from the script that drives Chrome so it can be tested.
 */

/** Nearest-rank percentile: `ratio` 0.95 of 315 values is the 16th-worst. */
export function percentile(values, ratio) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

/** The p95 pair a tier is held to; the CI virtualized arm has its own, tighter one. */
export function responsivenessLimits(budgets, tier, rowVirtualization) {
  if (tier === "primary")
    return {
      interactionLimitMs: budgets.interactionP95Ms,
      frameIntervalLimitMs: budgets.frameIntervalP95Ms,
    };
  if (tier === "ci" && rowVirtualization === "on")
    return {
      interactionLimitMs: budgets.ciVirtualizedInteractionP95Ms,
      frameIntervalLimitMs: budgets.ciVirtualizedFrameIntervalP95Ms,
    };
  return {
    interactionLimitMs: budgets.constrainedInteractionP95Ms,
    frameIntervalLimitMs: budgets.constrainedFrameIntervalP95Ms,
  };
}

function assertSampleCount(expected, interactions, frameIntervals) {
  if (expected > 0 && interactions.length === expected && frameIntervals.length === expected)
    return;
  throw new Error(
    `Expected ${expected} scroll samples, measured ${interactions.length} interactions ` +
      `and ${frameIntervals.length} frame intervals`,
  );
}

/**
 * p95 over every measured step pooled: one run's p95 is only its 4th-worst step, so a brief runner stall failed it.
 * Throws when any run is short of samples, so a missing measurement cannot read as a fast one.
 */
export function judgeResponsiveness(
  runs,
  { samplesPerRun, interactionLimitMs, frameIntervalLimitMs },
) {
  const interactions = runs.flatMap((run) => run.interactions);
  const frameIntervals = runs.flatMap((run) => run.frameIntervals);
  assertSampleCount(runs.length * samplesPerRun, interactions, frameIntervals);
  const interactionP95Ms = percentile(interactions, 0.95);
  const frameIntervalP95Ms = percentile(frameIntervals, 0.95);
  return {
    interactionP95Ms,
    frameIntervalP95Ms,
    passed: interactionP95Ms <= interactionLimitMs && frameIntervalP95Ms <= frameIntervalLimitMs,
  };
}

const tenths = (ms) => Math.round(ms * 10) / 10;
const droppedIn = (gap, intervalMs) =>
  gap > 1.5 * intervalMs ? Math.round(gap / intervalMs) - 1 : 0;

/** A run as the page measured it, per step: each frame's work, the worst frame, the total, and frames dropped. */
export function frameWorkRun({ gaps, steps }) {
  const frameIntervalMs = percentile(gaps, 0.5);
  return {
    frameIntervalMs: tenths(frameIntervalMs),
    steps: steps.map(({ transition, settled, assignMs, frames, keepAliveScrolls }) => {
      const work = frames.map((frame) => frame.end - frame.begin);
      return {
        transition,
        settled,
        frameWorkMs: work.map(tenths),
        maxFrameWorkMs: tenths(Math.max(0, ...work)),
        workMs: tenths(work.reduce((sum, ms) => sum + ms, assignMs)),
        droppedFrames: frames
          .flatMap((frame) => frame.gaps)
          .reduce((sum, gap) => sum + droppedIn(gap, frameIntervalMs), 0),
        keepAliveScrolls,
      };
    }),
  };
}

function frameWorkOf(steps) {
  const maxFrames = steps.map((step) => step.maxFrameWorkMs);
  const dropped = steps.map((step) => step.droppedFrames);
  return {
    steps: steps.length,
    maxFrameWorkP95Ms: percentile(maxFrames, 0.95),
    maxFrameWorkMs: Math.max(0, ...maxFrames),
    droppedFrames: dropped.reduce((sum, count) => sum + count, 0),
    maxStepDroppedFrames: Math.max(0, ...dropped),
    unsettledSteps: steps.filter((step) => !step.settled).length,
  };
}

/** Report-only until a budget is set from it: each step's worst frame and drops, pooled and per transition. */
export function summarizeFrameWork(runs) {
  const steps = runs.flatMap((run) => run.steps);
  const transitions = [...new Set(steps.map((step) => step.transition))];
  return {
    ...frameWorkOf(steps),
    byTransition: Object.fromEntries(
      transitions.map((transition) => {
        const own = steps.filter((step) => step.transition === transition);
        return [
          transition,
          {
            ...frameWorkOf(own),
            workMedianMs: percentile(
              own.map((step) => step.workMs),
              0.5,
            ),
          },
        ];
      }),
    ),
    runs: runs.map((run) => frameWorkOf(run.steps)),
  };
}

/** A failed timing attempt is measured once more, so one bad stretch of a shared runner cannot fail the gate alone. */
export const TIMING_ATTEMPTS = 2;

export function attemptPassed({ responsivenessPassed, passingRuns, requiredPassingRuns }) {
  return responsivenessPassed && passingRuns >= requiredPassingRuns;
}

export function gatePassed({ directScrollApproved, attempts, memoryReturned }) {
  const timingPassed = attempts.slice(0, TIMING_ATTEMPTS).some((attempt) => attempt.passed);
  return directScrollApproved && timingPassed && memoryReturned;
}
