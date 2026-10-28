/**
 * Words for the badge on a pending manuscript.
 * A revision stores a swim-rule result on the critique. Round 0 only has the disconnected READ shell.
 * The badge names that difference so a swim finding is not hidden, and a swim pass is not called a READ pass.
 */
export function manuscriptConsistencyLabel(kind: string, critique: unknown): string {
  const record = critique as {
    consistency?: {
      label?: string;
      versionA?: { status?: string };
      versionB?: { status?: string };
    };
  } | null;
  const version = kind === "manuscript_b" ? record?.consistency?.versionB : record?.consistency?.versionA;
  const status = version?.status;
  if (record?.consistency?.label === "swim-rule heuristic" && status) {
    return `Swim-rule check: ${status} (READ consistency is not connected)`;
  }
  return "Consistency: unavailable (READ lane disconnected)";
}
