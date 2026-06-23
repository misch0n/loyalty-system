/**
 * Shared Puppeteer helpers for the UI regression/validation suite.
 *
 * Each test gets an isolated browser context (fresh IndexedDB / storage), drives
 * the REAL built app served by `e2e/globalSetup.ts`, and asserts on the rendered
 * page. Helpers are intentionally small and purpose-built.
 */
import puppeteer, { type Browser, type BrowserContext, type Page } from 'puppeteer';

export const baseUrl = (): string =>
  process.env.E2E_URL ?? 'http://localhost:4317/loyalty-system/';

export async function launchBrowser(): Promise<Browser> {
  return puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
}

export interface Session {
  page: Page;
  context: BrowserContext;
  close: () => Promise<void>;
}

/** A fresh, isolated session (own storage) so tests never bleed into each other. */
export async function freshSession(browser: Browser): Promise<Session> {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 390, height: 820 });
  return { page, context, close: () => context.close() };
}

export async function gotoApp(page: Page, hash = ''): Promise<void> {
  await page.goto(baseUrl() + hash, { waitUntil: 'networkidle2', timeout: 30000 });
}

/** Wait until the visible body text matches `re`. */
export async function waitForText(page: Page, re: RegExp, timeout = 15000): Promise<void> {
  await page.waitForFunction(
    (src: string) => new RegExp(src, 'i').test(document.body.innerText),
    { timeout },
    re.source,
  );
}

export function bodyText(page: Page): Promise<string> {
  return page.evaluate(() => document.body.innerText);
}

/** Click the first <button>/<a> whose visible text contains `text`. */
export async function clickText(page: Page, text: string): Promise<void> {
  const clicked = await page.evaluate((needle: string) => {
    const els = Array.from(document.querySelectorAll('button, a')) as HTMLElement[];
    const el = els.find((e) => (e.innerText || '').trim().includes(needle));
    if (!el) return false;
    el.click();
    return true;
  }, text);
  if (!clicked) throw new Error(`no clickable element with text "${text}"`);
}

/** Tap the logo (a tap → home; the dev panel is a separate corner trigger). */
export async function tapLogo(page: Page): Promise<void> {
  const c = await page.$eval('.logo-gesture', (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.click(c.x, c.y);
}

/** Tap the hidden top-left developer-tools trigger (prototype only). */
export async function tapDevTrigger(page: Page): Promise<void> {
  await page.click('.dev-trigger');
}

/** Long-press the logo (≥600ms) → staff sign-in. */
export async function holdLogo(page: Page, ms = 800): Promise<void> {
  const c = await page.$eval('.logo-gesture', (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await new Promise((r) => setTimeout(r, ms));
  await page.mouse.up();
}

/** Fill the staff sign-in form (username + password) and submit. */
export async function signIn(page: Page, username: string, password: string): Promise<void> {
  await page.type('input[autocomplete="username"]', username);
  await page.type('input[autocomplete="current-password"]', password);
  await clickText(page, 'Sign in');
}

/** Tap PIN digits on the keypad (each key carries data-k) — used on unlock. */
export async function typePin(page: Page, digits: string): Promise<void> {
  for (const d of digits) {
    await page.click(`.key[data-k="${d}"]`);
    await new Promise((r) => setTimeout(r, 40));
  }
}
