/**
 * Welcome (unrecognized-visitor landing) navigation smoke test.
 *
 * Confirms the landing CTAs actually route — "Create your card" → /register and
 * "I already have one" → /lost — so a fresh visitor isn't stranded.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Welcome } from '../../../src/ui/screens/customer/Welcome';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function mountWelcome() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/welcome']}>
        <Routes>
          <Route path="/welcome" element={<Welcome />} />
          <Route path="/register" element={<div>REGISTER SCREEN</div>} />
          <Route path="/lost" element={<div>LOST SCREEN</div>} />
        </Routes>
      </MemoryRouter>,
    );
  });
}

function clickByText(text: string) {
  const btn = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
    (b.textContent ?? '').includes(text),
  );
  if (!btn) throw new Error(`Button "${text}" not found`);
  act(() => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('Welcome landing navigation', () => {
  it('"Create your card" routes to Register', async () => {
    await mountWelcome();
    clickByText('Create your card');
    expect(container.textContent).toContain('REGISTER SCREEN');
  });

  it('"I already have one" routes to Lost card', async () => {
    await mountWelcome();
    clickByText('I already have one');
    expect(container.textContent).toContain('LOST SCREEN');
  });
});
