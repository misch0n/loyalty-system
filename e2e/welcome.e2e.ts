import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser } from 'puppeteer';
import { bodyText, clickText, freshSession, gotoApp, launchBrowser, waitForText } from './support';

let browser: Browser;
beforeAll(async () => {
  browser = await launchBrowser();
});
afterAll(async () => {
  await browser?.close();
});

describe('Welcome (unrecognized visitor)', () => {
  it('a fresh device resolves to the forest hero with Find us below the fold', async () => {
    const { page, close } = await freshSession(browser);
    try {
      await gotoApp(page);
      await waitForText(page, /Every coffee counts/);
      expect(page.url()).toMatch(/#\/welcome/);
      // forest hero + the cup+sunburst lockup wordmark
      expect(await page.$('.bg-forest .lockup .word')).not.toBeNull();
      const t = await bodyText(page);
      expect(t).toMatch(/The tenth is ours to give/);
      expect(t).toMatch(/Find us/i);
    } finally {
      await close();
    }
  });

  it('"Create your card" routes to Register', async () => {
    const { page, close } = await freshSession(browser);
    try {
      await gotoApp(page);
      await waitForText(page, /Every coffee counts/);
      await clickText(page, 'Create your card');
      await waitForText(page, /Join the club/);
      expect(page.url()).toMatch(/#\/register/);
    } finally {
      await close();
    }
  });

  it('"I already have one" routes to Lost card', async () => {
    const { page, close } = await freshSession(browser);
    try {
      await gotoApp(page);
      await waitForText(page, /Every coffee counts/);
      await clickText(page, 'I already have one');
      await waitForText(page, /Lost your card/);
      expect(page.url()).toMatch(/#\/lost/);
    } finally {
      await close();
    }
  });
});
