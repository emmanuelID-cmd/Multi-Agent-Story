import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

const projectId = "11111111-1111-4111-8111-111111111111";
const analysisId = "22222222-2222-4222-8222-222222222222";
const idea = "A sailor hears a signal from an island that vanished years ago.";

test("sparse story idea, sourced analysis, choices, confirmation, and edit invalidation", async ({ page }) => {
  let intake: any = null;
  let project: any = null;
  let confirmedBody: any = null;
  let metadataBody: any = null;
  let analyzeCalls = 0;
  const analysis = {
    id: analysisId, sourceHash: "a".repeat(64), model: "claude-test", promptVersion: "intake-v1",
    summary: "A sailor follows a mysterious signal.",
    observations: [{ field: "premise", quote: "A sailor hears a signal from an island that vanished years ago.", ambiguous: false }],
    suggestions: [
      { field: "genre", question: "What genre fits?", reason: "The idea has a mystery.", options: ["Mystery", "Adventure"], dependsOn: null },
      { field: "tone", question: "What atmosphere fits?", reason: "The signal could feel eerie.", options: ["Eerie"], dependsOn: null },
      { field: "characterArcs", question: "How should the sailor change?", reason: "A character arc can help.", options: ["Learns to trust"], dependsOn: "characters" },
    ],
    missing: ["genre", "tone", "characters", "characterArcs"], usage: { inputTokens: 100, outputTokens: 80 },
  };
  await page.route("**/api/projects", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: project ? [project] : [] });
    const body = route.request().postDataJSON();
    expect(body).toEqual({ rawText: idea });
    intake = { version: 1, revision: 0, rawText: idea, status: "draft", decisions: [] };
    project = { id: projectId, version: 1, brief: { premise: idea, genre: "", audience: "", tone: "", desiredEnding: "", intake } };
    return route.fulfill({ status: 201, json: project });
  });
  await page.route(`**/api/projects/${projectId}`, route => route.fulfill({ json: {
    project, bible: null, run: null, pending: [], tasks: [], chapters: [], critique: null, evidence: [], acceptedManuscript: null,
  } }));
  await page.route(`**/api/projects/${projectId}/intake`, route => {
    const body = route.request().postDataJSON();
    expect(body.expectedRevision).toBe(intake.revision);
    if (body.action === "analyze") {
      analyzeCalls++;
      if (analyzeCalls === 2) {
        intake = { ...intake, revision: intake.revision + 1, status: "draft", analysis: undefined, decisions: [] };
        project = { ...project, brief: { ...project.brief, intake } };
        return route.fulfill({ status: 503, json: { error: "Claude unavailable. Retry analysis." } });
      }
      intake = { ...intake, revision: intake.revision + 1, status: "analyzed", analysis, decisions: [] };
    }
    else if (body.action === "save") intake = { ...intake, revision: intake.revision + 1, status: "draft", rawText: body.rawText, analysis: undefined, confirmed: undefined, decisions: [] };
    else if (body.action === "review") intake = { ...intake, revision: intake.revision + 1, decisions: body.decisions };
    else if (body.action === "confirm") {
      confirmedBody = body;
      intake = { ...intake, revision: intake.revision + 1, status: "confirmed", decisions: body.decisions, confirmed: {
        at: "2026-10-26T12:00:00.000Z", analysisId, scope: { genre: "Mystery", dimensions: [{ field: "premise", value: idea }, { field: "genre", value: "Mystery" }, { field: "characters", value: "Mara, a sailor" }], providers: ["nyt", "gutendex"] },
      } };
    }
    project = { ...project, brief: { ...project.brief, intake } };
    return route.fulfill({ json: intake });
  });
  await page.route("**/api/research/benchmarks", route => {
    metadataBody = route.request().postDataJSON();
    return route.fulfill({ json: { projectId, evidence: [
      { provider: "nyt", status: "not_requested", reasonCode: "LIVE_READS_DISABLED", records: [] },
      { provider: "gutendex", status: "not_requested", reasonCode: "LIVE_READS_DISABLED", records: [] },
    ] } });
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Start with your story idea" })).toBeVisible();
  await expect(page.getByText("People and world", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Your story idea" }).fill(idea);
  await page.getByRole("button", { name: "Save story idea" }).click();
  await expect(page.getByRole("button", { name: "Analyze with Claude" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Propose candidate bibles" })).toBeDisabled();
  await page.getByRole("button", { name: "Analyze with Claude" }).click();
  await expect(page.getByRole("heading", { name: "What Claude found in your text" })).toBeVisible();
  await expect(page.getByText("Quoted from your idea.")).toBeVisible();
  await expect(page.getByText("Answer Character names and roles first")).toBeVisible();
  await page.getByRole("textbox", { name: "Your story idea" }).fill(`${idea} The tide is rising.`);
  await expect(page.getByRole("heading", { name: "What Claude found in your text" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Analyze with Claude" })).toBeDisabled();
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByRole("button", { name: "Analyze with Claude" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Claude unavailable" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Your story idea" })).toHaveValue(`${idea} The tide is rising.`);
  await page.getByRole("button", { name: "Analyze with Claude" }).click();
  await page.getByLabel("Mystery", { exact: true }).check();
  await page.getByRole("group", { name: /Tone \/ atmosphere/ }).getByRole("button", { name: "Reject suggestions" }).click();
  await page.getByRole("button", { name: "Save review progress" }).click();
  await expect(page.getByText("Review choices are saved.", { exact: true })).toBeVisible();
  await page.goto(`/${projectId}`);
  await expect(page.getByLabel("Mystery", { exact: true })).toBeChecked();
  await expect(page.getByRole("group", { name: /Tone \/ atmosphere/ }).getByRole("button", { name: "Reject suggestions" })).toHaveAttribute("aria-pressed", "true");
  await page.getByText("Add optional detail: Character names and roles").click();
  await page.getByRole("group", { name: /Character names and roles/ }).getByLabel("Your answer").fill("Mara, a sailor");
  await page.getByRole("group", { name: /Character names and roles/ }).getByRole("button", { name: "Use my answer" }).click();
  await expect(page.getByRole("group", { name: /Character growth/ })).toBeEnabled();
  await page.getByLabel("I confirm this brief and research scope.").check();
  await page.getByRole("button", { name: "Confirm brief and research scope" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Review Character growth" })).toBeVisible();
  await page.getByRole("group", { name: /Character growth/ }).getByRole("button", { name: "Decide later" }).click();
  await page.getByRole("group", { name: /Character names and roles/ }).getByLabel("Your answer").fill("Nara, a sailor");
  await expect(page.getByRole("group", { name: /Character growth/ }).getByText("Current choice:")).toHaveCount(0);
  await page.getByRole("group", { name: /Character names and roles/ }).getByLabel("Your answer").fill("Mara, a sailor");
  await page.getByRole("group", { name: /Character names and roles/ }).getByRole("button", { name: "Use my answer" }).click();
  await page.getByRole("group", { name: /Character growth/ }).getByRole("button", { name: "Decide later" }).click();
  await page.getByLabel("I confirm this brief and research scope.").check();
  await page.getByRole("button", { name: "Confirm brief and research scope" }).click();
  await expect(page.getByRole("heading", { name: "Confirmed research scope" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Propose candidate bibles" })).toBeDisabled();
  mkdirSync(".tools/visuals", { recursive: true });
  await page.screenshot({ path: ".tools/visuals/intake-desktop.png", fullPage: true });
  expect(confirmedBody.analysisId).toBe(analysisId);
  expect(confirmedBody.decisions).toEqual(expect.arrayContaining([
    { field: "genre", action: "accept", optionIndex: 0 },
    { field: "tone", action: "reject" },
    { field: "characters", action: "custom", value: "Mara, a sailor" },
  ]));
  await page.getByRole("button", { name: "Request book metadata" }).click();
  expect(metadataBody).toEqual({ projectId, genre: "Mystery", providers: ["nyt", "gutendex"] });
  await expect(page.getByText(/NYT Books: not requested/)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".tools/visuals/intake-mobile.png", fullPage: true });
  await page.getByRole("textbox", { name: "Your story idea" }).fill(`${idea} New current version.`);
  await expect(page.getByText(/NYT Books: not requested/)).toHaveCount(0);
  await page.getByRole("button", { name: "Save changes" }).click();
  intake = { ...intake, revision: intake.revision + 1, status: "analyzing", startedAt: "2020-01-01T00:00:00.000Z" };
  project = { ...project, brief: { ...project.brief, intake } };
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry analysis" })).toBeEnabled();
  expect(analyzeCalls).toBe(3);
  await page.getByRole("button", { name: "Retry analysis" }).click();
  expect(analyzeCalls).toBe(4);
});
