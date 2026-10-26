import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';

const deckUrl = pathToFileURL(resolve('docs/artifacts/story-builder-visual-v3.html')).href;
const shots = resolve('.tools/visual-deck');

test('all ten slides navigate and the architecture stages are links', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(deckUrl);
  await expect(page.locator('.slide.active')).toHaveAttribute('data-slide', '1');
  for (let n = 2; n <= 10; n++) {
    await page.getByRole('button', { name: 'Next slide' }).click();
    await expect(page.locator('.slide.active')).toHaveAttribute('data-slide', String(n));
    await expect(page.locator('#slide-counter')).toHaveText(`${n} / 10`);
    if (n === 3) {
      await expect(page.locator('.detail-chip')).toHaveCount(18);
      await expect(page.locator('.detail-cloud')).toContainText('Character growth');
      await expect(page.locator('.detail-cloud')).toContainText('POV / tense');
    }
    if (n === 5) {
      await expect(page.locator('.bible-option small')).toHaveText([
        'Facts · beats · chapters', 'Facts · beats · chapters', 'Facts · beats · chapters',
      ]);
    }
  }
  await page.keyboard.press('Home');
  await expect(page.locator('.slide.active')).toHaveAttribute('data-slide', '1');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.slide.active')).toHaveAttribute('data-slide', '2');
  await page.locator('#node-reader').click();
  await expect(page.locator('.slide.active')).toHaveAttribute('data-slide', '7');
  expect(errors).toEqual([]);
});

test('moving light pauses, resumes, replays and steps on a real SVG path', async ({ page }) => {
  await page.goto(deckUrl + '#2');
  const light = page.locator('#deck-light');
  await expect(light).toHaveAttribute('visibility', 'visible');
  const at = async () => light.evaluate(el => [el.getAttribute('cx'), el.getAttribute('cy')].join(','));
  await page.getByRole('button', { name: 'Pause animation' }).click();
  const paused = await at();
  await page.waitForTimeout(180);
  expect(await at()).toBe(paused);
  await page.getByRole('button', { name: 'Play animation', exact: true }).click();
  await page.waitForTimeout(180);
  expect(await at()).not.toBe(paused);
  await page.getByRole('button', { name: 'Pause animation' }).click();
  await page.getByRole('button', { name: 'Replay animation' }).click();
  const restarted = await at();
  expect(Number(restarted.split(',')[0])).toBeCloseTo(260, 0);
  await page.getByRole('button', { name: 'Step animation' }).click();
  const stepped = (await at()).split(',').map(Number);
  expect(stepped[0]).toBeCloseTo(510, 0);
  expect(stepped[1]).toBeCloseTo(154, 0);
  await expect(page.getByRole('button', { name: 'Play animation', exact: true })).toBeVisible();
  for (let n = 0; n < 14; n++) await page.getByRole('button', { name: 'Step animation' }).click();
  const wrapped = (await at()).split(',').map(Number);
  expect(wrapped[0]).toBeCloseTo(260, 0);
  expect(wrapped[1]).toBeCloseTo(154, 0);
  await expect(page.locator('#stage-status')).toContainText('loop 2');
});

test('reduced motion starts with animation paused', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(deckUrl + '#2');
  await expect(page.getByRole('button', { name: 'Play animation', exact: true })).toBeVisible();
  const cx = await page.locator('#deck-light').getAttribute('cx');
  await page.waitForTimeout(160);
  await expect(page.locator('#deck-light')).toHaveAttribute('cx', cx!);
});

test('review paths switch without claiming a live decision', async ({ page }) => {
  await page.goto(deckUrl + '#9');
  await page.getByRole('button', { name: 'Revise' }).click();
  await expect(page.locator('.revise-outcome')).toHaveClass(/active/);
  await expect(page.locator('.accept-outcome')).not.toHaveClass(/active/);
  await expect(page.locator('.slide.active')).toContainText('up to 2 rounds');
  await page.getByRole('button', { name: 'Accept' }).click();
  await expect(page.locator('.accept-outcome')).toHaveClass(/active/);
  await expect(page.locator('.utility-label')).toContainText('not live activity');
});

test('visual captures for desktop and mobile review', async ({ page }) => {
  await mkdir(shots, { recursive: true });
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(deckUrl);
  for (let n = 1; n <= 10; n++) {
    await page.goto(deckUrl + '#' + n);
    await page.screenshot({ path: resolve(shots, `slide-${String(n).padStart(2,'0')}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const n of [2, 3, 7, 9, 10]) {
    await page.goto(deckUrl + '#' + n);
    await page.screenshot({ path: resolve(shots, `mobile-${String(n).padStart(2,'0')}.png`), fullPage: true });
  }
});
