import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const navigate = vi.fn();
let locationState: unknown = null;
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  useLocation: () => ({ state: locationState }),
}));

import { LostCard } from './LostCard';
import { ServicesProvider } from '../../../common/ServicesContext';
import type { Services } from '../../../../services/Services';
import { ApiError } from '../../../../services/errors';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
  locationState = null;
});

function fakeServices(
  request = vi.fn().mockResolvedValue(undefined),
  consume = vi.fn().mockResolvedValue({ token: 'tok-back' }),
): Services {
  return { recovery: { request, consume } } as unknown as Services;
}

async function mount(services: Services) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <ServicesProvider value={services}>
        <LostCard />
      </ServicesProvider>,
    );
  });
}

const emailInput = () => container.querySelector('input[type="email"]') as HTMLInputElement;
const codeInput = () =>
  container.querySelector('input[autocomplete="one-time-code"]') as HTMLInputElement;
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

async function toCodeStep(services: Services, email = 'maria@example.com') {
  await mount(services);
  await type(emailInput(), email);
  await click(button('Send me a code'));
}

describe('LostCard', () => {
  it('requests a code and moves to the waiting-for-code step', async () => {
    const services = fakeServices();
    await toCodeStep(services);

    expect(services.recovery.request).toHaveBeenCalledWith('maria@example.com');
    const sent = container.querySelector('.lost-sent')?.textContent ?? '';
    expect(sent).toContain('maria@example.com');
    expect(sent).toContain('6-character code');
    expect(sent).toContain('15 minutes');
    expect(codeInput()).not.toBeNull();
    expect(emailInput()).toBeNull();
  });

  it('never mentions a link, and has no "no email on your card" path', async () => {
    const services = fakeServices();
    await mount(services);
    expect(container.textContent).not.toMatch(/link|No email on your card/i);
    await type(emailInput(), 'maria@example.com');
    await click(button('Send me a code'));
    expect(container.textContent).not.toMatch(/link/i);
  });

  it('prefills the email handed over by Register', async () => {
    locationState = { email: 'maria@example.com' };
    await mount(fakeServices());
    expect(emailInput().value).toBe('maria@example.com');
  });

  it('upper-cases the code as typed and restores the card on success', async () => {
    const services = fakeServices();
    await toCodeStep(services);

    await type(codeInput(), 'k39-xq4');
    expect(codeInput().value).toBe('K39-XQ4');
    await click(button('Restore my card'));

    expect(services.recovery.consume).toHaveBeenCalledWith('maria@example.com', 'K39-XQ4');
    expect(navigate).toHaveBeenCalledWith('/card/tok-back', { replace: true });
  });

  it('shows a field error when the code does not work', async () => {
    const services = fakeServices(undefined, vi.fn().mockResolvedValue(null));
    await toCodeStep(services);

    await type(codeInput(), 'WRONG1');
    await click(button('Restore my card'));

    const field = codeInput().closest('.field') as HTMLElement;
    expect(field.textContent).toContain('That code didn’t work. Check it, or send a new one.');
    expect(codeInput().getAttribute('aria-invalid')).toBe('true');
    expect(navigate).not.toHaveBeenCalled();
    // Nothing says how many tries are left, or that there is a limit.
    expect(container.textContent).not.toMatch(/attempt|tries|locked/i);
  });

  it('shows the generic form error when the check itself fails', async () => {
    const services = fakeServices(
      undefined,
      vi.fn().mockRejectedValue(new ApiError({ kind: 'offline' })),
    );
    await toCodeStep(services);
    await type(codeInput(), 'ABC123');
    await click(button('Restore my card'));

    expect(container.querySelector('.lost-form-error')?.textContent).toContain(
      'Could not check the code',
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it('sends a new code to the same address', async () => {
    const services = fakeServices();
    await toCodeStep(services);
    await type(codeInput(), 'OLD123');

    await click(button('Send a new code'));
    expect(services.recovery.request).toHaveBeenCalledTimes(2);
    expect(services.recovery.request).toHaveBeenLastCalledWith('maria@example.com');
    expect(container.querySelector('.lost-resent')?.textContent).toContain('We sent a new code');
    expect(codeInput().value).toBe('');
  });

  it('goes back to the email step to use a different address', async () => {
    const services = fakeServices();
    await toCodeStep(services);

    await click(button('Use a different email'));
    expect(codeInput()).toBeNull();
    expect(emailInput().value).toBe('maria@example.com');
  });

  it('shows the form error when the code cannot be sent', async () => {
    const services = fakeServices(vi.fn().mockRejectedValue(new ApiError({ kind: 'offline' })));
    await toCodeStep(services);
    expect(container.querySelector('.lost-form-error')?.textContent).toContain(
      'Could not send the code',
    );
    expect(codeInput()).toBeNull();
  });

  it('says a rate limit is a wait, not a connection problem', async () => {
    const services = fakeServices(
      undefined,
      vi.fn().mockRejectedValue(new ApiError({ kind: 'rate_limited', retryAfterSec: 600 })),
    );
    await toCodeStep(services);
    await type(codeInput(), 'ABC123');
    await click(button('Restore my card'));

    const error = container.querySelector('.lost-form-error')?.textContent ?? '';
    expect(error).toContain('Too many tries');
    expect(error).not.toMatch(/connection/i);
  });

  it('tells a till to restore the card on the customer’s own phone', async () => {
    const services = fakeServices(
      undefined,
      vi.fn().mockRejectedValue(new ApiError({ kind: 'forbidden', code: 'staff_device' })),
    );
    await toCodeStep(services);
    await type(codeInput(), 'ABC123');
    await click(button('Restore my card'));

    expect(container.querySelector('.lost-form-error')?.textContent).toContain(
      'signed in as a till',
    );
  });
});
