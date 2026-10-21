import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { approvalSpike, Command } from "../src/agents/graph";

describe("approval interruption", () => {
  it("pauses for a specific version and resumes only on exact approval", async () => {
    const graph = approvalSpike();
    const config = { configurable: { thread_id: randomUUID() } };
    await graph.invoke({ version: 3, approved: false }, config);
    const paused = await graph.getState(config);
    expect(paused.next).toContain("approval");
    expect(paused.values.approved).toBe(false);
    await graph.invoke(new Command({ resume: { approved: true, version: 2 } }), config);
    expect((await graph.getState(config)).values.approved).toBe(false);
    expect((await graph.getState(config)).tasks[0].interrupts).toHaveLength(1);
    const approved = await graph.invoke(new Command({ resume: { approved: true, version: 3 } }), config);
    expect(approved.approved).toBe(true);
    expect((await graph.getState(config)).next).toEqual([]);
  });

  it("does not treat a matching version without approval as consent", async () => {
    const graph = approvalSpike();
    const config = { configurable: { thread_id: randomUUID() } };
    await graph.invoke({ version: 1, approved: false }, config);
    await graph.invoke(new Command({ resume: { approved: false, version: 1 } }), config);
    expect((await graph.getState(config)).values.approved).toBe(false);
    expect((await graph.getState(config)).tasks[0].interrupts).toHaveLength(1);
  });
});
