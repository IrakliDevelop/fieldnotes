import type { Viewport } from '@fieldnotes/core';

// Each of these could remove or clone an adopted server-rendered node; select.cycle traps Tab.
const LOCKED = [
  'edit.delete',
  'edit.cut',
  'edit.copy',
  'edit.paste',
  'edit.duplicate',
  'select.cycle',
  'select.cycle-reverse',
];

/** Disables every shortcut that could detach or clone an adopted hero node, or trap Tab. */
export function lockdown(viewport: Viewport): void {
  for (const id of LOCKED) viewport.shortcuts.disable(id);
}
