import { z } from "zod";
import { bibleSchema, briefSchema, type Bible, type Brief } from "../../src/contracts";

export interface MockBibleCase {
  id: string;
  name: string;
  brief: Brief;
  bible: Bible;
  bibleVersion: number;
  expectedToneNotes: string;
}

export const lighthouseMysteryCase: MockBibleCase = {
  id: "lighthouse",
  name: "Lighthouse Mystery (Nautical Noir)",
  brief: briefSchema.parse({
    premise: "Mara, a solitary lighthouse keeper who cannot swim, investigates an enigmatic pulsing blue signal on the outer breakwater.",
    genre: "Nautical Mystery",
    audience: "Adult Fiction",
    tone: "Atmospheric, grounded, and tense",
    desiredEnding: "Mara safely rescues the missing sailor with the harbor boat and returns to shore.",
  }),
  bible: bibleSchema.parse({
    facts: [
      { id: "F1", text: "Mara, a lighthouse keeper, cannot swim." },
      { id: "F2", text: "The blue signal is human-made and pulses every three minutes." },
      { id: "F3", text: "The missing sailor is rescued using the wooden harbor boat." },
    ],
    beats: [
      { chapterIndex: 1, text: "Mara spots the rhythmic blue lantern signal from the catwalk and times its pattern." },
      { chapterIndex: 2, text: "Mara navigates the harbor boat through fog toward the breakwater, staying out of the deep swells." },
      { chapterIndex: 3, text: "Mara pulls the stranded sailor into the skiff and rows back before the tide submerges the ledge." },
    ],
  }),
  bibleVersion: 1,
  expectedToneNotes: "Tactile maritime details, salt spray, lantern oil, fear of deep water.",
};

export const clockworkFairytaleCase: MockBibleCase = {
  id: "clockwork",
  name: "The Clockwork Weaver (Gothic Folklore)",
  brief: briefSchema.parse({
    premise: "An apprentice silversmith must replace the clockwork heart of the cathedral's stone gargoyle before midnight to stop the encroaching shadows.",
    genre: "Gothic Folklore",
    audience: "Adult Fiction",
    tone: "Dark, tactile, and ominous",
    desiredEnding: "The apprentice seats the brass heart at the final chime of midnight, reawakening the guardian.",
  }),
  bible: bibleSchema.parse({
    facts: [
      { id: "F1", text: "The clockwork gargoyle repels shadow beasts that cross the city walls at midnight." },
      { id: "F2", text: "The mechanical heart requires three winding brass keys hidden in the catacombs." },
      { id: "F3", text: "Shadow beasts dissolve in water and cannot cross salt boundaries." },
    ],
    beats: [
      { chapterIndex: 1, text: "The gargoyle's internal gears grind to a shuddering stop as twilight purples the cobblestones." },
      { chapterIndex: 2, text: "Peter descends into the flooded ossuary, using a vial of holy salt to ward off creeping silhouettes while seizing the third key." },
      { chapterIndex: 3, text: "Peter scales the storm-slicked cathedral spire as the bells toll midnight, seating the clockwork heart just as claws reach the parapet." },
    ],
  }),
  bibleVersion: 1,
  expectedToneNotes: "Creaking bronze gears, salt lines, shadows with yellow eyes, gothic stone.",
};

export const orbitalSciFiCase: MockBibleCase = {
  id: "orbital",
  name: "Orbital Archivist (Solarpunk Sci-Fi)",
  brief: briefSchema.parse({
    premise: "A solitary botanist aboard an abandoned orbital ring must manually realign a jammed solar reflector during an eclipse to prevent heirloom crop failure.",
    genre: "Hard Sci-Fi / Solarpunk",
    audience: "Adult Fiction",
    tone: "Contemplative, claustrophobic, and resolute",
    desiredEnding: "The solar reflector locks into place, restoring golden warmth to the hydroponic seedlings.",
  }),
  bible: bibleSchema.parse({
    facts: [
      { id: "F1", text: "The orbital habitat preserves the last living germplasm of Earth's heirloom grains." },
      { id: "F2", text: "The primary solar mirror gimbal jammed following a micrometeorite impact." },
      { id: "F3", text: "Seedlings freeze to death if deprived of heat and light for more than ninety minutes." },
    ],
    beats: [
      { chapterIndex: 1, text: "Veda detects a temperature drop in Dome Three as the lunar shadow encroaches on the unaligned solar mirrors." },
      { chapterIndex: 2, text: "Veda executes an unsanctioned tethered spacewalk across the microgravity truss to dislodge the fused titanium gear." },
      { chapterIndex: 3, text: "With suit oxygen dwindling and the frost line expanding across the glass, Veda uses a lever arm to crank the reflector into the light." },
    ],
  }),
  bibleVersion: 1,
  expectedToneNotes: "Suit telemetry, hiss of oxygen, velvet vacuum of space, delicate green sprouts.",
};

export const corruptedBibleCase: { id: string; name: string; bible: any; bibleVersion: number } = {
  id: "corrupted",
  name: "Corrupted Adversarial Bible (Missing Beat 3)",
  bible: {
    facts: [{ id: "F1", text: "A broken story with missing beats." }],
    beats: [
      { chapterIndex: 1, text: "Beat 1 exists." },
      { chapterIndex: 2, text: "Beat 2 exists." },
      // Missing beat 3!
    ],
  },
  bibleVersion: 1,
};
