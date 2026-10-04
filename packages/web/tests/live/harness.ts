/**
 * Devices for the live suite.
 *
 * A **device** is what the SPA is on one phone or one till: the real
 * composition root (`createServices`), the real `ApiClient` and `ApiStore`, and
 * the cookies that server set for it. Node's `fetch` keeps no cookies, so each
 * device gets a jar of its own (`dev/jarFetch.ts`), and the CSRF reader reads
 * the jar instead of `document.cookie`. Nothing below the services is replaced — every call is an
 * HTTP request the server answers, against the database `globalSetup` reset.
 *
 * Each device also gets its own `x-forwarded-for` address. The server trusts
 * the proxy header (it sits behind Cloudflare and nginx), and its rate limits
 * are per source address; without this every test would share one, and the
 * suite would rate-limit itself.
 */

import { randomBytes } from 'node:crypto';
import { inject } from 'vitest';
import type { StaffRole } from '@cafe/shared/domain/models';
import { createServices, type Services } from '../../src/services/Services';
import { CSRF_COOKIE } from '../../src/adapters/http/ApiClient';
import { cookieJarFetch } from '../../dev/jarFetch';
import type { Actor } from '../../src/services/types';

export interface Device {
  services: Services;
  /** Cookie name → value, as a browser would hold them for this device. */
  jar: Map<string, string>;
}

/** A fresh device with no cookies: a new phone, or a till nobody has signed in on. */
export async function device(): Promise<Device> {
  // Random rather than counted: each test file loads this module afresh, and a
  // counter would hand the next file the same addresses — and the same buckets.
  const address = `10.${[...randomBytes(3)].join('.')}`;
  const { fetch: jarFetch, jar } = cookieJarFetch({ 'x-forwarded-for': address });

  const services = await createServices({
    baseUrl: inject('apiBaseUrl'),
    fetch: jarFetch,
    readCsrfToken: () => jar.get(CSRF_COOKIE) ?? null,
  });
  return { services, jar };
}

/** A short random suffix, so tests sharing one database never collide. */
export function unique(): string {
  return randomBytes(4).toString('hex');
}

/** A device signed in as the bootstrap admin. */
export async function adminDevice(): Promise<Device & { actor: Actor }> {
  const admin = await device();
  const result = await admin.services.staff.login(inject('adminUsername'), inject('adminPassword'));
  if (!result.ok || !result.actor) throw new Error(`harness admin could not sign in: ${result.reason}`);
  return { ...admin, actor: result.actor };
}

export interface StaffLogin {
  username: string;
  password: string;
  id: string;
}

/** A new account of `role`, created by the bootstrap admin. Not signed in anywhere. */
export async function newAccount(role: StaffRole = 'staff'): Promise<StaffLogin> {
  const admin = await adminDevice();
  const username = `${role}-${unique()}`;
  const password = `pw-${unique()}-${unique()}`;
  const account = await admin.services.staff.create(username, password, role, `Test ${role}`);
  return { username, password, id: account.id };
}

/** A device signed in as a brand-new account of `role`. */
export async function signedIn(role: StaffRole = 'staff'): Promise<Device & { actor: Actor }> {
  const login = await newAccount(role);
  const till = await device();
  const result = await till.services.staff.login(login.username, login.password);
  if (!result.ok || !result.actor) throw new Error(`could not sign in as ${login.username}`);
  return { ...till, actor: result.actor };
}

/** A customer's phone with a freshly registered card — bound to it by `POST /customers`. */
export async function customerPhone() {
  const phone = await device();
  const email = `guest-${unique()}@example.test`;
  const result = await phone.services.customers.selfRegister({ displayName: 'Guest', email, consent: true });
  if (!result.ok || !result.customer) throw new Error('could not register a card');
  return { ...phone, customer: result.customer, email };
}

/**
 * The recovery code most recently mailed to `email`. The server sends it in the
 * background after answering, so this polls for a while before giving up.
 */
export async function recoveryCodeFor(email: string, after = 0): Promise<string> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${inject('mailboxUrl')}/messages`);
    const mails = (await response.json()) as { to: string[]; data: string }[];
    const mine = mails.filter((mail) => mail.to.includes(email)).slice(after);
    const code = mine
      .map((mail) => /recovery code is:\s*([A-Z0-9-]+)/i.exec(mail.data)?.[1])
      .filter((found): found is string => Boolean(found))
      .pop();
    if (code) return code;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('no recovery mail arrived');
}

/** How many mails have gone to `email` so far — pass to `recoveryCodeFor` as `after`. */
export async function mailCount(email: string): Promise<number> {
  const response = await fetch(`${inject('mailboxUrl')}/messages`);
  const mails = (await response.json()) as { to: string[] }[];
  return mails.filter((mail) => mail.to.includes(email)).length;
}
