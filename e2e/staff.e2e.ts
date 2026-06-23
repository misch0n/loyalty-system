import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser } from 'puppeteer';
import {
  bodyText,
  freshSession,
  gotoApp,
  holdLogo,
  launchBrowser,
  signIn,
  waitForText,
} from './support';

let browser: Browser;
beforeAll(async () => {
  browser = await launchBrowser();
});
afterAll(async () => {
  await browser?.close();
});

describe('Staff sign-in (username + password)', () => {
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

  it('wrong credentials show an error and the form stays usable', async () => {
    const { page, close } = await freshSession(browser);
    try {
      await gotoApp(page, '#/login');
      await waitForText(page, /Staff sign-in/);
      await signIn(page, 'staff', 'wrong');
      await waitForText(page, /wrong|match/i);
      // still on the sign-in screen with the form present
      expect(await page.$('input[autocomplete="username"]')).not.toBeNull();
    } finally {
      await close();
    }
  });

  it('correct staff credentials sign in to the counter panel', async () => {
    const { page, close } = await freshSession(browser);
    try {
      await gotoApp(page, '#/login');
      await waitForText(page, /Staff sign-in/);
      await signIn(page, 'staff', 'staff'); // seed staff account
      await waitForText(page, /On shift|Scan a customer/);
      expect(page.url()).toMatch(/#\/staff$/);
      expect(await bodyText(page)).toMatch(/Scan a customer/);
    } finally {
      await close();
    }
  });
});
