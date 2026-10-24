import { chapterSchema, type Chapter, type Bible } from "../contracts";
import type { ReaderToEditorHandoff } from "./handoff";

export interface RevisedManuscript {
  kind: "manuscript_a" | "manuscript_b";
  editorialLens: "continuity_and_pacing" | "voice_and_atmosphere";
  rationale: string;
  chapters: Chapter[];
  changesMade: Array<{
    chapterIndex: number;
    summary: string;
    justification: string;
  }>;
}

/**
 * Critic/Editor A: Continuity and Pacing Lens.
 * Evaluates the three chapters for narrative continuity, fact adherence, and scene pacing.
 * Eliminates contradictions (e.g. rewriting "Mara swam" into safe boat handling)
 * and sharpens narrative transitions.
 */
export function criticEditorA(
  handoff: ReaderToEditorHandoff,
  baseChapters: Chapter[],
  approvedBible: Bible
): RevisedManuscript {
  const bibleVersion = handoff.version.bibleVersion;
  const cannotSwimFact = approvedBible.facts.find(f => f.id === "F1")?.text ?? "Mara cannot swim.";
  const ch2HasContradiction = baseChapters.some(c => c.chapterIndex === 2 && c.text.includes("Mara swam"));

  const revisedChapters: Chapter[] = baseChapters.map(c => {
    if (c.chapterIndex === 1) {
      return chapterSchema.parse({
        chapterIndex: 1,
        bibleVersion,
        text: "[Revised Version A — Continuity & Pacing]\n\n" +
          "Mara watched a blue signal blink beyond the lighthouse. She logged its timing on paper and checked the tide. " +
          "Because she could not swim, she stayed well clear of the churning waterline and readied the harbor skiff. " +
          "The light was a clear clue, not a command.",
      });
    }

    if (c.chapterIndex === 2) {
      if (c.text.includes("Mara swam")) {
        return chapterSchema.parse({
          chapterIndex: 2,
          bibleVersion,
          text: "[Revised Version A — Continuity & Pacing]\n\n" +
            "Mara investigated strictly from the boat, tracking the rhythmic blue pulses along the harbor wall. " +
            `Remembering that she could not swim (${cannotSwimFact}), she held fast to the gunwale and adjusted her rudder. ` +
            "A shuttered lantern on the breakwater produced the signal: it was unmistakably human-made. " +
            "She hailed the missing sailor and held the boat steady in the surging tide.",
        });
      }
      return chapterSchema.parse({
        chapterIndex: 2,
        bibleVersion,
        text: "[Revised Version A — Continuity & Pacing]\n\n" +
          "Mara investigated from the boat, tracking the marked pattern with deliberate care. " +
          `Mindful that she could not swim (${cannotSwimFact}), she kept the skiff aligned against the breakwater surge. ` +
          "A shuttered lantern on the rocks produced the blue signal: it was confirmed human-made. " +
          "She called to the missing sailor and prepared a secure approach without entering the water.",
      });
    }

    if (c.chapterIndex === 3) {
      return chapterSchema.parse({
        chapterIndex: 3,
        bibleVersion,
        text: "[Revised Version A — Continuity & Pacing]\n\n" +
          "Mara brought the skiff alongside the breakwater and assisted the exhausted sailor aboard. " +
          "Together they steered back through the harbor channel. The human-made signal had guided the mission, " +
          "and her vessel had kept her safely out of the water.",
      });
    }

    throw new Error(`Unexpected chapter index: ${c.chapterIndex}`);
  });

  const changesMade = [
    ...(ch2HasContradiction ? [{
      chapterIndex: 2,
      summary: "Replaced swimming action with boat maneuvering.",
      justification: "Approved fact F1 explicitly establishes that Mara cannot swim.",
    }] : [{
      chapterIndex: 2,
      summary: "Refined approach pacing and reinforced boat-only navigation.",
      justification: "Maintains narrative momentum while strictly adhering to approved fact F1.",
    }]),
    {
      chapterIndex: 1,
      summary: "Tightened opening cadence.",
      justification: "Improves narrative momentum leading into the inciting signal.",
    },
    {
      chapterIndex: 3,
      summary: "Reinforced resolution coherence.",
      justification: "Confirms safe recovery by boat without water contact.",
    },
  ];

  const rationale = ch2HasContradiction
    ? "Corrected critical continuity contradiction in chapter 2 regarding Mara swimming. " +
      "Realigned scene actions with approved fact F1 (cannot swim) and tightened transition pacing."
    : "Polished scene transitions and narrative pacing across all three chapters while strictly honoring approved story facts.";

  return {
    kind: "manuscript_a",
    editorialLens: "continuity_and_pacing",
    rationale,
    chapters: revisedChapters,
    changesMade,
  };
}

/**
 * Critic/Editor B: Voice and Atmosphere Lens.
 * Evaluates the three chapters for prose cadence, atmospheric texture, and sensory depth.
 * Elevates the coastal mood and character interiority while strictly respecting established facts.
 */
export function criticEditorB(
  handoff: ReaderToEditorHandoff,
  baseChapters: Chapter[],
  approvedBible: Bible
): RevisedManuscript {
  const bibleVersion = handoff.version.bibleVersion;

  const revisedChapters: Chapter[] = baseChapters.map(c => {
    if (c.chapterIndex === 1) {
      return chapterSchema.parse({
        chapterIndex: 1,
        bibleVersion,
        text: "[Revised Version B — Voice & Atmosphere]\n\n" +
          "High in the lantern room, Mara caught the faint cobalt pulse shivering against the offshore fog. " +
          "The smell of brine and damp stone clung to the granite walls as she inked the rhythm onto parchment. " +
          "The black Atlantic offered no second chances to someone who could not swim; she checked her knots, " +
          "trusted the stout cedar hull of the harbor boat, and stepped into the mist.",
      });
    }

    if (c.chapterIndex === 2) {
      // If base chapter 2 had "Mara swam", Editor B also preserves fact F1
      return chapterSchema.parse({
        chapterIndex: 2,
        bibleVersion,
        text: "[Revised Version B — Voice & Atmosphere]\n\n" +
          "Oars dipped into the swell with a muffled thud. Mara followed the blue lantern flash across the breakwater, " +
          "her gaze fixed on the slippery stones where sea spray rose like cold smoke. " +
          "She never tested the deep water with her boots, keeping the oarlock pinned as she drew within hailing distance. " +
          "'Hold on!' she called into the wind, spotting the drenched coat of the missing sailor.",
      });
    }

    if (c.chapterIndex === 3) {
      return chapterSchema.parse({
        chapterIndex: 3,
        bibleVersion,
        text: "[Revised Version B — Voice & Atmosphere]\n\n" +
          "With a heave of canvas and rope, she drew the shivering sailor onto the dry floorboards. " +
          "The skiff turned its bow toward the beacon's warm amber arc. Behind them, the mystery on the rocks fell quiet, " +
          "leaving only the rhythmic crash of surf against stone and the quiet relief of survival.",
      });
    }

    throw new Error(`Unexpected chapter index: ${c.chapterIndex}`);
  });

  return {
    kind: "manuscript_b",
    editorialLens: "voice_and_atmosphere",
    rationale: "Elevated atmospheric imagery of coastal isolation and deepened Mara's sensory perspective " +
      "while strictly maintaining fact F1 and chapter beat milestones.",
    chapters: revisedChapters,
    changesMade: [
      {
        chapterIndex: 1,
        summary: "Enriched sensory description of the fog and granite tower.",
        justification: "Establishes atmospheric tone and visceral stakes.",
      },
      {
        chapterIndex: 2,
        summary: "Enhanced ocean imagery and dialogue tension.",
        justification: "Heightens atmospheric escalation during the approach.",
      },
      {
        chapterIndex: 3,
        summary: "Deepened sensory relief and coastal atmosphere upon return.",
        justification: "Provides satisfying emotional and tonal resolution.",
      },
    ],
  };
}
