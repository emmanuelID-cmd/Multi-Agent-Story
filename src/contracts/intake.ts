import { z } from "zod";
import { inspectText } from "./input-policy";

export const intakeFields = [
  { id: "premise", label: "Premise / story idea", group: "Foundation" },
  { id: "genre", label: "Genre", group: "Foundation" },
  { id: "subgenre", label: "Subgenre", group: "Foundation" },
  { id: "audience", label: "Audience", group: "Foundation" },
  { id: "tone", label: "Tone / atmosphere", group: "Foundation" },
  { id: "characters", label: "Character names and roles", group: "People and world" },
  { id: "setting", label: "Settings / locations", group: "People and world" },
  { id: "lore", label: "Lore / world rules", group: "People and world" },
  { id: "timePeriod", label: "Time period", group: "People and world" },
  { id: "characterArcs", label: "Character growth, goals and relationships", group: "People and world" },
  { id: "beginning", label: "Beginning", group: "Story direction" },
  { id: "middle", label: "Middle", group: "Story direction" },
  { id: "ending", label: "Ending", group: "Story direction" },
  { id: "risingAction", label: "Rising action", group: "Story direction" },
  { id: "stakes", label: "Stakes / consequences", group: "Story direction" },
  { id: "climax", label: "Climax", group: "Story direction" },
  { id: "fallingAction", label: "Falling action / resolution", group: "Story direction" },
  { id: "pointOfView", label: "Point of view / tense", group: "Story direction" },
] as const;
export const intakeFieldSchema = z.enum(intakeFields.map(f => f.id));
export type IntakeField = z.infer<typeof intakeFieldSchema>;
export const intakeText = z.string().trim().min(1, "Write a story idea first.").max(12_000, "Keep the story idea within 12,000 characters.")
  .superRefine((value, ctx) => {
    if (inspectText(value, "creative", "rawText", "writer-intake").verdict === "REJECT")
      ctx.addIssue({ code: "custom", message: "Remove unexpected control characters before saving the idea." });
  });
const answer = z.string().trim().min(1).max(2_000);
export const intakeObservationSchema = z.strictObject({
  field: intakeFieldSchema, quote: answer, ambiguous: z.boolean(),
});
export const intakeSuggestionSchema = z.strictObject({
  field: intakeFieldSchema, question: z.string().min(1).max(300),
  reason: z.string().min(1).max(400), options: z.array(z.string().min(1).max(500)).min(1).max(3),
  dependsOn: intakeFieldSchema.nullable(),
});
export const intakeModelOutputSchema = z.strictObject({
  summary: z.string().min(1).max(700),
  observations: z.array(intakeObservationSchema).max(18),
  suggestions: z.array(intakeSuggestionSchema).max(8),
});
export const intakeAnalysisSchema = intakeModelOutputSchema.extend({
  id: z.uuid(), sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  model: z.string().max(100), promptVersion: z.literal("intake-v1"),
  missing: z.array(intakeFieldSchema).max(18),
  usage: z.object({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() }),
});
export type IntakeAnalysis = z.infer<typeof intakeAnalysisSchema>;
export const intakeDecisionSchema = z.discriminatedUnion("action", [
  z.strictObject({ field: intakeFieldSchema, action: z.literal("accept"), optionIndex: z.number().int().min(0).max(2) }),
  z.strictObject({ field: intakeFieldSchema, action: z.literal("custom"), value: answer }),
  z.strictObject({ field: intakeFieldSchema, action: z.literal("reject") }),
  z.strictObject({ field: intakeFieldSchema, action: z.literal("defer") }),
]);
export type IntakeDecision = z.infer<typeof intakeDecisionSchema>;
export const intakeScopeSchema = z.strictObject({
  genre: z.string().min(1).max(80),
  dimensions: z.array(z.strictObject({ field: intakeFieldSchema, value: answer })).min(1).max(18),
  providers: z.tuple([z.literal("nyt"), z.literal("gutendex")]),
});
export type IntakeScope = z.infer<typeof intakeScopeSchema>;
export const intakeRecordSchema = z.strictObject({
  version: z.literal(1), revision: z.number().int().nonnegative(), rawText: intakeText,
  status: z.enum(["draft", "analyzing", "analyzed", "confirmed"]),
  analysis: intakeAnalysisSchema.optional(), decisions: z.array(intakeDecisionSchema).max(18),
  operationId: z.uuid().optional(), startedAt: z.iso.datetime().optional(),
  confirmed: z.strictObject({ at: z.iso.datetime(), analysisId: z.uuid(), scope: intakeScopeSchema }).optional(),
});
export type IntakeRecord = z.infer<typeof intakeRecordSchema>;
export const intakeRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("save"), expectedRevision: z.number().int().nonnegative(), rawText: intakeText }),
  z.strictObject({ action: z.literal("analyze"), expectedRevision: z.number().int().nonnegative() }),
  z.strictObject({ action: z.literal("review"), expectedRevision: z.number().int().nonnegative(), analysisId: z.uuid(),
    decisions: z.array(intakeDecisionSchema).max(18) }),
  z.strictObject({ action: z.literal("confirm"), expectedRevision: z.number().int().nonnegative(), analysisId: z.uuid(),
    decisions: z.array(intakeDecisionSchema).max(18), confirmScope: z.literal(true) }),
]);
export type IntakeRequest = z.infer<typeof intakeRequestSchema>;
export const newIntakeRequestSchema = z.strictObject({ rawText: intakeText });

/** Preview only. The server repeats this calculation against its stored analysis. */
export function resolveIntake(analysis: IntakeAnalysis, decisions: IntakeDecision[]) {
  const values: Partial<Record<IntakeField, string>> = {};
  for (const item of analysis.observations) if (!item.ambiguous) values[item.field] = item.quote;
  const seen = new Set<IntakeField>();
  for (const decision of decisions) {
    if (seen.has(decision.field)) throw Error("Each detail needs one decision.");
    seen.add(decision.field);
    if (values[decision.field]) throw Error("Edit the original idea to change an already supplied detail.");
    const suggestion = analysis.suggestions.find(s => s.field === decision.field);
    if (decision.action === "custom") values[decision.field] = decision.value;
    if (decision.action === "accept") {
      if (!suggestion?.options[decision.optionIndex]) throw Error("Choose an available suggestion.");
      values[decision.field] = suggestion.options[decision.optionIndex];
    }
  }
  for (const suggestion of analysis.suggestions) {
    if (suggestion.dependsOn && values[suggestion.field] && !values[suggestion.dependsOn])
      throw Error("Answer the parent detail before its follow-up.");
  }
  for (const [field, value] of Object.entries(values)) {
    if (inspectText(value, field === "genre" ? "label" : "creative", field, "intake-decision").verdict !== "ACCEPT")
      throw Error("Review the detail's formatting before confirmation.");
  }
  return values;
}

export function scopeFromIntake(analysis: IntakeAnalysis, decisions: IntakeDecision[]): IntakeScope {
  const values = resolveIntake(analysis, decisions);
  return intakeScopeSchema.parse({ genre: values.genre ?? "", providers: ["nyt", "gutendex"],
    dimensions: intakeFields.filter(f => values[f.id]).map(f => ({ field: f.id, value: values[f.id] })) });
}

export function assertIntakeDecisionsReviewed(analysis: IntakeAnalysis, decisions: IntakeDecision[]) {
  const values = resolveIntake(analysis, decisions);
  for (const suggestion of analysis.suggestions) {
    if (suggestion.dependsOn && !values[suggestion.dependsOn]) continue;
    if (!decisions.some(d => d.field === suggestion.field))
      throw Error(`Review ${intakeFields.find(f => f.id === suggestion.field)?.label}: choose an option, write an answer, reject, or decide later.`);
  }
}
