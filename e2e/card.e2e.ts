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
  await page.click('.consent'); // grant consent (required)
  await clickText(page, 'Create my card');
  await waitForText(page, /for a free coffee/);
}

describe('Card view (the customer hub)', () => {
  it('registering lands on a card showing 10 cups, /10, a cream QR tile and a discreet menu', async () => {
    const { page, close } = await freshSession(browser);
    try {
      await registerToCard(page);
      expect(page.url()).toMatch(/#\/card\//);

      // ten stamps, none filled for a brand-new card
      expect(await page.$$eval('.stamp', (els) => els.length)).toBe(10);
      expect(await page.$$eval('.stamp.on', (els) => els.length)).toBe(0);

      const t = await bodyText(page);
      // counter is /10 (not /9) and the string is NOT concatenated ("coffee0")
      expect(t).toMatch(/0\s*\/\s*10/);
      expect(t).not.toMatch(/coffee0/);
      expect(t).toMatch(/10 more for a free coffee/);

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
