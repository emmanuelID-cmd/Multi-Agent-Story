import { describe, expect, it } from "vitest";
import { manuscriptConsistencyLabel } from "../src/app/manuscript-status";

describe("manuscript consistency badge", () => {
  it("keeps the READ shell wording when no swim-rule critique was stored", () => {
    expect(manuscriptConsistencyLabel("manuscript_a", null)).toBe(
      "Consistency: unavailable (READ lane disconnected)"
    );
    expect(
      manuscriptConsistencyLabel("manuscript_a", {
        consistency: { versionA: { status: "unavailable" }, versionB: { status: "unavailable" } },
      })
    ).toBe("Consistency: unavailable (READ lane disconnected)");
  });

  it("shows the stored swim-rule status for each editor without calling it a READ pass", () => {
    const critique = {
      consistency: {
        label: "swim-rule heuristic",
        versionA: { status: "partial" },
        versionB: { status: "complete" },
      },
    };
    expect(manuscriptConsistencyLabel("manuscript_a", critique)).toBe(
      "Swim-rule check: partial (READ consistency is not connected)"
    );
    expect(manuscriptConsistencyLabel("manuscript_b", critique)).toBe(
      "Swim-rule check: complete (READ consistency is not connected)"
    );
  });
});
