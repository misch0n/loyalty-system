import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser } from 'puppeteer';
import {
  bodyText,
  freshSession,
  gotoApp,
  launchBrowser,
  tapDevTrigger,
  tapLogo,
  waitForText,
} from './support';

let browser: Browser;
beforeAll(async () => {
  browser = await launchBrowser();
});
afterAll(async () => {
  await browser?.close();
});

describe('Dev trigger vs logo home', () => {
  it('tapping the hidden top-left dev trigger opens the developer tools panel', async () => {
    const { page, close } = await freshSession(browser);
    try {
      await gotoApp(page);
      await waitForText(page, /Every coffee counts/);
      await tapDevTrigger(page);
      await page.waitForSelector('.proto', { timeout: 8000 });
      const t = await bodyText(page);
      expect(t).toMatch(/Prototype/i);
      expect(t).toMatch(/not shipped|developer tools/i);
      // Stripped to the three controls — no demo-card / jump-to-view selectors.
      expect(await page.$('select')).toBeNull();
      expect(t).toMatch(/Scan to pair/i);
      expect(t).toMatch(/Reset/i);
    } finally {
      await close();
    }
  });

  it('tapping the logo goes home (stays on Welcome for a fresh device)', async () => {
    const { page, close } = await freshSession(browser);
    try {
      await gotoApp(page, '#/register'); // navigate away first
      await waitForText(page, /Join the club/);
      await tapLogo(page);
      await waitForText(page, /Every coffee counts/);
      expect(page.url()).toMatch(/#\/welcome/);
    } finally {
      await close();
    }
  });
});
