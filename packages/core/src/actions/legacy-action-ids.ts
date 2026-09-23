/**
 * Exact legacy-to-canonical alias table. The `tool:` prefix is handled
 * separately in {@link resolveActionId}.
 */
export const LEGACY_ACTION_IDS: Readonly<Record<string, string>> = {
  undo: 'edit.undo',
  redo: 'edit.redo',
  cut: 'edit.cut',
  copy: 'edit.copy',
  paste: 'edit.paste',
  duplicate: 'edit.duplicate',
  delete: 'edit.delete',
  'select-all': 'select.all',
  deselect: 'select.none',
  'cycle-selection': 'select.cycle',
  'cycle-selection-reverse': 'select.cycle-reverse',
  'z-front': 'arrange.bring-to-front',
  'z-forward': 'arrange.bring-forward',
  'z-backward': 'arrange.send-backward',
  'z-back': 'arrange.send-to-back',
  group: 'arrange.group',
  ungroup: 'arrange.ungroup',
  'toggle-lock': 'arrange.toggle-lock',
  'rotate-cw': 'arrange.rotate-cw',
  'rotate-ccw': 'arrange.rotate-ccw',
  'nudge-left': 'arrange.nudge-left',
  'nudge-right': 'arrange.nudge-right',
  'nudge-up': 'arrange.nudge-up',
  'nudge-down': 'arrange.nudge-down',
  'zoom-in': 'view.zoom-in',
  'zoom-out': 'view.zoom-out',
  'zoom-reset': 'view.zoom-reset',
  'zoom-fit': 'view.zoom-to-fit',
};

/**
 * Resolve a legacy action id to its canonical form. Exact table entries are
 * checked first, then the `tool:` prefix is normalised to `tool.`. Unknown and
 * already-canonical ids are returned unchanged.
 */
export function resolveActionId(id: string): string {
  const exact = LEGACY_ACTION_IDS[id];
  if (exact !== undefined) {
    return exact;
  }
  if (id.startsWith('tool:')) {
    return 'tool.' + id.slice(5);
  }
  return id;
}
