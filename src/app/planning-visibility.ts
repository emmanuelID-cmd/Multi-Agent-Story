export function showBibleCandidate(
  proposal: { baseVersion: number; kind: string; data: unknown },
  projectVersion: number,
  hasIntake: boolean,
  latest: { status: string; proposalVersion: number } | null | undefined,
): boolean {
  if (proposal.baseVersion !== projectVersion || !["bible_a", "bible_b", "bible_c"].includes(proposal.kind)) return false;
  const data = proposal.data as { kind?: string; proposalVersion?: number } | null;
  if (!hasIntake) return data?.kind !== "bible_candidate";
  return data?.kind === "bible_candidate" && latest?.status === "completed" && data.proposalVersion === latest.proposalVersion;
}

export function canRetryBiblePlanning(latest: { status: string; retryAvailable?: boolean; operationId?: string } | null | undefined): boolean {
  return !!latest?.operationId && !!latest.retryAvailable && ["running", "failed"].includes(latest.status);
}
