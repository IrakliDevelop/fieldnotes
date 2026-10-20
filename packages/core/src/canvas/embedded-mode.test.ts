// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextMenu } from './context-menu';
import { EmbeddedMode } from './embedded-mode';

function setup(isMenuOpen = () => false, onDisengage: () => void = vi.fn()) {
  const wrapper = document.createElement('div');
  document.body.appendChild(wrapper);
  const mode = new EmbeddedMode({ wrapper, isMenuOpen, onDisengage });
  return { wrapper, mode };
}

function pressEscape(target: EventTarget = document.body, init: KeyboardEventInit = {}): Event {
  const e = new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(e);
  return e;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('EmbeddedMode', () => {
  it('starts disengaged with manipulation and overscroll auto', () => {
    const { wrapper, mode } = setup();
    expect(mode.isEngaged()).toBe(false);
    expect(wrapper.style.touchAction).toBe('manipulation');
    expect(wrapper.style.overscrollBehavior).toBe('auto');
  });

  it('engage sets touch-action none and emits true once', () => {
    const { wrapper, mode } = setup();
    const listener = vi.fn();
    mode.onChange(listener);
    mode.setEngaged(true);
    expect(mode.isEngaged()).toBe(true);
    expect(wrapper.style.touchAction).toBe('none');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(true);
  });

  it('setting the same value emits nothing', () => {
    const onDisengage = vi.fn();
    const { mode } = setup(() => false, onDisengage);
    const listener = vi.fn();
    mode.onChange(listener);
    mode.setEngaged(false);
    mode.setEngaged(true);
    mode.setEngaged(true);
    expect(listener).toHaveBeenCalledTimes(1);
    mode.setEngaged(false);
    mode.setEngaged(false);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(onDisengage).toHaveBeenCalledTimes(1);
  });

  it('disengage calls onDisengage before listeners', () => {
    const order: string[] = [];
    const { wrapper, mode } = setup(
      () => false,
      () => void order.push('onDisengage'),
    );
    mode.setEngaged(true);
    mode.onChange((engaged) => order.push(`listener:${engaged}`));
    mode.setEngaged(false);
    expect(order).toEqual(['onDisengage', 'listener:false']);
    expect(wrapper.style.touchAction).toBe('manipulation');
  });

  it('unsubscribe stops a listener', () => {
    const { mode } = setup();
    const listener = vi.fn();
    mode.onChange(listener)();
    mode.setEngaged(true);
    expect(listener).not.toHaveBeenCalled();
  });

  it('acceptsPointer rejects touch only while disengaged', () => {
    const { mode } = setup();
    expect(mode.acceptsPointer('touch')).toBe(false);
    expect(mode.acceptsPointer('mouse')).toBe(true);
    expect(mode.acceptsPointer('pen')).toBe(true);
    mode.setEngaged(true);
    expect(mode.acceptsPointer('touch')).toBe(true);
    expect(mode.acceptsPointer('mouse')).toBe(true);
    expect(mode.acceptsPointer('pen')).toBe(true);
  });

  it('Escape on body disengages', () => {
    const { mode } = setup();
    mode.setEngaged(true);
    pressEscape();
    expect(mode.isEngaged()).toBe(false);
  });

  it('Escape while disengaged does nothing', () => {
    const { mode } = setup();
    const listener = vi.fn();
    mode.onChange(listener);
    pressEscape();
    expect(listener).not.toHaveBeenCalled();
  });

  it('Escape in a text input, with the menu open, or already defaultPrevented does not disengage', () => {
    let menuOpen = false;
    const { mode } = setup(() => menuOpen);
    mode.setEngaged(true);

    const input = document.createElement('input');
    document.body.appendChild(input);
    pressEscape(input);
    expect(mode.isEngaged()).toBe(true);

    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    document.body.appendChild(editable);
    pressEscape(editable);
    expect(mode.isEngaged()).toBe(true);

    menuOpen = true;
    pressEscape();
    expect(mode.isEngaged()).toBe(true);
    menuOpen = false;

    const handler = (e: Event) => e.preventDefault();
    document.addEventListener('keydown', handler, true);
    pressEscape();
    document.removeEventListener('keydown', handler, true);
    expect(mode.isEngaged()).toBe(true);
  });

  it('Escape on a focused checkbox disengages', () => {
    const { mode } = setup();
    mode.setEngaged(true);
    const box = document.createElement('input');
    box.type = 'checkbox';
    document.body.appendChild(box);
    box.focus();
    pressEscape(box);
    expect(mode.isEngaged()).toBe(false);
  });

  it('after destroy Escape emits nothing', () => {
    const { mode } = setup();
    mode.setEngaged(true);
    const listener = vi.fn();
    mode.onChange(listener);
    mode.destroy();
    pressEscape();
    expect(listener).not.toHaveBeenCalled();
    expect(mode.isEngaged()).toBe(true);
  });

  it('context menu opened before engaging consumes Escape', () => {
    const menu = new ContextMenu({ onCommand: vi.fn(), onClose: vi.fn() });
    menu.open([{ label: 'Copy', action: 'copy' }], { x: 0, y: 0 });
    const { mode } = setup(() => menu.isOpen());
    mode.setEngaged(true);
    pressEscape();
    expect(menu.isOpen()).toBe(false);
    expect(mode.isEngaged()).toBe(true);
  });
});
