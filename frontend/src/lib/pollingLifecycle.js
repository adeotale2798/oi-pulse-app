/** Poll immediately on initial mount and when a closed-market poller resumes. */
export function shouldRunPollImmediately({ hasRun, wasQuiescent, isQuiescent }) {
  return !hasRun || (wasQuiescent === true && isQuiescent === false);
}
