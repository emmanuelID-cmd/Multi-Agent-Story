import { describe, expect, it } from "vitest";
import { showBibleCandidate, canRetryBiblePlanning } from "../src/app/planning-visibility";

const candidate = { baseVersion: 1, kind: "bible_a", data: { kind: "bible_candidate", proposalVersion: 1 } };
describe("planning candidate visibility", () => {
  it.each(["running", "failed", "invalid"])("hides older candidates while a newer operation is %s", status => {
    expect(showBibleCandidate(candidate, 1, true, { status, proposalVersion: 2 })).toBe(false);
  });
  it("offers retry only for an eligible current failed or uncertain operation", () => {
    expect(canRetryBiblePlanning({ status: "failed", operationId: "id", retryAvailable: true })).toBe(true);
    expect(canRetryBiblePlanning({ status: "running", operationId: "id", retryAvailable: true })).toBe(true);
    expect(canRetryBiblePlanning({ status: "failed", operationId: "id", retryAvailable: false })).toBe(false);
    expect(canRetryBiblePlanning({ status: "completed", operationId: "id", retryAvailable: true })).toBe(false);
    expect(canRetryBiblePlanning(null)).toBe(false);
  });
  it("shows only candidates from the latest completed operation", () => {
    expect(showBibleCandidate(candidate, 1, true, { status: "completed", proposalVersion: 2 })).toBe(false);
    expect(showBibleCandidate(candidate, 1, true, { status: "completed", proposalVersion: 1 })).toBe(true);
    expect(showBibleCandidate(candidate, 2, true, { status: "completed", proposalVersion: 1 })).toBe(false);
    expect(showBibleCandidate(candidate, 1, true, null)).toBe(false);
  });
  it("preserves legacy fixture candidates without presenting them for intake projects", () => {
    const legacy = { ...candidate, data: {} };
    expect(showBibleCandidate(legacy, 1, false, null)).toBe(true);
    expect(showBibleCandidate(legacy, 1, true, null)).toBe(false);
  });
});
