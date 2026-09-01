import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'puppeteer';
import {
  bodyText,
  clickText,
  freshSession,
  gotoApp,
  launchBrowser,
  waitForText,
} from './support';

let browser: Browser;
beforeAll(async () => {
  browser = await launchBrowser();
});
afterAll(async () => {
  await browser?.close();
});

/** Register a token-only card and land on the card view. */
async function registerToCard(page: Page): Promise<void> {
  await gotoApp(page, '#/register');
  await waitForText(page, /Join the club/);
  // `.consent` is the row wrapper; `.consent-box` is the actual checkbox control.
  await page.click('.consent-box'); // grant consent (required)
  await clickText(page, 'Create my card');
  await waitForText(page, /for a free coffee/);
}

describe('Card view (the customer hub)', () => {
  it('registering lands on a card showing 10 cups with the free one pre-stamped', async () => {
    const { page, close } = await freshSession(browser);
    try {
      await registerToCard(page);
      expect(page.url()).toMatch(/#\/card\//);

      // The card is a fixed 10-cup grid: 9 earnable cups plus the FREE reward
      // cup, which is pre-stamped as the prize. A brand-new card has earned
      // nothing, so exactly one cup — the free one — is lit.
      expect(await page.$$eval('.stamp', (els) => els.length)).toBe(10);
      expect(await page.$$eval('.stamp.on', (els) => els.length)).toBe(1);
      expect(await page.$$eval('.stamp.on.free', (els) => els.length)).toBe(1);

      const t = await bodyText(page);
      // Counter reflects the DISPLAYED cups (1 of 10, the free one), and the
      // string is NOT concatenated ("coffee1").
      expect(t).toMatch(/1\s*\/\s*10/);
      expect(t).not.toMatch(/coffee1/);
      // Nine purchases earn the reward.
      expect(t).toMatch(/9 more for a free coffee/);

      // QR tile is CREAM (#F8F3E8), not espresso brown
      const bg = await page.$eval('.qrwrap', (el) => getComputedStyle(el).backgroundColor);
      expect(bg).toBe('rgb(248, 243, 232)');

      // the "⋯" is a discreet small corner control, not a big floating box
      const dots = await page.$('.dots-btn');
      expect(dots).not.toBeNull();
      const w = await page.$eval('.dots-btn', (el) => el.getBoundingClientRect().width);
      expect(w).toBeLessThan(48);
    } finally {
      await close();
    }
  });

  it('tapping the QR opens the enlarged overlay; the ⋯ opens the card menu', async () => {
    const { page, close } = await freshSession(browser);
    try {
      await registerToCard(page);

      // tap the QR tile → enlarged overlay
      await page.click('.qrwrap');
      await page.waitForSelector('.qr-enlarge', { timeout: 8000 });
      // close it (Escape)
      await page.keyboard.press('Escape');

      // open the card menu
      await page.click('.dots-btn');
      await page.waitForSelector('.sheet', { timeout: 8000 });
      expect(await bodyText(page)).toMatch(/Delete my card/);
    } finally {
      await close();
    }
  });
});
