import { test, expect } from "@playwright/test";

test("story link creation, copy link, invalid link rejection, and reopening the saved idea", async ({ page, browser }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Need a test account?" })).not.toBeVisible();
  await expect(page.getByLabel("Email")).not.toBeVisible();

  await page.getByPlaceholder("A sailor finds a signal from an island that vanished years ago").fill("Mara lighthouse rescue story.");
  await page.getByRole("button", { name: "Save story idea" }).click();

  await expect(page.getByRole("button", { name: "Copy link" })).toBeVisible({ timeout: 10_000 });
  await expect(page).toHaveURL(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  const workId = new URL(page.url()).pathname.slice(1);
  await expect(page.getByText(workId)).toBeVisible();
  await expect(page.getByLabel("Your story idea", { exact: true })).toHaveValue("Mara lighthouse rescue story.");

  const randomId = crypto.randomUUID();
  const randomRes = await page.request.get(`/api/projects/${randomId}`);
  expect(randomRes.status()).toBe(404);
  expect(await randomRes.json()).toEqual({ error: "Project unavailable." });

  const outsider = await browser.newContext();
  const outsiderPage = await outsider.newPage();
  await outsiderPage.goto(`/${randomId}`);
  await expect(outsiderPage.getByRole("heading", { name: "Story unavailable" })).toBeVisible();

  await outsiderPage.goto(`/${workId}`);
  await expect(outsiderPage.getByLabel("Your story idea", { exact: true })).toHaveValue("Mara lighthouse rescue story.");
  await expect(outsiderPage.getByRole("button", { name: "Copy link" })).toBeVisible();
  await outsider.close();
});
