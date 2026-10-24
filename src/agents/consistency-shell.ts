/**
 * Local shell for Manny's READ Consistency agent.
 * Returns an explicit `unavailable` status indicating that the READ lane
 * consistency checker is disconnected. Never returns a pass, score, or "no issues".
 */
export interface ConsistencyShellResult {
  status: "unavailable";
  manuscriptVersion: string;
  reason: string;
}

export function consistencyShell(manuscriptVersion: string): ConsistencyShellResult {
  return {
    status: "unavailable",
    manuscriptVersion,
    reason: "READ consistency service is not connected. Independent consistency findings remain unverified for this manuscript version.",
  };
}
