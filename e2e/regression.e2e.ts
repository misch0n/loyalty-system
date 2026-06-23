/**
 * Regression guards for the specific bugs the reference bundle called out, so
 * they can't silently come back.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser } from 'puppeteer';
import { freshSession, gotoApp, launchBrowser, waitForText } from './support';

let browser: Browser;
beforeAll(async () => {
  browser = await launchBrowser();
});
afterAll(async () => {
  await browser?.close();
});

describe('Reference bug-list regressions', () => {
  it('no global "Staff sign-in" subtitle is visibly rendered on Welcome', async () => {
    const { page, close } = await freshSession(browser);
    try {
      await gotoApp(page);
      await waitForText(page, /Every coffee counts/);
      // The only "Staff sign-in" element is the visually-hidden keyboard link.
      const visible = await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll('*')) as HTMLElement[];
        return els
          .filter((e) => (e.childElementCount === 0) && /^staff sign-in$/i.test((e.textContent || '').trim()))
          .some((e) => {
            const r = e.getBoundingClientRect();
            return r.width > 2 && r.height > 2; // sr-only collapses to 1px
          });
      });
      expect(visible).toBe(false);
    } finally {
      await close();
    }
  });

  it('the logo is the cup+sunburst mark (an SVG with many rays), not a generic glyph', async () => {
    const { page, close } = await freshSession(browser);
    try {
      await gotoApp(page);
      await waitForText(page, /Every coffee counts/);
      const rays = await page.$$eval('.lockup .mark line', (els) => els.length);
      expect(rays).toBeGreaterThanOrEqual(20); // the sunburst draws 30 rays
    } finally {
      await close();
    }
  });

  it('the screen has ~24px horizontal gutters (content does not bleed to the edge)', async () => {
    const { page, close } = await freshSession(browser);
    try {
      await gotoApp(page, '#/register');
      await waitForText(page, /Join the club/);
      const pad = await page.$eval('.screen-pad', (el) => getComputedStyle(el).paddingLeft);
      expect(pad).toBe('24px');
    } finally {
      await close();
    }
  });
});
