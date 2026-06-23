import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser } from 'puppeteer';
import {
  bodyText,
  freshSession,
  gotoApp,
  holdLogo,
  launchBrowser,
  typePin,
  waitForText,
} from './support';

let browser: Browser;
beforeAll(async () => {
  browser = await launchBrowser();
});
afterAll(async () => {
  await browser?.close();
});

describe('Staff sign-in (PIN)', () => {
  it('long-pressing the logo opens staff sign-in', async () => {
    const { page, close } = await freshSession(browser);
    try {
      await gotoApp(page);
      await waitForText(page, /Every coffee counts/);
      await holdLogo(page);
      await waitForText(page, /Staff sign-in/);
      expect(page.url()).toMatch(/#\/login/);
    } finally {
      await close();
    }
  });

  it('a wrong PIN shows an error and the pad stays usable (no freeze)', async () => {
    const { page, close } = await freshSession(browser);
    try {
      await gotoApp(page, '#/login');
      await waitForText(page, /Staff sign-in/);
      await typePin(page, '9999');
      await waitForText(page, /didn.t match/i);
      // the keypad is not stuck disabled
      const disabled = await page.$eval('.key[data-k="1"]', (el) => (el as HTMLButtonElement).disabled);
      expect(disabled).toBe(false);
      // and the dots reset to empty
      expect(await page.$$eval('.pin-dots i.on', (els) => els.length)).toBe(0);
    } finally {
      await close();
    }
  });

  it('the correct PIN signs in to the staff panel', async () => {
    const { page, close } = await freshSession(browser);
    try {
      await gotoApp(page, '#/login');
      await waitForText(page, /Staff sign-in/);
      await typePin(page, '1234'); // seed staff PIN
      await waitForText(page, /On shift|Scan a customer/);
      expect(page.url()).toMatch(/#\/staff$/);
      expect(await bodyText(page)).toMatch(/Scan a customer/);
    } finally {
      await close();
    }
  });
});
