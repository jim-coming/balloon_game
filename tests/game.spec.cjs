const { test, expect } = require('@playwright/test');
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-04T06:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-04T06:00:01Z'));
  await page.addInitScript(() => { Math.random = () => .5; });
  await page.goto('/');
  await page.clock.runFor(50);
});
test('all modes and difficulties work without overflow or browser errors', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  for (const [difficulty, seconds] of [['easy', 40], ['normal', 30], ['hard', 25], ['insane', 20]]) {
    await page.locator(`[data-difficulty="${difficulty}"]`).click();
    await expect(page.locator('#time-value')).toHaveText(String(seconds));
    await expect(page.locator(`[data-difficulty="${difficulty}"]`)).toHaveAttribute('aria-pressed', 'true');
  }
  await page.locator('[data-mode="arcade"]').click();
  await expect(page.locator('#mode-legend')).toContainText('金球');
  await page.locator('[data-mode="challenge"]').click();
  await expect(page.locator('#level-panel')).toBeVisible();
  await expect(page.locator('[data-level="1"]')).toBeDisabled();
  await expect(page.locator('#start-button')).toContainText('第 1 關');
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  expect(fits).toBe(true); expect(errors).toEqual([]);
});
test('mouse or touch scoring, pause/resume, results, replay and saved records', async ({ page, isMobile }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.locator('#start-button').click(); await page.clock.runFor(100);
  const balloon = page.locator('.balloon').first();
  if (isMobile) await balloon.tap(); else await balloon.click();
  await expect(page.locator('#score-value')).not.toHaveText('0');
  await page.locator('#pause-button').click();
  const remaining = await page.locator('#time-value').textContent();
  await page.clock.fastForward(10000);
  await expect(page.locator('#time-value')).toHaveText(remaining);
  await expect(page.locator('#pause-screen')).toBeVisible();
  await page.locator('#resume-button').click(); await page.clock.runFor(100);
  await page.clock.fastForward(35000);
  await expect(page.locator('#result-screen')).toBeVisible();
  await expect(page.locator('#result-hits')).toHaveText('1');
  await expect(page.locator('#result-accuracy')).toHaveText('100%');
  await expect(page.locator('#new-record')).toBeVisible();
  const resultScore = await page.locator('#result-score').textContent();
  await page.locator('#replay-button').click();
  await expect(page.locator('#stage')).toHaveAttribute('data-state', 'playing');
  await expect(page.locator('#score-value')).toHaveText('0');
  await page.reload(); await page.clock.runFor(100);
  await expect(page.locator('#best-score')).toContainText(resultScore);
  expect(errors).toEqual([]);
});
test('first mission can be completed, unlocks the next stage, and persists', async ({ page }) => {
  await page.locator('[data-mode="challenge"]').click();
  await page.locator('#start-button').click(); await page.clock.runFor(100);
  for (let i = 0; i < 8; i++) {
    await page.locator('.balloon:not(.bomb)').first().click();
    if (i < 7) await page.clock.runFor(1450);
  }
  await page.clock.fastForward(45000);
  await expect(page.locator('#result-title')).toContainText('任務完成');
  await expect(page.locator('#next-level-button')).toBeVisible();
  await page.locator('#next-level-button').click();
  await expect(page.locator('#round-status')).toContainText('第 2 關');
  await page.reload(); await page.clock.runFor(100);
  await expect(page.locator('[data-level="1"]')).toBeEnabled();
  await expect(page.locator('[data-level="1"]')).toHaveAttribute('aria-pressed', 'true');
});
test('keyboard controls and hiding the document pause the round', async ({ page }) => {
  await page.locator('#start-button').click(); await page.clock.runFor(100);
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Space');
  await expect(page.locator('#aim')).toBeVisible();
  await expect(page.locator('.bullet')).toHaveCount(1);
  await page.keyboard.press('p'); await expect(page.locator('#pause-screen')).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.locator('#stage')).toHaveAttribute('data-state', 'playing');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.locator('#pause-screen')).toBeVisible();
  await expect(page.locator('#pause-description')).toContainText('自動暫停');
});
test('blocked storage does not prevent play', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get: () => { throw new Error('blocked'); } });
  });
  await page.reload(); await page.clock.runFor(100);
  await expect(page.locator('#storage-note')).toContainText('本次');
  await page.locator('#start-button').click();
  await expect(page.locator('#stage')).toHaveAttribute('data-state', 'playing');
});
test('mode records and the mute preference survive reload independently', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('balloon-club-v2', JSON.stringify({
    mode: 'classic', difficulty: 'normal', sound: true,
    best: { 'classic:normal': 123, 'classic:hard': 88, 'arcade:hard': 77 },
  })));
  await page.reload(); await page.clock.runFor(50);
  await expect(page.locator('#best-score')).toContainText('123');
  await page.locator('[data-difficulty="hard"]').click();
  await expect(page.locator('#best-score')).toContainText('88');
  await page.locator('[data-mode="arcade"]').click();
  await expect(page.locator('#best-score')).toContainText('77');
  await page.locator('#sound-button').click();
  await page.reload(); await page.clock.runFor(50);
  await expect(page.locator('#sound-button')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-mode="arcade"]')).toHaveAttribute('aria-pressed', 'true');
});
test('malformed saved preferences fall back safely', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('balloon-club-v2', '{bad json'));
  await page.reload(); await page.clock.runFor(50);
  await expect(page.locator('[data-mode="classic"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#best-score')).toContainText('0');
  await page.locator('#start-button').click();
  await expect(page.locator('#stage')).toHaveAttribute('data-state', 'playing');
});
