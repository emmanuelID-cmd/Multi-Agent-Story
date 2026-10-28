import { join } from "node:path";
import { orderedChapters, type Chapter } from "../../../contracts";
import { buildFixtureHandoff, type ReaderToEditorHandoff } from "../../handoff";
import {
  criticEditorAModel,
  criticEditorBModel,
  type CriticEditorModelInput,
} from "../../editors";
import {
  AnthropicWriteModel,
  type WriteModel,
  type WriteModelResponse,
} from "../model";
import {
  buildManuscriptEnvelope,
  verifyManuscriptEnvelope,
  type RevisedManuscript,
} from "../runtime";
import {
  SandboxEditorTracer,
  type EditorRunTrace,
  type EditorTraceStep,
  auditTypographyInProse,
  auditEditorialQuality,
} from "./editor-tracer";
import { resolveEditorSandboxPaths } from "./cleanup";
import { executeBibleInSandbox } from "./runner";
import { type MockBibleCase } from "../../../../tests/fixtures/mock-bibles";

export interface EditorSandboxExecutionOptions {
  model?: WriteModel;
  useLiveModel?: boolean;
  liveModelId?: string;
  baseChapters?: Chapter[];
  endToEnd?: boolean;
  userEditorialInstructions?: string;
  baseDir?: string;
}

import { cleanProseTypography } from "../runtime";

function stripTerminal(s: string): string {
  return s.trim().replace(/[.,;:!?\s]+$/, "");
}

function lowerFirst(s: string): string {
  return s.length > 0 ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

/**
 * Creates a deterministic simulated model for the Editor agents (Fontaine and Lang).
 * Simulates high-fidelity, setting-faithful revisions adhering strictly to their distinct lenses:
 * - Fontaine (critic_editor_a): Continuity & Pacing (tightening transitions, causal logic, honoring facts)
 * - Lang (critic_editor_b): Voice & Atmosphere (sensory immersion, poetic cadence, setting-specific texture)
 */
export function createEditorSandboxSimulatedModel(
  bibleCase: MockBibleCase,
  baseChapters: Chapter[]
): WriteModel {
  return {
    async complete(call) {
      if (call.signal?.aborted) {
        throw new DOMException("Operation canceled.", "AbortError");
      }

      const role = call.role;
      const bibleVersion = bibleCase.bibleVersion;
      const bibleId = bibleCase.id;

      if (role === "critic_editor_a") {
        // Fontaine: Continuity & Pacing
        const ch2Base = baseChapters.find((c) => c.chapterIndex === 2)?.text ?? "";
        const ch2Contradiction = ch2Base.includes("swam") || ch2Base.includes("swimming");

        let rev1 = "";
        let rev2 = "";
        let rev3 = "";
        let changesMade: RevisedManuscript["changesMade"] = [];
        let rationale = "";

        if (bibleId === "lighthouse") {
          rev1 =
            `From the high lantern gallery, Mara timed the steady blue signal pulsing across the outer ledge every three minutes. ` +
            `Aware of the churning undertow and mindful that she could not swim, she kept a cautious distance from the surf and methodically checked the tide tables. ` +
            `She readied the wooden harbor boat, securing oars and rowlocks so the skiff was balanced for the crossing.`;

          rev2 = ch2Contradiction
            ? `Mara held firmly to the gunwale as the harbor skiff met the outer swells, navigating directly toward the breakwater while keeping safely inside the wooden hull. ` +
              `Because approved fact F1 established that she could not swim, she relied entirely on measured strokes of the oars to close the distance. ` +
              `A shuttered brass lantern on the rocks created the signal, confirming human origin and guiding her approach without entering the water.`
            : `With deliberate, measured strokes, Mara guided the harbor boat through the rising fog toward the breakwater, maintaining strict course discipline. ` +
              `Mindful of the deep channel and her inability to swim, she kept the skiff aligned with the harbor wall. ` +
              `The shuttered lantern pulsed every three minutes on the rocks ahead, confirming the human distress signal and setting up the approach.`;

          rev3 =
            `Pulling alongside the jagged ledge, Mara secured the bow line and assisted the exhausted sailor aboard the harbor boat. ` +
            `She turned the skiff before the incoming tide could swamp the rocks, keeping both passengers safely inside the vessel. ` +
            `Guided by the harbor beacon's arc, they crossed the calm water and reached the safety of the stone pier.`;

          changesMade = [
            {
              chapterIndex: 1,
              summary: "Tightened opening exposition and streamlined nautical preparations.",
              justification: "Focuses immediate dramatic momentum onto the rhythmic signal timing and skiff readiness.",
            },
            ...(ch2Contradiction
              ? [
                  {
                    chapterIndex: 2,
                    summary: "Corrected critical continuity contradiction by replacing swimming with boat navigation.",
                    justification: "Strictly honors approved fact F1 establishing that Mara cannot swim.",
                  },
                ]
              : [
                  {
                    chapterIndex: 2,
                    summary: "Sharpened transit pacing and reinforced boat-only navigation discipline.",
                    justification: "Maintains uninterrupted causal momentum between Chapters 1 and 3 without logic gaps.",
                  },
                ]),
            {
              chapterIndex: 3,
              summary: "Reinforced resolution coherence and verified boat-only rescue completion.",
              justification: "Ensures the falling action ties off all navigational stakes cleanly.",
            },
          ];

          rationale = ch2Contradiction
            ? "Corrected fatal swimming contradiction in Chapter 2 to honor Fact F1. Sharpened causal transitions and tightened narrative pacing across all three chapters."
            : "Polished structural discipline, causal momentum, and scene transitions across all three chapters while strictly honoring approved story bible facts.";
        } else if (bibleId === "clockwork") {
          rev1 =
            `High in the stone cathedral gallery, Peter watched the internal brass gears of the stone gargoyle grind to a shuddering halt. ` +
            `Twilight purpled the cobblestones far below, and the causal countdown toward midnight began with unyielding certainty. ` +
            `Knowing that shadow beasts would breach the parapets once the final bell tolled, he mapped his descent to the flooded catacombs.`;

          rev2 =
            `Peter descended the spiral stairs into the flooded ossuary, stepping carefully across slippery tomb slabs. ` +
            `Using a vial of holy salt to hold back the creeping silhouettes that could not cross mineral boundaries, ` +
            `he reached into the stone niche, freed the third brass winding key, and began his ascent before the shadows could rally.`;

          rev3 =
            `Scaling the rain-slicked spire as the cathedral bells tolled their eleventh chime, Peter drove the brass key into the gargoyle's chest. ` +
            `With the final chime resounding at midnight, he seated the clockwork heart; bronze gears caught with a roar, ` +
            `and radiant mechanical force swept the parapets clean of darkness.`;

          changesMade = [
            {
              chapterIndex: 1,
              summary: "Tightened clockwork mechanism breakdown and clarified the midnight time constraint.",
              justification: "Establishes a rigorous causal deadline that drives Peter's descent into the ossuary.",
            },
            {
              chapterIndex: 2,
              summary: "Streamlined the catacombs sequence to emphasize key recovery and salt warding logic.",
              justification: "Eliminates narrative drag during the underground transit while preserving shadow beast rules.",
            },
            {
              chapterIndex: 3,
              summary: "Sharpened climax rhythm and synchronized the final heart placement with the stroke of midnight.",
              justification: "Maximizes dramatic momentum at the apex of the falling action.",
            },
          ];

          rationale =
            "Tightened causal pacing, reinforced the strict midnight countdown, and clarified key retrieval mechanics across all three chapters.";
        } else {
          // Orbital
          rev1 =
            `In Dome Three of the orbital habitat, Veda monitored the temperature gradient as the lunar shadow encroached upon the primary solar array. ` +
            `With the mirror gimbal jammed following a micrometeorite impact, the heirloom crops faced freezing within ninety minutes. ` +
            `She calculated the required EVA transit trajectory, verified the airlock seal, and prepared her tethered spacewalk.`;

          rev2 =
            `Veda cycled through the secondary airlock and pulled herself along the microgravity truss toward the mirror pivot. ` +
            `Keeping both tether carabiners locked against the titanium rail, she reached the jammed gimbal, inspected the fused gear teeth, ` +
            `and aligned her hydraulic lever before the shadow line could envelop the habitat ring.`;

          rev3 =
            `Working against the ninety-minute deadline as frost crystals spider-webbed across the dome exterior, Veda threw her weight into the lever arm. ` +
            `The fused titanium pivot snapped free, the reflector locked into the golden sunlight, ` +
            `and life-giving warmth flooded back into the hydroponic seedling beds.`;

          changesMade = [
            {
              chapterIndex: 1,
              summary: "Streamlined thermal telemetry exposition and clarified the ninety-minute freezing deadline.",
              justification: "Establishes precise stakes and logical momentum for the upcoming spacewalk.",
            },
            {
              chapterIndex: 2,
              summary: "Sharpened EVA transit pacing and reinforced tether safety protocols.",
              justification: "Maintains realistic orbital physics and steady tension leading to the repair apex.",
            },
            {
              chapterIndex: 3,
              summary: "Tightened lever arm mechanics and confirmed rapid restoration of habitat sunlight.",
              justification: "Provides a crisp, disciplined resolution to the life-support crisis.",
            },
          ];

          rationale =
            "Polished thermal timeline precision, clarified microgravity EVA steps, and tightened pacing leading to the mirror restoration.";
        }

        const payload: RevisedManuscript = {
          kind: "manuscript_a",
          editorialLens: "continuity_and_pacing",
          rationale,
          chapters: [
            { chapterIndex: 1, bibleVersion, text: cleanProseTypography(rev1) },
            { chapterIndex: 2, bibleVersion, text: cleanProseTypography(rev2) },
            { chapterIndex: 3, bibleVersion, text: cleanProseTypography(rev3) },
          ],
          changesMade,
        };

        return {
          modelUsed: "sandbox-simulated-sonnet",
          value: payload,
          usage: { inputTokens: 2400, outputTokens: 1650 },
        } satisfies WriteModelResponse;
      }

      if (role === "critic_editor_b") {
        // Lang: Voice & Atmosphere
        let rev1 = "";
        let rev2 = "";
        let rev3 = "";
        let changesMade: RevisedManuscript["changesMade"] = [];
        let rationale = "";

        if (bibleId === "lighthouse") {
          rev1 =
            `High in the octagonal lantern room, Mara watched the faint blue pulse shiver against the offshore fog like a dying star. ` +
            `The air tasted of cold brine, damp granite, and whale oil as she recorded the rhythmic three-minute cadence upon damp paper. ` +
            `The Atlantic held no mercy for someone who could not swim; she tested the hemp painters, stepped into the cedar harbor skiff, ` +
            `and pushed off into the swirling coastal mist.`;

          rev2 =
            `The oars groaned in their brass locks, rhythmic and muffled against the heavy swell. ` +
            `Salt spray clung to Mara's eyelashes as she drew toward the black teeth of the breakwater, where the blue flash pulsed through the gloom. ` +
            `She stayed low against the thwart, feeling the deep pull of the tide under the floorboards, ` +
            `and called through the roar of the surf toward the huddled silhouette on the rocks.`;

          rev3 =
            `With a heave of canvas and salted cordage, Mara hauled the shivering sailor over the gunwale and wrapped him in coarse wool. ` +
            `Turning the bow toward the warm amber beam of the lighthouse tower, she rowed through the foam into the harbor's quiet embrace. ` +
            `The sea fell quiet behind them, leaving only the ancient rhythm of the tide and the hush of survival.`;

          changesMade = [
            {
              chapterIndex: 1,
              summary: "Enriched sensory details of whale oil, cold brine mist, and tactile skiff preparation.",
              justification: "Deepens atmospheric isolation and grounds Mara's fear of deep water in visceral prose texture.",
            },
            {
              chapterIndex: 2,
              summary: "Heightened auditory and tactile textures of groaning oars and crashing coastal surf.",
              justification: "Elevates emotional vulnerability during the dangerous night approach.",
            },
            {
              chapterIndex: 3,
              summary: "Infused lyrical cadence and sensory relief as the boat returns to the amber lighthouse beam.",
              justification: "Delivers an evocative, poetic conclusion to the nocturnal rescue.",
            },
          ];

          rationale =
            "Elevated atmospheric imagery of coastal isolation, sensory brine textures, and lyrical character interiority across all three chapters.";
        } else if (bibleId === "clockwork") {
          rev1 =
            `Shadows lengthened across the cathedral flagstones like poured ink as the gargoyle's bronze ribs shuddered into silence. ` +
            `The smell of oxidized brass and ancient incense hung thick in the nave as twilight drained from the stained glass. ` +
            `Peter touched the cold metal mechanism, feeling the absence of its heartbeat as darkness began to pool in the vaulted corners.`;

          rev2 =
            `Down in the ossuary, damp lime and cold water chilled Peter's boots as he moved through corridors of bone. ` +
            `Yellow eyes flickered at the edge of his torchlight, hissing in fury as he scattered grains of holy salt in shimmering defensive lines. ` +
            `His fingers closed around the cold, ornate brass of the third winding key, its teeth sharp against his calloused palm.`;

          rev3 =
            `A howling wind tore across the cathedral parapets as the twelfth chime vibrated through the stones. ` +
            `Peter drove the winding key home and turned it against the spring; bronze gears whirred with golden warmth, ` +
            `the stone beast stirred to life with emerald luminance, and the darkness shrieked into retreat.`;

          changesMade = [
            {
              chapterIndex: 1,
              summary: "Deepened gothic imagery of oxidized bronze, fading nave twilight, and cold stone architecture.",
              justification: "Establishes ominous folklore ambiance and visceral dread of the stopped heartbeat.",
            },
            {
              chapterIndex: 2,
              summary: "Heightened atmospheric tension in the ossuary with glistening lime, salt ward lines, and yellow eyes.",
              justification: "Immerses the reader in the sensory claustrophobia of the subterranean catacombs.",
            },
            {
              chapterIndex: 3,
              summary: "Infused triumphant auditory resonance and emerald luminance into the gargoyle's reawakening.",
              justification: "Creates an emotionally resonant and visually striking folklore culmination.",
            },
          ];

          rationale =
            "Elevated gothic folklore atmosphere, tactile bronze textures, and evocative sensory mood across all three chapters.";
        } else {
          // Orbital
          rev1 =
            `In the hushed stillness of Dome Three, Veda heard only the soft sigh of air scrubbers and the crackle of freezing condensation. ` +
            `Through the curved polycarbonate canopy, the velvet black of the vacuum loomed, pierced by the sharp diamond light of distant stars. ` +
            `The delicate heirloom shoots below her boots bowed beneath the encroaching chill as the solar mirror's warmth flickered and died.`;

          rev2 =
            `Outside the airlock, the universe opened in silent, terrifying grandeur. ` +
            `Veda's suit telemetry hummed softly in her ear as her gloved hands navigated the frost-rimed titanium lattice of the orbital ring. ` +
            `Below her boots, the curved blue horizon of Earth turned slowly, indifferent to the struggle on the unlit truss.`;

          rev3 =
            `With the final torque of the ratchet, the jammed gimbal yield with a muffled vibration through her suit. ` +
            `The polished mirror array swung into alignment, catching the blazing white brilliance of the sun and redirecting it into the dome. ` +
            `Golden warmth spilled across the green shoots, melting frost into sparkling dew upon the leaves of Earth's surviving heritage.`;

          changesMade = [
            {
              chapterIndex: 1,
              summary: "Enriched contemplative stillness, botanical fragility, and velvet vacuum aesthetics in Dome Three.",
              justification: "Deepens solitary scientific devotion and poetic contrast between living shoots and cold space.",
            },
            {
              chapterIndex: 2,
              summary: "Elevated cosmic awe and sensory isolation during the silent spacewalk along the titanium truss.",
              justification: "Immerses the reader in the vastness of orbit and tactile microgravity maneuvers.",
            },
            {
              chapterIndex: 3,
              summary: "Infused lyrical warmth and radiant golden imagery into the restoration of sunlight.",
              justification: "Provides an evocative, uplifting climax celebrating preservation and planetary life.",
            },
          ];

          rationale =
            "Elevated contemplative solarpunk atmosphere, cosmic sensory grandeur, and lyrical emotional resonance across all three chapters.";
        }

        const payload: RevisedManuscript = {
          kind: "manuscript_b",
          editorialLens: "voice_and_atmosphere",
          rationale,
          chapters: [
            { chapterIndex: 1, bibleVersion, text: cleanProseTypography(rev1) },
            { chapterIndex: 2, bibleVersion, text: cleanProseTypography(rev2) },
            { chapterIndex: 3, bibleVersion, text: cleanProseTypography(rev3) },
          ],
          changesMade,
        };

        return {
          modelUsed: "sandbox-simulated-sonnet",
          value: payload,
          usage: { inputTokens: 2550, outputTokens: 1780 },
        } satisfies WriteModelResponse;
      }

      throw new Error(`Unhandled editor sandbox role: ${role}`);
    },
  };
}

/**
 * Performs anti-imitation check: ensures neither "Fontaine" nor "Lang"
 * appears within the actual narrative story prose.
 */
function auditAntiImitationInProse(chapters: Chapter[]): {
  passed: boolean;
  offendingWordsFound: string[];
} {
  const offending: string[] = [];
  const banned = ["Fontaine", "Jean de La Fontaine", "Lang", "Andrew Lang"];

  for (const ch of chapters) {
    for (const b of banned) {
      const regex = new RegExp(`\\b${b}\\b`, "i");
      if (regex.test(ch.text)) {
        if (!offending.includes(b)) offending.push(b);
      }
    }
  }

  return {
    passed: offending.length === 0,
    offendingWordsFound: offending,
  };
}

/**
 * Executes a full dual-editor sandbox run (Fontaine & Lang) on a story bible.
 */
export async function executeEditorsInSandbox(
  bibleCase: MockBibleCase,
  options: EditorSandboxExecutionOptions = {}
): Promise<EditorRunTrace> {
  const tracer = new SandboxEditorTracer(
    bibleCase.id,
    bibleCase.name,
    bibleCase.bibleVersion
  );

  // 1. Resolve Base Chapters (dynamic end-to-end or pre-supplied)
  let baseChapters: Chapter[];
  if (options.baseChapters && options.baseChapters.length === 3) {
    baseChapters = options.baseChapters;
  } else {
    // Generate fresh base chapters from the writer sandbox
    const writerTrace = await executeBibleInSandbox(bibleCase, {
      baseDir: options.baseDir,
    });
    baseChapters = writerTrace.steps.map((s) => ({
      chapterIndex: s.chapterIndex,
      bibleVersion: bibleCase.bibleVersion,
      text: s.chapterText,
    }));
  }

  // Ensure base chapters pass write barrier
  orderedChapters(baseChapters, bibleCase.bibleVersion);

  const baseChaptersSummary = {
    hashes: baseChapters.map((c) => `${c.chapterIndex}:${c.text.length}chars`),
    totalWords: baseChapters.reduce((sum, c) => sum + c.text.split(/\s+/).length, 0),
    chapters: baseChapters.map((c) => ({
      chapterIndex: c.chapterIndex,
      wordCount: c.text.split(/\s+/).length,
    })),
  };

  // 2. Prepare 5-Field Reader Handoff
  const recordedRequest =
    options.userEditorialInstructions ??
    bibleCase.brief.desiredEnding ??
    "Polish legibility, flow, and apply distinct editorial lens.";

  const handoff = buildFixtureHandoff(
    baseChapters,
    bibleCase.bibleVersion,
    recordedRequest,
    0
  );

  const handoffAudit = {
    valid: true,
    confidence: handoff.completeness.confidence,
    coveredChapters: handoff.sourceReferences.map((r) => {
      const match = r.locator.match(/chapter_(\d+)/);
      return match ? parseInt(match[1], 10) : 0;
    }),
    recordedRequest,
  };

  // 3. Resolve Model
  let model: WriteModel;
  if (options.model) {
    model = options.model;
  } else if (options.useLiveModel) {
    const key =
      process.env.WRITE_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY required for live editor sandbox run.");
    model = new AnthropicWriteModel(key, {
      criticModelId: options.liveModelId ?? "claude-3-5-sonnet-20241022",
    });
  } else {
    model = createEditorSandboxSimulatedModel(bibleCase, baseChapters);
  }

  const runId = `editor-run-${Date.now()}`;

  // 4. Execute Critic/Editor A: Fontaine (Continuity & Pacing)
  const tAStart = Date.now();
  const inputA: CriticEditorModelInput = {
    bibleVersion: bibleCase.bibleVersion,
    handoff,
    baseChapters,
    approvedBible: bibleCase.bible,
    expectedRecordedRequest: recordedRequest,
    userEditorialInstructions: recordedRequest,
  };
  const resA = await criticEditorAModel(inputA, model);
  const tADuration = Date.now() - tAStart;

  // Barrier & Envelope for Fontaine
  let barrierAPassed = false;
  try {
    orderedChapters(resA.proposal.chapters, bibleCase.bibleVersion);
    barrierAPassed = true;
  } catch {
    barrierAPassed = false;
  }

  const envelopeA = buildManuscriptEnvelope({
    manuscript: resA.proposal,
    baseChapters,
    runId,
    baseVersion: bibleCase.bibleVersion,
  });
  const envelopeAValid = verifyManuscriptEnvelope({
    envelope: envelopeA,
    storedChapters: baseChapters,
    manuscript: resA.proposal,
    expectedBaseVersion: bibleCase.bibleVersion,
  }).valid;
  const antiImitationA = auditAntiImitationInProse(resA.proposal.chapters);
  const typographyA = auditTypographyInProse(resA.proposal.chapters);
  const editorialQualityA = auditEditorialQuality(
    resA.proposal.chapters,
    bibleCase.id,
    "critic_editor_a",
    resA.proposal
  );

  const stepA: EditorTraceStep = {
    role: "critic_editor_a",
    alias: "Fontaine",
    lens: "continuity_and_pacing",
    modelUsed: resA.modelUsed,
    usage: resA.usage,
    durationMs: tADuration,
    proposal: resA.proposal,
    envelope: envelopeA,
    envelopeValid: envelopeAValid,
    barrierPassed: barrierAPassed,
    antiImitationAudit: antiImitationA,
    typographyAudit: typographyA,
    editorialAudit: editorialQualityA,
    changesCount: resA.proposal.changesMade.length,
    wordDeltas: {
      ch1: (resA.proposal.chapters[0]?.text.split(/\s+/).length ?? 0) - baseChaptersSummary.chapters[0].wordCount,
      ch2: (resA.proposal.chapters[1]?.text.split(/\s+/).length ?? 0) - baseChaptersSummary.chapters[1].wordCount,
      ch3: (resA.proposal.chapters[2]?.text.split(/\s+/).length ?? 0) - baseChaptersSummary.chapters[2].wordCount,
    },
  };
  tracer.recordStep(stepA);

  // 5. Execute Critic/Editor B: Lang (Voice & Atmosphere)
  const tBStart = Date.now();
  const inputB: CriticEditorModelInput = {
    bibleVersion: bibleCase.bibleVersion,
    handoff,
    baseChapters,
    approvedBible: bibleCase.bible,
    expectedRecordedRequest: recordedRequest,
    userEditorialInstructions: recordedRequest,
  };
  const resB = await criticEditorBModel(inputB, model);
  const tBDuration = Date.now() - tBStart;

  // Barrier & Envelope for Lang
  let barrierBPassed = false;
  try {
    orderedChapters(resB.proposal.chapters, bibleCase.bibleVersion);
    barrierBPassed = true;
  } catch {
    barrierBPassed = false;
  }

  const envelopeB = buildManuscriptEnvelope({
    manuscript: resB.proposal,
    baseChapters,
    runId,
    baseVersion: bibleCase.bibleVersion,
  });
  const envelopeBValid = verifyManuscriptEnvelope({
    envelope: envelopeB,
    storedChapters: baseChapters,
    manuscript: resB.proposal,
    expectedBaseVersion: bibleCase.bibleVersion,
  }).valid;
  const antiImitationB = auditAntiImitationInProse(resB.proposal.chapters);
  const typographyB = auditTypographyInProse(resB.proposal.chapters);
  const editorialQualityB = auditEditorialQuality(
    resB.proposal.chapters,
    bibleCase.id,
    "critic_editor_b",
    resB.proposal
  );

  const stepB: EditorTraceStep = {
    role: "critic_editor_b",
    alias: "Lang",
    lens: "voice_and_atmosphere",
    modelUsed: resB.modelUsed,
    usage: resB.usage,
    durationMs: tBDuration,
    proposal: resB.proposal,
    envelope: envelopeB,
    envelopeValid: envelopeBValid,
    barrierPassed: barrierBPassed,
    antiImitationAudit: antiImitationB,
    typographyAudit: typographyB,
    editorialAudit: editorialQualityB,
    changesCount: resB.proposal.changesMade.length,
    wordDeltas: {
      ch1: (resB.proposal.chapters[0]?.text.split(/\s+/).length ?? 0) - baseChaptersSummary.chapters[0].wordCount,
      ch2: (resB.proposal.chapters[1]?.text.split(/\s+/).length ?? 0) - baseChaptersSummary.chapters[1].wordCount,
      ch3: (resB.proposal.chapters[2]?.text.split(/\s+/).length ?? 0) - baseChaptersSummary.chapters[2].wordCount,
    },
  };
  tracer.recordStep(stepB);

  // 6. Build Trace & Persist
  const runTrace = tracer.buildTrace(baseChaptersSummary, handoffAudit);
  const paths = resolveEditorSandboxPaths(options.baseDir);

  SandboxEditorTracer.saveTraceJson(
    runTrace,
    join(paths.traces, `${bibleCase.id}_editor_trace.json`)
  );
  SandboxEditorTracer.saveReviewMarkdown(
    runTrace,
    join(paths.reviews, `${bibleCase.id}_editor_review.md`)
  );

  return runTrace;
}
