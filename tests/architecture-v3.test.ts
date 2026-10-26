import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const diagram = JSON.parse(readFileSync("docs/architecture/assets/flow-architecture-v3.json", "utf8"));
const svg = readFileSync("docs/architecture/assets/flow-architecture-v3.svg", "utf8");
type Node = { id: string; x: number; y: number; w: number; h: number };
type Edge = { id: string; from: string; to: string; path: string };
type Stop = { edge: string; seconds: number; pause: number };

describe("v3 shared architecture and animation contract", () => {
  it("keeps the approved twelve instances and three READ / five WRITE ownership lanes", () => {
    const roster = diagram.roster as { id: string; owner: string }[];
    expect(new Set(roster.map(r => r.id)).size).toBe(12);
    expect(roster.filter(r => r.owner === "Manny").map(r => r.id).sort()).toEqual(["consistency", "reader", "research"]);
    expect(roster.filter(r => r.owner === "Justin")).toHaveLength(5);
    expect(roster.some(r => r.id === "intake")).toBe(false);
    expect(roster.filter(r => r.id === "consistency")).toHaveLength(1);
  });

  it("keeps SVG stages and connectors synchronized with the data used by both decks", () => {
    const nodes = diagram.nodes as Node[];
    const edges = diagram.edges as Edge[];
    expect(new Set(nodes.map(n => n.id)).size).toBe(nodes.length);
    for (const node of nodes) {
      expect(svg).toContain(`id="node-${node.id}"`);
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.x + node.w).toBeLessThanOrEqual(diagram.width);
      expect(node.y + node.h).toBeLessThanOrEqual(diagram.height);
    }
    for (const edge of edges) {
      expect(svg).toContain(`id="${edge.id}"`);
      expect(svg).toContain(`d="${edge.path}"`);
      expect(nodes.some(n => n.id === edge.from)).toBe(true);
      expect(nodes.some(n => n.id === edge.to)).toBe(true);
    }
    expect(svg).not.toMatch(/@import|<script|https?:\/\/(?!www\.w3\.org)/);
  });

  it("animates required gates in order, includes the bounded revision illustration and uses a slow cycle", () => {
    const route = diagram.route as Stop[];
    const ids = route.map(r => r.edge);
    expect(ids.indexOf("edge-research-dossier_gate")).toBeLessThan(ids.indexOf("edge-dossier_gate-bibles"));
    expect(ids.indexOf("edge-bibles-bible_gate")).toBeLessThan(ids.indexOf("edge-bible_gate-writers"));
    expect(ids.indexOf("edge-barrier-reader")).toBeLessThan(ids.indexOf("edge-reader-editors"));
    expect(ids).toContain("edge-review-reader");
    expect(ids.at(-1)).toBe("edge-review-export");
    for (const stop of route) {
      expect(diagram.edges.some((edge: Edge) => edge.id === stop.edge)).toBe(true);
      expect(stop.seconds).toBeGreaterThan(0);
      expect(stop.pause).toBeGreaterThanOrEqual(0);
    }
    const duration = route.reduce((sum, stop) => sum + stop.seconds + stop.pause, 0);
    expect(duration).toBeGreaterThanOrEqual(45);
    expect(duration).toBeLessThanOrEqual(60);
    expect(diagram.status).toMatch(/not live/i);
  });
});
