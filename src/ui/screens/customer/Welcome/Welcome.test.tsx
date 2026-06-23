import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
}));

import { Welcome } from './Welcome';
import { ROUTES } from '../../../app/routes';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

async function mount(node: React.ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(node);
  });
}

function clickButton(label: string) {
  const btn = Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent === label,
  ) as HTMLButtonElement;
  expect(btn).toBeTruthy();
  act(() => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('Welcome', () => {
  it('renders the forest hero and find-us block', async () => {
    await mount(<Welcome />);
    expect(container.querySelector('.screen.bg-forest')).not.toBeNull();
    expect(container.querySelector('.welcome-headline')?.textContent).toContain(
      'Every coffee counts.',
    );
    expect(container.querySelector('.findus')).not.toBeNull();
  });

  it('routes to register from "Create your card"', async () => {
    await mount(<Welcome />);
    clickButton('Create your card');
    expect(navigate).toHaveBeenCalledWith(ROUTES.register);
  });

  it('routes to lost from "I already have one"', async () => {
    await mount(<Welcome />);
    clickButton('I already have one');
    expect(navigate).toHaveBeenCalledWith(ROUTES.lost);
  });
});
