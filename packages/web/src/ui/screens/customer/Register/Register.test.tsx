import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
}));

import { Register } from './Register';
import { ServicesProvider } from '../../../common/ServicesContext';
import type { Services } from '../../../../services/Services';
import type { RegistrationDetails } from '../../../../services/CustomerService';
import { ApiError } from '../../../../services/errors';
import { validateRegistration } from '@cafe/shared/domain/validation';
import type { Customer } from '@cafe/shared/domain/models';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

const customer: Customer = {
  id: 'c1',
  token: 'tok-123456',
  shortCode: 'ABCD1234',
  displayName: 'Maria',
  email: 'maria@example.com',
  status: 'active',
  createdAt: new Date().toISOString(),
};

/**
 * A services-level stub that answers the way `CustomerService.selfRegister`
 * does: the shared validation first, then the server's answer.
 */
function registerStub(server: () => Promise<Customer> = async () => customer) {
  return vi.fn(async (details: RegistrationDetails) => {
    const errors = validateRegistration(details);
    if (errors.length > 0) return { ok: false, errors };
    return { ok: true, customer: await server() };
  });
}

function fakeServices(selfRegister = registerStub()): Services {
  return {
    customers: { selfRegister },
    identity: { set: vi.fn(), get: vi.fn(), clear: vi.fn() },
  } as unknown as Services;
}

async function mount(services: Services) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <ServicesProvider value={services}>
        <Register />
      </ServicesProvider>,
    );
  });
}

const nameInput = () => container.querySelector('input[autocomplete="name"]') as HTMLInputElement;
const emailInput = () => container.querySelector('input[type="email"]') as HTMLInputElement;
const fieldOf = (input: HTMLInputElement) => input.closest('.field') as HTMLElement;
const button = (label: string) =>
  Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent === label,
  ) as HTMLButtonElement;

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(
      input,
      value,
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function fillIn(name = 'Maria', email = 'maria@example.com') {
  await type(nameInput(), name);
  await type(emailInput(), email);
  await click(container.querySelector('[role="checkbox"]')!);
}

describe('Register', () => {
  it('marks nothing optional and carries no device-only caveat', async () => {
    await mount(fakeServices());
    expect(container.querySelector('.opt')).toBeNull();
    expect(container.textContent).not.toMatch(/optional|only on this device|leave it blank/i);
    expect(nameInput().required).toBe(true);
    expect(emailInput().required).toBe(true);
  });

  it('submits name, email and consent and opens the card — the server binds the device', async () => {
    const services = fakeServices();
    await mount(services);
    await fillIn();
    await click(button('Create my card'));

    expect(services.customers.selfRegister).toHaveBeenCalledWith({
      displayName: 'Maria',
      email: 'maria@example.com',
      consent: true,
    });
    // `POST /customers` binds this device; the screen writes nothing to IdentityStore.
    expect(services.identity.set).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(`/card/${customer.token}`, { replace: true });
  });

  it('requires a name and an email', async () => {
    const services = fakeServices();
    await mount(services);
    await click(container.querySelector('[role="checkbox"]')!);
    await click(button('Create my card'));

    expect(fieldOf(nameInput()).textContent).toContain('Enter your name.');
    expect(fieldOf(emailInput()).textContent).toContain('Enter your email address.');
    expect(nameInput().getAttribute('aria-invalid')).toBe('true');
    expect(emailInput().getAttribute('aria-invalid')).toBe('true');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('on email_in_use, flags the email and offers recovery with the address prefilled', async () => {
    const services = fakeServices(
      registerStub(async () => {
        throw new ApiError({ kind: 'email_in_use' });
      }),
    );
    await mount(services);
    await fillIn('Maria', ' maria@example.com ');
    await click(button('Create my card'));

    expect(fieldOf(emailInput()).textContent).toContain('This email already has a card.');
    expect(emailInput().getAttribute('aria-invalid')).toBe('true');
    expect(container.querySelector('.register-form-error')).toBeNull();

    await click(button('Get my card back'));
    expect(navigate).toHaveBeenCalledWith('/lost', { state: { email: 'maria@example.com' } });
  });

  it('drops the recovery offer once the email is edited', async () => {
    const services = fakeServices(
      registerStub(async () => {
        throw new ApiError({ kind: 'email_in_use' });
      }),
    );
    await mount(services);
    await fillIn();
    await click(button('Create my card'));
    expect(button('Get my card back')).toBeDefined();

    await type(emailInput(), 'other@example.com');
    expect(button('Get my card back')).toBeUndefined();
    expect(emailInput().getAttribute('aria-invalid')).toBe('false');
  });

  it('on invalid_details, flags both fields rather than the form', async () => {
    const services = fakeServices(
      registerStub(async () => {
        throw new ApiError({ kind: 'rejected', code: 'invalid_details' });
      }),
    );
    await mount(services);
    await fillIn();
    await click(button('Create my card'));

    expect(fieldOf(nameInput()).textContent).toContain('Check your name');
    expect(fieldOf(emailInput()).textContent).toContain('Check your email address');
    expect(container.querySelector('.register-form-error')).toBeNull();
  });

  it('keeps the generic form error for anything else', async () => {
    const services = fakeServices(
      registerStub(async () => {
        throw new ApiError({ kind: 'offline' });
      }),
    );
    await mount(services);
    await fillIn();
    await click(button('Create my card'));

    expect(container.querySelector('.register-form-error')?.textContent).toContain(
      'Could not create your card',
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it('the privacy notice says name and email are collected, and nothing about anonymity', async () => {
    await mount(fakeServices());
    await click(container.querySelector('.privacy-link')!);
    const notice = document.querySelector('.privacy')?.textContent ?? '';
    expect(notice).toContain('your name and your email address');
    expect(notice).not.toMatch(/optional|anonymous|wallet/i);
  });
});
