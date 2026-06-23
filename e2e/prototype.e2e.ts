import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser } from 'puppeteer';
import { bodyText, freshSession, gotoApp, launchBrowser, tapLogo, waitForText } from './support';

let browser: Browser;
beforeAll(async () => {
  browser = await launchBrowser();
});
afterAll(async () => {
  await browser?.close();
});

describe('Logo gestures: prototype panel vs home', () => {
  it('tapping the RIGHT half of the logo opens the prototype tools panel', async () => {
    const { page, close } = await freshSession(browser);
    try {
      await gotoApp(page);
      await waitForText(page, /Every coffee counts/);
      await tapLogo(page, 'right');
      await page.waitForSelector('.proto', { timeout: 8000 });
      const t = await bodyText(page);
      expect(t).toMatch(/Prototype/i);
      expect(t).toMatch(/not shipped|demo controls/i);
    } finally {
      await close();
    }
  });

  it('tapping the LEFT half of the logo goes home (stays on Welcome for a fresh device)', async () => {
    const { page, close } = await freshSession(browser);
    try {
      await gotoApp(page, '#/register'); // navigate away first
      await waitForText(page, /Join the club/);
      await tapLogo(page, 'left');
      await waitForText(page, /Every coffee counts/);
      expect(page.url()).toMatch(/#\/welcome/);
    } finally {
      await close();
    }
  });
});
