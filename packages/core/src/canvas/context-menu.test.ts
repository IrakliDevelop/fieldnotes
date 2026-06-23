// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { ContextMenu } from './context-menu';

describe('ContextMenu', () => {
  it('renders one button per item and fires onCommand then closes', () => {
    const onCommand = vi.fn();
    const onClose = vi.fn();
    const menu = new ContextMenu({ onCommand, onClose });
    menu.open(
      [
        { label: 'Copy', action: 'copy' },
        { label: 'Delete', action: 'delete' },
      ],
      { x: 10, y: 10 },
    );
    const root = document.querySelector('.fieldnotes-context-menu') as HTMLElement;
    expect(root).toBeTruthy();
    const buttons = root.querySelectorAll('.fieldnotes-context-menu-item');
    expect(buttons.length).toBe(2);
    (buttons[0] as HTMLButtonElement).click();
    expect(onCommand).toHaveBeenCalledWith('copy');
    expect(menu.isOpen()).toBe(false);
    expect(onClose).toHaveBeenCalled();
    menu.dispose();
  });

  it('closes on Escape', () => {
    const menu = new ContextMenu({ onCommand: vi.fn(), onClose: vi.fn() });
    menu.open([{ label: 'Copy', action: 'copy' }], { x: 0, y: 0 });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(menu.isOpen()).toBe(false);
    menu.dispose();
  });

  it('does not fire a disabled item', () => {
    const onCommand = vi.fn();
    const menu = new ContextMenu({ onCommand, onClose: vi.fn() });
    menu.open([{ label: 'Paste', action: 'paste', disabled: true }], { x: 0, y: 0 });
    const btn = document.querySelector('.fieldnotes-context-menu-item') as HTMLButtonElement;
    btn.click();
    expect(onCommand).not.toHaveBeenCalled();
    menu.dispose();
  });

  it('re-opening closes the previous menu (single instance)', () => {
    const menu = new ContextMenu({ onCommand: vi.fn(), onClose: vi.fn() });
    menu.open([{ label: 'Copy', action: 'copy' }], { x: 0, y: 0 });
    menu.open([{ label: 'Delete', action: 'delete' }], { x: 5, y: 5 });
    expect(document.querySelectorAll('.fieldnotes-context-menu').length).toBe(1);
    menu.dispose();
  });
});
