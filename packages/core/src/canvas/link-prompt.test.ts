/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openLinkPrompt } from './link-prompt';

const opened: (() => void)[] = [];

function setup(initialValue = '') {
  const wrapper = document.createElement('div');
  wrapper.tabIndex = 0;
  document.body.append(wrapper);
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  const close = openLinkPrompt({
    container: document.body,
    wrapper,
    initialValue,
    onSubmit,
    onClose,
  });
  opened.push(close);
  const input = document.querySelector<HTMLInputElement>('.fieldnotes-palette-input');
  if (!input) throw new Error('link prompt input not mounted');
  return { wrapper, onSubmit, onClose, close, input };
}

function press(target: HTMLElement, key: string): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

function mounted(): Element | null {
  return document.querySelector('[role="dialog"][aria-label="Link"]');
}

afterEach(() => {
  for (const close of opened.splice(0)) close();
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('openLinkPrompt', () => {
  it('Enter submits the normalized link, removes the root and closes once', () => {
    const { onSubmit, onClose, input, wrapper } = setup();
    input.value = 'example.com';
    press(input, 'Enter');
    expect(onSubmit).toHaveBeenCalledWith('https://example.com');
    expect(mounted()).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(wrapper);
  });

  it('Enter with a disallowed link marks the input invalid and stays open', () => {
    const { onSubmit, onClose, input } = setup();
    input.value = 'javascript:x';
    press(input, 'Enter');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(mounted()).not.toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    press(input, 'a');
    expect(input.hasAttribute('aria-invalid')).toBe(false);
  });

  it('Escape closes without submitting', () => {
    const { onSubmit, onClose, input } = setup('https://x.y');
    press(input, 'Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(mounted()).toBeNull();
  });

  it('an outside pointerdown closes without submitting', () => {
    vi.useFakeTimers();
    const { onSubmit, onClose, wrapper } = setup('https://x.y');
    vi.runAllTimers();
    wrapper.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(mounted()).toBeNull();
  });

  it('Enter with an empty value submits null', () => {
    const { onSubmit, input } = setup('https://x.y');
    input.value = '   ';
    press(input, 'Enter');
    expect(onSubmit).toHaveBeenCalledWith(null);
    expect(mounted()).toBeNull();
  });

  it('the input holds the initial value and has focus', () => {
    const { input } = setup('https://x.y');
    expect(input.value).toBe('https://x.y');
    expect(document.activeElement).toBe(input);
    expect(mounted()?.getAttribute('aria-modal')).toBe('true');
  });

  it('close twice calls onClose once', () => {
    const { close, onClose } = setup();
    close();
    close();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
