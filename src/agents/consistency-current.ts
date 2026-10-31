/**
 * Says whether a consistency result is current enough to finish or accept.
 * Current means the checker returned "ready" or "ready_for_review".
 * A swim-rule result of "complete" is only a local guess, so it stays off this list.
 * The synthetic finish, the revision round, the connected read path, and the Accept
 * button all call this so they agree before a manuscript can move forward.
 * Add a status here only when READ itself starts using that word for a finished check.
 */
export function isCurrentConsistencyStatus(status: unknown): boolean {
  return status === "ready" || status === "ready_for_review";
}
