import type { Bible, Chapter, Fixture } from "../contracts";
import { orderedChapters } from "../contracts";
import { draftChapterOne, draftChapterTwo, draftChapterThree } from "./writers";
import type { ProviderEvidence } from "../server/research/book-metadata";
import type { ReadAuthority, ReadSnapshot, ResearchInput } from "./read/contracts";
import type { ModelCall, ModelResponse, ReadModel } from "./read/model";
import { sha256 } from "./read/runtime";

export const fixtureBible: Bible = {
  facts: [
    { id: "F1", text: "Mara, a lighthouse keeper, cannot swim." },
    { id: "F2", text: "The blue signal is human-made." },
    { id: "F3", text: "The missing sailor is rescued using a boat." },
  ],
  beats: [
    { chapterIndex: 1, text: "Discover the blue signal." },
    { chapterIndex: 2, text: "Investigate its human origin." },
    { chapterIndex: 3, text: "Rescue the missing sailor by boat." },
  ],
};

export const recordedRequest = "Review the three chapters and propose two complete editorial alternatives while preserving Mara's approved facts.";

export function fixtureChapters(kind: "normal" | "continuity"): Chapter[] {
  return orderedChapters([draftChapterThree(1), draftChapterOne(1), draftChapterTwo(1, kind as Fixture)], 1);
}

export function fixtureResearchInput(authority: ReadAuthority, model: string): ResearchInput {
  const fetchedAt = "2026-10-25T00:00:00.000Z";
  const craft = "Mara found a fresh brass key inside the cold lantern. The door had been locked when the missing sailor left; someone had returned after midnight. She drew the key's three notches in her notebook rather than touch it. Across the black harbor, a blue light flashed three times and disappeared.\n\nShe waited. Rain tapped the window while the channel stayed dark. On the next flash she counted the long pause between pulses. Three short lights, one long silence: the same pattern was scratched beside the missing sailor's berth. The resemblance was a clue, not proof. She checked the harbor log and found that a boat had left for the breakwater before the tide turned.\n\nMara could not swim. She tied a safety line inside the skiff, packed a shuttered lamp, and followed the sheltered channel. Near the rocks she signaled the recorded pattern. A lantern answered from behind the wall. The sailor called from a stranded boat; he had hidden the key to keep it from the thief. Mara kept the skiff steady and brought him aboard. The key, the log, and the answering signal resolved the immediate mystery, while the thief's identity remained an open thread.";
  const context = "In this fictional harbor test setting, the breakwater has a sheltered boat channel.";
  return {
    authority, versions: { contract: "read-v1", prompt: "read-v1", harness: "read-harness-v1", model },
    briefVersion: 1, scopeVersion: 1, criteriaVersion: 1, scopeConfirmed: true,
    brief: { premise: "Mara follows a blue signal to rescue a missing sailor by boat.", genre: "mystery", optionalDetails: {}, acceptedSuggestions: {} },
    dimensions: [
      { id: "genre", label: "Locate a mystery clue and response in THIS scene only; no published-book comparison or genre-wide claim.", claimType: "craft" },
      { id: "craft", label: "Locate one suspense technique in THIS scene only; no author-style or genre-wide generalization.", claimType: "craft" },
    ],
    eligibleSources: [
      { sourceId: "fixture_craft", kind: "licensed_text", work: "Original test passage", author: "Test fixture", publicationDate: null, sourceUrl: "https://example.invalid/fixtures/craft", fetchedAt, rightsBasis: "Original synthetic test text authored for this fixture; no third-party work is ingested.", jurisdiction: "US", rightsVerified: true, locator: "fixture:craft:1", text: craft, sha256: sha256(craft) },
      { sourceId: "fixture_context", kind: "historical_context", work: "Fictional harbor setting note", author: "Test fixture", publicationDate: null, sourceUrl: "https://example.invalid/fixtures/context", fetchedAt, rightsBasis: "Original synthetic test note authored for this fixture; it makes no real-world historical claim.", jurisdiction: "US", rightsVerified: true, locator: "fixture:context:1", text: context, sha256: sha256(context) },
    ],
    benchmarkRequest: { genre: "mystery", providers: ["nyt", "gutendex"], nytList: "hardcover-fiction", limit: 1 },
  };
}

export function fixtureProviders(): ProviderEvidence[] {
  const checkedAt = "2026-10-25T00:00:00.000Z";
  return (["nyt", "gutendex"] as const).map(provider => ({
    provider, status: "available", reasonCode: "SYNTHETIC_FIXTURE", sourceUrl: `https://example.invalid/fixtures/${provider}`,
    checkedAt, fetchedAt: checkedAt, records: [{ providerRecordId: `${provider}-fixture-1`, title: "Synthetic Harbor Mystery", authors: ["Test Fixture"], isbns: [], sourceUrl: `https://example.invalid/fixtures/${provider}/1`, fetchedAt: checkedAt, publishedDate: null, signals: { rank: provider === "nyt" ? 1 : null, weeksOnList: null, downloadCount: provider === "gutendex" ? 1 : null }, missingFields: ["publishedDate", "isbns"], matchConfidence: "unmatched" }],
    quarantinedCount: 0, findings: [], limitation: "Synthetic metadata fixture only; no real ranking, sales, rights, or cross-provider match is asserted.",
  }));
}

export function fixtureSnapshot(authority: ReadAuthority, chapters: Chapter[], draftVersion = 1, proposalId?: string): ReadSnapshot {
  return {
    ownerId: authority.ownerId, projectId: authority.projectId, stateVersion: authority.stateVersion,
    bibleVersion: 1, draftVersion, proposalId, proposalVersion: proposalId ? 1 : undefined,
    chapters: orderedChapters(chapters, 1).map(chapter => ({ ...chapter, sourceId: `chapter_${chapter.chapterIndex}_v${draftVersion}`, draftVersion, sha256: sha256(chapter.text) })),
    facts: fixtureBible.facts,
  };
}

type ResearchData = { eligibleSources: ResearchInput["eligibleSources"] };
type SnapshotData = { snapshot: ReadSnapshot };

function quote(text: string): string {
  const withoutLabel = text.replace(/^\[[^\]]+\]\s*/, "");
  return withoutLabel.match(/[^.!?]+[.!?]/)?.[0].trim().slice(0, 120) || text.slice(0, 120);
}

/** Deterministic model double; every value still passes the production runtime validators. */
export class FixtureReadModel implements ReadModel {
  readonly modelId = "fixture-read-v1";
  readonly calls: ModelCall["agent"][] = [];
  async complete(call: ModelCall): Promise<ModelResponse> {
    this.calls.push(call.agent);
    if (call.signal.aborted) throw new Error("CANCELED");
    const data = call.data as ResearchData & SnapshotData;
    let value: unknown;
    if (call.agent === "research") {
      const sources = data.eligibleSources;
      value = {
        items: [
          { itemId: "genre_item", sourceId: "fixture_craft", kind: "located_text_observation", dimensionId: "genre", claim: "An unexpected brass key supplies a concrete clue in this original mystery scene.", locator: sources[0].locator, quote: "Mara found a fresh brass key inside the cold lantern.", confidence: 1 },
          { itemId: "craft_item", sourceId: "fixture_craft", kind: "located_text_observation", dimensionId: "craft", claim: "Waiting and the dark channel delay information in this original scene.", locator: sources[0].locator, quote: "She waited. Rain tapped the window while the channel stayed dark.", confidence: 1 },
        ],
        synthesis: [{ dimensionId: "genre", observation: "The unexplained key supplies a concrete mystery clue without imitating another work.", itemIds: ["genre_item"] }, { dimensionId: "craft", observation: "Use a pause and restricted information to create uncertainty.", itemIds: ["craft_item"] }], gaps: [],
      };
    } else if (call.agent === "reader") {
      value = { findings: data.snapshot.chapters.map(chapter => ({ chapterIndex: chapter.chapterIndex, sourceId: chapter.sourceId, quote: quote(chapter.text), factId: null, observation: `Chapter ${chapter.chapterIndex} is available for the recorded editorial task.` })), missingItems: [], confidence: 1 };
    } else {
      const snapshot = data.snapshot;
      const swim = snapshot.chapters.find(chapter => chapter.text.includes("Mara swam"));
      value = { findings: swim ? [{ chapterIndex: swim.chapterIndex, sourceId: swim.sourceId, quote: "Mara swam", factId: "F1", observation: "This action conflicts with approved fact F1.", severity: "high", suggestedCorrection: "Keep Mara in the boat." }] : [], unresolvedIssues: [], checkedFactIds: snapshot.facts.map(fact => fact.id), checkedChapterIndexes: snapshot.chapters.map(chapter => chapter.chapterIndex) };
    }
    return { value, usage: { inputTokens: 100, outputTokens: 80 } };
  }
}
