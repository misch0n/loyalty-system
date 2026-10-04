/**
 * Dev seed — a few cards and a barista on a running API, for driving the SPA by hand.
 *
 * What the deleted `demoSeed` gave the IndexedDB prototype, rebuilt for the
 * server (register P6, kept until release). It goes **through the API**, with
 * the same `createServices` the SPA uses — no SQL, no server internals — so a
 * seeded card is exactly what a real registration and a real counter commit
 * leave behind, audit rows and mail included.
 *
 *   npm run seed:dev -w @cafe/web
 *
 * Environment:
 *   SEED_API_URL         the API, unproxied            (default http://127.0.0.1:3000)
 *   SEED_APP_URL         the SPA, for the card links   (default http://localhost:5173)
 *   SEED_ADMIN_USERNAME  an existing admin             (required)
 *   SEED_ADMIN_PASSWORD  its password                  (required)
 *
 * Safe to run twice: an account or a card that already exists is reused, not
 * duplicated, and only a card that is new gets its points.
 *
 * It prints the fixtures' names and card links: invented demo data, in a
 * dev-only tool. Nothing else may log a customer's details (`CLAUDE.md`).
 */

import { randomUUID } from 'node:crypto';
import type { Customer } from '@cafe/shared/domain/models';
import { createServices, type Services } from '../src/services/Services';
import { CSRF_COOKIE } from '../src/adapters/http/ApiClient';
import { isApiError } from '../src/services/errors';
import { cookieJarFetch } from './jarFetch';

const API_URL = process.env.SEED_API_URL ?? 'http://127.0.0.1:3000';
const APP_URL = (process.env.SEED_APP_URL ?? 'http://localhost:5173').replace(/\/+$/, '');
const ADMIN_USERNAME = process.env.SEED_ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;

const BARISTA = { username: 'barista', password: 'barista-dev-password', name: 'Barista' };

/** The cards, and how far along each one is: points first, then rewards to mint. */
const CARDS = [
  { displayName: 'Maria Demo', email: 'maria@example.test', commits: [2, 2] },
  { displayName: 'Tom Demo', email: 'tom@example.test', commits: 'one reward' as const },
  { displayName: 'Ana Demo', email: 'ana@example.test', commits: [] },
];

async function device(): Promise<Services> {
  const { fetch, jar } = cookieJarFetch();
  return createServices({ baseUrl: API_URL, fetch, readCsrfToken: () => jar.get(CSRF_COOKIE) ?? null });
}

async function ensureBarista(admin: Services): Promise<void> {
  try {
    await admin.staff.create(BARISTA.username, BARISTA.password, 'staff', BARISTA.name);
    console.log(`  + staff account ${BARISTA.username} / ${BARISTA.password}`);
  } catch (err) {
    if (err instanceof Error && err.message === 'That username is already taken.') {
      console.log(`  = staff account ${BARISTA.username} already exists`);
      return;
    }
    throw err;
  }
}

/** Registers the card from a fresh "phone", or finds the one that already has the address. */
async function ensureCard(
  admin: Services,
  card: (typeof CARDS)[number],
): Promise<{ customer: Customer; created: boolean }> {
  const phone = await device();
  try {
    const result = await phone.customers.selfRegister({ ...card, consent: true });
    if (!result.ok || !result.customer) throw new Error(`could not register ${card.displayName}`);
    return { customer: result.customer, created: true };
  } catch (err) {
    if (!isApiError(err) || err.failure.kind !== 'email_in_use') throw err;
    const [existing] = await admin.customers.find(card.email);
    if (!existing) throw new Error(`${card.email} is in use but not found`);
    return { customer: existing, created: false };
  }
}

async function main(): Promise<void> {
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    console.error('Set SEED_ADMIN_USERNAME and SEED_ADMIN_PASSWORD to an existing admin account.');
    process.exit(2);
  }

  const admin = await device();
  const signedIn = await admin.staff.login(ADMIN_USERNAME, ADMIN_PASSWORD);
  if (!signedIn.ok || !signedIn.actor) {
    console.error(`Could not sign in as ${ADMIN_USERNAME}: ${signedIn.reason}`);
    process.exit(1);
  }
  const actor = signedIn.actor;
  const config = await admin.config.get();
  console.log(`Seeding ${API_URL} (a reward is ${config.pointsPerReward} points)`);

  await ensureBarista(admin);

  for (const card of CARDS) {
    const { customer, created } = await ensureCard(admin, card);
    if (created) {
      const commits =
        card.commits === 'one reward'
          ? splitIntoCommits(config.pointsPerReward, config.maxPointsPerTransaction)
          : card.commits;
      for (const pointsDelta of commits) {
        const result = await admin.loyalty.commit(actor, {
          customerId: customer.id,
          pointsDelta,
          redeemRewardIds: [],
          idempotencyKey: randomUUID(),
          source: 'a',
        });
        if (!result.ok) throw new Error(`commit refused for ${card.displayName}: ${result.error}`);
      }
    }
    const state = await admin.loyalty.getState(customer.id);
    console.log(
      `  ${created ? '+' : '='} ${card.displayName.padEnd(10)} ${state.balance} pts, ` +
        `${state.rewards?.length ?? 0} reward(s)  ${APP_URL}/#/card/${customer.token}`,
    );
  }

  await admin.staff.logout();
}

/** `total` points as the fewest commits the per-scan cap allows. */
function splitIntoCommits(total: number, cap: number): number[] {
  const commits: number[] = [];
  for (let left = total; left > 0; left -= cap) commits.push(Math.min(cap, left));
  return commits;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
